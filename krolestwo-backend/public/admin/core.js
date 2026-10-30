'use strict';
/* ===== Królestwo Cieni — panel admina: rdzeń (helpery, API, UI, wykresy, router) ===== */
const KC = { token: localStorage.getItem('kc_admin_token') || '', me: null, views: {}, acts: {}, meta: null, timers: [], current: null };

/* ---------- bezpieczne szablony HTML (auto-escape) ---------- */
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(String(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v == null || v === false) return '';
  return esc(v);
}
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return new Raw(out);
}
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const setHtml = (el, r) => { el.innerHTML = val(r); };
const icon = (n) => raw(`<svg><use href="#i-${n}"/></svg>`);

/* ---------- formatowanie ---------- */
const fmtNum = (n) => Number(n || 0).toLocaleString('pl-PL');
const fmtDate = (d) => (d ? new Date(d).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) : '');
function ago(d) {
  if (!d) return 'nigdy';
  const s = Math.max(0, (Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'przed chwilą';
  if (s < 3600) return Math.floor(s / 60) + ' min temu';
  if (s < 86400) return Math.floor(s / 3600) + ' godz. temu';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' dni temu';
  return fmtDate(d);
}
function fmtDur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return (d ? d + ' d ' : '') + (h ? h + ' godz. ' : '') + m + ' min';
}
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
const ROLE = { admin: ['Administrator', 'gold'], moderator: ['Moderator', 'violet'], player: ['Gracz', ''] };
const roleBadge = (r) => html`<span class="badge ${(ROLE[r] || ROLE.player)[1]}">${(ROLE[r] || ROLE.player)[0]}</span>`;
const isAdmin = () => KC.me && KC.me.role === 'admin';

/* ---------- API ---------- */
async function request(url, method = 'GET', body, auth = true) {
  const opts = { method, headers: {} };
  if (auth && KC.token) opts.headers.Authorization = 'Bearer ' + KC.token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opts); } catch (e) { throw new Error('Brak połączenia z serwerem.'); }
  let j = {};
  try { j = await r.json(); } catch (e) { /* brak JSON */ }
  if (r.status === 401 && auth && KC.me) { logout(true); throw new Error(j.error || 'Sesja wygasła — zaloguj się ponownie.'); }
  if (!r.ok) { const err = new Error(j.error || 'Błąd serwera (' + r.status + ')'); err.status = r.status; throw err; }
  return j;
}
const api = (path, method, body) => request('/api/admin' + path, method, body);
const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

async function downloadCsv(type) {
  try {
    const r = await fetch('/api/admin/reports/csv?type=' + type, { headers: { Authorization: 'Bearer ' + KC.token } });
    if (!r.ok) throw new Error('Nie udało się wygenerować raportu.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `raport-${type}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Raport pobrany.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- toasty ---------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, type === 'err' ? 5500 : 3200);
}
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'err'); } };

