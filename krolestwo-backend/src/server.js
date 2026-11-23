'use strict';
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool, types } = require('pg');
types.setTypeParser(20, (v) => Number(v));      // bigint -> number (liczniki, id)
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> number
const { CLS_TO_CODE, CODE_TO_CLS, sha256, HttpError, getDatabaseUrl } = require('./common');
const { sanitizeSave, buildMonsterTable } = require('./saveGuard');
const realtime = require('./realtime');
const cfg = require('./config');
const createAdminRouter = require('./admin');

const PORT = Number(process.env.PORT) || 8080;

const pool = new Pool({
  connectionString: getDatabaseUrl(),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c search_path=kc,public',
  max: 10,
});
pool.on('error', (e) => console.error('[pg] błąd połączenia:', e.message));
cfg.init(pool);

const app = express();

// Zaufanie do proxy tylko jawnie, przez ENV (domyślnie: brak). Bez tego req.ip to adres gniazda,
// więc nagłówek X-Forwarded-For od klienta nie może posłużyć do obejścia limitów.
//   TRUST_PROXY=1         -> jeden proxy przed aplikacją (nginx / Caddy / tunel)
//   TRUST_PROXY=loopback  -> tylko proxy na tej samej maszynie (można też podać listę IP/CIDR)
// Wartość "true" jest odrzucana: ufałaby dowolnemu nagłówkowi wysłanemu przez klienta.
function configureTrustProxy() {
  const raw = String(process.env.TRUST_PROXY ?? '').trim();
  const die = (m) => { console.error('[config] ' + m); process.exit(1); };
  if (!raw || raw === '0' || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') die('TRUST_PROXY=true jest niedozwolone. Podaj liczbę proxy (np. 1), "loopback" albo listę IP/CIDR.');
  try { app.set('trust proxy', /^\d+$/.test(raw) ? Number(raw) : raw); }
  catch (e) { die('Nieprawidłowa wartość TRUST_PROXY: ' + e.message); }
  return true;
}
const proxyTrusted = configureTrustProxy();
app.disable('x-powered-by');

// ---------- nagłówki bezpieczeństwa ----------
// CSP w dwóch warstwach:
//  1) wymuszana zawsze — dyrektywy, które nie mogą zepsuć gry: clickjacking, <object>, <base>, formularze;
//  2) pełna polityka zasobów (CSP_FULL) — domyślnie tylko RAPORTOWANA w konsoli przeglądarki (Report-Only).
//     Gra ma ~21 inline <script>, 54 inline onclick i inline <style>, więc 'unsafe-inline' jest konieczne,
//     a connect-src musi dopuszczać dowolny serwer wpisany w polu adresu. Po sprawdzeniu konsoli
//     (brak komunikatów "Refused to ...") ustaw CSP_ENFORCE=true, żeby ją wymuszać.
const CSP_SAFE = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const CSP_FULL = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' http: https: ws: wss:",
  CSP_SAFE,
].join('; ');
const CSP_ENFORCE = String(process.env.CSP_ENFORCE || '').toLowerCase() === 'true';
let warnedXff = false;
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (CSP_ENFORCE) res.setHeader('Content-Security-Policy', CSP_FULL);
  else {
    res.setHeader('Content-Security-Policy', CSP_SAFE);
    res.setHeader('Content-Security-Policy-Report-Only', CSP_FULL);
  }
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000'); // tylko po HTTPS (wymaga TRUST_PROXY za proxy)
  if (!proxyTrusted && !warnedXff && req.headers['x-forwarded-for']) {
    warnedXff = true;
    console.warn('[config] Wykryto X-Forwarded-For, ale TRUST_PROXY nie jest ustawione — wszyscy gracze za proxy będą mieć wspólny limit IP. Ustaw TRUST_PROXY=1, jeśli przed aplikacją stoi proxy.');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

// ---------- CORS ----------
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- helpery ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const hits = new Map();
function limit(max, windowMs, keyFn) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za chwilę.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

// Prosty cache TTL w pamięci (współdzieli trwające zapytanie, nie cache'uje błędów,
// liczba kluczy ograniczona — najstarszy wpis wypada pierwszy).
function ttlCache(ttlMs, maxEntries) {
  const store = new Map();
  return async (key, load) => {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.exp > now) return hit.value;
    const entry = { exp: now + ttlMs, value: Promise.resolve().then(load) };
    store.delete(key);
    store.set(key, entry);
    if (store.size > maxEntries) store.delete(store.keys().next().value);
    try { return await entry.value; }
    catch (e) { if (store.get(key) === entry) store.delete(key); throw e; }
  };
}
const configCache = ttlCache(10_000, 1);
const rankingCache = ttlCache(15_000, 100);

