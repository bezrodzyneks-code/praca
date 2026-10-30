'use strict';
/* ===== Widoki: potwory (+drop), przedmioty (+efekty), instancje (+trudność) ===== */

/* ---------- edytor list w modalu (drop, efekty, potwory instancji) ---------- */
const leInput = (i, k, v, o = {}) => html`<input data-i="${i}" data-k="${k}" data-t="${(o.type || 'number') === 'number' ? 'n' : 's'}" type="${o.type || 'number'}"
  value="${v ?? ''}" min="${o.min ?? ''}" max="${o.max ?? ''}" step="${o.step ?? 1}" placeholder="${o.ph || ''}">`;
const leSelect = (i, k, opts, v, numeric = true) => html`<select data-i="${i}" data-k="${k}" data-t="${numeric ? 'n' : 's'}">${opts.map((o) =>
  html`<option value="${o.value}" ${String(o.value) === String(v) ? raw('selected') : ''}>${o.label}</option>`)}</select>`;

function listModal({ title, rows, cols, tpl, blank, onSave, hint, addLabel = 'Dodaj wiersz', size = 'wide' }) {
  const st = rows.map((r) => ({ ...r }));
  const m = modal({
    title, size,
    body: html`${hint ? html`<div class="note" style="margin-bottom:14px">${hint}</div>` : ''}<div id="le" class="rows"></div>
      <button class="btn sm" id="le-add" style="margin-top:12px">${icon('plus')} ${addLabel}</button>`,
    footer: html`<span class="err" id="le-err"></span><button class="btn ghost" data-no>Anuluj</button><button class="btn gold" data-ok>Zapisz zmiany</button>`,
  });
  const box = $('#le', m.el);
  const draw = () => setHtml(box, st.length
    ? st.map((r, i) => html`<div class="rrow" style="grid-template-columns:${cols}">${tpl(r, i)}<button class="btn sm danger icon" data-del="${i}" title="Usuń wiersz">✕</button></div>`)
    : html`<div class="empty" style="padding:24px">Lista jest pusta</div>`);
  draw();
  const upd = (e) => {
    const t = e.target; if (t.dataset.i === undefined) return;
    st[+t.dataset.i][t.dataset.k] = t.dataset.t === 'n' ? (t.value === '' ? null : Number(t.value)) : t.value;
  };
  box.addEventListener('input', upd); box.addEventListener('change', upd);
  box.addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { st.splice(+d.dataset.del, 1); draw(); } });
  $('#le-add', m.el).onclick = () => { st.push(blank()); draw(); };
  $('[data-no]', m.el).onclick = m.close;
  const ok = $('[data-ok]', m.el);
  ok.onclick = async () => {
    $('#le-err', m.el).textContent = ''; ok.disabled = true;
    try { await onSave(st); m.close(); } catch (e) { $('#le-err', m.el).textContent = e.message; ok.disabled = false; }
  };
}

const EFFECT_NAMES = { burn: 'Szansa podpalenia', poison: 'Szansa zatrucia', freeze: 'Szansa zamrożenia', stun: 'Szansa ogłuszenia', lifesteal: 'Kradzież życia', bleed: 'Szansa krwawienia' };

