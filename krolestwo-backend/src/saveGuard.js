'use strict';
// Walidacja i filtrowanie zapisu postaci (Etap C1).
//
// Klient gry jest wciąż autorytatywny co do przebiegu rozgrywki (walka, drop i nagrody liczy przeglądarka),
// więc serwer nie może ich odtworzyć. Może natomiast:
//   1. sam ustalić stan początkowy nowej postaci,
//   2. odrzucić wszystko, co nie ma prawa istnieć (zła struktura, nieznane przedmioty, afiksy spoza zakresów,
//      umiejętności ponad limit punktów, cofanie ukończonych questów i otwartych skrzyń itp.),
//   3. ograniczyć TEMPO przyrostu EXP, poziomu, złota i zabójstw względem poprzedniego stanu zapisanego
//      na serwerze (wiadro limitu odnawiane z czasem, stan trzymany w kluczu _sg wewnątrz save_data),
//   4. ograniczyć statystyki bojowe do wartości wynikających z poziomu, klasy, umiejętności i ekwipunku.
// Modyfikacje są ciche (zapis się udaje, ale zawiera wartości poprawione); lista zmian wraca do wywołującego.
// Docelowo (server-authoritative) ta sama funkcja może przyjmować zdarzenia zamiast gotowych wartości.
//
// Moduł jest czysty (bez bazy i bez I/O): dane z bazy dostarcza wywołujący przez row/ctx.

const G = require('./gamedata');

// ===== Parametry limitów (do kalibracji; patrz tryb SAVE_GUARD=monitor w server.js) =====
const P = {
  MAX_LEVEL: 50,
  KILL_CAP: 40,            // zapas zabójstw (burst)
  KILL_RATE: 2,            // zabójstw odnawianych na sekundę
  REWARD_CAP_KILLS: 12,    // zapas EXP/złota = tyle "zabójstw najlepiej płatnego potwora z zasięgu poziomu"
  REWARD_RATE_KILLS: 2.0,  // tyle takich zabójstw odnawia się na sekundę
  LEVEL_LOOKAHEAD: 8,      // potwory do (poziom + 8) liczą się do limitu nagród
  REWARD_SAFETY: 1.5,      // margines na skalowanie nagród w instancjach, eventy itp.
  CHEST_GOLD: 60,          // limit złota za jedną nowo otwartą skrzynię (gra daje 8-27)
  MAX_DT: 3600,            // maks. czas (s) uwzględniany przy odnawianiu wiaderek
  SLACK: { maxHp: 3, maxMp: 3, atk: 2, def: 2, rate: 0.01 },
};

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toInt = (v, min, max, dflt) => (isNum(v) ? Math.min(max, Math.max(min, Math.floor(v))) : dflt);
const toNum = (v, min, max, dflt) => (isNum(v) ? Math.min(max, Math.max(min, v)) : dflt);
const cleanStr = (v, max, dflt = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, max) : dflt);
const KEY = /^[A-Za-z0-9_.:-]{1,48}$/;
const QUEST_STATUS = ['available', 'active', 'done'];
const DIRS = ['up', 'down', 'left', 'right'];

// ----- EXP: ta sama krzywa co w kliencie (xpNeeded) i w tabeli level_exp. exp w grze jest liczony NA POZIOM. -----
const xpNeeded = (l) => Math.floor(40 * Math.pow(1.35, l - 1));
function totalXp(lvl, exp) { let t = exp; for (let i = 1; i < lvl; i++) t += xpNeeded(i); return t; }
function fromTotalXp(total) {
  let l = 1, t = total;
  while (l < P.MAX_LEVEL && t >= xpNeeded(l)) { t -= xpNeeded(l); l++; }
  return { lvl: l, exp: t };
}

// Największa nagroda za zabójstwo wśród potworów do danego poziomu (bez mnożników).
function maxReward(monsters, maxLevel) {
  let exp = 0, gold = 0;
  for (const m of monsters) if (m.level <= maxLevel) { exp = Math.max(exp, m.exp); gold = Math.max(gold, m.gold); }
  return { exp: exp || 1, gold: gold || 1 };
}

