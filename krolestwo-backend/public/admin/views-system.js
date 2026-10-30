'use strict';
/* ===== Widoki: ekonomia, eventy, aktualizacje, logi, raporty, ustawienia ===== */

const toggle = (id, on) => html`<label class="toggle"><input type="checkbox" id="${id}" ${on ? raw('checked') : ''}><i></i></label>`;
const mult = (n) => '×' + Number(n).toFixed(2).replace(/\.?0+$/, '');

/* ------------------------------ EKONOMIA ------------------------------ */
KC.views.economy = async (view) => {
  const d = await api('/economy');
  const e = d.economy;
  const sliders = [['exp', 'Mnożnik EXP'], ['gold', 'Mnożnik złota'], ['drop', 'Szansa dropu']];
  setHtml(view, html`${pageHead('Ekonomia gry', 'Globalne mnożniki nagród. Wartość końcowa = mnożnik świata × globalny × aktywne eventy.')}
    <div class="grid g-main" style="margin-bottom:18px">
      <div class="card"><div class="card-h"><h3>Globalne mnożniki</h3><span class="sub">dotyczą wszystkich światów</span></div><div class="card-b">
        ${sliders.map(([k, l]) => html`<div class="slider-row"><label class="f" style="margin:0">${l}</label>
          <input type="range" id="e-${k}" min="0.1" max="5" step="0.1" value="${e[k]}"><output id="o-${k}">${mult(e[k])}</output></div>`)}
        <div style="display:flex;gap:10px;margin-top:20px;align-items:center"><button class="btn gold" data-act="save">Zastosuj zmiany</button>
          <button class="btn ghost" data-act="reset">Przywróć ×1</button><span class="mut">Gracze online dostaną powiadomienie na czacie.</span></div></div></div>
      <div class="card"><div class="card-h"><h3>Aktywne eventy</h3></div><div class="card-b">
        ${d.events.length ? d.events.map((ev) => html`<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b>🎉 ${ev.name}</b>
          <div class="mut" style="font-size:12px">do ${fmtDate(ev.ends_at)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge gold">EXP ${mult(ev.exp_mult)}</span><span class="badge gold">Złoto ${mult(ev.gold_mult)}</span><span class="badge gold">Drop ${mult(ev.drop_mult)}</span></div></div>`)
          : html`<div class="empty" style="padding:24px">Brak aktywnych eventów<br><a href="#/events">Zaplanuj event →</a></div>`}</div></div>
    </div>
    <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Światy i wartości końcowe</h3><span class="sub">to widzą gracze</span></div>
      ${table([
        { h: 'Świat', cell: (r) => html`<b>${r.name}</b> ${r.is_active ? '' : html`<span class="badge red">wyłączony</span>`}` },
        { h: 'EXP świata', cls: 'num', cell: (r) => mult(r.exp_rate) }, { h: 'Drop świata', cls: 'num', cell: (r) => mult(r.drop_rate) },
        { h: 'Kara za śmierć', cls: 'num', cell: (r) => Math.round(r.death_penalty * 100) + '%' }, { h: 'Maks. graczy', cls: 'num', cell: (r) => fmtNum(r.max_players) },
        { h: 'Wartość końcowa', cell: (r) => html`<span class="badge green">EXP ${mult(r.effective.xp)}</span> <span class="badge green">Złoto ${mult(r.effective.gold)}</span> <span class="badge green">Drop ${mult(r.effective.drop)}</span>` },
        { h: '', cls: 'act', cell: (r) => html`<button class="btn sm" data-act="realm" data-id="${r.id}">Edytuj</button>` },
      ], d.realms)}</div>
    <div class="note">Nagrody za konkretne potwory ustawisz w zakładce <a href="#/monsters">Potwory</a>, a mnożniki nagród instancji (Normalny ×${d.difficulties[0] ? d.difficulties[0].reward_mult : 1}, Trudny ×${d.difficulties[1] ? d.difficulties[1].reward_mult : 1}, Piekielny ×${d.difficulties[2] ? d.difficulties[2].reward_mult : 1}) w zakładce <a href="#/instances">Instancje</a>.</div>`);
  sliders.forEach(([k]) => $('#e-' + k).addEventListener('input', (ev) => { $('#o-' + k).textContent = mult(ev.target.value); }));
  const set = (k, v) => { $('#e-' + k).value = v; $('#o-' + k).textContent = mult(v); };
  KC.acts = {
    reset: () => sliders.forEach(([k]) => set(k, 1)),
    save: async () => { await api('/economy', 'PUT', { exp: +$('#e-exp').value, gold: +$('#e-gold').value, drop: +$('#e-drop').value }); toast('Ekonomia zaktualizowana.', 'ok'); route(); },
    realm: (ds) => { const r = d.realms.find((x) => x.id === ds.id); formModal({ title: 'Świat: ' + r.name,
      fields: [{ key: 'name', label: 'Nazwa' }, { key: 'max_players', label: 'Maks. graczy', type: 'number', min: 1 },
        { key: 'exp_rate', label: 'Mnożnik EXP', type: 'number', min: 0.1, max: 10, step: 0.1 }, { key: 'drop_rate', label: 'Mnożnik dropu', type: 'number', min: 0.1, max: 10, step: 0.1 },
        { key: 'death_penalty', label: 'Kara za śmierć (0–1)', type: 'number', min: 0, max: 1, step: 0.05, hint: '0,10 = 10% złota/EXP' }, { key: 'is_active', label: 'Świat aktywny', type: 'checkbox' },
        { key: 'description', label: 'Opis', type: 'textarea', full: true, rows: 2 }], values: r,
      onSubmit: async (v) => { await api('/realms/' + r.id, 'PATCH', v); toast('Świat zapisany.', 'ok'); route(); } }); },
  };
};

/* ------------------------------- EVENTY ------------------------------- */
KC.views.events = async (view) => {
  const d = await api('/events');
  const status = (e) => {
    const now = Date.now(), s = new Date(e.starts_at), en = new Date(e.ends_at);
    if (!e.is_active) return html`<span class="badge">Wyłączony</span>`;
    if (now < s) return html`<span class="badge blue">Zaplanowany</span>`;
    if (now > en) return html`<span class="badge">Zakończony</span>`;
    return html`<span class="badge green"><span class="dot" style="width:6px;height:6px"></span>Trwa</span>`;
  };
  setHtml(view, html`${pageHead('Eventy czasowe', 'Zaplanuj podwójny EXP, weekend złota i inne promocje — włączą się i wyłączą automatycznie.',
    html`<button class="btn gold" data-act="add">${icon('plus')} Nowy event</button>`)}
    <div class="card">${table([
      { h: 'Event', cell: (e) => html`<b>${e.name}</b><div class="mut" style="font-size:12px">${e.description || ''}</div>` },
      { h: 'Status', cell: status },
      { h: 'Początek', cell: (e) => fmtDate(e.starts_at) }, { h: 'Koniec', cell: (e) => fmtDate(e.ends_at) },
      { h: 'Mnożniki', cell: (e) => html`<span class="badge gold">EXP ${mult(e.exp_mult)}</span> <span class="badge gold">Złoto ${mult(e.gold_mult)}</span> <span class="badge gold">Drop ${mult(e.drop_mult)}</span>` },
      { h: '', cls: 'act', cell: (e) => html`<button class="btn sm" data-act="edit" data-id="${e.id}">Edytuj</button><button class="btn sm danger" data-act="del" data-id="${e.id}">Usuń</button>` },
    ], d.rows, { empty: 'Brak eventów — kliknij „Nowy event”.' })}</div>`);
  const fields = [
    { key: 'name', label: 'Nazwa', required: true, full: true }, { key: 'starts_at', label: 'Początek', type: 'datetime' }, { key: 'ends_at', label: 'Koniec', type: 'datetime' },
    { key: 'exp_mult', label: 'Mnożnik EXP', type: 'number', min: 0.1, max: 10, step: 0.1 }, { key: 'gold_mult', label: 'Mnożnik złota', type: 'number', min: 0.1, max: 10, step: 0.1 },
    { key: 'drop_mult', label: 'Mnożnik dropu', type: 'number', min: 0.1, max: 10, step: 0.1 }, { key: 'is_active', label: 'Event włączony', type: 'checkbox' },
    { key: 'description', label: 'Opis', type: 'textarea', full: true, rows: 2 },
  ];
  const byId = (id) => d.rows.find((e) => e.id === Number(id));
  const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  KC.acts = {
    add: () => formModal({ title: 'Nowy event', size: 'wide', submitLabel: 'Zaplanuj event', fields,
      values: { starts_at: hours(0), ends_at: hours(24 * 3), exp_mult: 2, gold_mult: 1, drop_mult: 1, is_active: true },
      onSubmit: async (v) => { await api('/events', 'POST', v); toast('Event zaplanowany.', 'ok'); route(); } }),
    edit: (ds) => { const e = byId(ds.id); formModal({ title: 'Edycja: ' + e.name, size: 'wide', fields, values: e,
      onSubmit: async (v) => { await api('/events/' + e.id, 'PATCH', v); toast('Zapisano.', 'ok'); route(); } }); },
    del: async (ds) => { const e = byId(ds.id); if (await confirmBox({ title: 'Usunąć event?', text: `„${e.name}” zostanie usunięty.`, okLabel: 'Usuń', danger: true })) { await api('/events/' + e.id, 'DELETE'); toast('Event usunięty.', 'ok'); route(); } },
  };
};

/* ---------------------------- AKTUALIZACJE ---------------------------- */
KC.views.updates = async (view) => {
  const d = await api('/updates');
  setHtml(view, html`${pageHead('Aktualizacje i patch notes', 'Przygotuj opis zmian i opublikuj go graczom.',
    html`<button class="btn gold" data-act="add">${icon('plus')} Nowa aktualizacja</button>`)}
    <div class="card">${d.rows.length ? d.rows.map((u) => html`<div class="upd"><h4><span class="badge violet">v${u.version}</span>${u.title}
      ${u.status === 'published' ? html`<span class="badge green">Opublikowana ${fmtDate(u.published_at)}</span>` : html`<span class="badge amber">Szkic</span>`}
      <span class="spacer"></span>
      ${u.status === 'draft' ? html`<button class="btn sm gold" data-act="pub" data-id="${u.id}">Opublikuj</button>` : ''}
      <button class="btn sm" data-act="edit" data-id="${u.id}">Edytuj</button><button class="btn sm danger" data-act="del" data-id="${u.id}">Usuń</button></h4>
      <p>${u.body || html`<span class="mut">Brak opisu zmian.</span>`}</p></div>`) : html`<div class="empty"><b>📜</b>Brak aktualizacji</div>`}</div>`);
  const fields = [{ key: 'version', label: 'Wersja', required: true, placeholder: '1.1.0' }, { key: 'title', label: 'Tytuł', required: true },
    { key: 'body', label: 'Opis zmian', type: 'textarea', full: true, rows: 9, placeholder: '• Nowa instancja…\n• Poprawki balansu…' }];
  const byId = (id) => d.rows.find((u) => u.id === Number(id));
  KC.acts = {
    add: () => formModal({ title: 'Nowa aktualizacja', size: 'wide', submitLabel: 'Zapisz szkic', fields,
      onSubmit: async (v) => { await api('/updates', 'POST', v); toast('Szkic zapisany.', 'ok'); route(); } }),
    edit: (ds) => { const u = byId(ds.id); formModal({ title: 'Edycja aktualizacji', size: 'wide', fields, values: u,
      onSubmit: async (v) => { await api('/updates/' + u.id, 'PATCH', v); toast('Zapisano.', 'ok'); route(); } }); },
    pub: async (ds) => { const u = byId(ds.id);
      if (await confirmBox({ title: 'Opublikować aktualizację?', text: `Wersja ${u.version} „${u.title}” zostanie opublikowana, a gracze online dostaną powiadomienie.`, okLabel: 'Opublikuj' })) {
        await api('/updates/' + u.id + '/publish', 'POST', {}); toast('Aktualizacja opublikowana.', 'ok'); route(); } },
    del: async (ds) => { const u = byId(ds.id); if (await confirmBox({ title: 'Usunąć wpis?', text: `Wersja ${u.version} zostanie usunięta.`, okLabel: 'Usuń', danger: true })) { await api('/updates/' + u.id, 'DELETE'); toast('Usunięto.', 'ok'); route(); } },
  };
};

/* ------------------------------- LOGI ------------------------------- */
KC.views.logs = async (view) => {
  const st = { tab: 'sys', page: 1, level: '', source: '', q: '', rows: [], total: 0, auto: false }; const LIM = 50;
  const LV = { info: ['log-i', 'INFO'], warn: ['log-w', 'WARN'], error: ['log-e', 'ERROR'] };
  setHtml(view, html`${pageHead('Logi i dziennik działań', 'Zdarzenia systemowe oraz historia akcji administratorów')}
    <div class="tabs" id="l-tabs"><button data-t="sys" class="active">Logi systemowe</button><button data-t="audit">Dziennik administratorów</button></div>
    <div class="toolbar" id="l-tools"></div><div class="card" id="l-box"></div>`);
  const tools = () => setHtml($('#l-tools'), st.tab === 'sys' ? html`${searchBox('l-q', 'Szukaj w komunikatach…', st.q)}
      <select id="l-l"><option value="">Wszystkie poziomy</option><option value="info" ${st.level === 'info' ? raw('selected') : ''}>Info</option><option value="warn" ${st.level === 'warn' ? raw('selected') : ''}>Ostrzeżenia</option><option value="error" ${st.level === 'error' ? raw('selected') : ''}>Błędy</option></select>
      <select id="l-s"><option value="">Wszystkie źródła</option>${['auth', 'server', 'admin', 'game', 'db'].map((s) => html`<option ${st.source === s ? raw('selected') : ''}>${s}</option>`)}</select>
      <label style="display:flex;gap:8px;align-items:center;color:var(--dim)">${toggle('l-auto', st.auto)} Auto-odświeżanie</label>
      <button class="btn" data-act="refresh">${icon('refresh')} Odśwież</button>` : html`<button class="btn" data-act="refresh">${icon('refresh')} Odśwież</button>`);
  const draw = () => {
    const cols = st.tab === 'sys' ? [
      { h: 'Czas', cell: (r) => html`<span class="dim mono">${new Date(r.created_at).toLocaleString('pl-PL')}</span>` },
      { h: 'Poziom', cell: (r) => html`<b class="${LV[r.level][0]}">${LV[r.level][1]}</b>` }, { h: 'Źródło', cell: (r) => html`<span class="badge">${r.source}</span>` },
      { h: 'Komunikat', cell: (r) => html`${r.message}${r.meta ? html` <span class="code">${JSON.stringify(r.meta)}</span>` : ''}` },
    ] : [
      { h: 'Czas', cell: (r) => html`<span class="dim mono">${new Date(r.created_at).toLocaleString('pl-PL')}</span>` },
      { h: 'Administrator', cell: (r) => html`<b>${r.admin_name}</b>` }, { h: 'Akcja', cell: (r) => html`<span class="badge violet">${r.action}</span>` },
      { h: 'Cel', cell: (r) => r.target_type ? html`<span class="dim">${r.target_type} #${r.target_id ?? ''}</span>` : '' },
      { h: 'Szczegóły', cell: (r) => r.details ? html`<span class="code">${JSON.stringify(r.details).slice(0, 140)}</span>` : '' }, { h: 'IP', cell: (r) => html`<span class="code">${r.ip || ''}</span>` },
    ];
    setHtml($('#l-box'), html`${table(cols, st.rows, { empty: 'Brak wpisów' })}${pager(st.total, st.page, LIM)}`);
  };
  const load = async () => {
    const d = st.tab === 'sys' ? await api('/logs' + qs({ level: st.level, source: st.source, q: st.q, page: st.page, limit: LIM })) : await api('/audit' + qs({ page: st.page, limit: LIM }));
    st.rows = d.rows; st.total = d.total; draw();
  };
  const bind = () => {
    const q = $('#l-q'); if (!q) return;
    q.addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; load().catch((x) => toast(x.message, 'err')); }));
    $('#l-l').addEventListener('change', (e) => { st.level = e.target.value; st.page = 1; load().catch((x) => toast(x.message, 'err')); });
    $('#l-s').addEventListener('change', (e) => { st.source = e.target.value; st.page = 1; load().catch((x) => toast(x.message, 'err')); });
    $('#l-auto').addEventListener('change', (e) => { st.auto = e.target.checked; });
  };
  $('#l-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#l-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    st.tab = b.dataset.t; st.page = 1; tools(); bind(); load().catch((x) => toast(x.message, 'err'));
  });
  KC.acts = { page: (ds) => { st.page = Number(ds.p); return load(); }, refresh: () => load() };
  KC.timers.push(setInterval(() => { if (st.auto && st.page === 1) load().catch(() => {}); }, 5000));
  tools(); bind(); await load();
};

