'use strict';
// Ustawienia gry zapisane w bazie (settings, game_events) + logi systemowe.
// Wartości są cache'owane przez 15 s; zmiana z panelu admina czyści cache od razu.

const DEFAULTS = {
  economy: { exp: 1, gold: 1, drop: 1 },
  server: {
    maintenance: false,
    maintenance_msg: 'Trwają prace techniczne. Zapraszamy za chwilę.',
    registration_open: true,
    motd: '',
    chat_enabled: true,
  },
};

let pool = null;
let cache = null;
let cacheAt = 0;
const TTL = 15_000;

function init(p) { pool = p; }
function invalidate() { cache = null; cacheAt = 0; }

async function load() {
  const s = {};
  const { rows } = await pool.query('SELECT key, value FROM settings');
  for (const k of Object.keys(DEFAULTS)) s[k] = { ...DEFAULTS[k] };
  for (const r of rows) s[r.key] = { ...(DEFAULTS[r.key] || {}), ...r.value };
  const ev = await pool.query(
    `SELECT id, name, description, starts_at, ends_at, exp_mult, gold_mult, drop_mult
       FROM game_events WHERE is_active AND now() BETWEEN starts_at AND ends_at ORDER BY ends_at`);
  s.events = ev.rows.map((e) => ({
    ...e, exp_mult: Number(e.exp_mult), gold_mult: Number(e.gold_mult), drop_mult: Number(e.drop_mult),
  }));
  return s;
}

async function get() {
  if (!cache || Date.now() - cacheAt > TTL) {
    try { cache = await load(); cacheAt = Date.now(); }
    catch (e) {
      if (!cache) { // tabele jeszcze nie istnieją (brak 04_admin.sql) — działaj na domyślnych
        cache = { ...structuredClone(DEFAULTS), events: [] };
        cacheAt = Date.now() - TTL + 5000;
      }
    }
  }
  return cache;
}

// Synchroniczny podgląd ostatnio pobranych ustawień (bez zapytania do bazy)
function peek() { return cache || { ...structuredClone(DEFAULTS), events: [] }; }

// Mnożniki widoczne dla gracza: reguły świata × ustawienia globalne × aktywne eventy
async function effectiveRules(realm) {
  const s = await get();
  const evMul = (k) => s.events.reduce((m, e) => m * e[k], 1);
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    xp:   r2(Number(realm.exp_rate  ?? 1) * s.economy.exp  * evMul('exp_mult')),
    drop: r2(Number(realm.drop_rate ?? 1) * s.economy.drop * evMul('drop_mult')),
    gold: r2(s.economy.gold * evMul('gold_mult')),
    death: Number(realm.death_penalty ?? 0.1),
  };
}

// Log systemowy (nie blokuje i nigdy nie rzuca wyjątku)
function log(level, source, message, meta) {
  if (!pool) return;
  pool.query('INSERT INTO system_logs (level, source, message, meta) VALUES ($1,$2,$3,$4)',
    [level, source, String(message).slice(0, 500), meta ? JSON.stringify(meta) : null]).catch(() => {});
}

// Wpis do dziennika działań administratora
function audit(req, action, targetType, targetId, details) {
  if (!pool || !req.user) return;
  pool.query(
    `INSERT INTO admin_audit_log (admin_id, admin_name, action, target_type, target_id, details, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user.id, req.user.username, action, targetType || null,
     targetId == null ? null : String(targetId), details ? JSON.stringify(details) : null, req.ip || null]
  ).catch(() => {});
  log('info', 'admin', `${req.user.username}: ${action}${targetId != null ? ' #' + targetId : ''}`);
}

module.exports = { init, get, peek, invalidate, effectiveRules, log, audit, DEFAULTS };
