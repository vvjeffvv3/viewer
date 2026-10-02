import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const parameters = { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 };
export const sessionCookieName = 'paperflip_session';

export class AuthError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message); this.status = status; this.retryAfter = retryAfter;
  }
}

function validRecord(record) {
  return record?.version === 1 && record.algorithm === 'scrypt'
    && record.N === parameters.N && record.r === parameters.r && record.p === parameters.p
    && typeof record.salt === 'string' && typeof record.hash === 'string'
    && /^[a-f0-9]{64}$/.test(record.salt) && /^[a-f0-9]{128}$/.test(record.hash);
}

function cookieToken(header = '', name = sessionCookieName) {
  const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  const value = entry?.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

export function sessionCookie(token, name = sessionCookieName) {
  return name + '=' + token + '; Path=/; HttpOnly; SameSite=Strict';
}

export function expiredSessionCookie(name = sessionCookieName) {
  return name + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

export class ReaderAuth {
  constructor({ filePath = null, sessionLifetimeMs = 8 * 60 * 60 * 1000, cooldownMs = 60000, maxFailures = 5, now = Date.now } = {}) {
    this.filePath = filePath; this.sessionLifetimeMs = sessionLifetimeMs;
    this.cooldownMs = cooldownMs; this.maxFailures = maxFailures; this.now = now;
    this.record = null; this.initializing = null; this.busy = false; this.cookieName = sessionCookieName;
    this.sessions = new Map(); this.failures = 0; this.blockedUntil = 0;
  }

  ready() {
    if (!this.initializing) this.initializing = this.load();
    return this.initializing;
  }

  async load() {
    if (!this.filePath) return;
    let data;
    try { data = await readFile(this.filePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw new AuthError(503, '비밀번호 설정을 읽지 못했습니다. 서버를 다시 실행해 주세요.');
    }
    try {
      const record = JSON.parse(data);
      if (!validRecord(record)) throw new Error();
      this.record = record;
    } catch (_) { throw new AuthError(503, '비밀번호 설정 파일을 확인할 수 없습니다.'); }
  }

  async status(header) {
    await this.ready();
    return { configured: Boolean(this.record), authenticated: this.authenticated(header) };
  }

  authenticated(header) {
    const token = cookieToken(header, this.cookieName), expiresAt = this.sessions.get(token);
    if (!token || !expiresAt || expiresAt <= this.now()) {
      if (token) this.sessions.delete(token);
      return false;
    }
    return true;
  }

  issueSession(previousHeader) {
    this.logout(previousHeader);
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= this.now()) this.sessions.delete(token);
    while (this.sessions.size >= 24) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, this.now() + this.sessionLifetimeMs);
    return token;
  }

  logout(header) { this.sessions.delete(cookieToken(header, this.cookieName)); }

  async setup(password, confirmation, previousHeader) {
    await this.ready();
    if (this.record) throw new AuthError(409, '비밀번호가 이미 설정되어 있습니다. 로그인해 주세요.');
    if (this.busy) throw new AuthError(429, '비밀번호를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.', 1);
    if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim()) {
      throw new AuthError(422, '비밀번호는 8자 이상, 128자 이하로 입력해 주세요.');
    }
    if (password !== confirmation) throw new AuthError(422, '두 비밀번호가 일치하지 않습니다.');
    this.busy = true;
    try {
      const salt = randomBytes(32), hash = await deriveKey(password, salt, 64, parameters);
      const record = { version: 1, algorithm: 'scrypt', N: parameters.N, r: parameters.r, p: parameters.p, salt: salt.toString('hex'), hash: hash.toString('hex') };
      if (this.filePath) {
        await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        try { await writeFile(this.filePath, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
        catch (error) {
          if (error.code === 'EEXIST') {
            await this.load();
            throw new AuthError(409, '비밀번호가 이미 설정되어 있습니다. 로그인해 주세요.');
          }
          throw new AuthError(503, '비밀번호를 저장하지 못했습니다. 다시 시도해 주세요.');
        }
      }
      this.record = record;
      return this.issueSession(previousHeader);
    } finally { this.busy = false; }
  }

  async login(password, previousHeader) {
    await this.ready();
    if (!this.record) throw new AuthError(409, '먼저 사용할 비밀번호를 설정해 주세요.');
    if (this.blockedUntil > this.now()) {
      throw new AuthError(429, '여러 번 틀렸습니다. 잠시 후 다시 입력해 주세요.', Math.ceil((this.blockedUntil - this.now()) / 1000));
    }
    if (this.blockedUntil) { this.failures = 0; this.blockedUntil = 0; }
    if (this.busy) throw new AuthError(429, '비밀번호를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.', 1);
    this.busy = true;
    try {
      let matched = false;
      if (typeof password === 'string' && password.length >= 1 && password.length <= 128) {
        const hash = await deriveKey(password, Buffer.from(this.record.salt, 'hex'), 64, parameters);
        matched = timingSafeEqual(hash, Buffer.from(this.record.hash, 'hex'));
      }
      if (!matched) {
        this.failures++;
        if (this.failures >= this.maxFailures) {
          this.blockedUntil = this.now() + this.cooldownMs;
          throw new AuthError(429, '여러 번 틀렸습니다. 잠시 후 다시 입력해 주세요.', Math.ceil(this.cooldownMs / 1000));
        }
        throw new AuthError(401, '비밀번호가 맞지 않습니다. 다시 입력해 주세요.');
      }
      this.failures = 0; this.blockedUntil = 0;
      return this.issueSession(previousHeader);
    } finally { this.busy = false; }
  }
}
