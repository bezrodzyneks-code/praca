'use strict';
/* ===== Widoki: pulpit, użytkownicy, postacie ===== */

const CLASS_COL = { 'Wojownik': 'red', 'Łotr': 'green', 'Łucznik': 'green', 'Mag': 'violet' };
const classBadge = (n) => html`<span class="badge ${CLASS_COL[n] || ''}">${n}</span>`;
const onlineDot = (on) => on ? html`<span class="badge green"><span class="dot" style="width:6px;height:6px"></span>Online</span>` : '';

/* ------------------------------ PULPIT ------------------------------ */
KC.views.dashboard = async (view) => {
  const d = await api('/dashboard');
  const t = d.totals;
  const ACT = {
    'user.ban': '🔨 zbanował', 'user.unban': '✅ odbanował', 'user.kick': '👢 wyrzucił', 'user.create': '➕ dodał konto', 'user.update': '✏️ edytował konto',
    'user.delete': '🗑 usunął konto', 'user.reset_password': '🔑 zresetował hasło', 'character.update': '✏️ edytował postać', 'character.delete': '🗑 usunął postać',
    'economy.update': '⚖️ zmienił ekonomię', 'settings.update': '⚙️ zmienił ustawienia', 'server.broadcast': '📢 wysłał ogłoszenie',
  };
  setHtml(view, html`
    ${pageHead('Witaj, ' + KC.me.username, new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
    <div class="grid g4" style="margin-bottom:18px">
      ${statCard('🟢', fmtNum(t.online), 'Graczy online', '', 'rgba(74,201,106,.18)')}
      ${statCard('👤', fmtNum(t.accounts), 'Kont w systemie', t.accounts_24h ? '+' + t.accounts_24h + ' w ciągu doby' : '')}
      ${statCard('🧙', fmtNum(t.characters), 'Aktywnych postaci', '', 'rgba(138,116,216,.2)')}
      ${statCard('🔨', fmtNum(t.banned), 'Zablokowanych kont', '', 'rgba(193,66,79,.18)')}
      ${statCard('💰', fmtNum(t.gold_total), 'Złota w obiegu')}
      ${statCard('👹', fmtNum(t.kills_total), 'Pokonanych potworów', '', 'rgba(193,66,79,.14)')}
      ${statCard('⚠️', fmtNum(t.errors_24h), 'Błędów (24 godz.)', t.errors_24h ? 'sprawdź logi' : 'brak problemów', t.errors_24h ? 'rgba(193,66,79,.2)' : 'rgba(74,201,106,.14)', !!t.errors_24h)}
      ${statCard('🌍', fmtNum(d.realms.length), 'Aktywnych światów', '', 'rgba(90,155,232,.16)')}
    </div>
    <div class="grid g-main" style="margin-bottom:18px">
      <div class="card"><div class="card-h"><h3>Nowe konta</h3><span class="sub">ostatnie 14 dni</span></div>
        <div class="card-b">${barChart(d.registrations.map((r) => ({ label: fmtDay(r.day), value: r.n })), { every: 2 })}</div></div>
      <div class="card"><div class="card-h"><h3>Klasy postaci</h3></div>
        <div class="card-b">${d.classes.length ? donut(d.classes.map((c) => ({ label: c.name, value: c.n }))) : html`<div class="empty">Brak postaci</div>`}</div></div>
    </div>
    <div class="grid g2" style="margin-bottom:18px">
      <div class="card"><div class="card-h"><h3>Rozkład poziomów</h3></div>
        <div class="card-b">${barChart(d.levels.map((l) => ({ label: l.from_lvl + '–' + (l.from_lvl + 9), value: l.n })), { grad: 'gBar2' })}</div></div>
      <div class="card"><div class="card-h"><h3>Obłożenie światów</h3></div>
        <div class="card-b">${hbars(d.realms.map((r) => ({ label: r.name, value: r.online, text: r.online + ' / ' + r.max_players })), 'v')}
          ${d.realms.length ? '' : html`<div class="empty">Brak światów</div>`}</div></div>
    </div>
    <div class="grid g-main">
      <div class="card"><div class="card-h"><h3>Najlepsi gracze</h3></div>
        ${table([
          { h: '#', cell: (r) => d.top.indexOf(r) + 1 },
          { h: 'Postać', cell: (r) => html`<b>${r.name}</b>` },
          { h: 'Klasa', cell: (r) => classBadge(r.class) },
          { h: 'Poziom', cls: 'num', cell: (r) => html`<b class="gold">${r.level}</b>` },
          { h: 'Zabójstwa', cls: 'num', cell: (r) => fmtNum(r.monsters_killed) },
        ], d.top, { empty: 'Brak postaci' })}</div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="card"><div class="card-h"><h3>Gracze online</h3><span class="sub" id="on-sub"></span></div><div class="card-b" id="online-list" style="padding:8px 18px 14px"></div></div>
        <div class="card"><div class="card-h"><h3>Ostatnie działania</h3></div><div class="card-b" style="padding:6px 18px 12px">
          ${d.audit.length ? d.audit.map((a) => html`<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px"><b>${a.admin_name}</b> ${ACT[a.action] || a.action}
            <div class="mut" style="font-size:11.5px">${ago(a.created_at)}</div></div>`) : html`<div class="empty" style="padding:20px">Brak wpisów</div>`}</div></div>
      </div>
    </div>`);
  const refresh = async () => {
    try {
      const o = await api('/online');
      const box = $('#online-list'); if (!box) return;
      $('#on-sub').textContent = o.players.length + ' graczy';
      setHtml(box, o.players.length ? o.players.slice(0, 12).map((p) => html`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
        <div class="avatar" style="width:28px;height:28px;font-size:11px">${initial(p.name)}</div><div style="flex:1;min-width:0"><b>${p.name}</b> <span class="mut">Lv ${p.level}</span>
        <div class="mut" style="font-size:11.5px">${p.class} • ${p.realm} • ${p.map}</div></div></div>`) : html`<div class="empty" style="padding:22px">Nikt nie jest teraz online</div>`);
    } catch (e) { /* ignoruj */ }
  };
  refresh(); KC.timers.push(setInterval(refresh, 10000));
};

