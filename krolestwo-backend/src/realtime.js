'use strict';
// Tryb online: pozycje graczy, czat (mapa / /g / /w), lista graczy, wspólne walki z potworami.
const { WebSocketServer } = require('ws');
const { CODE_TO_CLS } = require('./common');
const cfg = require('./config');

const clients = new Set();           // zalogowani (po 'join') gracze
const deadMonsters = new Map();      // realmId -> Map(monsterId -> timestamp śmierci)
let deps = null;

const send = (c, obj) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(obj)); };
const sameMap = (a, b) => a.realm.id === b.realm.id && a.map === b.map;

function countOnline(realmId) {
  let n = 0;
  for (const c of clients) if (c.realm.id === realmId) n++;
  return n;
}

const isStaff = (c) => c.role === 'admin' || c.role === 'moderator';
const countAll = () => clients.size;
const onlineAccounts = () => new Set([...clients].map((c) => c.accountId));
const isCharOnline = (id) => [...clients].some((c) => c.charId === Number(id));
const list = () => [...clients].map((c) => ({
  account_id: c.accountId, char_id: c.charId, name: c.name, class: c.cls, level: c.level,
  realm: c.realm.id, map: c.map, role: c.role,
}));
function broadcast(msg) {
  let n = 0;
  for (const c of clients) { send(c, { t: 'sys', msg }); n++; }
  return n;
}
function dropClient(c, msg, code) {
  send(c, { t: 'kicked', msg });
  clients.delete(c);
  c.ws.close(code || 4003, 'kicked');
}
function kickAccount(accountId, msg) {
  for (const c of [...clients]) if (c.accountId === Number(accountId)) dropClient(c, msg);
}
function kickAll(msg, exceptStaff) {
  for (const c of [...clients]) if (!(exceptStaff && isStaff(c))) dropClient(c, msg);
}

function kick(charId, msg) {
  for (const c of [...clients]) {
    if (c.charId === Number(charId)) {
      send(c, { t: 'kicked', msg });
      clients.delete(c);
      c.ws.close(4003, 'kicked');
    }
  }
}

async function join(c, m) {
  const user = await deps.auth(m.token);
  if (!user) return c.ws.close(4000, 'auth');
  const charId = Number(m.charId);
  const { rows } = await deps.pool.query(
    `SELECT ch.id, ch.name, ch.level, ch.current_map, ch.realm_id, cl.code AS cls,
            r.name AS rname, r.max_players, r.exp_rate, r.drop_rate, r.death_penalty
       FROM characters ch
       JOIN classes cl ON cl.id = ch.class_id
       JOIN realms  r  ON r.id = ch.realm_id
      WHERE ch.id = $1 AND ch.account_id = $2 AND ch.deleted_at IS NULL`,
    [charId, user.id]
  );
  const r = rows[0];
  if (!r) return c.ws.close(4003, 'char');

  const settings = await cfg.get();
  if (settings.server.maintenance && user.role !== 'admin' && user.role !== 'moderator') {
    send(c, { t: 'kicked', msg: settings.server.maintenance_msg });
    return c.ws.close(4003, 'maintenance');
  }
  const rules = await cfg.effectiveRules(r);

  // to samo konto zalogowane drugi raz -> stara sesja wylatuje
  for (const o of [...clients]) {
    if (o.accountId === user.id) {
      send(o, { t: 'kicked', msg: 'Zalogowano z innego miejsca.' });
      clients.delete(o);
      o.ws.close(4001, 'replaced');
    }
  }
  if (countOnline(r.realm_id) >= r.max_players) return c.ws.close(4002, 'full');

  Object.assign(c, {
    joined: true, accountId: user.id, charId, id: String(charId),
    name: r.name, cls: CODE_TO_CLS[r.cls] || r.cls, level: r.level,
    map: r.current_map, x: 0, y: 0, d: 'down', v: 0, a: 0, look: null, hadOthers: false, role: user.role,
    realm: { id: r.realm_id, name: r.rname, rules },
  });
  clients.add(c);

  const dead = [];
  const dm = deadMonsters.get(r.realm_id);
  if (dm) for (const [id, ts] of dm) dead.push({ id, age: Date.now() - ts });

  send(c, { t: 'joined', online: countOnline(r.realm_id), realm: { name: r.rname, rules: c.realm.rules }, dead });
  for (const o of clients) if (o !== c && o.realm.id === c.realm.id && o.look) send(c, { t: 'look', i: o.id, look: o.look });
  if (settings.server.motd) send(c, { t: 'sys', msg: '📜 ' + settings.server.motd });
  for (const e of settings.events) send(c, { t: 'sys', msg: `🎉 Trwa event: ${e.name} (EXP ×${e.exp_mult}, złoto ×${e.gold_mult}, drop ×${e.drop_mult})` });
}