/* ---------- modale ---------- */
function modal({ title, body, footer, size = '', onMount }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-h"><h3></h3><button class="btn ghost icon" data-x aria-label="Zamknij">✕</button></div>
    <div class="modal-b"></div>${footer ? '<div class="modal-f"></div>' : ''}</div>`;
  $('h3', ov).textContent = title;
  const b = $('.modal-b', ov);
  if (body instanceof Raw) b.innerHTML = body.s; else if (body instanceof Node) b.appendChild(body);
  if (footer) { const f = $('.modal-f', ov); if (footer instanceof Raw) f.innerHTML = footer.s; else f.appendChild(footer); }
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $('[data-x]', ov).onclick = close;
  document.body.appendChild(ov);
  const first = $('input:not([type=checkbox]),select,textarea', b); if (first) first.focus();
  if (onMount) onMount(ov, close);
  return { el: ov, close, body: b };
}

function confirmBox({ title = 'Potwierdź', text, okLabel = 'Potwierdź', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({
      title, size: 'sm', body: html`<p style="margin:0;color:var(--dim)">${text}</p>`,
      footer: html`<button class="btn ghost" data-no>Anuluj</button><button class="btn ${danger ? 'danger' : 'gold'}" data-ok>${okLabel}</button>`,
    });
    $('[data-ok]', m.el).onclick = () => { m.close(); resolve(true); };
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-x]', m.el).addEventListener('click', () => resolve(false));
    $('[data-ok]', m.el).focus();
  });
}

/* ---------- formularze ----------
   fields: {key,label,type:text|number|textarea|select|checkbox|datetime|password|section,
            options:[{value,label}], min,max,step,hint,full,required,placeholder,readonly}                    */
function fieldHtml(f, v) {
  if (f.type === 'section') return html`<div class="sect">${f.label}</div>`;
  const id = 'f_' + f.key;
  const cls = f.full ? 'full' : '';
  if (f.type === 'checkbox') {
    return html`<div class="chk ${cls}"><input type="checkbox" id="${id}" name="${f.key}" ${v ? raw('checked') : ''}><label class="f" for="${id}">${f.label}</label></div>`;
  }
  let input;
  if (f.type === 'textarea') input = html`<textarea id="${id}" name="${f.key}" rows="${f.rows || 4}" placeholder="${f.placeholder || ''}">${v ?? ''}</textarea>`;
  else if (f.type === 'select') {
    input = html`<select id="${id}" name="${f.key}" data-num="${f.numeric ? 1 : ''}">${(f.options || []).map((o) =>
      html`<option value="${o.value ?? ''}" ${String(o.value ?? '') === String(v ?? '') ? raw('selected') : ''}>${o.label}</option>`)}</select>`;
  } else if (f.type === 'datetime') input = html`<input type="datetime-local" id="${id}" name="${f.key}" value="${toLocalInput(v)}">`;
  else if (f.type === 'number') input = html`<input type="number" id="${id}" name="${f.key}" value="${v ?? ''}" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" ${f.readonly ? raw('readonly') : ''}>`;
  else input = html`<input type="${f.type === 'password' ? 'password' : 'text'}" id="${id}" name="${f.key}" value="${v ?? ''}" placeholder="${f.placeholder || ''}" autocomplete="off" ${f.readonly ? raw('readonly') : ''} ${f.maxlength ? raw('maxlength="' + f.maxlength + '"') : ''}>`;
  return html`<div class="${cls}"><label class="f" for="${id}">${f.label}${f.required ? ' *' : ''}</label>${input}${f.hint ? html`<div class="hint">${f.hint}</div>` : ''}</div>`;
}
function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'section') continue;
    const el = $(`[name="${f.key}"]`, root);
    if (!el) continue;
    if (f.type === 'checkbox') out[f.key] = el.checked;
    else if (f.type === 'number') out[f.key] = el.value === '' ? null : Number(el.value);
    else if (f.type === 'datetime') out[f.key] = el.value ? new Date(el.value).toISOString() : null;
    else if (f.type === 'select' && f.numeric) out[f.key] = el.value === '' ? null : Number(el.value);
    else out[f.key] = el.value;
  }
  return out;
}
function formModal({ title, fields, values = {}, submitLabel = 'Zapisz', size = '', extra, side, onSubmit, onChange }) {
  const form = html`<form id="kc-form" onsubmit="return false"><div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.key]))}</div>${extra || ''}</form>`;
  const body = side ? html`<div class="split">${form}<aside class="side-pv">${side}</aside></div>` : form;
  const m = modal({
    title, size, body,
    footer: html`<span class="err" id="kc-err"></span><button class="btn ghost" data-no>Anuluj</button><button class="btn gold" data-ok>${submitLabel}</button>`,
  });
  const err = $('#kc-err', m.el), ok = $('[data-ok]', m.el);
  $('[data-no]', m.el).onclick = m.close;
  if (onChange) m.el.addEventListener('input', () => onChange(readForm(m.el, fields), m.el));
  if (onChange) onChange(readForm(m.el, fields), m.el);
  const submit = async () => {
    err.textContent = ''; ok.disabled = true;
    try { await onSubmit(readForm(m.el, fields), m.el); m.close(); }
    catch (e) { err.textContent = e.message; ok.disabled = false; }
  };
  ok.onclick = submit;
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); submit(); } });
  return m;
}