// Licznik NIEUDANYCH logowań (okno stałe 15 min), niezależny od limitu IP na trasie:
//  - para IP + konto: zwykłe pomyłki z jednego adresu,
//  - samo konto: atak rozproszony z wielu adresów.
// Liczony tak samo dla istniejących i nieistniejących nazw — odpowiedź nie zdradza, czy konto istnieje.
// Klucze wymyśla klient, więc rozmiar mapy jest ograniczony (najstarszy wpis wypada pierwszy).
const loginFails = new Map(); // klucz -> { n, reset }
const LOGIN_FAIL_WINDOW = 15 * 60_000;
const LOGIN_FAIL_MAX_IP_USER = 10;
const LOGIN_FAIL_MAX_USER = 30;
const LOGIN_FAIL_CAP = 20000;
const failCount = (k) => { const e = loginFails.get(k); return e && e.reset > Date.now() ? e.n : 0; };
function failAdd(k) {
  const now = Date.now();
  let e = loginFails.get(k);
  if (!e || e.reset <= now) {
    loginFails.delete(k);
    if (loginFails.size >= LOGIN_FAIL_CAP) loginFails.delete(loginFails.keys().next().value);
    e = { n: 0, reset: now + LOGIN_FAIL_WINDOW };
    loginFails.set(k, e);
  }
  return ++e.n;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of loginFails) if (e.reset <= now) loginFails.delete(k); }, 5 * 60_000).unref();
// Odcisk nieznanego loginu do logów: HMAC z losowym kluczem procesu — pozwala zauważyć powtarzające się próby
// na tę samą nazwę, ale nie da się z niego odzyskać wpisanego tekstu (mógł to być przypadkiem wpisany hasło).
const FP_SECRET = crypto.randomBytes(16);
const fingerprint = (t) => crypto.createHmac('sha256', FP_SECRET).update(t).digest('hex').slice(0, 8);

async function createSession(accountId, req) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO sessions (account_id, token_hash, ip_address, user_agent) VALUES ($1,$2,$3,$4)',
    [accountId, sha256(token), req.ip || null, String(req.get('user-agent') || '').slice(0, 300)]
  );
  return token;
}