// Dane potworów: lustro z klienta + wartości z bazy (większa z dwóch wygrywa), ewentualne potwory tylko z bazy.
function buildMonsterTable(dbRows) {
  const map = new Map(Object.entries(G.MONSTERS).map(([code, m]) => [code, { code, level: m.lvl, exp: m.exp, gold: m.gold }]));
  for (const r of dbRows || []) {
    const cur = map.get(r.code) || { code: r.code, level: Number(r.level) || 1, exp: 0, gold: 0 };
    cur.exp = Math.max(cur.exp, Number(r.exp_reward) || 0);
    cur.gold = Math.max(cur.gold, Number(r.gold_max) || 0);
    map.set(r.code, cur);
  }
  return [...map.values()];
}

// ----- Przedmioty -----
function itemCaps(id, ctx) {
  const base = G.ITEMS[id]; if (!base) return null;
  const db = (ctx.itemCaps && ctx.itemCaps[id]) || {};
  const caps = { ...base };
  for (const k of ['atk', 'def', 'price']) if (k in base) caps[k] = Math.max(base[k], Number(db[k]) || 0);
  return caps;
}
function affixMax(k, lvl) {
  const a = G.AFFIXES[k];
  return Math.max(1, Math.ceil(a.max * (a.flat ? 1 + (lvl - 1) * 0.07 : 1)) + 1);
}
// Zwraca poprawny przedmiot albo null (nieznane id / zły typ). Pola spoza listy są odrzucane.
function cleanItem(raw, ctx, lvl, note, where) {
  if (!isObj(raw)) { if (raw !== null && raw !== undefined) note(where, 'obiekt', null, 'przedmiot: zły typ'); return null; }
  const caps = typeof raw.id === 'string' ? itemCaps(raw.id, ctx) : null;
  if (!caps) { note(where, String(raw.id).slice(0, 24), null, 'nieznany przedmiot'); return null; }
  const it = { id: raw.id, name: cleanStr(raw.name, 48, caps.name), rarity: caps.rarity, slot: caps.slot };
  for (const k of ['atk', 'def', 'heal', 'bag']) if (k in caps) it[k] = Math.min(caps[k], toInt(raw[k], 0, caps[k], caps[k]));
  if ('price' in caps) it.price = Math.min(caps.price, toInt(raw.price, 0, caps.price, caps.price));
  const gear = !['consumable', 'bag'].includes(caps.slot);
  if (gear && Array.isArray(raw.affixes)) {
    const maxN = G.AFFIX_COUNT[caps.rarity] || 0;
    it.affixes = [];
    for (const a of raw.affixes.slice(0, maxN)) {
      if (!isObj(a) || !Object.prototype.hasOwnProperty.call(G.AFFIXES, a.k)) continue;
      const v = toInt(a.v, 1, affixMax(a.k, lvl), 1);
      it.affixes.push({ k: a.k, v });
    }
    if (raw.affixes.length > it.affixes.length) note(where + '.affixes', raw.affixes.length, it.affixes.length, 'afiksy poza zakresem');
  }
  if (gear && raw.up !== undefined) {
    const up = toInt(raw.up, 0, 5, 0);
    if (up) it.up = up;
  }
  return it;
}
// Premie ekwipunku do statystyk (lustro itemAtk/itemDef/applyStats z klienta).
function gearBonus(equip) {
  const g = { atk: 0, def: 0, maxHp: 0, maxMp: 0, crit: 0, ms: 0, ls: 0 };
  for (const it of Object.values(equip || {})) {
    if (!it) continue;
    const primary = (it.atk && (!it.def || it.slot === 'weapon' || it.atk >= it.def)) ? 'atk' : 'def';
    g.atk += (it.atk || 0) + ((it.up && primary === 'atk') ? it.up : 0);
    g.def += (it.def || 0) + ((it.up && it.def && primary === 'def') ? it.up : 0);
    for (const a of it.affixes || []) {
      if (a.k === 'hp') g.maxHp += a.v; else if (a.k === 'mp') g.maxMp += a.v;
      else if (a.k === 'atkp') g.atk += a.v; else if (a.k === 'defp') g.def += a.v;
      else g[a.k] += a.v / 100;
    }
  }
  return g;
}

