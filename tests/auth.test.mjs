import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReaderAuth, sessionCookie } from '../auth.mjs';

const password = 'temporary-test-password-한글';
function cookie(token) { return sessionCookie(token).split(';')[0]; }

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'paperflip-auth-test-'));
  if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('paperflip-auth-test-')) throw new Error('Unexpected temporary directory');
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('only a salted hash is persisted and a new process must authenticate again', async t => {
  const directory = await temporaryDirectory(t), filePath = path.join(directory, 'password.json');
  const first = new ReaderAuth({ filePath });
  const firstCookie = cookie(await first.setup(password, password));
  assert.equal(first.authenticated(firstCookie), true);
  const saved = await readFile(filePath, 'utf8');
  assert.equal(saved.includes(password), false);
  const record = JSON.parse(saved);
  assert.equal(record.algorithm, 'scrypt'); assert.equal(record.salt.length, 64); assert.equal(record.hash.length, 128);
  const restarted = new ReaderAuth({ filePath });
  assert.deepEqual(await restarted.status(firstCookie), { configured: true, authenticated: false });
  await assert.rejects(restarted.setup('different-password', 'different-password'), error => error.status === 409);
  const newCookie = cookie(await restarted.login(password));
  assert.equal(restarted.authenticated(newCookie), true);
  assert.equal(await readFile(filePath, 'utf8'), saved, 'login must not rewrite the password record');
});

test('sessions expire and repeated guesses enforce a cooldown before another verification', async () => {
  let time = 1000;
  const auth = new ReaderAuth({ now: () => time, sessionLifetimeMs: 1000, cooldownMs: 2000, maxFailures: 2 });
  const initial = cookie(await auth.setup(password, password));
  time += 1001;
  assert.equal(auth.authenticated(initial), false);
  await assert.rejects(auth.login('incorrect-password'), error => error.status === 401);
  await assert.rejects(auth.login('incorrect-password'), error => error.status === 429 && error.retryAfter === 2);
  await assert.rejects(auth.login(password), error => error.status === 429);
  time += 2001;
  assert.equal(auth.authenticated(cookie(await auth.login(password))), true);
});

test('an unreadable password record fails closed instead of reopening first-time setup', async t => {
  const directory = await temporaryDirectory(t), filePath = path.join(directory, 'password.json');
  await writeFile(filePath, '{broken-record');
  const auth = new ReaderAuth({ filePath });
  await assert.rejects(auth.status(), error => error.status === 503);
  await assert.rejects(auth.setup(password, password), error => error.status === 503);
  assert.equal(await readFile(filePath, 'utf8'), '{broken-record');
});
