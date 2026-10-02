const byId = id => document.getElementById(id);
const ui = {
  form: byId('entry-form'), fields: byId('entry-fields'), title: byId('entry-title'),
  description: byId('entry-description'), password: byId('entry-password'), confirmation: byId('entry-confirmation'),
  confirmField: byId('confirm-field'), tip: byId('password-tip'), submit: byId('entry-submit'),
  message: byId('entry-message'), retry: byId('entry-retry')
};
let setup = false, submitting = false, retryTimer = null;

function message(text) { ui.message.textContent = text; ui.message.hidden = !text; }
async function initialize() {
  ui.fields.disabled = true; ui.retry.hidden = true; message('');
  try {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
    const state = await response.json();
    if (!response.ok) throw new Error(state.message || '입장 화면을 열지 못했습니다.');
    if (state.authenticated) { location.replace('/'); return; }
    setup = !state.configured;
    ui.title.textContent = setup ? '내 서재의 비밀번호 만들기' : '내 서재의 문을 열어 주세요';
    ui.description.textContent = setup ? '처음 한 번만 설정하면 됩니다. 이후에는 이 비밀번호로 만화 컬렉션에 들어갈 수 있어요.' : '당신만 아는 비밀번호를 입력하고, 읽던 이야기를 이어 가세요.';
    ui.password.autocomplete = setup ? 'new-password' : 'current-password';
    ui.password.minLength = setup ? 8 : 1;
    ui.confirmField.hidden = !setup; ui.confirmation.required = setup; ui.tip.hidden = !setup;
    ui.submit.textContent = setup ? '비밀번호 정하고 시작하기' : '서재 들어가기';
    ui.fields.disabled = false;
  } catch (error) {
    message(error.message || '서버에 연결하지 못했습니다. 실행하기.cmd로 서버를 열고 다시 시도해 주세요.');
    ui.retry.hidden = false;
  }
}
function cooldown(seconds, text) {
  let remaining = Math.min(60, Math.max(1, seconds || 60));
  ui.fields.disabled = true;
  message(text + ' (' + remaining + '초 후 다시 입력)');
  clearInterval(retryTimer);
  retryTimer = setInterval(() => {
    remaining--;
    if (!remaining) { clearInterval(retryTimer); retryTimer = null; ui.fields.disabled = false; message('다시 비밀번호를 입력해 주세요.'); }
    else message(text + ' (' + remaining + '초 후 다시 입력)');
  }, 1000);
}
ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || retryTimer) return;
  if (setup && ui.password.value !== ui.confirmation.value) { message('두 비밀번호가 일치하지 않습니다.'); ui.confirmation.focus(); return; }
  submitting = true; ui.fields.disabled = true; message('');
  ui.submit.textContent = '비밀번호 확인 중…';
  try {
    const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ui.password.value, ...(setup ? { confirmation: ui.confirmation.value } : {}) })
    });
    const result = await response.json();
    if (response.ok) { ui.password.value = ''; ui.confirmation.value = ''; location.replace('/'); return; }
    ui.password.value = ''; ui.confirmation.value = '';
    if (response.status === 429) cooldown(Number(response.headers.get('Retry-After')), result.message);
    else if (response.status === 409) { await initialize(); message(result.message); }
    else message(result.message || '입장하지 못했습니다. 다시 시도해 주세요.');
  } catch (_) { message('서버에 연결하지 못했습니다. 실행하기.cmd로 서버를 열고 다시 시도해 주세요.'); }
  finally {
    submitting = false; ui.submit.textContent = setup ? '비밀번호 정하고 시작하기' : '서재 들어가기';
    if (!retryTimer) ui.fields.disabled = false;
  }
});
ui.retry.addEventListener('click', initialize);
initialize();