async function authFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const { rows } = await pool.query(
    `SELECT a.id, a.username, a.role, a.max_characters, s.id AS session_id,
            (a.is_banned AND (a.banned_until IS NULL OR a.banned_until > now())) AS banned
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)]
  );
  const u = rows[0];
  if (!u || u.banned) return null;
  pool.query(
    `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - INTERVAL '5 minutes'`,
    [u.session_id]
  ).catch(() => {});
  return u;
}

const auth = wrap(async (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const user = await authFromToken(m && m[1]);
  if (!user) throw new HttpError(401, 'Sesja wygasła — zaloguj się ponownie.');
  req.user = user;
  req.token = m[1];
  next();
});

const clampInt = (v, min, max) => Math.min(max, Math.max(min, Math.floor(Number(v)) || 0));

// Tryb ochrony zapisu (saveGuard.js): enforce = filtruje i ogranicza zapis (domyślnie);
// monitor = zapisuje jak dawniej, ale loguje, co zostałoby skorygowane (do kalibracji); off = wyłączone.
const SAVE_GUARD = ['enforce', 'monitor', 'off'].includes(String(process.env.SAVE_GUARD || '').toLowerCase())
  ? String(process.env.SAVE_GUARD).toLowerCase() : 'enforce';

// Dane referencyjne dla ochrony zapisu (potwory i przedmioty z bazy, reguły świata) — z krótkim cache.
const guardDataCache = ttlCache(60_000, 1);
const loadGuardData = () => guardDataCache('guard', async () => {
  const [mon, items] = await Promise.all([
    pool.query('SELECT code, level, exp_reward, gold_max FROM monsters'),
    pool.query('SELECT code, atk, def, buy_price FROM items'),
  ]);
  const itemCaps = {};
  for (const r of items.rows) itemCaps[r.code] = { atk: r.atk, def: r.def, price: r.buy_price };
  return { monsters: buildMonsterTable(mon.rows), itemCaps };
});
const realmRulesCache = ttlCache(15_000, 50);
const loadRealmRules = (realmId) => realmRulesCache('rules:' + realmId, async () => {
  const { rows } = await pool.query('SELECT exp_rate, drop_rate, death_penalty FROM realms WHERE id = $1', [realmId]);
  return cfg.effectiveRules(rows[0] || {});
});
const guardLogAt = new Map(); // postać -> czas ostatniego wpisu w logu (ograniczenie spamu)
function logGuard(charId, name, username, res, mode) {
  const now = Date.now();
  if (now - (guardLogAt.get(charId) || 0) < 60_000) return;
  if (guardLogAt.size > 5000) guardLogAt.clear();
  guardLogAt.set(charId, now);
  cfg.log('warn', 'save', `${mode === 'enforce' ? 'Skorygowano zapis' : 'Podejrzany zapis (tryb monitor)'}: ${name} (${res.adjustments.length} zmian)`,
    { charId, account: username, changes: res.adjustments.slice(0, 10) });
}

// Zapisuje stan gry wysłany przez klienta: JSON w save_data + kluczowe statystyki
// w kolumnach (ranking, widoki, bestiariusz). Wywoływane wewnątrz transakcji.
// opts.create = true: zapis początkowy nowej postaci (wartości początkowe ustala serwer, dane postępu od klienta są ignorowane).
async function applySave(db, charId, accountId, data, opts = {}) {
  if (!data || typeof data !== 'object' || !data.hero || typeof data.hero !== 'object') {
    throw new HttpError(400, 'Nieprawidłowe dane zapisu.');
  }

  const cur = await db.query(
    `SELECT ch.name, ch.realm_id, ch.level, ch.exp, ch.gold, ch.hp, ch.mp, ch.max_hp, ch.max_mp, ch.atk, ch.def,
            ch.force_reload, ch.save_data, ch.last_saved_at, cl.code AS cls_code,
            cl.base_hp, cl.base_mp, cl.base_atk, cl.base_def,
            cl.hp_per_level, cl.mp_per_level, cl.atk_per_level, cl.def_per_level
       FROM characters ch JOIN classes cl ON cl.id = ch.class_id
      WHERE ch.id = $1 AND ch.account_id = $2 AND ch.deleted_at IS NULL FOR UPDATE OF ch`,
    [charId, accountId]
  );
  const row = cur.rows[0];
  if (!row) throw new HttpError(404, 'Nie znaleziono postaci.');
  if (row.force_reload) {
    throw new HttpError(409, 'Administrator zmodyfikował Twoją postać — odśwież stronę i wczytaj ją ponownie.');
  }
  const oldLevel = row.level;

  // Wartości dotychczasowe (przycięte do zakresów) — używane przy SAVE_GUARD=off oraz w trybie monitor.
  const legacy = (() => {
    const h = data.hero;
    const w = data.world && typeof data.world === 'object' ? data.world : {};
    const maxHp = clampInt(h.maxHp, 1, 1_000_000);
    const maxMp = clampInt(h.maxMp, 0, 1_000_000);
    const killsObj = w.kills && typeof w.kills === 'object' ? w.kills : {};
    const killCodes = Object.keys(killsObj).filter((k) => /^[a-z_]{1,24}$/.test(k));
    const killCounts = killCodes.map((k) => clampInt(killsObj[k], 0, 1_000_000));
    return {
      lvl: clampInt(h.lvl, 1, 50), exp: clampInt(h.exp, 0, 2_000_000_000), gold: clampInt(h.gold, 0, 2_000_000_000),
      hp: Math.min(clampInt(h.hp, 0, 1_000_000), maxHp), maxHp, mp: Math.min(clampInt(h.mp, 0, 1_000_000), maxMp), maxMp,
      atk: clampInt(h.atk, 0, 1_000_000), def: clampInt(h.def, 0, 1_000_000),
      killCodes, killCounts, totalKills: killCounts.reduce((a, b) => a + b, 0),
      map: /^[a-z_]{1,24}$/.test(String(w.map)) ? String(w.map) : 'town',
      x: Math.max(-9999, Math.min(9999, Number(w.x) || 0)), y: Math.max(-9999, Math.min(9999, Number(w.y) || 0)),
      blob: data,
    };
  })();

  let v = legacy, adjusted = 0;
  if (SAVE_GUARD !== 'off') {
    const [gd, rules] = await Promise.all([loadGuardData(), loadRealmRules(row.realm_id)]);
    const res = sanitizeSave({
      mode: opts.create ? 'create' : 'save', incoming: data, stored: row.save_data, now: Date.now(),
      row: {
        id: charId, username: opts.username || '', name: row.name, cls: CODE_TO_CLS[row.cls_code],
        level: row.level, exp: row.exp, gold: row.gold, hp: row.hp, mp: row.mp, max_hp: row.max_hp, max_mp: row.max_mp,
        atk: row.atk, def: row.def, last_saved_at: row.last_saved_at ? new Date(row.last_saved_at).getTime() : Date.now(),
        klass: row,
      },
      ctx: { xpMul: rules.xp, goldMul: rules.gold, monsters: gd.monsters, itemCaps: gd.itemCaps },
    });
    if (res.adjustments.length) logGuard(charId, row.name, opts.username || '', res, SAVE_GUARD);
    if (SAVE_GUARD === 'enforce') {
      adjusted = res.adjustments.length;
      v = { ...res.cols, blob: res.data };
    }
  }

  await db.query(
    `UPDATE characters ch SET
        level = $3::int, exp = $4, gold = $5, hp = $6, max_hp = $7, mp = $8, max_mp = $9,
        atk = $10, def = $11,
        str = c.base_str + c.str_per_level * ($3::int - 1),
        dex = c.base_dex + c.dex_per_level * ($3::int - 1),
        int = c.base_int + c.int_per_level * ($3::int - 1),
        monsters_killed = GREATEST($12, 0), current_map = $13, pos_x = $14, pos_y = $15,
        save_data = $16::jsonb, last_saved_at = now()
       FROM classes c
      WHERE ch.id = $1 AND ch.account_id = $2 AND c.id = ch.class_id`,
    [charId, accountId, v.lvl, v.exp, v.gold, v.hp, v.maxHp, v.mp, v.maxMp,
     v.atk, v.def, v.totalKills, v.map, v.x, v.y, JSON.stringify(v.blob)]
  );

  if (v.killCodes.length) {
    await db.query(
      `INSERT INTO character_bestiary (character_id, monster_id, kills)
       SELECT $1, m.id, k.kills FROM unnest($2::text[], $3::int[]) AS k(code, kills)
         JOIN monsters m ON m.code = k.code
       ON CONFLICT (character_id, monster_id)
       DO UPDATE SET kills = GREATEST(character_bestiary.kills, EXCLUDED.kills)`,
      [charId, v.killCodes, v.killCounts]
    );
  }
  if (v.lvl > oldLevel) {
    await db.query(
      `INSERT INTO character_events (character_id, event_type, message) VALUES ($1,'level_up',$2)`,
      [charId, `Awans na poziom ${v.lvl}!`]
    );
  }
  return { adjusted };
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- API ----------
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, db: 'postgres' });
}));

app.post('/api/register', limit(10, 60_000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(username)) {
    throw new HttpError(400, 'Login: 3–24 znaków (litery, cyfry, _ oraz -).');
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    throw new HttpError(400, 'Hasło musi mieć od 6 do 72 znaków.');
  }
  if (!(await cfg.get()).server.registration_open) throw new HttpError(403, 'Rejestracja nowych kont jest tymczasowo wyłączona.');
  const hash = await bcrypt.hash(password, 12);
  let id;
  try {
    const r = await pool.query(
      'INSERT INTO accounts (username, password_hash, display_name, last_login_at) VALUES ($1,$2,$1,now()) RETURNING id',
      [username, hash]
    );
    id = r.rows[0].id;
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Ten login jest już zajęty.');
    throw e;
  }
  cfg.log('info', 'auth', `Rejestracja konta: ${username}`, { ip: req.ip });
  res.json({ token: await createSession(id, req), username });
}));

const DUMMY_HASH = bcrypt.hashSync('nieistniejace-haslo', 12);
app.post('/api/login', limit(15, 60_000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Podaj login i hasło.');
  const uname = username.slice(0, 24).toLowerCase();
  const kIpUser = 'iu:' + req.ip + '|' + uname, kUser = 'u:' + uname;
  if (failCount(kIpUser) >= LOGIN_FAIL_MAX_IP_USER || failCount(kUser) >= LOGIN_FAIL_MAX_USER) {
    throw new HttpError(429, 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za kilka minut.');
  }
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role, is_banned, ban_reason, banned_until FROM accounts WHERE lower(username) = lower($1)',
    [username.slice(0, 24)]
  );
  const acc = rows[0];
  const ok = await bcrypt.compare(password.slice(0, 72), acc ? acc.password_hash : DUMMY_HASH);
  if (!acc || !ok) {
    const nIpUser = failAdd(kIpUser), nUser = failAdd(kUser);
    // Wpisany tekst logujemy tylko, gdy to nazwa istniejącego konta (zapisujemy jego nazwę z bazy).
    // Dla nieznanych nazw — wyłącznie odcisk, bo ktoś mógł wpisać hasło w pole loginu.
    const who = acc ? acc.username : `nieznane konto #${fingerprint(uname)}`;
    cfg.log('warn', 'auth', `Nieudane logowanie: ${who}`, { ip: req.ip });
    if (nIpUser === LOGIN_FAIL_MAX_IP_USER || nUser === LOGIN_FAIL_MAX_USER) {
      cfg.log('warn', 'auth', `Zablokowano logowanie po serii nieudanych prób: ${who}`, { ip: req.ip, limit: nUser >= LOGIN_FAIL_MAX_USER ? 'konto' : 'ip+konto' });
    }
    throw new HttpError(401, 'Nieprawidłowy login lub hasło.');
  }
  loginFails.delete(kIpUser);
  if (acc.is_banned && (!acc.banned_until || new Date(acc.banned_until) > new Date())) {
    const until = acc.banned_until ? ' (do ' + new Date(acc.banned_until).toLocaleString('pl-PL') + ')' : '';
    throw new HttpError(403, 'Konto zablokowane' + until + (acc.ban_reason ? ': ' + acc.ban_reason : '.'));
  }
  const st = await cfg.get();
  if (st.server.maintenance && acc.role !== 'admin' && acc.role !== 'moderator') throw new HttpError(503, st.server.maintenance_msg);
  await pool.query('UPDATE accounts SET last_login_at = now() WHERE id = $1', [acc.id]);
  cfg.log('info', 'auth', `Logowanie: ${acc.username}`, { ip: req.ip, role: acc.role });
  res.json({ token: await createSession(acc.id, req), username: acc.username, role: acc.role });
}));