// ----- Umiejętności -----
function cleanSkills(raw, cls) {
  if (!isObj(raw)) return null;
  const allowed = G.SKILLS[cls] || [];
  const out = {};
  for (const id of Object.keys(raw).slice(0, 40)) {
    if (!allowed.includes(id)) continue;
    const r = toInt(raw[id], 0, G.SKILL_MAX_RANK, 0);
    if (r > 0) out[id] = r;
  }
  return out;
}
const sumRanks = (s) => Object.values(s || {}).reduce((a, b) => a + b, 0);
function passiveBonus(skills) {
  const pb = { maxHp: 0, maxMp: 0, atk: 0, def: 0, crit: 0, ms: 0, ls: 0 };
  for (const [id, r] of Object.entries(skills || {})) {
    const f = G.PASSIVES[id]; if (!f) continue;
    for (const [k, v] of Object.entries(f(r))) pb[k] += v;
  }
  return pb;
}

// ----- Świat (struktury, które klient tylko DOPISUJE; cofnięcie = próba odnowienia nagród) -----
function cleanWorld(inc, st, create, now, note) {
  const w = {};
  const stMap = KEY.test(String(st.map)) ? st.map : 'town';
  w.map = create ? 'town' : (KEY.test(String(inc.map)) ? inc.map : stMap);
  w.x = toNum(inc.x, -9999, 9999, toNum(st.x, -9999, 9999, 0));
  w.y = toNum(inc.y, -9999, 9999, toNum(st.y, -9999, 9999, 0));
  w.dir = DIRS.includes(inc.dir) ? inc.dir : (DIRS.includes(st.dir) ? st.dir : 'down');

  // fog: tablice 0/1; odkryty obszar nie może się "cofnąć" -> mapy znane tylko ze starego zapisu są zachowane
  w.fog = {};
  let cells = 0;
  const takeFog = (src) => {
    for (const id of Object.keys(src).slice(0, 60)) {
      const arr = src[id];
      if (id in w.fog || !KEY.test(id) || !Array.isArray(arr) || arr.length > 20000 || cells + arr.length > 400000) continue;
      cells += arr.length;
      w.fog[id] = arr.map((v) => (v === 1 || v === true ? 1 : 0));
    }
  };
  if (!create) { if (isObj(inc.fog)) takeFog(inc.fog); if (isObj(st.fog)) takeFog(st.fog); }

  const union = (a, b, cap) => { const s = new Set(); for (const x of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) if (typeof x === 'string' && KEY.test(x)) s.add(x); return [...s].slice(0, cap); };
  w.visitedMaps = create ? ['town'] : union(st.visitedMaps, inc.visitedMaps, 60);
  if (!w.visitedMaps.length) w.visitedMaps = ['town'];

  // skrzynie i flagi: raz ustawione zostają (klient ich nigdy nie kasuje)
  const flagSet = (stO, incO, cap) => {
    const out = {}; let fresh = 0;
    for (const k of Object.keys(isObj(stO) && !create ? stO : {}).slice(0, cap)) if (KEY.test(k) && stO[k] === true) out[k] = true;
    if (isObj(incO) && !create) for (const k of Object.keys(incO).slice(0, cap)) if (KEY.test(k) && incO[k] === true && !out[k] && Object.keys(out).length < cap) { out[k] = true; fresh++; }
    return { out, fresh };
  };
  const ch = flagSet(st.openedChests, inc.openedChests, 1000); w.openedChests = ch.out; w.newChests = ch.fresh;
  const fl = flagSet(st.flags, inc.flags, 500); w.flags = fl.out;

  // deadMonsters: znacznik czasu zabicia; tylko do przodu (kasowanie = natychmiastowy respawn bossów)
  w.deadMonsters = {};
  if (!create) {
    for (const k of Object.keys(isObj(st.deadMonsters) ? st.deadMonsters : {}).slice(0, 2000)) if (KEY.test(k) && isNum(st.deadMonsters[k])) w.deadMonsters[k] = st.deadMonsters[k];
    if (isObj(inc.deadMonsters)) for (const k of Object.keys(inc.deadMonsters).slice(0, 2000)) {
      if (!KEY.test(k) || !isNum(inc.deadMonsters[k])) continue;
      const ts = Math.min(Math.max(0, inc.deadMonsters[k]), now + 60000);
      if (!(k in w.deadMonsters) && Object.keys(w.deadMonsters).length >= 2000) continue;
      w.deadMonsters[k] = Math.max(w.deadMonsters[k] || 0, ts);
    }
  }

  // questy: 'done' jest ostateczne; nowe przejścia do 'done' liczymy (każde uprawnia do jednej nagrody)
  w.quests = {}; w.newDone = 0;
  const readQ = (q) => (isObj(q) && QUEST_STATUS.includes(q.status) ? { status: q.status, progress: toInt(q.progress, 0, 100000, 0) } : null);
  if (!create) {
    for (const id of Object.keys(isObj(st.quests) ? st.quests : {}).slice(0, 200)) { const q = KEY.test(id) && readQ(st.quests[id]); if (q) w.quests[id] = q; }
    if (isObj(inc.quests)) for (const id of Object.keys(inc.quests).slice(0, 200)) {
      const q = KEY.test(id) && readQ(inc.quests[id]); if (!q) continue;
      const prev = w.quests[id];
      if (prev && prev.status === 'done') { if (q.status !== 'done') note('world.quests.' + id, q.status, 'done', 'ukończony quest nie wraca'); continue; }
      if (q.status === 'done') w.newDone++;
      w.quests[id] = q;
    }
  }

  w.clock = toNum(inc.clock, 0, 2000, toNum(st.clock, 0, 2000, 600));
  const day = toInt(inc.day, 0, 1000000, toInt(st.day, 0, 1000000, undefined));
  if (day !== undefined) w.day = day;
  w.tracked = typeof inc.tracked === 'string' && KEY.test(inc.tracked) ? inc.tracked : null;
  return w;
}