function onChat(c, raw) {
  if (cfg.peek().server.chat_enabled === false && !isStaff(c)) return send(c, { t: 'err', msg: 'Czat jest tymczasowo wyłączony.' });
  const text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!text) return;
  const now = Date.now();
  if (now - c.lastChat < 700) return send(c, { t: 'err', msg: 'Pisz wolniej.' });
  c.lastChat = now;

  let m;
  if ((m = text.match(/^\/g\s+(.+)$/i))) {
    for (const o of clients) if (o.realm.id === c.realm.id) send(o, { t: 'chat', ch: 'global', from: c.name, msg: m[1] });
  } else if ((m = text.match(/^\/w\s+(\S+)\s+(.+)$/i))) {
    const target = [...clients].find((o) => o.realm.id === c.realm.id && o.name.toLowerCase() === m[1].toLowerCase());
    if (!target) return send(c, { t: 'err', msg: 'Gracz „' + m[1] + '” nie jest online.' });
    const msg = { t: 'chat', ch: 'w', from: c.name, msg: m[2], to: target.name };
    send(target, msg);
    if (target !== c) send(c, msg);
  } else if (text.startsWith('/')) {
    send(c, { t: 'err', msg: 'Komendy: /g wiadomość (wszyscy), /w nick wiadomość (prywatna).' });
  } else {
    for (const o of clients) if (sameMap(o, c)) send(o, { t: 'chat', ch: 'map', from: c.name, msg: text });
  }
}

function handle(c, m) {
  switch (m.t) {
    case 'pos': {
      if (typeof m.m === 'string' && /^[a-z_]{1,24}$/.test(m.m)) c.map = m.m;
      const x = Number(m.x), y = Number(m.y);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 5000 && Math.abs(y) < 5000) { c.x = x; c.y = y; }
      c.d = String(m.d || 'down').slice(0, 8);
      c.v = m.v ? 1 : 0;
      c.a = Number(m.a) | 0;
      const l = Number(m.l);
      if (Number.isInteger(l) && l >= 1 && l <= 50) c.level = l;
      break;
    }
    case 'look': {
      if (!m.look || typeof m.look !== 'object' || JSON.stringify(m.look).length > 2000) break;
      c.look = m.look;
      for (const o of clients) if (o !== c && o.realm.id === c.realm.id) send(o, { t: 'look', i: c.id, look: c.look });
      break;
    }
    case 'chat': onChat(c, m.text); break;
    case 'who':
      send(c, { t: 'who', list: [...clients].filter((o) => o.realm.id === c.realm.id)
        .map((o) => ({ n: o.name, c: o.cls, l: o.level, m: o.map })) });
      break;
    case 'ping': send(c, { t: 'pong', ts: m.ts }); break;
    case 'mdmg': {
      const d = Number(m.d);
      if (typeof m.id !== 'string' || m.id.length > 40 || !Number.isFinite(d) || d <= 0 || d > 100000) break;
      for (const o of clients) if (o !== c && sameMap(o, c)) send(o, { t: 'mdmg', id: m.id, d: Math.floor(d), from: c.name });
      break;
    }
    case 'mkill': {
      if (typeof m.id !== 'string' || m.id.length > 40) break;
      if (!deadMonsters.has(c.realm.id)) deadMonsters.set(c.realm.id, new Map());
      deadMonsters.get(c.realm.id).set(m.id, Date.now());
      for (const o of clients) if (o !== c && sameMap(o, c)) send(o, { t: 'mkill', id: m.id, by: c.name });
      break;
    }
    default: break;
  }
}

function attach(server, d) {
  deps = d;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

  wss.on('connection', (ws) => {
    const c = { ws, joined: false, lastChat: 0, alive: true, burst: 0, burstAt: Date.now() };
    const joinTimer = setTimeout(() => { if (!c.joined) ws.close(4000, 'timeout'); }, 10_000);

    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - c.burstAt > 1000) { c.burstAt = now; c.burst = 0; }
      if (++c.burst > 100) return;                       // ochrona przed floodem
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!c.joined) {
        if (m.t === 'join' && !c.joining) {
          c.joining = true;
          join(c, m).catch((e) => { console.error('[ws join]', e.message); ws.close(4000, 'error'); });
        }
        return;
      }
      handle(c, m);
    });
    ws.on('close', () => { clearTimeout(joinTimer); clients.delete(c); });
    ws.on('error', () => {});
    c.ws.isClient = c;
  });

  // snapshoty pozycji: każdy widzi graczy z tej samej mapy i serwera
  setInterval(() => {
    const groups = new Map();
    for (const c of clients) {
      const k = c.realm.id + '|' + c.map;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const g of groups.values()) {
      for (const c of g) {
        const p = [];
        for (const o of g) {
          if (o === c || p.length >= 50) continue;
          p.push({ i: o.id, n: o.name, c: o.cls, l: o.level, x: o.x, y: o.y, a: o.a, d: o.d, v: o.v });
        }
        if (!p.length && !c.hadOthers) continue;       // nic nowego do wysłania
        c.hadOthers = p.length > 0;
        send(c, { t: 'snap', p });
      }
    }
  }, 150).unref();

  // ping co 30 s — zrywa martwe połączenia
  setInterval(() => {
    for (const ws of wss.clients) {
      const c = ws.isClient;
      if (c && !c.alive) { ws.terminate(); continue; }
      if (c) c.alive = false;
      ws.ping();
    }
  }, 30_000).unref();

  // sprzątanie listy zabitych potworów (respawn po kilku minutach)
  setInterval(() => {
    const limit = Date.now() - 10 * 60 * 1000;
    for (const m of deadMonsters.values()) for (const [id, ts] of m) if (ts < limit) m.delete(id);
  }, 60_000).unref();
}

module.exports = {
  attach, countOnline, countAll, onlineAccounts, isCharOnline, list, broadcast,
  kick, kickChar: kick, kickAccount, kickAll,
};
