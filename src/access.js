async function checkAccess() {
  try {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
    const state = await response.json();
    if (response.ok && state.authenticated) { document.body.hidden = false; return true; }
  } catch (_) {}
  document.body.hidden = true;
  location.replace('/login.html');
  return false;
}

export async function requireAccess() {
  if (!await checkAccess()) throw new Error('로그인이 필요합니다.');
  window.addEventListener('pageshow', event => { if (event.persisted) { document.body.hidden = true; checkAccess(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { document.body.hidden = true; checkAccess(); } });
  setInterval(checkAccess, 60000);
}

export async function lockLibrary() {
  document.body.hidden = true;
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!response.ok) throw new Error();
    location.replace('/login.html');
  } catch (_) {
    document.body.hidden = false;
    throw new Error('서재를 잠그지 못했습니다. 다시 시도해 주세요.');
  }
}
