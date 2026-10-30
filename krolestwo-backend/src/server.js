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
const { CLS_TO_CODE, CODE_TO_CLS, sha256, HttpError } = require('./common');
const realtime = require('./realtime');
const cfg = require('./config');
const createAdminRouter = require('./admin');

const PORT = Number(process.env.PORT) || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://kc:kc_password@localhost:5432/krolestwo',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c search_path=kc,public',
  max: 10,
});
pool.on('error', (e) => console.error('[pg] błąd połączenia:', e.message));
cfg.init(pool);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
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
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za chwilę.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

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

// Zapisuje stan gry wysłany przez klienta: JSON w save_data + kluczowe statystyki
// w kolumnach (ranking, widoki, bestiariusz). Wywoływane wewnątrz transakcji.
async function applySave(db, charId, accountId, data) {
  if (!data || typeof data !== 'object' || !data.hero || typeof data.hero !== 'object') {
    throw new HttpError(400, 'Nieprawidłowe dane zapisu.');
  }
  const h = data.hero;
  const w = data.world && typeof data.world === 'object' ? data.world : {};

  const lvl = clampInt(h.lvl, 1, 50);
  const maxHp = clampInt(h.maxHp, 1, 1_000_000);
  const maxMp = clampInt(h.maxMp, 0, 1_000_000);
  const vals = {
    exp: clampInt(h.exp, 0, 2_000_000_000),
    gold: clampInt(h.gold, 0, 2_000_000_000),
    hp: Math.min(clampInt(h.hp, 0, 1_000_000), maxHp),
    mp: Math.min(clampInt(h.mp, 0, 1_000_000), maxMp),
    atk: clampInt(h.atk, 0, 1_000_000),
    def: clampInt(h.def, 0, 1_000_000),
  };
  const killsObj = w.kills && typeof w.kills === 'object' ? w.kills : {};
  const killCodes = Object.keys(killsObj).filter((k) => /^[a-z_]{1,24}$/.test(k));
  const killCounts = killCodes.map((k) => clampInt(killsObj[k], 0, 1_000_000));
  const totalKills = killCounts.reduce((a, b) => a + b, 0);
  const map = /^[a-z_]{1,24}$/.test(String(w.map)) ? String(w.map) : 'town';
  const px = Math.max(-9999, Math.min(9999, Number(w.x) || 0));
  const py = Math.max(-9999, Math.min(9999, Number(w.y) || 0));

  const cur = await db.query(
    'SELECT level, force_reload FROM characters WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL FOR UPDATE',
    [charId, accountId]
  );
  if (!cur.rows[0]) throw new HttpError(404, 'Nie znaleziono postaci.');
  if (cur.rows[0].force_reload) {
    throw new HttpError(409, 'Administrator zmodyfikował Twoją postać — odśwież stronę i wczytaj ją ponownie.');
  }
  const oldLevel = cur.rows[0].level;

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
    [charId, accountId, lvl, vals.exp, vals.gold, vals.hp, maxHp, vals.mp, maxMp,
     vals.atk, vals.def, totalKills, map, px, py, JSON.stringify(data)]
  );

  if (killCodes.length) {
    await db.query(
      `INSERT INTO character_bestiary (character_id, monster_id, kills)
       SELECT $1, m.id, k.kills FROM unnest($2::text[], $3::int[]) AS k(code, kills)
         JOIN monsters m ON m.code = k.code
       ON CONFLICT (character_id, monster_id)
       DO UPDATE SET kills = GREATEST(character_bestiary.kills, EXCLUDED.kills)`,
      [charId, killCodes, killCounts]
    );
  }
  if (lvl > oldLevel) {
    await db.query(
      `INSERT INTO character_events (character_id, event_type, message) VALUES ($1,'level_up',$2)`,
      [charId, `Awans na poziom ${lvl}!`]
    );
  }
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
  const { rows } = await pool.query(
    'SELECT id, username, password_hash, role, is_banned, ban_reason, banned_until FROM accounts WHERE lower(username) = lower($1)',
    [username.slice(0, 24)]
  );
  const acc = rows[0];
  const ok = await bcrypt.compare(password.slice(0, 72), acc ? acc.password_hash : DUMMY_HASH);
  if (!acc || !ok) {
    cfg.log('warn', 'auth', `Nieudane logowanie: ${username.slice(0, 24)}`, { ip: req.ip });
    throw new HttpError(401, 'Nieprawidłowy login lub hasło.');
  }
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
      if (data) await applySave(db, id, req.user.id, data);
      return id;
    });
    res.json({ id: out, name: name.trim() });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'To imię jest już zajęte na tym serwerze.');
    if (e.code === '23514') throw new HttpError(400, 'Osiągnięto limit postaci na tym serwerze.');
    throw e;
  }
}));

app.post('/api/characters/:id/save', auth, wrap(async (req, res) => {
  const id = clampInt(req.params.id, 0, Number.MAX_SAFE_INTEGER);
  await tx((db) => applySave(db, id, req.user.id, req.body && req.body.data));
  res.json({ ok: true });
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
app.get('/api/ranking', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT place, name, class, level, monsters_killed FROM v_ranking
      WHERE realm_id = $1 AND place <= 50 ORDER BY place`, [String(req.query.realm || 'cienie')]);
  res.json({ ranking: rows });
}));

// Publiczna konfiguracja gry: ustawienia serwera, ekonomia, eventy, aktualizacje oraz
// wartości potworów i przedmiotów z bazy (nadpisują domyślne w kliencie).
app.get('/api/config', wrap(async (req, res) => {
  const s = await cfg.get();
  const [mon, items, upd] = await Promise.all([
    pool.query('SELECT code, name, level, hp, atk, exp_reward, gold_min, gold_max FROM monsters'),
    pool.query('SELECT code, name, atk, def, buy_price FROM items'),
    pool.query(`SELECT version, title, body, published_at FROM game_updates WHERE status = 'published'
                 ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 3`),
  ]);
  res.json({
    maintenance: s.server.maintenance, maintenance_msg: s.server.maintenance_msg,
    registration_open: s.server.registration_open, motd: s.server.motd, chat_enabled: s.server.chat_enabled,
    economy: s.economy, events: s.events, updates: upd.rows,
    monsters: mon.rows.map((m) => ({ code: m.code, name: m.name, lvl: m.level, hp: m.hp, atk: m.atk,
      exp: m.exp_reward, gold: Math.round((m.gold_min + m.gold_max) / 2) })),
    items: items.rows.map((i) => ({ id: i.code, name: i.name, atk: i.atk, def: i.def, price: i.buy_price })),
  });
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