/* --------------------------- UŻYTKOWNICY --------------------------- */
KC.views.users = async (view) => {
  const st = { page: 1, q: '', filter: '', rows: [], total: 0 }; const LIM = 20;
  const admin = isAdmin();
  setHtml(view, html`${pageHead('Użytkownicy', 'Konta graczy, role, blokady i resety haseł',
    admin ? html`<button class="btn gold" data-act="add">${icon('plus')} Dodaj użytkownika</button>` : '')}
    <div class="toolbar">${searchBox('u-q', 'Szukaj po loginie lub e-mailu…')}
      <select id="u-f"><option value="">Wszystkie konta</option><option value="banned">Zablokowane</option><option value="admin">Administratorzy</option>
      <option value="moderator">Moderatorzy</option><option value="player">Gracze</option></select></div>
    <div class="card" id="u-box"></div>`);
  const cols = [
    { h: 'Użytkownik', cell: (u) => html`<div class="who"><div class="avatar">${initial(u.display_name || u.username)}</div><div class="t"><b>${u.display_name || u.username}</b><small>${u.email || '@' + u.username}</small></div></div>` },
    { h: 'Rola', cell: (u) => roleBadge(u.role) },
    { h: 'Postacie', cls: 'num', cell: (u) => `${u.characters} / ${u.max_characters}` },
    { h: 'Status', cell: (u) => u.banned_now
      ? html`<span class="badge red" title="${u.ban_reason || ''}">Zablokowany${u.banned_until ? ' do ' + fmtDate(u.banned_until) : ''}</span>`
      : (u.online ? onlineDot(true) : html`<span class="mut">Aktywne</span>`) },
    { h: 'Rejestracja', cell: (u) => html`<span class="dim">${fmtDate(u.created_at)}</span>` },
    { h: 'Ostatnio', cell: (u) => html`<span class="dim">${ago(u.last_login_at)}</span>` },
    { h: '', cls: 'act', cell: (u) => {
      if (u.id === KC.me.id) return html`<span class="mut">(to Ty)</span>`;
      const locked = !admin && u.role !== 'player';
      if (locked) return html`<span class="mut">—</span>`;
      return html`${admin ? html`<button class="btn sm" data-act="edit" data-id="${u.id}">Edytuj</button><button class="btn sm" data-act="reset" data-id="${u.id}">Hasło</button>` : ''}
        ${u.banned_now ? html`<button class="btn sm" data-act="unban" data-id="${u.id}">Odblokuj</button>` : html`<button class="btn sm danger" data-act="ban" data-id="${u.id}">Ban</button>`}
        ${u.online ? html`<button class="btn sm" data-act="kick" data-id="${u.id}">Kick</button>` : ''}
        ${admin ? html`<button class="btn sm danger" data-act="del" data-id="${u.id}">Usuń</button>` : ''}`;
    } },
  ];
  const draw = () => setHtml($('#u-box'), html`${table(cols, st.rows, { empty: 'Nie znaleziono użytkowników' })}${pager(st.total, st.page, LIM)}`);
  const load = async () => { const d = await api('/users' + qs({ q: st.q, filter: st.filter, page: st.page, limit: LIM })); st.rows = d.rows; st.total = d.total; draw(); };
  const byId = (id) => st.rows.find((u) => u.id === Number(id));
  const roleOpts = [{ value: 'player', label: 'Gracz' }, { value: 'moderator', label: 'Moderator' }, { value: 'admin', label: 'Administrator' }];

  $('#u-q').addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; load().catch((x) => toast(x.message, 'err')); }));
  $('#u-f').addEventListener('change', (e) => { st.filter = e.target.value; st.page = 1; load().catch((x) => toast(x.message, 'err')); });

  KC.acts = {
    page: (ds) => { st.page = Number(ds.p); return load(); },
    add: () => formModal({
      title: 'Nowy użytkownik', submitLabel: 'Utwórz konto',
      fields: [{ key: 'username', label: 'Login', required: true, hint: '3–24 znaków: litery, cyfry, _ oraz -', maxlength: 24 },
        { key: 'password', label: 'Hasło', type: 'password', required: true, hint: 'Minimum 6 znaków' },
        { key: 'email', label: 'E-mail (opcjonalnie)' }, { key: 'role', label: 'Rola', type: 'select', options: roleOpts }],
      values: { role: 'player' },
      onSubmit: async (v) => { await api('/users', 'POST', v); toast('Konto utworzone.', 'ok'); await load(); },
    }),
    edit: (ds) => { const u = byId(ds.id); formModal({
      title: 'Edycja: ' + u.username,
      fields: [{ key: 'display_name', label: 'Nazwa wyświetlana', maxlength: 40 }, { key: 'email', label: 'E-mail' },
        { key: 'role', label: 'Rola', type: 'select', options: roleOpts }, { key: 'max_characters', label: 'Limit postaci', type: 'number', min: 1, max: 20 },
        { key: 'bio', label: 'Opis profilu', type: 'textarea', full: true, rows: 3 }],
      values: u,
      onSubmit: async (v) => { await api('/users/' + u.id, 'PATCH', { display_name: v.display_name, email: v.email, role: v.role, max_characters: v.max_characters, bio: v.bio }); toast('Dane zapisane.', 'ok'); await load(); },
    }); },
    reset: (ds) => { const u = byId(ds.id); formModal({
      title: 'Reset hasła: ' + u.username, submitLabel: 'Resetuj hasło',
      fields: [{ key: 'password', label: 'Nowe hasło', type: 'password', full: true, hint: 'Zostaw puste, aby wygenerować losowe hasło. Użytkownik zostanie wylogowany.' }],
      onSubmit: async (v) => {
        const r = await api('/users/' + u.id + '/reset-password', 'POST', { password: v.password });
        modal({ title: 'Hasło zresetowane', size: 'sm',
          body: html`<p style="margin-top:0" class="dim">Nowe hasło dla <b>${u.username}</b> (pokazane tylko raz):</p><input value="${r.password}" readonly onfocus="this.select()" style="font-family:monospace;font-size:16px;text-align:center">`,
          footer: html`<button class="btn gold" onclick="navigator.clipboard&&navigator.clipboard.writeText('${r.password}');toast('Skopiowano.','ok')">Kopiuj</button>` });
      },
    }); },
    ban: (ds) => { const u = byId(ds.id); formModal({
      title: 'Blokada konta: ' + u.username, submitLabel: 'Zablokuj konto',
      fields: [{ key: 'reason', label: 'Powód', full: true, placeholder: 'np. oszukiwanie, obraźliwy czat…' },
        { key: 'hours', label: 'Czas trwania', type: 'select', numeric: true, full: true, options: [{ value: 0, label: 'Na stałe' }, { value: 1, label: '1 godzina' },
          { value: 24, label: '24 godziny' }, { value: 168, label: '7 dni' }, { value: 720, label: '30 dni' }] }],
      values: { hours: 24 },
      onSubmit: async (v) => { await api('/users/' + u.id + '/ban', 'POST', v); toast('Konto zablokowane.', 'ok'); await load(); },
    }); },
    unban: async (ds) => { const u = byId(ds.id); await api('/users/' + u.id + '/unban', 'POST'); toast('Konto odblokowane.', 'ok'); await load(); },
    kick: async (ds) => { const u = byId(ds.id); if (await confirmBox({ title: 'Wyrzucić gracza?', text: `Gracz ${u.username} zostanie rozłączony i wylogowany.`, okLabel: 'Wyrzuć' })) { await api('/users/' + u.id + '/kick', 'POST'); toast('Gracz wyrzucony.', 'ok'); await load(); } },
    del: async (ds) => { const u = byId(ds.id); if (await confirmBox({ title: 'Usunąć konto?', text: `Konto „${u.username}” wraz ze wszystkimi postaciami zostanie trwale usunięte. Tej operacji nie można cofnąć.`, okLabel: 'Usuń konto', danger: true })) { await api('/users/' + u.id, 'DELETE'); toast('Konto usunięte.', 'ok'); await load(); } },
  };
  await load();
};

