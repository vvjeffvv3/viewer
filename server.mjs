import http from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReaderAuth, AuthError, sessionCookie, expiredSessionCookie, sessionCookieName } from './auth.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const publicFiles = new Set(['/login.html', '/src/auth.js', '/src/auth.css']);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    request.resume(); throw new AuthError(415, '요청 형식을 확인해 주세요.');
  }
  return new Promise((resolve, reject) => {
    let size = 0, exceeded = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) {
        if (!exceeded) reject(new AuthError(413, '입력한 내용이 너무 깁니다.'));
        exceeded = true; chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch (_) { reject(new AuthError(400, '입력한 내용을 확인해 주세요.')); }
    });
    request.on('error', () => reject(new AuthError(400, '요청을 읽지 못했습니다.')));
    request.on('aborted', () => reject(new AuthError(400, '요청이 중단되었습니다.')));
  });
}
function localOrigin(request) {
  let host;
  try { host = new URL('http://' + request.headers.host); } catch (_) { return null; }
  if (!['127.0.0.1', 'localhost'].includes(host.hostname) || host.username || host.password
    || host.pathname !== '/' || host.search || host.hash || Number(host.port || 80) !== request.socket.localPort) return null;
  return host.origin;
}

export function createReaderServer(root = projectRoot, { controlToken = '', instanceId = '', onShutdown = null, auth = null } = {}) {
  const absoluteRoot = path.resolve(root);
  const passwordAuth = auth || new ReaderAuth({ filePath: path.join(absoluteRoot, '.private', 'password.json') });
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    try {
      const origin = localOrigin(request);
      if (!origin) { request.resume(); json(response, 403, { message: '접근할 수 없는 주소입니다.' }); return; }
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, origin).pathname); }
      catch (_) { response.writeHead(400); response.end('Invalid URL'); return; }
      if (pathname.includes('\0')) { response.writeHead(400); response.end('Invalid path'); return; }

      if (pathname === '/api/shutdown' && request.method === 'POST') {
        if (!controlToken || !onShutdown || request.headers['x-paperflip-control'] !== controlToken) {
          response.writeHead(403); response.end('Forbidden'); return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.once('finish', onShutdown); response.end(JSON.stringify({ stopped: true })); return;
      }
      if (['/api/auth/setup', '/api/auth/login', '/api/auth/logout'].includes(pathname)) {
        if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end(); return; }
        if (request.headers.origin !== origin) {
          request.resume(); throw new AuthError(403, '이 사이트의 로그인 화면에서 다시 시도해 주세요.');
        }
        const body = await readJson(request);
        if (pathname === '/api/auth/logout') {
          passwordAuth.logout(request.headers.cookie);
          response.setHeader('Set-Cookie', expiredSessionCookie(passwordAuth.cookieName));
          json(response, 200, { ok: true }); return;
        }
        const token = pathname.endsWith('/setup')
          ? await passwordAuth.setup(body.password, body.confirmation, request.headers.cookie)
          : await passwordAuth.login(body.password, request.headers.cookie);
        response.setHeader('Set-Cookie', sessionCookie(token, passwordAuth.cookieName));
        json(response, 200, { ok: true }); return;
      }

      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return;
      }
      if (pathname === '/api/health') {
        const body = JSON.stringify({ app: 'paperflip', version: '1.3.0', projectRoot: absoluteRoot, instanceId, managedControl: Boolean(controlToken && onShutdown) });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(request.method === 'HEAD' ? undefined : body); return;
      }
      if (pathname === '/api/auth/status') {
        const state = await passwordAuth.status(request.headers.cookie);
        if (request.method === 'HEAD') { response.writeHead(200); response.end(); return; }
        json(response, 200, state); return;
      }
      if (pathname === '/') pathname = '/index.html';
      if (!publicFiles.has(pathname)) {
        const state = await passwordAuth.status(request.headers.cookie);
        if (!state.authenticated) {
          if (pathname === '/index.html') { response.writeHead(303, { Location: '/login.html' }); response.end(); }
          else json(response, 401, { message: '비밀번호를 입력해 먼저 로그인해 주세요.' });
          return;
        }
      }
      if (pathname !== '/index.html' && pathname !== '/login.html' && !pathname.startsWith('/src/') && !pathname.startsWith('/assets/')) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const filePath = path.resolve(absoluteRoot, '.' + pathname);
      if (!filePath.startsWith(absoluteRoot + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
      const relative = path.relative(absoluteRoot, filePath);
      if (relative.split(path.sep).some(part => part.startsWith('.')) ||
        !['index.html', 'login.html'].includes(relative) && !relative.startsWith('src' + path.sep) && !relative.startsWith('assets' + path.sep)) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      const contentType = contentTypes[path.extname(filePath).toLowerCase()];
      if (!contentType) { response.writeHead(404); response.end('Not found'); return; }
      try {
        const body = await readFile(filePath);
        response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (_) { response.writeHead(404); response.end('Not found'); }
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const known = error instanceof AuthError;
      if (known && error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      json(response, known ? error.status : 503, { message: known ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  });
  server.on('listening', () => {
    // Cookies are shared across ports; separate local preview sessions by port.
    passwordAuth.cookieName = sessionCookieName + '_' + server.address().port;
  });
  return server;
}

async function runLocalServer() {
  const portIndex = process.argv.indexOf('--port');
  const portArgument = portIndex >= 0 ? process.argv[portIndex + 1] : '8787';
  const port = Number(portArgument);
  if (!/^\d+$/.test(portArgument || '') || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('포트는 1부터 65535 사이의 숫자로 지정해 주세요.');
  }
  const auth = new ReaderAuth({ filePath: path.join(projectRoot, '.private', 'password.json') });
  await auth.ready();
  const controlToken = randomBytes(24).toString('hex'), instanceId = randomUUID();
  const controlPath = path.join(projectRoot, '.logs', 'server-control.json');
  const server = createReaderServer(projectRoot, {
    controlToken, instanceId, auth,
    onShutdown: () => {
      server.close(async () => {
        try {
          const current = JSON.parse(await readFile(controlPath, 'utf8'));
          if (current.instanceId === instanceId) await unlink(controlPath);
        } catch (_) {}
        process.exit(0);
      });
      server.closeIdleConnections?.();
    }
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? port + ' 포트가 사용 중입니다. --port 옵션으로 다른 포트를 선택해 주세요.' : '서버를 시작하지 못했습니다.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', async () => {
    try {
      await mkdir(path.dirname(controlPath), { recursive: true });
      await writeFile(controlPath, JSON.stringify({ app: 'paperflip', projectRoot, instanceId, port, token: controlToken }), { mode: 0o600 });
      console.log('Paperflip 준비: http://127.0.0.1:' + port);
    } catch (_) { console.error('서버 실행 기록을 저장하지 못했습니다. 프로젝트 폴더의 쓰기 권한을 확인해 주세요.'); server.close(() => process.exit(1)); }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
