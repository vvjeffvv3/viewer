import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReaderServer } from '../server.mjs';
import { ReaderAuth } from '../auth.mjs';

const password = 'test-only-reader-password';
async function serverContext(t, options = {}) {
  const auth = options.auth || new ReaderAuth();
  const server = createReaderServer(undefined, { ...options, auth });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }));
  const port = server.address().port;
  const request = (pathname, { method = 'GET', cookie, body, origin, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const requestHeaders = { ...headers };
    if (payload !== undefined) requestHeaders['Content-Type'] ??= 'application/json';
    if (cookie) requestHeaders.Cookie = cookie;
    if (origin !== false && method === 'POST') requestHeaders.Origin = origin || 'http://127.0.0.1:' + port;
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: requestHeaders }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => text += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body: text, headers: response.headers }));
    });
    req.on('error', reject); req.end(payload);
  });
  return { request, auth };
}
function responseCookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }

test('the server blocks private pages and scripts until the password is set and authenticated', async t => {
  const { request } = await serverContext(t);
  const home = await request('/');
  assert.equal(home.status, 303); assert.equal(home.headers.location, '/login.html');
  assert.doesNotMatch(home.body, /panel-collection/);
  assert.equal((await request('/src/app.js')).status, 401);
  assert.equal((await request('/src/book-store.js')).status, 401);
  assert.equal((await request('/assets/cover.png')).status, 401);
  const entry = await request('/login.html');
  assert.equal(entry.status, 200); assert.match(entry.body, /type=\"password\"/);
  assert.equal((await request('/src/auth.js')).status, 200);
  assert.equal((await request('/src/auth.css')).status, 200);
  assert.deepEqual(JSON.parse((await request('/api/auth/status')).body), { configured: false, authenticated: false });
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: 'short', confirmation: 'short' } })).status, 422);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password, confirmation: 'different' } })).status, 422);

  const setup = await request('/api/auth/setup', { method: 'POST', body: { password, confirmation: password } });
  assert.equal(setup.status, 200);
  assert.match(setup.headers['set-cookie'][0], /HttpOnly/);
  assert.match(setup.headers['set-cookie'][0], /SameSite=Strict/);
  assert.doesNotMatch(setup.headers['set-cookie'][0], /Max-Age|Expires/);
  const cookie = responseCookie(setup);
  const unlocked = await request('/', { cookie });
  assert.equal(unlocked.status, 200); assert.match(unlocked.body, /panel-collection/);
  assert.doesNotMatch(unlocked.body, /codex-clipboard|data:image\/png;base64/);
  assert.match(unlocked.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(unlocked.headers['content-security-policy'], /form-action 'self'/);
  assert.equal((await request('/src/app.js', { cookie })).status, 200);
  assert.equal((await request('/src/access.js', { cookie })).status, 200);
  assert.equal((await request('/README.md', { cookie })).status, 404);
  assert.equal((await request('/auth.mjs', { cookie })).status, 404);
  assert.equal((await request('/.private/password.json', { cookie })).status, 404);
  assert.equal((await request('/.logs/server-control.json', { cookie })).status, 404);
  assert.equal((await request('/assets/%2e%2e%2f.private%2fpassword.json', { cookie })).status, 403);
  assert.equal((await request('/assets/%2e%2e%2f%2e%2e%2fsecret.png', { cookie })).status, 403);
  assert.equal((await request('/src/%00app.js', { cookie })).status, 400);
  assert.equal((await request('/', { cookie, method: 'HEAD' })).body, '');
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: { password: 'cannot-replace-password', confirmation: 'cannot-replace-password' } })).status, 409);
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  assert.equal(JSON.parse((await request('/api/health')).body).app, 'paperflip');
});

test('login rejects guesses, rotates sessions, and logout invalidates the old cookie', async t => {
  const { request } = await serverContext(t);
  const setup = await request('/api/auth/setup', { method: 'POST', body: { password, confirmation: password } });
  const oldCookie = responseCookie(setup);
  const incorrect = await request('/api/auth/login', { method: 'POST', body: { password: 'wrong-password' } });
  assert.equal(incorrect.status, 401); assert.equal(incorrect.headers['set-cookie'], undefined);
  const login = await request('/api/auth/login', { method: 'POST', cookie: oldCookie, body: { password } });
  assert.equal(login.status, 200);
  const cookie = responseCookie(login); assert.notEqual(cookie, oldCookie);
  assert.equal((await request('/', { cookie: oldCookie })).status, 303);
  assert.equal((await request('/', { cookie })).status, 200);
  assert.deepEqual(JSON.parse((await request('/api/auth/status', { cookie })).body), { configured: true, authenticated: true });
  const logout = await request('/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.equal(logout.status, 200); assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await request('/', { cookie })).status, 303);
  assert.equal((await request('/src/app.js', { cookie })).status, 401);
});

test('authentication rejects other origins, bad hosts, oversized and malformed payloads', async t => {
  const { request } = await serverContext(t);
  const body = { password, confirmation: password };
  assert.equal((await request('/api/auth/setup', { method: 'POST', body, origin: 'http://unrelated.example' })).status, 403);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body, origin: false })).status, 403);
  assert.equal((await request('/login.html', { headers: { Host: 'unrelated.example' } })).status, 403);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: 'null' })).status, 400);
  assert.equal((await request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: 'a'.repeat(5000) }) })).status, 413);
  assert.equal((await request('/api/auth/login')).status, 405);
  assert.deepEqual(JSON.parse((await request('/api/auth/status')).body), { configured: false, authenticated: false });
});

test('a managed server only accepts its own local shutdown token', async t => {
  let stopped = false;
  const { request } = await serverContext(t, { controlToken: 'test-only-token', instanceId: 'test-instance', onShutdown: () => { stopped = true; } });
  assert.equal((await request('/api/shutdown', { method: 'POST' })).status, 403); assert.equal(stopped, false);
  assert.equal((await request('/api/shutdown', { method: 'POST', headers: { 'X-Paperflip-Control': 'wrong-token' } })).status, 403);
  assert.equal((await request('/api/shutdown', { method: 'POST', headers: { 'X-Paperflip-Control': 'test-only-token' } })).status, 200);
  assert.equal(stopped, true);
});