function cleanSettings(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw).slice(0, 20)) {
    if (!/^[A-Za-z_]{1,24}$/.test(k)) continue;
    const v = raw[k];
    if (typeof v === 'boolean' || isNum(v)) out[k] = v; else if (typeof v === 'string') out[k] = cleanStr(v, 40);
  }
  return out;
}

// ============================================================
// sanitizeSave
//   mode:     'save' | 'create'
//   incoming: dane z żądania; stored: poprzedni save_data (lub null)
//   row:      { id, username, name, cls (nazwa klasy w kliencie), level, exp, gold, hp, mp, max_hp, max_mp, atk, def,
//               last_saved_at (ms), klass: {base_hp, base_mp, base_atk, base_def, hp_per_level, mp_per_level, atk_per_level, def_per_level} }
//   ctx:      { xpMul, goldMul, monsters (z buildMonsterTable), itemCaps: {id: {atk, def, price}} }
//   now:      Date.now()
// Zwraca { data, cols, adjustments }. Rzuca Error z .status = 400, gdy dane nie mają struktury zapisu.
// ============================================================
function sanitizeSave({ mode, incoming, stored, row, ctx, now }) {
  const create = mode === 'create';
  if (!isObj(incoming) || !isObj(incoming.hero)) { const e = new Error('Nieprawidłowe dane zapisu.'); e.status = 400; throw e; }
  const adj = [];
  const note = (field, from, to, reason) => { if (adj.length < 40) adj.push({ field, from, to, reason }); };
  const inc = incoming, ih = inc.hero, iw = isObj(inc.world) ? inc.world : {};
  const st = isObj(stored) && !create ? stored : {};
  const sh = isObj(st.hero) ? st.hero : {};
  const sw = isObj(st.world) ? st.world : {};
  const sg = isObj(st._sg) ? st._sg : {};
  const cls = row.cls, K = row.klass;
  const MAXL = P.MAX_LEVEL;

  // --- punkt odniesienia: ostatni zapis na serwerze (blob), a gdy go brak — kolumny ---
  const baseLvl = toInt(sh.lvl, 1, MAXL, toInt(Number(row.level), 1, MAXL, 1));
  const baseExp = toInt(sh.exp, 0, 2e9, toInt(Number(row.exp), 0, 2e9, 0));
  const baseGold = toInt(sh.gold, 0, 2e9, toInt(Number(row.gold), 0, 2e9, 0));

  // --- wiaderka limitu (odnawiane czasem) ---
  const t0 = create ? now : (isNum(sg.t) ? sg.t : (row.last_saved_at || now));
  const dt = Math.min(P.MAX_DT, Math.max(0, (now - t0) / 1000));
  const xpMul = Math.max(1, Number(ctx.xpMul) || 1), goldMul = Math.max(1, Number(ctx.goldMul) || 1);
  const ref = maxReward(ctx.monsters, baseLvl + P.LEVEL_LOOKAHEAD);
  const perExp = ref.exp * xpMul * P.REWARD_SAFETY, perGold = ref.gold * goldMul * P.REWARD_SAFETY;
  const refill = (tok, cap, rate) => Math.min(cap, (isNum(tok) ? Math.max(0, tok) : cap) + rate * dt);
  let tKill = refill(sg.ke, P.KILL_CAP, P.KILL_RATE);
  let tExp = refill(sg.xe, perExp * P.REWARD_CAP_KILLS, perExp * P.REWARD_RATE_KILLS);
  let tGold = refill(sg.ge, perGold * P.REWARD_CAP_KILLS, perGold * P.REWARD_RATE_KILLS);

  // --- świat ---
  const w = cleanWorld(iw, sw, create, now, note);

  // zabójstwa: tylko znane kody, nigdy w dół, przyrost ograniczony wiaderkiem
  const known = new Set([...ctx.monsters.map((m) => m.code)]);
  const kills = {};
  if (!create) for (const [c, n] of Object.entries(isObj(sw.kills) ? sw.kills : {})) if (/^[a-z0-9_]{1,32}$/.test(c) && isNum(n)) kills[c] = toInt(n, 0, 1e6, 0);
  if (!create && isObj(iw.kills)) {
    for (const c of Object.keys(iw.kills).slice(0, 100)) {
      if (!known.has(c)) { note('world.kills.' + String(c).slice(0, 24), iw.kills[c], null, 'nieznany potwór'); continue; }
      const want = toInt(iw.kills[c], 0, 1e6, 0), cur = kills[c] || 0;
      if (want <= cur) continue;
      const use = Math.min(want - cur, Math.floor(tKill));
      kills[c] = cur + use; tKill -= use;
      if (use < want - cur) note('world.kills.' + c, want, cur + use, 'zbyt szybki przyrost zabójstw');
    }
  }
  w.kills = kills;
  const totalKills = Object.values(kills).reduce((a, b) => a + b, 0);

  // --- EXP i poziom (przyrost ograniczony w jednostkach "łącznego EXP") ---
  const inLvl = toInt(ih.lvl, 1, MAXL, baseLvl), inExp = toInt(ih.exp, 0, 2e9, baseExp);
  const questExp = w.newDone * G.QUEST_MAX.exp * xpMul;
  let lvl = baseLvl, exp = baseExp;
  if (!create) {
    const baseTotal = totalXp(baseLvl, baseExp), inTotal = totalXp(inLvl, inExp);
    if (inTotal <= baseTotal) { lvl = inLvl; exp = inExp; }
    else {
      const delta = inTotal - baseTotal, allowed = tExp + questExp;
      if (delta <= allowed) { lvl = inLvl; exp = inExp; tExp -= Math.max(0, delta - questExp); }
      else {
        const f = fromTotalXp(baseTotal + Math.floor(allowed));
        note('hero.lvl/exp', `${inLvl}/${inExp}`, `${f.lvl}/${f.exp}`, 'zbyt szybki przyrost EXP');
        lvl = f.lvl; exp = f.exp; tExp = 0;
      }
    }
  }

  // --- złoto ---
  const inGold = toInt(ih.gold, 0, 2e9, baseGold);
  let gold = baseGold;
  if (!create) {
    if (inGold <= baseGold) gold = inGold;
    else {
      const extra = w.newDone * G.QUEST_MAX.gold + Math.min(w.newChests, 100) * P.CHEST_GOLD;
      const delta = inGold - baseGold, allowed = tGold + extra;
      if (delta <= allowed) { gold = inGold; tGold -= Math.max(0, delta - extra); }
      else { gold = baseGold + Math.floor(allowed); tGold = 0; note('hero.gold', inGold, gold, 'zbyt szybki przyrost złota'); }
    }
  }

  // --- hero: tożsamość z serwera ---
  const hero = { name: row.name, cls };
  hero.lvl = lvl; hero.exp = exp; hero.gold = gold;

  // --- umiejętności (suma rang <= poziom) ---
  let skills = null;
  const storedSkills = cleanSkills(sh.skills, cls);
  if (!create && isObj(ih.skills)) {
    skills = cleanSkills(ih.skills, cls);
    if (sumRanks(skills) > lvl) { note('hero.skills', sumRanks(skills), sumRanks(storedSkills || {}), 'więcej punktów umiejętności niż poziom'); skills = storedSkills && sumRanks(storedSkills) <= lvl ? storedSkills : {}; }
  } else if (!create && storedSkills) skills = sumRanks(storedSkills) <= lvl ? storedSkills : {};
  const pas = passiveBonus(skills);

  // --- przedmioty ---
  let bagsOut = [], equipOut = null, legacy = null;
  const cleanBagItems = (arr, size, where) => (Array.isArray(arr) ? arr.slice(0, size).map((x, i) => cleanItem(x, ctx, lvl, note, where + '[' + i + ']')) : []);
  const cleanBags = (raw, where) => {
    const out = [];
    if (Array.isArray(raw)) for (const b of raw.slice(0, 8)) {
      if (!isObj(b)) continue;
      const size = toInt(b.size, 1, 12, 8);
      out.push({ name: cleanStr(b.name, 24, 'Torba'), size, items: cleanBagItems(b.items, size, where) });
    }
    return out;
  };
  if (create) {
    legacy = [{ id: 'potion1', name: 'Mikstura Zdrowia', rarity: 'potion', heal: 30 }];
  } else {
    // Pusta lista toreb zepsułaby grę po wczytaniu (klient tworzy domyślne torby tylko, gdy klucza brak),
    // dlatego bez ani jednej poprawnej torby zostaje poprzedni zapis, a gdy go nie ma — klucz jest pomijany.
    bagsOut = cleanBags(ih.bags, 'hero.bags');
    if (!bagsOut.length) bagsOut = cleanBags(sh.bags, 'hero.bags(stary)');
    if (isObj(ih.equip)) {
      equipOut = {};
      for (const slot of G.EQUIP_SLOTS) equipOut[slot] = cleanItem(ih.equip[slot], ctx, lvl, note, 'hero.equip.' + slot);
    }
    if (Array.isArray(ih.inventory)) legacy = ih.inventory.slice(0, 60).map((x, i) => cleanItem(x, ctx, lvl, note, 'hero.inventory[' + i + ']')).filter(Boolean);
  }
  const gear = gearBonus(equipOut);

  // --- statystyki: limit wynikający z klasy/poziomu/umiejętności/ekwipunku (nigdy poniżej poprzedniego zapisu) ---
  const lvlStat = (b, per) => Number(b) + Number(per) * (lvl - 1);
  const stat = (name, key, ceilBase, slack) => {
    const stored0 = toInt(sh[key], 0, 1e6, toInt(Number(row[name]), 0, 1e6, 0));
    const ceil = Math.floor(ceilBase) + slack;
    const limit = Math.max(stored0, ceil);
    if (create) return toInt(Number(row[name]), 0, 1e6, 0);
    const v = toInt(ih[key], 0, limit, stored0 || ceil);
    if (isNum(ih[key]) && Math.floor(ih[key]) > limit) note('hero.' + key, Math.floor(ih[key]), limit, 'statystyka ponad limit');
    return v;
  };
  hero.hp = 0; hero.maxHp = 0; hero.mp = 0; hero.maxMp = 0;
  hero.maxHp = Math.max(1, stat('max_hp', 'maxHp', lvlStat(K.base_hp, K.hp_per_level) + pas.maxHp + gear.maxHp, P.SLACK.maxHp));
  hero.maxMp = stat('max_mp', 'maxMp', lvlStat(K.base_mp, K.mp_per_level) + pas.maxMp + gear.maxMp, P.SLACK.maxMp);
  hero.hp = create ? toInt(Number(row.hp), 0, hero.maxHp, hero.maxHp) : Math.min(toInt(ih.hp, 0, 1e6, toInt(sh.hp, 0, 1e6, hero.maxHp)), hero.maxHp);
  hero.mp = create ? toInt(Number(row.mp), 0, hero.maxMp, hero.maxMp) : Math.min(toInt(ih.mp, 0, 1e6, toInt(sh.mp, 0, 1e6, hero.maxMp)), hero.maxMp);
  hero.atk = stat('atk', 'atk', lvlStat(K.base_atk, K.atk_per_level) + pas.atk + gear.atk, P.SLACK.atk);
  hero.def = stat('def', 'def', lvlStat(K.base_def, K.def_per_level) + pas.def + gear.def, P.SLACK.def);

  // pochodne (crit/ms/ls): limit = baza + umiejętności + ekwipunek
  const rate = (key, base, extra) => {
    if (create || !isNum(ih[key])) return undefined;
    const limit = Math.max(isNum(sh[key]) ? sh[key] : 0, base + extra + P.SLACK.rate);
    if (ih[key] > limit) note('hero.' + key, ih[key], limit, 'wartość ponad limit');
    return Math.min(Math.max(0, ih[key]), limit);
  };
  const crit = rate('crit', 0.08, pas.crit + gear.crit), ms = rate('ms', 0, pas.ms + gear.ms), ls = rate('ls', 0, pas.ls + gear.ls);
  if (crit !== undefined) hero.crit = crit;
  if (ms !== undefined) hero.ms = ms;
  if (ls !== undefined) hero.ls = ls;

  if (skills) hero.skills = skills;
  if (!create && (isObj(ih.pb) || skills)) {
    let pb = pas;
    if (isObj(ih.pb) && Object.keys(pas).every((k) => isNum(ih.pb[k]) && Math.abs(ih.pb[k] - pas[k]) < 1e-6)) pb = { ...ih.pb };
    else if (isObj(ih.pb)) note('hero.pb', 'inne', 'wyliczone', 'premie z umiejętności niezgodne');
    hero.pb = pb;
  }
  if (bagsOut.length) hero.bags = bagsOut;
  if (equipOut) hero.equip = equipOut;
  if (legacy) hero.inventory = legacy;
  hero.history = create ? [] : (Array.isArray(ih.history) ? ih.history.slice(0, 40).filter(isObj).map((h) => ({ t: toInt(h.t, 0, 8.64e15, 0), text: cleanStr(h.text, 200) })) : []);

  // --- składanie zapisu ---
  const world = { map: w.map, x: w.x, y: w.y, dir: w.dir, fog: w.fog, visitedMaps: w.visitedMaps, openedChests: w.openedChests,
    deadMonsters: w.deadMonsters, quests: w.quests, clock: w.clock, flags: w.flags, kills: w.kills, tracked: w.tracked };
  if (w.day !== undefined) world.day = w.day;
  const data = { account: row.username, charId: row.id, hero, world, settings: cleanSettings(inc.settings),
    _sg: { v: 1, t: now, ke: tKill, xe: tExp, ge: tGold } };

  const killCodes = Object.keys(kills);
  return {
    data, adjustments: adj,
    cols: { lvl, exp, gold, hp: hero.hp, maxHp: hero.maxHp, mp: hero.mp, maxMp: hero.maxMp, atk: hero.atk, def: hero.def,
      killCodes, killCounts: killCodes.map((c) => kills[c]), totalKills, map: w.map, x: w.x, y: w.y },
  };
}

module.exports = { sanitizeSave, buildMonsterTable, totalXp, fromTotalXp, xpNeeded, P };