/* ------------------------------ RAPORTY ------------------------------ */
KC.views.reports = async (view) => {
  let days = Number(sessionStorage.getItem('kc_days')) || 7;
  const d = await api('/reports?days=' + days);
  const s = d.summary;
  setHtml(view, html`${pageHead('Raporty i statystyki', 'Zbiorcze dane o graczach i serwerze za wybrany okres',
    html`<select id="r-days" style="width:auto">${[7, 14, 30, 90].map((n) => html`<option value="${n}" ${n === days ? raw('selected') : ''}>Ostatnie ${n} dni</option>`)}</select>
      <button class="btn" data-act="csv" data-t="characters">⬇ Postacie (CSV)</button><button class="btn" data-act="csv" data-t="accounts">⬇ Konta (CSV)</button>`)}
    <div class="grid g4" style="margin-bottom:18px">
      ${statCard('➕', fmtNum(s.new_accounts), 'Nowych kont')}${statCard('🔥', fmtNum(s.active_accounts), 'Aktywnych kont', '', 'rgba(74,201,106,.18)')}
      ${statCard('🧙', fmtNum(s.new_characters), 'Nowych postaci', '', 'rgba(138,116,216,.2)')}${statCard('⭐', fmtNum(s.level_ups), 'Awansów na poziom')}
      ${statCard('📊', s.avg_level, 'Średni poziom postaci', '', 'rgba(90,155,232,.16)')}${statCard('🛡', fmtNum(s.admin_actions), 'Akcji administratorów', '', 'rgba(138,116,216,.2)')}
      ${statCard('🔐', fmtNum(s.failed_logins), 'Nieudanych logowań', '', 'rgba(224,176,48,.16)')}${statCard('⚠️', fmtNum(s.errors), 'Błędów serwera', '', 'rgba(193,66,79,.18)', !!s.errors)}
    </div>
    <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Aktywność dzienna</h3></div><div class="card-b">
      ${groupBars(d.daily.map((x) => fmtDay(x.day)), [{ name: 'Nowe konta', color: '#d4af37', values: d.daily.map((x) => x.accounts) },
        { name: 'Nowe postacie', color: '#8a74d8', values: d.daily.map((x) => x.characters) }, { name: 'Błędy', color: '#c1424f', values: d.daily.map((x) => x.errors) }],
        { every: Math.ceil(d.daily.length / 14) })}</div></div>
    <div class="grid g2" style="margin-bottom:18px">
      <div class="card"><div class="card-h"><h3>Klasy</h3></div>${table([{ h: 'Klasa', cell: (c) => classBadge(c.name) }, { h: 'Postaci', cls: 'num', cell: (c) => c.n }, { h: 'Średni poziom', cls: 'num', cell: (c) => c.avg_level }], d.classes, { empty: 'Brak postaci' })}</div>
      <div class="card"><div class="card-h"><h3>Najczęstsze błędy</h3></div>${table([{ h: 'Komunikat', cell: (e) => html`<span class="log-e">${e.message}</span>` }, { h: 'Razy', cls: 'num', cell: (e) => e.n }, { h: 'Ostatnio', cell: (e) => html`<span class="dim">${ago(e.last_at)}</span>` }], d.errors, { empty: '🎉 Brak błędów w tym okresie' })}</div>
    </div>
    <div class="grid g2"><div class="card"><div class="card-h"><h3>Top 10 — poziom</h3></div>${table([{ h: '#', cell: (r) => d.topLevel.indexOf(r) + 1 }, { h: 'Postać', cell: (r) => html`<b>${r.name}</b>` }, { h: 'Klasa', cell: (r) => classBadge(r.class) }, { h: 'Poz.', cls: 'num', cell: (r) => html`<b class="gold">${r.level}</b>` }], d.topLevel, { empty: 'Brak danych' })}</div>
      <div class="card"><div class="card-h"><h3>Top 10 — złoto</h3></div>${table([{ h: '#', cell: (r) => d.topGold.indexOf(r) + 1 }, { h: 'Postać', cell: (r) => html`<b>${r.name}</b>` }, { h: 'Klasa', cell: (r) => classBadge(r.class) }, { h: 'Złoto', cls: 'num', cell: (r) => html`<b class="gold">${fmtNum(r.gold)}</b>` }], d.topGold, { empty: 'Brak danych' })}</div></div>`);
  $('#r-days').addEventListener('change', (e) => { sessionStorage.setItem('kc_days', e.target.value); route(); });
  KC.acts = { csv: (ds) => downloadCsv(ds.t) };
};