/* ----------------------------- POSTACIE ----------------------------- */
KC.views.characters = async (view) => {
  const meta = await loadMeta();
  const st = { page: 1, q: '', realm: '', cls: '', rows: [], total: 0 }; const LIM = 20;
  const admin = isAdmin();
  setHtml(view, html`${pageHead('Postacie', 'Podgląd i edycja bohaterów graczy')}
    <div class="toolbar">${searchBox('c-q', 'Szukaj postaci lub konta…')}
      <select id="c-r"><option value="">Wszystkie światy</option>${meta.realms.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select>
      <select id="c-c"><option value="">Wszystkie klasy</option>${meta.classes.map((c) => html`<option value="${c.code}">${c.name}</option>`)}</select></div>
    <div class="card" id="c-box"></div>`);
  const cols = [
    { h: 'Postać', cell: (c) => html`<div class="who"><div class="avatar">${initial(c.name)}</div><div class="t"><b>${c.name}</b><small>konto: ${c.username}</small></div></div>` },
    { h: 'Klasa', cell: (c) => classBadge(c.class) },
    { h: 'Poz.', cls: 'num', cell: (c) => html`<b class="gold">${c.level}</b>` },
    { h: 'EXP', cls: 'num', cell: (c) => fmtNum(c.exp) },
    { h: 'Złoto', cls: 'num', cell: (c) => fmtNum(c.gold) },
    { h: 'HP', cls: 'num', cell: (c) => `${c.hp}/${c.max_hp}` },
    { h: 'Świat', cell: (c) => html`<span class="dim">${c.realm_id}</span>` },
    { h: 'Zapis', cell: (c) => c.online ? onlineDot(true) : html`<span class="dim">${ago(c.last_saved_at)}</span>` },
    { h: '', cls: 'act', cell: (c) => html`<button class="btn sm" data-act="view" data-id="${c.id}">Szczegóły</button>${admin ? html`<button class="btn sm" data-act="edit" data-id="${c.id}">Edytuj</button><button class="btn sm danger" data-act="del" data-id="${c.id}">Usuń</button>` : ''}` },
  ];
  const draw = () => setHtml($('#c-box'), html`${table(cols, st.rows, { empty: 'Nie znaleziono postaci' })}${pager(st.total, st.page, LIM)}`);
  const load = async () => { const d = await api('/characters' + qs({ q: st.q, realm: st.realm, class: st.cls, page: st.page, limit: LIM })); st.rows = d.rows; st.total = d.total; draw(); };
  const reload = () => load().catch((x) => toast(x.message, 'err'));
  $('#c-q').addEventListener('input', debounce((e) => { st.q = e.target.value; st.page = 1; reload(); }));
  $('#c-r').addEventListener('change', (e) => { st.realm = e.target.value; st.page = 1; reload(); });
  $('#c-c').addEventListener('change', (e) => { st.cls = e.target.value; st.page = 1; reload(); });

  const fields = [
    { type: 'section', key: 's1', label: 'Postęp' },
    { key: 'class', label: 'Klasa', type: 'select', options: meta.classes.map((c) => ({ value: c.code, label: c.name })) },
    { key: 'level', label: 'Poziom (1–50)', type: 'number', min: 1, max: 50 }, { key: 'exp', label: 'EXP', type: 'number', min: 0 },
    { key: 'gold', label: 'Złoto', type: 'number', min: 0 }, { key: 'skill_points', label: 'Punkty umiejętności', type: 'number', min: 0 },
    { type: 'section', key: 's2', label: 'Statystyki' },
    { key: 'max_hp', label: 'Maks. HP', type: 'number', min: 1 }, { key: 'hp', label: 'HP', type: 'number', min: 0 },
    { key: 'max_mp', label: 'Maks. MP', type: 'number', min: 0 }, { key: 'mp', label: 'MP', type: 'number', min: 0 },
    { key: 'atk', label: 'Atak', type: 'number', min: 0 }, { key: 'def', label: 'Obrona', type: 'number', min: 0 },
    { key: 'str', label: 'Siła', type: 'number', min: 0 }, { key: 'dex', label: 'Zręczność', type: 'number', min: 0 }, { key: 'int', label: 'Inteligencja', type: 'number', min: 0 },
  ];
  const byId = (id) => st.rows.find((c) => c.id === Number(id));
  const openEdit = async (id) => {
    const c = await api('/characters/' + id);
    formModal({
      title: 'Edycja postaci: ' + c.name, size: 'wide', fields, values: { ...c, class: c.class_code },
      extra: html`<div class="note" style="margin-top:16px">Zmiany zapiszą się też w zapisie gry. Jeśli gracz jest online, zostanie rozłączony i będzie musiał wczytać postać ponownie.</div>`,
      onSubmit: async (v) => { await api('/characters/' + id, 'PATCH', v); toast('Postać zaktualizowana.', 'ok'); await load(); },
    });
  };
  KC.acts = {
    page: (ds) => { st.page = Number(ds.p); return load(); },
    edit: (ds) => openEdit(ds.id),
    del: async (ds) => { const c = byId(ds.id); if (await confirmBox({ title: 'Usunąć postać?', text: `Postać „${c.name}” (poz. ${c.level}) zostanie usunięta.`, okLabel: 'Usuń postać', danger: true })) { await api('/characters/' + c.id, 'DELETE'); toast('Postać usunięta.', 'ok'); await load(); } },
    view: async (ds) => {
      const c = await api('/characters/' + ds.id);
      const m = modal({ title: c.name, size: 'wide', body: html`
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">${classBadge(c.class)} <span class="badge gold">Poziom ${c.level}</span>
          <span class="badge">${c.realm_id}</span> <span class="badge">konto: ${c.username}</span> ${onlineDot(c.online)}<span class="mut">Zapis: ${fmtDate(c.last_saved_at)} • Mapa: ${c.current_map}</span></div>
        <div class="kv" style="margin-bottom:18px">${[['EXP', fmtNum(c.exp)], ['Złoto', fmtNum(c.gold)], ['HP', c.hp + ' / ' + c.max_hp], ['MP', c.mp + ' / ' + c.max_mp],
          ['Atak', c.atk], ['Obrona', c.def], ['Siła', c.str], ['Zręczność', c.dex], ['Inteligencja', c.int], ['Pkt umiejętności', c.skill_points], ['Zabójstwa', fmtNum(c.monsters_killed)], ['Zgony', c.deaths]]
          .map(([k, v]) => html`<div><small>${k}</small><b>${v}</b></div>`)}</div>
        <div class="grid g2"><div><h4 style="margin-bottom:8px">Ekwipunek (baza)</h4>${c.inventory.length ? table([
            { h: 'Przedmiot', cell: (i) => html`<b>${i.name}</b>` }, { h: 'Rzadkość', cell: (i) => html`<span class="dim">${i.rarity}</span>` },
            { h: 'Miejsce', cell: (i) => i.equipped_slot ? html`<span class="badge gold">${i.equipped_slot}</span>` : html`<span class="mut">plecak</span>` }], c.inventory)
            : html`<div class="note">Ekwipunek gry jest zapisany w pliku zapisu postaci (save_data), nie w tabeli przedmiotów.</div>`}</div>
          <div><h4 style="margin-bottom:8px">Ostatnie zdarzenia</h4>${c.events.length ? c.events.map((e) => html`<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">${e.message}<div class="mut" style="font-size:11.5px">${ago(e.created_at)}</div></div>`) : html`<span class="mut">Brak zdarzeń</span>`}</div></div>`,
        footer: admin ? html`<button class="btn" data-ed>Edytuj postać</button>` : null });
      const b = $('[data-ed]', m.el); if (b) b.onclick = () => { m.close(); openEdit(c.id); };
    },
  };
  await load();
};
