'use strict';
/* ===== Start panelu: logowanie, weryfikacja uprawnień, status serwera ===== */

function showLogin(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#lg-err').textContent = msg || '';
  $('#lg-pass').value = '';
  setTimeout(() => ($('#lg-user').value ? $('#lg-pass') : $('#lg-user')).focus(), 50);
}

function logout(expired) {
  if (!expired && KC.token) request('/api/logout', 'POST', undefined, true).catch(() => {});
  KC.token = ''; KC.me = null; KC.meta = null;
  localStorage.removeItem('kc_admin_token');
  clearTimers();
  showLogin(expired ? 'Sesja wygasła — zaloguj się ponownie.' : '');
}

async function enter() {
  // weryfikacja uprawnień: tylko admin / moderator
  const me = await api('/me');
  KC.me = me;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#me-nm').textContent = me.username;
  $('#me-av').textContent = initial(me.username);
  $('#me-rl').textContent = (ROLE[me.role] || ROLE.player)[0];
  renderNav();
  refreshStatus();
  KC.statusTimer = KC.statusTimer || setInterval(refreshStatus, 20000);
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

async function refreshStatus() {
  if (!KC.me) return;
  try {
    const s = await api('/server/status');
    $('#online-n').textContent = s.online;
    $('#pill-maint').style.display = s.maintenance ? '' : 'none';
  } catch (e) { /* cichy błąd */ }
}

async function doLogin() {
  const u = $('#lg-user').value.trim(), p = $('#lg-pass').value;
  const err = $('#lg-err'), btn = $('#lg-btn');
  if (!u || !p) { err.textContent = 'Podaj login i hasło.'; return; }
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Sprawdzanie uprawnień…';
  try {
    const r = await request('/api/login', 'POST', { username: u, password: p }, false);
    KC.token = r.token; localStorage.setItem('kc_admin_token', r.token);
    try { await enter(); }
    catch (e) { // zalogowano, ale brak roli personelu
      request('/api/logout', 'POST', undefined, true).catch(() => {});
      KC.token = ''; KC.me = null; localStorage.removeItem('kc_admin_token');
      err.textContent = e.status === 403 ? 'To konto nie ma uprawnień do panelu administracyjnego.' : e.message;
    }
  } catch (e) { err.textContent = e.message; }
  btn.disabled = false; btn.textContent = 'Zaloguj do panelu';
}

$('#lg-btn').onclick = doLogin;
$('#lg-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('#lg-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lg-pass').focus(); });
$('#btn-logout').onclick = () => logout(false);
$('#btn-reload').onclick = () => route();
$('#burger').onclick = () => $('#side').classList.toggle('open');

(async () => {
  if (!KC.token) return showLogin();
  try { await enter(); } catch (e) { KC.token = ''; localStorage.removeItem('kc_admin_token'); showLogin(e.status === 403 ? e.message : ''); }
})();