/* ---------- tabele ---------- */
function table(cols, rows, { empty = 'Brak danych' } = {}) {
  if (!rows.length) return html`<div class="empty"><b>⌛</b>${empty}</div>`;
  return html`<div class="table-wrap"><table><thead><tr>${cols.map((c) => html`<th class="${c.cls || ''}">${c.h}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr>${cols.map((c) => html`<td class="${c.cls || ''}">${c.cell(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}
function pager(total, page, limit) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return html`<div class="pager"><span>${fmtNum(total)} rekordów</span><span class="spacer"></span>
    <button class="btn sm" data-act="page" data-p="${page - 1}" ${page <= 1 ? raw('disabled') : ''}>‹ Poprzednia</button>
    <span>Strona ${page} / ${pages}</span>
    <button class="btn sm" data-act="page" data-p="${page + 1}" ${page >= pages ? raw('disabled') : ''}>Następna ›</button></div>`;
}
const searchBox = (id, ph, v = '') => html`<div class="search"><svg><use href="#i-search"/></svg><input id="${id}" placeholder="${ph}" value="${v}" autocomplete="off"></div>`;
function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const skeleton = () => html`<div class="grid g4" style="margin-bottom:18px">${[1, 2, 3, 4].map(() => html`<div class="skel" style="height:84px"></div>`)}</div><div class="skel" style="height:300px"></div>`;
const pageHead = (t, p, actions) => html`<div class="page-h"><div><h1>${t}</h1>${p ? html`<p>${p}</p>` : ''}</div><div class="spacer"></div>${actions || ''}</div>`;
const statCard = (ic, value, label, delta, tint, bad) => html`<div class="card stat" style="--tint:${tint || 'rgba(212,175,55,.14)'}"><div class="ic">${ic}</div>
  <div><div class="v">${value}</div><div class="l">${label}</div>${delta ? html`<div class="d ${bad ? 'bad' : ''}">${delta}</div>` : ''}</div></div>`;

/* ---------- wykresy SVG ---------- */
function barChart(items, { height = 190, grad = 'gBar', every = 1, unit = '' } = {}) {
  const W = 640, H = height, pad = { l: 8, r: 8, t: 22, b: 24 };
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = (W - pad.l - pad.r) / Math.max(1, items.length);
  const bars = items.map((it, i) => {
    const h = Math.max(it.value ? 3 : 0, (H - pad.t - pad.b) * (it.value / max));
    const x = pad.l + i * bw + bw * 0.16, w = bw * 0.68, y = H - pad.b - h;
    return `<g><rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" style="fill:url(#${grad})"><title>${esc(it.label)}: ${it.value}${unit}</title></rect>
      ${it.value ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" style="fill:var(--dim)">${it.value}</text>` : ''}
      ${i % every === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(it.label)}</text>` : ''}</g>`;
  }).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img"><line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="#2d2742"/>${bars}</svg>`);
}
function groupBars(labels, series, { height = 220, every = 1 } = {}) {
  const W = 640, H = height, pad = { l: 8, r: 8, t: 14, b: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gw = (W - pad.l - pad.r) / Math.max(1, labels.length), n = series.length;
  const out = labels.map((lb, i) => {
    const bars = series.map((s, k) => {
      const v = s.values[i], h = Math.max(v ? 3 : 0, (H - pad.t - pad.b) * (v / max));
      const bw = (gw * 0.76) / n, x = pad.l + i * gw + gw * 0.12 + k * bw;
      return `<rect x="${x.toFixed(1)}" y="${(H - pad.b - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color}"><title>${esc(s.name)} ${esc(lb)}: ${v}</title></rect>`;
    }).join('');
    return bars + (i % every === 0 ? `<text x="${(pad.l + i * gw + gw / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(lb)}</text>` : '');
  }).join('');
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="#2d2742"/>${out}</svg><div class="legend">${legend}</div>`);
}
const PALETTE = ['#d4af37', '#8a74d8', '#c1424f', '#4ac96a', '#5a9be8', '#e0b030'];
function donut(items) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  const arcs = items.map((it, i) => {
    const len = (it.value / total) * C, off = -acc; acc += len;
    return `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(it.label)}: ${it.value}</title></circle>`;
  }).join('');
  const legend = items.map((it, i) => `<div style="margin:5px 0"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};margin-right:8px"></i>${esc(it.label)} <b style="margin-left:6px">${it.value}</b> <span class="mut">(${Math.round(it.value / total * 100)}%)</span></div>`).join('');
  return raw(`<div class="donut-wrap"><svg viewBox="0 0 140 140"><circle r="${R}" cx="70" cy="70" fill="none" stroke="#1d1730" stroke-width="20"/>${arcs}
    <text x="70" y="68" text-anchor="middle" style="fill:var(--ink);font:700 22px var(--font)">${items.reduce((a, b) => a + b.value, 0)}</text>
    <text x="70" y="84" text-anchor="middle" style="fill:var(--faint);font:11px var(--font)">postaci</text></svg><div>${legend}</div></div>`);
}
function hbars(items, cls = '') {
  const max = Math.max(1, ...items.map((i) => i.value));
  return html`${items.map((i) => html`<div class="hbar"><span class="dim">${i.label}</span><div class="tr"><i class="${cls}" style="width:${Math.max(2, i.value / max * 100)}%"></i></div><b class="mono">${i.text ?? fmtNum(i.value)}</b></div>`)}`;
}

/* ---------- meta (słowniki) ---------- */
async function loadMeta(force) {
  if (!KC.meta || force) KC.meta = await api('/meta');
  return KC.meta;
}
const rarityPill = (r) => html`<span class="rar" style="--c:${r.color_hex || r.color || '#aaa'}">${r.name || r.rarity}</span>`;

/* ---------- router ---------- */
const NAV = [
  { group: 'Przegląd' },
  { id: 'dashboard', label: 'Pulpit', ic: 'home', title: 'Pulpit', roles: ['admin', 'moderator'] },
  { id: 'reports', label: 'Raporty', ic: 'chart', title: 'Raporty i statystyki', roles: ['admin', 'moderator'] },
  { group: 'Gracze' },
  { id: 'users', label: 'Użytkownicy', ic: 'users', title: 'Użytkownicy', roles: ['admin', 'moderator'] },
  { id: 'characters', label: 'Postacie', ic: 'shield', title: 'Postacie', roles: ['admin', 'moderator'] },
  { group: 'Zawartość gry' },
  { id: 'monsters', label: 'Potwory', ic: 'skull', title: 'Potwory i drop', roles: ['admin'] },
  { id: 'items', label: 'Przedmioty', ic: 'box', title: 'Przedmioty', roles: ['admin'] },
  { id: 'instances', label: 'Instancje', ic: 'gate', title: 'Instancje i trudność', roles: ['admin'] },
  { group: 'Ekonomia i treści' },
  { id: 'economy', label: 'Ekonomia', ic: 'coin', title: 'Ekonomia gry', roles: ['admin'] },
  { id: 'events', label: 'Eventy', ic: 'cal', title: 'Eventy czasowe', roles: ['admin'] },
  { id: 'updates', label: 'Aktualizacje', ic: 'doc', title: 'Aktualizacje i patch notes', roles: ['admin'] },
  { group: 'System' },
  { id: 'logs', label: 'Logi', ic: 'list', title: 'Logi i dziennik działań', roles: ['admin', 'moderator'] },
  { id: 'settings', label: 'Ustawienia', ic: 'sliders', title: 'Ustawienia serwera', roles: ['admin'] },
];
function renderNav() {
  const role = KC.me.role; let html_ = ''; let pending = '';
  for (const n of NAV) {
    if (n.group) { pending = `<div class="nav-group">${esc(n.group)}</div>`; continue; }
    if (!n.roles.includes(role)) continue;
    html_ += pending + `<a href="#/${n.id}" data-id="${n.id}"><svg><use href="#i-${n.ic}"/></svg>${esc(n.label)}</a>`;
    pending = '';
  }
  $('#nav').innerHTML = html_;
}
function clearTimers() { KC.timers.forEach(clearInterval); KC.timers = []; }
async function route() {
  if (!KC.me) return;
  clearTimers();
  const id = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const nav = NAV.find((n) => n.id === id && n.roles.includes(KC.me.role)) || NAV.find((n) => n.id === 'dashboard');
  KC.current = nav.id; KC.acts = {};
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === nav.id));
  $('#title').textContent = nav.title;
  $('#side').classList.remove('open');
  const view = $('#view');
  view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  setHtml(view, skeleton());
  try { await KC.views[nav.id](view); }
  catch (e) { setHtml(view, html`<div class="card"><div class="empty"><b>⚠️</b>${e.message}<br><button class="btn" style="margin-top:14px" onclick="route()">Spróbuj ponownie</button></div></div>`); }
}
// delegacja kliknięć: <button data-act="nazwa" data-id="5">
document.addEventListener('click', (e) => {
  const b = e.target.closest('#view [data-act]'); if (!b || b.disabled) return;
  const fn = KC.acts[b.dataset.act];
  if (fn) Promise.resolve(fn(b.dataset, b)).catch((err) => toast(err.message, 'err'));
});
window.addEventListener('hashchange', route);