app.post('/api/logout', auth, wrap(async (req, res) => {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [req.user.session_id]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT username, display_name, bio, avatar_url, created_at FROM accounts WHERE id = $1', [req.user.id]);
  res.json(rows[0]);
}));

// Edycja profilu (display_name, bio, avatar_url) i zmiana hasła
app.post('/api/me', auth, wrap(async (req, res) => {
  const { display_name, bio, avatar_url, old_password, new_password } = req.body || {};
  if (new_password !== undefined) {
    if (typeof new_password !== 'string' || new_password.length < 6 || new_password.length > 72) {
      throw new HttpError(400, 'Nowe hasło musi mieć od 6 do 72 znaków.');
    }
    const { rows } = await pool.query('SELECT password_hash FROM accounts WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(old_password || ''), rows[0].password_hash))) {
      throw new HttpError(403, 'Stare hasło jest nieprawidłowe.');
    }
    await pool.query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(new_password, 12)]);
    // unieważnij pozostałe sesje
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [req.user.id, req.user.session_id]);
  }
  await pool.query(
    `UPDATE accounts SET display_name = COALESCE($2, display_name), bio = COALESCE($3, bio),
                         avatar_url = COALESCE($4, avatar_url) WHERE id = $1`,
    [req.user.id,
     typeof display_name === 'string' ? display_name.slice(0, 40) : null,
     typeof bio === 'string' ? bio.slice(0, 500) : null,
     typeof avatar_url === 'string' ? avatar_url.slice(0, 500) : null]
  );
  res.json({ ok: true });
}));