/* ------------------------------ POTWORY ------------------------------ */
KC.views.monsters = async (view) => {
  const meta = await loadMeta(true);
  const st = { q: '', rows: [] };
  setHtml(view, html`${pageHead('Potwory i drop', 'Statystyki, nagrody i tabele dropu. Zmiany trafiają do gry przy następnym wejściu gracza na serwer.',
    html`<button class="btn gold" data-act="add">${icon('plus')} Dodaj potwora</button>`)}
    <div class="toolbar">${searchBox('m-q', 'Szukaj potwora…')}</div><div class="card" id="m-box"></div>`);
  const cols = [
    { h: 'Poz.', cls: 'num', cell: (m) => html`<b class="gold">${m.level}</b>` },
    { h: 'Potwór', cell: (m) => html`<div class="t"><b>${m.name}</b> ${m.is_boss ? html`<span class="badge red">Boss</span>` : ''}${m.is_elite ? html` <span class="badge amber">Elita</span>` : ''}${m.night_only ? html` <span class="badge violet">Noc</span>` : ''}<div class="code">${m.code}</div></div>` },
    { h: 'HP', cls: 'num', cell: (m) => fmtNum(m.hp) }, { h: 'Atak', cls: 'num', cell: (m) => m.atk }, { h: 'Obrona', cls: 'num', cell: (m) => m.def },
    { h: 'EXP', cls: 'num', cell: (m) => fmtNum(m.exp_reward) },
    { h: 'Złoto', cls: 'num', cell: (m) => `${fmtNum(m.gold_min)}–${fmtNum(m.gold_max)}` },
    { h: 'Drop', cls: 'num', cell: (m) => html`<span class="badge">${m.drops} poz.</span>` },
    { h: '', cls: 'act', cell: (m) => html`<button class="btn sm" data-act="edit" data-id="${m.id}">Edytuj</button><button class="btn sm" data-act="drops" data-id="${m.id}">Drop</button><button class="btn sm danger" data-act="del" data-id="${m.id}">Usuń</button>` },
  ];
  const draw = () => setHtml($('#m-box'), table(cols, st.rows, { empty: 'Brak potworów' }));
  const load = async () => { st.rows = (await api('/monsters' + qs({ q: st.q }))).rows; draw(); };
  $('#m-q').addEventListener('input', debounce((e) => { st.q = e.target.value; load().catch((x) => toast(x.message, 'err')); }));
  const fields = (isNew) => [
    { key: 'name', label: 'Nazwa', required: true }, { key: 'code', label: 'Kod (unikalny)', required: true, readonly: !isNew, hint: isNew ? 'Małe litery, cyfry i _ — np. ice_golem' : 'Kodu nie można zmienić' },
    { key: 'kind', label: 'Typ wyglądu', type: 'select', options: ['rat', 'goblin', 'wolf', 'spider', 'skeleton', 'ghost', 'druid', 'orc', 'demon', 'dragon', 'zombie'].map((k) => ({ value: k, label: k })) },
    { key: 'level', label: 'Poziom', type: 'number', min: 1, max: 50, required: true },
    { type: 'section', key: 's1', label: 'Walka' },
    { key: 'hp', label: 'HP', type: 'number', min: 1, required: true }, { key: 'atk', label: 'Atak', type: 'number', min: 0, required: true }, { key: 'def', label: 'Obrona', type: 'number', min: 0 },
    { type: 'section', key: 's2', label: 'Nagrody' },
    { key: 'exp_reward', label: 'EXP', type: 'number', min: 0, required: true }, { key: 'gold_min', label: 'Złoto min', type: 'number', min: 0 }, { key: 'gold_max', label: 'Złoto max', type: 'number', min: 0 },
    { type: 'section', key: 's3', label: 'Cechy' },
    { key: 'is_elite', label: 'Elita', type: 'checkbox' }, { key: 'is_boss', label: 'Boss', type: 'checkbox' }, { key: 'night_only', label: 'Pojawia się tylko nocą', type: 'checkbox' },
    { key: 'description', label: 'Opis', type: 'textarea', full: true, rows: 2 },
  ];
  const byId = (id) => st.rows.find((m) => m.id === Number(id));
  KC.acts = {
    add: () => formModal({ title: 'Nowy potwór', size: 'wide', submitLabel: 'Utwórz', fields: fields(true), values: { kind: 'rat', level: 1, hp: 20, atk: 3, def: 1, exp_reward: 10, gold_min: 3, gold_max: 8 },
      onSubmit: async (v) => { await api('/monsters', 'POST', v); toast('Potwór dodany.', 'ok'); await load(); } }),
    edit: (ds) => { const m = byId(ds.id); formModal({ title: 'Edycja: ' + m.name, size: 'wide', fields: fields(false), values: m,
      onSubmit: async (v) => { delete v.code; await api('/monsters/' + m.id, 'PATCH', v); toast('Zapisano.', 'ok'); await load(); } }); },
    del: async (ds) => { const m = byId(ds.id); if (await confirmBox({ title: 'Usunąć potwora?', text: `„${m.name}” zostanie usunięty razem z jego tabelą dropu. Jeśli jest bossem instancji, najpierw zmień bossa.`, okLabel: 'Usuń', danger: true })) { await api('/monsters/' + m.id, 'DELETE'); toast('Potwór usunięty.', 'ok'); await load(); } },
    drops: async (ds) => {
      const m = byId(ds.id); const d = await api('/monsters/' + m.id + '/drops');
      const opts = meta.items.map((i) => ({ value: i.id, label: `${i.name} (poz. ${i.required_level})` }));
      listModal({
        title: 'Tabela dropu: ' + m.name, cols: '1fr 110px 80px 80px 40px', addLabel: 'Dodaj przedmiot',
        hint: 'Szansa podawana w procentach (np. 2,5 = 2,5% na zabójstwo). Boss i elita mają mnożniki w grze.',
        rows: d.rows.map((r) => ({ item_id: r.item_id, pct: Math.round(r.drop_chance * 10000) / 100, min_qty: r.min_qty, max_qty: r.max_qty })),
        blank: () => ({ item_id: meta.items[0] && meta.items[0].id, pct: 5, min_qty: 1, max_qty: 1 }),
        tpl: (r, i) => html`${leSelect(i, 'item_id', opts, r.item_id)}${leInput(i, 'pct', r.pct, { min: 0.001, max: 100, step: 0.01 })}${leInput(i, 'min_qty', r.min_qty, { min: 1 })}${leInput(i, 'max_qty', r.max_qty, { min: 1 })}`,
        onSave: async (rows) => {
          await api('/monsters/' + m.id + '/drops', 'PUT', { drops: rows.map((r) => ({ item_id: r.item_id, drop_chance: (r.pct || 0) / 100, min_qty: r.min_qty || 1, max_qty: r.max_qty || r.min_qty || 1 })) });
          toast('Drop zapisany.', 'ok'); await load();
        },
      });
    },
  };
  await load();
};