/* ----------------------------- USTAWIENIA ----------------------------- */
KC.views.settings = async (view) => {
  const [s, status, bans] = await Promise.all([api('/settings'), api('/server/status'), api('/bans')]);
  const sv = s.server;
  setHtml(view, html`${pageHead('Ustawienia serwera', 'Konfiguracja działa od razu — bez restartu.')}
    ${sv.maintenance ? html`<div class="banner warn">🛠 <b>Tryb konserwacji jest włączony</b> — logować mogą się tylko administratorzy i moderatorzy.</div>` : ''}
    <div class="grid g-main" style="margin-bottom:18px">
      <div class="card"><div class="card-h"><h3>Konfiguracja</h3></div><div class="card-b" style="padding-top:6px">
        <div class="setrow"><div class="t"><b>Tryb konserwacji</b><small>Wyrzuca graczy i blokuje logowanie zwykłych kont</small></div>${toggle('s-maint', sv.maintenance)}</div>
        <div class="setrow" style="display:block"><label class="f">Komunikat konserwacji</label><input id="s-mmsg" value="${sv.maintenance_msg}" maxlength="300"></div>
        <div class="setrow"><div class="t"><b>Rejestracja nowych kont</b><small>Wyłącz, aby zatrzymać zakładanie kont</small></div>${toggle('s-reg', sv.registration_open)}</div>
        <div class="setrow"><div class="t"><b>Czat w grze</b><small>Wyłączony czat blokuje wiadomości graczy</small></div>${toggle('s-chat', sv.chat_enabled)}</div>
        <div class="setrow" style="display:block"><label class="f">Wiadomość dnia (pokazuje się na czacie po wejściu do gry)</label><input id="s-motd" value="${sv.motd}" maxlength="300" placeholder="np. Witaj w Królestwie Cieni!"></div>
        <button class="btn gold" data-act="save" style="margin-top:14px">Zapisz ustawienia</button></div></div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="card"><div class="card-h"><h3>Status serwera</h3><span class="pill"><span class="dot ${status.maintenance ? 'warn' : ''}"></span>${status.maintenance ? 'Konserwacja' : 'Działa'}</span></div>
          <div class="card-b"><div class="kv" style="grid-template-columns:1fr 1fr">${[['Czas pracy', fmtDur(status.uptime_sec)], ['Online', status.online], ['Pamięć', status.memory_mb + ' MB'], ['Baza danych', status.db_size_mb + ' MB'],
            ['Połączenia DB', status.db_connections], ['Eventy', status.active_events], ['Node.js', status.node]].map(([k, v]) => html`<div><small>${k}</small><b>${v}</b></div>`)}</div>
            <button class="btn" style="margin-top:14px" data-act="reload">${icon('refresh')} Przeładuj konfigurację</button></div></div>
        <div class="card"><div class="card-h"><h3>Ogłoszenie dla graczy</h3></div><div class="card-b">
          <input id="s-bc" maxlength="200" placeholder="Treść ogłoszenia (pojawi się na czacie)"><button class="btn" style="margin-top:12px" data-act="bc">📢 Wyślij do graczy online</button></div></div>
      </div></div>
    <div class="card"><div class="card-h"><h3>Zablokowane konta</h3><span class="sub">${bans.rows.length} aktywnych blokad</span></div>
      ${table([{ h: 'Konto', cell: (b) => html`<b>${b.username}</b>` }, { h: 'Powód', cell: (b) => b.ban_reason || html`<span class="mut">—</span>` },
        { h: 'Od', cell: (b) => fmtDate(b.banned_at) }, { h: 'Do', cell: (b) => b.banned_until ? fmtDate(b.banned_until) : html`<span class="badge red">na stałe</span>` },
        { h: '', cls: 'act', cell: (b) => html`<button class="btn sm" data-act="unban" data-id="${b.id}">Odblokuj</button>` }], bans.rows, { empty: 'Brak zablokowanych kont' })}</div>`);
  KC.acts = {
    save: async () => {
      await api('/settings', 'PUT', { server: { maintenance: $('#s-maint').checked, maintenance_msg: $('#s-mmsg').value, registration_open: $('#s-reg').checked, chat_enabled: $('#s-chat').checked, motd: $('#s-motd').value } });
      toast('Ustawienia zapisane.', 'ok'); refreshStatus(); route();
    },
    reload: async () => { const r = await api('/server/reload', 'POST'); toast(`Konfiguracja przeładowana (aktywne eventy: ${r.events}).`, 'ok'); route(); },
    bc: async () => { const m = $('#s-bc').value.trim(); if (!m) return toast('Wpisz treść ogłoszenia.', 'err'); const r = await api('/broadcast', 'POST', { message: m }); $('#s-bc').value = ''; toast(`Wysłano do ${r.recipients} graczy.`, 'ok'); },
    unban: async (ds) => { await api('/users/' + ds.id + '/unban', 'POST'); toast('Konto odblokowane.', 'ok'); route(); },
  };
};