app.get('/api/realms', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, max_players, exp_rate, drop_rate, death_penalty
       FROM realms WHERE is_active ORDER BY name`);
  res.json({
    maxChars: req.user.max_characters,
    realms: await Promise.all(rows.map(async (r) => ({
      id: r.id, name: r.name, desc: r.description || '',
      online: realtime.countOnline(r.id), max: r.max_players,
      rules: await cfg.effectiveRules(r),
    }))),
  });
}));

app.get('/api/characters', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ch.id, ch.name, cl.code AS cls, ch.level, ch.last_saved_at AS updated
       FROM characters ch JOIN classes cl ON cl.id = ch.class_id
      WHERE ch.account_id = $1 AND ch.realm_id = $2 AND ch.deleted_at IS NULL
      ORDER BY ch.last_saved_at DESC`,
    [req.user.id, String(req.query.realm || '')]
  );
  res.json({ characters: rows.map((r) => ({ ...r, cls: CODE_TO_CLS[r.cls] })) });
}));

app.get('/api/characters/:id', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ch.*, cl.code AS cls_code FROM characters ch JOIN classes cl ON cl.id = ch.class_id
      WHERE ch.id = $1 AND ch.account_id = $2 AND ch.deleted_at IS NULL`,
    [clampInt(req.params.id, 0, Number.MAX_SAFE_INTEGER), req.user.id]
  );
  const c = rows[0];
  if (!c) throw new HttpError(404, 'Nie znaleziono postaci.');
  if (c.force_reload) await pool.query('UPDATE characters SET force_reload = FALSE WHERE id = $1', [c.id]);
  let data = c.save_data;
  if (!data) { // postać utworzona poza grą (np. z SQL) — zbuduj minimalny zapis
    data = {
      account: req.user.username,
      hero: {
        name: c.name, cls: CODE_TO_CLS[c.cls_code], lvl: c.level, exp: Number(c.exp), gold: Number(c.gold),
        hp: c.hp, maxHp: c.max_hp, mp: c.mp, maxMp: c.max_mp, atk: c.atk, def: c.def,
        inventory: [{ id: 'potion1', name: 'Mikstura Zdrowia', rarity: 'potion', heal: 30 }], history: [],
      },
    };
  }
  res.json({ id: c.id, name: c.name, cls: CODE_TO_CLS[c.cls_code], data });
}));

app.post('/api/characters', auth, wrap(async (req, res) => {
  const { realm, name, cls, data } = req.body || {};
  const clsCode = CLS_TO_CODE[cls];
  if (!clsCode) throw new HttpError(400, 'Nieznana klasa postaci.');
  if (typeof name !== 'string' || !/^[\p{L}0-9 _-]{3,16}$/u.test(name.trim())) {
    throw new HttpError(400, 'Imię: 3–16 znaków (litery, cyfry, spacja, _ oraz -).');
  }
  const r = await pool.query('SELECT 1 FROM realms WHERE id = $1 AND is_active', [String(realm || '')]);
  if (!r.rows[0]) throw new HttpError(400, 'Nieznany serwer.');

  try {
    const out = await tx(async (db) => {
      const created = await db.query('SELECT create_character($1,$2,$3,$4) AS id',
        [req.user.id, realm, name.trim(), clsCode]);
      const id = created.rows[0].id;
      if (data) await applySave(db, id, req.user.id, data, { create: true, username: req.user.username });
      return id;
    });
    res.json({ id: out, name: name.trim() });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'To imię jest już zajęte na tym serwerze.');
    if (e.code === '23514') throw new HttpError(400, 'Osiągnięto limit postaci na tym serwerze.');
    throw e;
  }
}));

// Autosave klienta: debounce 2,5 s (maks. ok. 24 zapisów/min) + zapis przy wyjściu/ukryciu karty.
// Limit 60/min na konto zostawia duży zapas uczciwym graczom, a blokuje spam (klient przy 429 nic nie psuje —
// kolejna zmiana stanu uruchamia nowy zapis).
const saveLimit = limit(60, 60_000, (req) => 'save:' + req.user.id);
app.post('/api/characters/:id/save', auth, saveLimit, wrap(async (req, res) => {
  const id = clampInt(req.params.id, 0, Number.MAX_SAFE_INTEGER);
  const out = await tx((db) => applySave(db, id, req.user.id, req.body && req.body.data, { username: req.user.username }));
  res.json(out && out.adjusted ? { ok: true, adjusted: out.adjusted } : { ok: true });
}));

app.delete('/api/characters/:id', auth, wrap(async (req, res) => {
  const id = clampInt(req.params.id, 0, Number.MAX_SAFE_INTEGER);
  const r = await pool.query(
    'UPDATE characters SET deleted_at = now() WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL',
    [id, req.user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Nie znaleziono postaci.');
  realtime.kick(id, 'Postać została usunięta.');
  res.json({ ok: true });
}));

// Ranking graczy (publiczny): /api/ranking?realm=cienie
const loadRanking = async (realm) => (await pool.query(
  `SELECT place, name, class, level, monsters_killed FROM v_ranking
    WHERE realm_id = $1 AND place <= 50 ORDER BY place`, [realm])).rows;
app.get('/api/ranking', wrap(async (req, res) => {
  const realm = String(req.query.realm || 'cienie');
  // cache tylko dla poprawnych identyfikatorów świata (nie dla dowolnych napisów z URL)
  const ranking = /^[a-z0-9_-]{1,32}$/i.test(realm)
    ? await rankingCache(realm, () => loadRanking(realm))
    : await loadRanking(realm);
  res.json({ ranking });
}));

// Publiczna konfiguracja gry: ustawienia serwera, ekonomia, eventy, aktualizacje oraz
// wartości potworów i przedmiotów z bazy (nadpisują domyślne w kliencie).
const loadConfigPayload = async () => {
  const s = await cfg.get();
  const [mon, items, upd] = await Promise.all([
    pool.query('SELECT code, name, level, hp, atk, exp_reward, gold_min, gold_max FROM monsters'),
    pool.query('SELECT code, name, atk, def, buy_price FROM items'),
    pool.query(`SELECT version, title, body, published_at FROM game_updates WHERE status = 'published'
                 ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 3`),
  ]);
  return {
    maintenance: s.server.maintenance, maintenance_msg: s.server.maintenance_msg,
    registration_open: s.server.registration_open, motd: s.server.motd, chat_enabled: s.server.chat_enabled,
    economy: s.economy, events: s.events, updates: upd.rows,
    monsters: mon.rows.map((m) => ({ code: m.code, name: m.name, lvl: m.level, hp: m.hp, atk: m.atk,
      exp: m.exp_reward, gold: Math.round((m.gold_min + m.gold_max) / 2) })),
    items: items.rows.map((i) => ({ id: i.code, name: i.name, atk: i.atk, def: i.def, price: i.buy_price })),
  };
};
app.get('/api/config', wrap(async (req, res) => {
  res.json(await configCache('config', loadConfigPayload));
}));

// ---------- panel administratora ----------
app.use('/api/admin', createAdminRouter({ pool, auth, realtime, startedAt: new Date().toISOString() }));

// ---------- frontend (opcjonalnie: ten sam origin co gra) ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nie znaleziono.' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Zapis jest zbyt duży.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Nieprawidłowy JSON.' });
  console.error('[błąd]', err);
  cfg.log('error', 'server', err && err.message ? err.message : 'Nieznany błąd', { path: req.path, method: req.method });
  res.status(500).json({ error: 'Błąd serwera.' });
});

const server = http.createServer(app);
realtime.attach(server, { pool, auth: authFromToken });

const pruneLogs = () => pool.query("DELETE FROM system_logs WHERE created_at < now() - interval '30 days'").catch(() => {});
pruneLogs();
setInterval(pruneLogs, 24 * 60 * 60 * 1000).unref();

// Sprzątanie sesji, których i tak nie da się użyć: wygasłych lub unieważnionych ponad 7 dni temu.
// Aktywna sesja (revoked_at IS NULL i expires_at w przyszłości) nigdy nie spełnia tego warunku. Kasowanie partiami.
async function pruneSessions() {
  const BATCH = 5000;
  let total = 0;
  try {
    for (let i = 0; i < 20; i++) {
      const r = await pool.query(
        `DELETE FROM sessions WHERE id IN (
           SELECT id FROM sessions
            WHERE expires_at < now() - interval '7 days'
               OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
            LIMIT ${BATCH})`);
      total += r.rowCount;
      if (r.rowCount < BATCH) break;
    }
    if (total) cfg.log('info', 'server', `Usunięto ${total} nieużywanych sesji`);
  } catch (e) { console.error('[pg] sprzątanie sesji:', e.message); }
}
pruneSessions();
setInterval(pruneSessions, 6 * 60 * 60 * 1000).unref();
cfg.log('info', 'server', 'Serwer uruchomiony', { port: PORT });

const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = dostępny w całej sieci lokalnej
server.listen(PORT, HOST, () => {
  console.log('⚔️  Królestwo Cieni — serwer działa');
  console.log(`   Na tym komputerze:      http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const list of Object.values(require('os').networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`   Inne urządzenia (Wi-Fi): http://${n.address}:${PORT}`);
      }
    }
  }
});

const shutdown = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