/* ----------------------------- PRZEDMIOTY ----------------------------- */
function itemPreview(v, meta, effects = []) {
  const r = meta.rarities.find((x) => x.id === Number(v.rarity_id)) || meta.rarities[0];
  const L = [];
  const add = (k, val, plus) => { if (val) L.push([k, (plus && val > 0 ? '+' : '') + val]); };
  L.push(['Wymagany poziom', v.required_level || 1]);
  add('Obrażenia', v.atk, 1); add('Obrona', v.def, 1); add('Zdrowie', v.hp, 1); add('Mana', v.mp, 1);
  add('Siła', v.str, 1); add('Zręczność', v.dex, 1); add('Inteligencja', v.int, 1);
  if (v.crit_pct) L.push(['Szansa krytyka', v.crit_pct + '%']);
  add('Leczy HP', v.heal_hp, 1); add('Leczy MP', v.heal_mp, 1); add('Miejsca w torbie', v.bag_slots, 1);
  effects.forEach((e) => L.push([EFFECT_NAMES[e.effect_code] || e.effect_code, e.chance_pct + '%']));
  return html`<div class="itemcard" style="--c:${r.color_hex}"><div class="n">${v.name || 'Nowy przedmiot'}</div><div class="r">${r.emoji || ''} ${r.name}</div>
    ${L.map(([k, x]) => html`<div class="ln"><span>${k}</span><b>${x}</b></div>`)}</div>`;
}
const statSummary = (i) => [['atk', 'ATK'], ['def', 'DEF'], ['hp', 'HP'], ['mp', 'MP'], ['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['heal_hp', 'Leczy']]
  .filter(([k]) => i[k]).map(([k, l]) => `${i[k] > 0 && k !== 'heal_hp' ? '+' : ''}${i[k]} ${l}`).join(', ') || '—';

KC.views.items = async (view) => {
  const meta = await loadMeta(true);
  const st = { q: '', rarity: '', slot: '', rows: [] };
  setHtml(view, html`${pageHead('Przedmioty', 'Katalog przedmiotów: statystyki, rzadkość i efekty specjalne',
    html`<button class="btn gold" data-act="add">${icon('plus')} Dodaj przedmiot</button>`)}
    <div class="toolbar">${searchBox('i-q', 'Szukaj przedmiotu…')}
      <select id="i-r"><option value="">Każda rzadkość</option>${meta.rarities.map((r) => html`<option value="${r.id}">${r.emoji} ${r.name}</option>`)}</select>
      <select id="i-s"><option value="">Każdy slot</option>${meta.slots.map((s) => html`<option value="${s.code}">${s.name}</option>`)}</select></div>
    <div class="card" id="items-box"></div>`);
  const cls = (id) => (meta.classes.find((c) => c.id === id) || {}).name;
  const cols = [
    { h: 'Przedmiot', cell: (i) => html`<div class="t"><span class="rar" style="--c:${i.color_hex}">${i.name}</span><div class="code">${i.code}</div></div>` },
    { h: 'Slot', cell: (i) => html`<span class="dim">${(meta.slots.find((s) => s.code === i.slot) || {}).name || i.slot}</span>` },
    { h: 'Poz.', cls: 'num', cell: (i) => i.required_level }, { h: 'Klasa', cell: (i) => cls(i.class_id) || html`<span class="mut">każda</span>` },
    { h: 'Statystyki', cell: (i) => html`<span class="dim">${statSummary(i)}</span>` },
    { h: 'Efekty', cell: (i) => i.effects.length ? i.effects.map((e) => html`<span class="badge amber" style="margin-right:4px">${e.effect_code} ${e.chance_pct}%</span>`) : html`<span class="mut">—</span>` },
    { h: 'Cena', cls: 'num', cell: (i) => html`<span class="gold">${fmtNum(i.buy_price)}</span> <span class="mut">/ ${fmtNum(i.sell_price)}</span>` },
    { h: '', cls: 'act', cell: (i) => html`<button class="btn sm" data-act="edit" data-id="${i.id}">Edytuj</button><button class="btn sm" data-act="fx" data-id="${i.id}">Efekty</button><button class="btn sm danger" data-act="del" data-id="${i.id}">Usuń</button>` },
  ];
  const draw = () => setHtml($('#items-box'), table(cols, st.rows, { empty: 'Brak przedmiotów' }));
  const load = async () => { st.rows = (await api('/items' + qs({ q: st.q, rarity: st.rarity, slot: st.slot }))).rows; draw(); };
  const rl = () => load().catch((x) => toast(x.message, 'err'));
  $('#i-q').addEventListener('input', debounce((e) => { st.q = e.target.value; rl(); }));
  $('#i-r').addEventListener('change', (e) => { st.rarity = e.target.value; rl(); });
  $('#i-s').addEventListener('change', (e) => { st.slot = e.target.value; rl(); });

  const N = (key, label, min, max, step) => ({ key, label, type: 'number', min, max, step });
  const fields = (isNew) => [
    { key: 'name', label: 'Nazwa', required: true }, { key: 'code', label: 'Kod (unikalny)', required: true, readonly: !isNew, hint: isNew ? 'Małe litery, cyfry i _' : 'Kodu nie można zmienić' },
    { key: 'slot', label: 'Slot', type: 'select', options: meta.slots.map((s) => ({ value: s.code, label: s.name })) },
    { key: 'rarity_id', label: 'Rzadkość', type: 'select', numeric: true, options: meta.rarities.map((r) => ({ value: r.id, label: `${r.emoji} ${r.name}` })) },
    N('required_level', 'Wymagany poziom', 1, 50),
    { key: 'class_id', label: 'Klasa', type: 'select', numeric: true, options: [{ value: '', label: 'Każda klasa' }, ...meta.classes.map((c) => ({ value: c.id, label: c.name }))] },
    { type: 'section', key: 's1', label: 'Statystyki' },
    N('atk', 'Obrażenia (atak)'), N('def', 'Obrona'), N('hp', 'HP'), N('mp', 'MP'), N('str', 'Siła'), N('dex', 'Zręczność'), N('int', 'Inteligencja'), N('crit_pct', 'Szansa krytyka %', 0, 100, 0.1),
    { type: 'section', key: 's2', label: 'Użycie i handel' },
    N('heal_hp', 'Leczy HP', 0), N('heal_mp', 'Leczy MP', 0), N('bag_slots', 'Dodatkowe sloty torby', 0), N('buy_price', 'Cena kupna (0 = brak w sklepie)', 0), N('sell_price', 'Cena sprzedaży', 0),
    { key: 'stackable', label: 'Stackowalny', type: 'checkbox' }, { key: 'tradeable', label: 'Można wymieniać', type: 'checkbox' },
    { key: 'description', label: 'Opis', type: 'textarea', full: true, rows: 2 },
  ];
  const byId = (id) => st.rows.find((i) => i.id === Number(id));
  const clean = (v) => { const o = { ...v }; if (o.class_id === null || o.class_id === '') o.class_id = null; return o; };
  KC.acts = {
    add: () => formModal({ title: 'Nowy przedmiot', size: 'wide', submitLabel: 'Utwórz', fields: fields(true),
      values: { slot: 'weapon', rarity_id: 1, required_level: 1, atk: 0, def: 0, hp: 0, mp: 0, str: 0, dex: 0, int: 0, crit_pct: 0, heal_hp: 0, heal_mp: 0, bag_slots: 0, buy_price: 0, sell_price: 0, tradeable: true, max_stack: 1 },
      side: html`<label class="f">Podgląd w grze</label><div id="pv"></div>`,
      onChange: (v, el) => { const p = $('#pv', el); if (p) setHtml(p, itemPreview(v, meta)); },
      onSubmit: async (v) => { await api('/items', 'POST', clean(v)); toast('Przedmiot dodany.', 'ok'); await load(); } }),
    edit: (ds) => { const i = byId(ds.id); formModal({ title: 'Edycja: ' + i.name, size: 'wide', fields: fields(false), values: i,
      side: html`<label class="f">Podgląd w grze</label><div id="pv"></div>`,
      onChange: (v, el) => { const p = $('#pv', el); if (p) setHtml(p, itemPreview(v, meta, i.effects)); },
      onSubmit: async (v) => { delete v.code; await api('/items/' + i.id, 'PATCH', clean(v)); toast('Zapisano.', 'ok'); await load(); } }); },
    del: async (ds) => { const i = byId(ds.id); if (await confirmBox({ title: 'Usunąć przedmiot?', text: `„${i.name}” zostanie usunięty z katalogu i z tabel dropu.`, okLabel: 'Usuń', danger: true })) { await api('/items/' + i.id, 'DELETE'); toast('Przedmiot usunięty.', 'ok'); await load(); } },
    fx: (ds) => {
      const i = byId(ds.id); const opts = meta.effects.map((e) => ({ value: e.code, label: e.name }));
      listModal({ title: 'Efekty specjalne: ' + i.name, cols: '1fr 100px 100px 100px 40px', addLabel: 'Dodaj efekt', size: 'wide',
        hint: 'Przykład: Miecz Płomienia → Podpalenie, szansa 8%, siła 12 obrażeń na tyk, czas 4 s.',
        rows: i.effects, blank: () => ({ effect_code: meta.effects[0].code, chance_pct: 5, magnitude: 0, duration_sec: 0 }),
        tpl: (r, k) => html`${leSelect(k, 'effect_code', opts, r.effect_code, false)}${leInput(k, 'chance_pct', r.chance_pct, { min: 0, max: 100, step: 0.1, ph: 'Szansa %' })}${leInput(k, 'magnitude', r.magnitude, { min: 0, step: 0.1, ph: 'Siła' })}${leInput(k, 'duration_sec', r.duration_sec, { min: 0, step: 0.1, ph: 'Czas s' })}`,
        onSave: async (rows) => { await api('/items/' + i.id + '/effects', 'PUT', { effects: rows }); toast('Efekty zapisane.', 'ok'); await load(); } });
    },
  };
  await load();
};

/* ------------------------------ INSTANCJE ------------------------------ */
KC.views.instances = async (view) => {
  const meta = await loadMeta(true);
  const [inst, diff] = await Promise.all([api('/instances'), api('/difficulties')]);
  const DC = { normal: 'n', hard: 'h', hell: 'x' };
  const bossOpts = [...meta.monsters].sort((a, b) => (b.is_boss - a.is_boss) || a.level - b.level)
    .map((m) => ({ value: m.id, label: `${m.is_boss ? '👑 ' : ''}${m.name} (poz. ${m.level})` }));
  const monOpts = meta.monsters.map((m) => ({ value: m.id, label: `${m.name} (poz. ${m.level})` }));
  setHtml(view, html`${pageHead('Instancje', 'Lochy z grupami potworów i bossem oraz poziomy trudności',
    html`<button class="btn gold" data-act="add">${icon('plus')} Dodaj instancję</button>`)}
    <div class="card" style="margin-bottom:18px"><div class="card-h"><h3>Poziomy trudności</h3><span class="sub">mnożniki bazowych statystyk i nagród</span></div>
      <div class="card-b"><div class="grid g3">${diff.rows.map((d) => html`<div class="diff ${DC[d.code] || ''}"><h4>${d.name}</h4>
        <div class="kv" style="grid-template-columns:repeat(2,1fr)">${[['HP', d.hp_mult], ['Atak', d.atk_mult], ['Obrona', d.def_mult], ['Nagrody', d.reward_mult], ['Drop', d.drop_mult]]
          .map(([k, v]) => html`<div><small>${k}</small><b>×${v}</b></div>`)}</div>
        <button class="btn sm" style="margin-top:12px" data-act="diff" data-id="${d.id}">Edytuj mnożniki</button></div>`)}</div></div></div>
    <div class="cards">${inst.rows.map((i) => {
      const waves = {}; i.monsters.forEach((m) => { (waves[m.wave] = waves[m.wave] || []).push(m); });
      return html`<div class="card inst"><div class="hd"><div style="display:flex;gap:10px;align-items:center"><h3>${i.name}</h3><span class="badge gold">Poz. ${i.required_level}</span></div>
        <div class="dim" style="margin-top:4px">${i.description || ''}</div></div>
        <div class="card-b"><div style="margin-bottom:10px">👑 Boss: <b>${i.boss_name}</b> <span class="mut">• mapa: ${i.map_code || '—'}</span></div>
          ${Object.keys(waves).length ? Object.keys(waves).map((w) => html`<div class="wave"><span class="w">Fala ${w}</span>${waves[w].map((m) => html`<span class="badge">${m.name} ×${m.count_min === m.count_max ? m.count_min : m.count_min + '–' + m.count_max}</span>`)}</div>`) : html`<div class="mut">Brak przypisanych potworów</div>`}
          <div class="mut" style="margin:12px 0 14px;font-size:12px">Przejścia: ${fmtNum(i.runs)} • Ukończone: ${fmtNum(i.completed)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="edit" data-id="${i.id}">Edytuj</button><button class="btn sm" data-act="mons" data-id="${i.id}">Potwory</button><button class="btn sm danger" data-act="del" data-id="${i.id}">Usuń</button></div></div></div>`;
    })}</div>${inst.rows.length ? '' : html`<div class="card"><div class="empty"><b>🏰</b>Brak instancji</div></div>`}`);
  const go = () => route();
  const byId = (id) => inst.rows.find((i) => i.id === Number(id));
  const fields = (isNew) => [
    { key: 'name', label: 'Nazwa', required: true }, { key: 'code', label: 'Kod (unikalny)', required: true, readonly: !isNew },
    { key: 'required_level', label: 'Wymagany poziom', type: 'number', min: 1, max: 50, required: true },
    { key: 'boss_id', label: 'Boss', type: 'select', numeric: true, options: bossOpts }, { key: 'map_code', label: 'Kod mapy' },
    { key: 'description', label: 'Opis', type: 'textarea', full: true, rows: 2 },
  ];
  KC.acts = {
    add: () => formModal({ title: 'Nowa instancja', submitLabel: 'Utwórz', fields: fields(true), values: { required_level: 1, boss_id: bossOpts[0] && bossOpts[0].value },
      onSubmit: async (v) => { await api('/instances', 'POST', v); toast('Instancja dodana.', 'ok'); go(); } }),
    edit: (ds) => { const i = byId(ds.id); formModal({ title: 'Edycja: ' + i.name, fields: fields(false), values: i,
      onSubmit: async (v) => { delete v.code; await api('/instances/' + i.id, 'PATCH', v); toast('Zapisano.', 'ok'); go(); } }); },
    del: async (ds) => { const i = byId(ds.id); if (await confirmBox({ title: 'Usunąć instancję?', text: `„${i.name}” zostanie usunięta razem z listą potworów.`, okLabel: 'Usuń', danger: true })) { await api('/instances/' + i.id, 'DELETE'); toast('Instancja usunięta.', 'ok'); go(); } },
    mons: (ds) => { const i = byId(ds.id);
      listModal({ title: 'Potwory w instancji: ' + i.name, cols: '1fr 80px 80px 80px 40px', addLabel: 'Dodaj potwora',
        hint: 'Potwory pojawiają się falami przed bossem. Podaj losowy zakres liczby potworów w fali.',
        rows: i.monsters, blank: () => ({ monster_id: meta.monsters[0].id, wave: 1, count_min: 1, count_max: 3 }),
        tpl: (r, k) => html`${leSelect(k, 'monster_id', monOpts, r.monster_id)}${leInput(k, 'wave', r.wave, { min: 1, max: 20, ph: 'Fala' })}${leInput(k, 'count_min', r.count_min, { min: 1, max: 50, ph: 'Min' })}${leInput(k, 'count_max', r.count_max, { min: 1, max: 50, ph: 'Maks' })}`,
        onSave: async (rows) => { await api('/instances/' + i.id + '/monsters', 'PUT', { monsters: rows }); toast('Lista potworów zapisana.', 'ok'); go(); } }); },
    diff: (ds) => { const d = diff.rows.find((x) => x.id === Number(ds.id)); formModal({ title: 'Trudność: ' + d.name, size: 'sm',
      fields: [['hp_mult', 'Mnożnik HP'], ['atk_mult', 'Mnożnik ataku'], ['def_mult', 'Mnożnik obrony'], ['reward_mult', 'Mnożnik nagród (EXP i złoto)'], ['drop_mult', 'Mnożnik dropu']]
        .map(([key, label]) => ({ key, label, type: 'number', min: 0.1, max: 20, step: 0.1, full: true })), values: d,
      onSubmit: async (v) => { await api('/difficulties/' + d.id, 'PATCH', v); toast('Mnożniki zapisane.', 'ok'); go(); } }); },
  };
};
