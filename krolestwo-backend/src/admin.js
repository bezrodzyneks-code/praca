'use strict';
// API panelu administratora: /api/admin/*
// Role: "admin" = pełny dostęp, "moderator" = podgląd + bany + kick.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { HttpError, CLS_TO_CODE, CODE_TO_CLS } = require('./common');
const cfg = require('./config');

// ---------- walidacja pól ----------
function clean(body, spec, partial) {
  body = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const [k, s] of Object.entries(spec)) {
    if (partial && s.createOnly) continue;
    const label = s.label || k;
    if (!(k in body)) {
      if (!partial && s.required) throw new HttpError(400, `Pole „${label}” jest wymagane.`);
      continue;
    }
    let v = body[k];
    if (v === null || v === '') {
      if (s.nullable) { out[k] = null; continue; }
      if (s.type === 'str' && !s.required) v = '';
      else throw new HttpError(400, `Pole „${label}” jest wymagane.`);
    }
    switch (s.type) {
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < s.min || n > s.max) throw new HttpError(400, `„${label}” musi być liczbą całkowitą z zakresu ${s.min}–${s.max}.`);
        out[k] = n; break;
      }
      case 'num': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < s.min || n > s.max) throw new HttpError(400, `„${label}” musi być liczbą z zakresu ${s.min}–${s.max}.`);
        out[k] = n; break;
      }
      case 'bool': out[k] = v === true || v === 'true' || v === 1; break;
      case 'str': {
        v = String(v).trim();
        if (s.required && !v) throw new HttpError(400, `Pole „${label}” jest wymagane.`);
        if (v.length > (s.max || 200)) throw new HttpError(400, `„${label}” może mieć maksymalnie ${s.max || 200} znaków.`);
        if (s.re && v && !s.re.test(v)) throw new HttpError(400, s.reMsg || `Nieprawidłowa wartość pola „${label}”.`);
        out[k] = v; break;
      }
      case 'ts': {
        const d = new Date(v);
        if (isNaN(d)) throw new HttpError(400, `„${label}” — nieprawidłowa data.`);
        out[k] = d.toISOString(); break;
      }
      case 'enum':
        if (!s.values.includes(v)) throw new HttpError(400, `„${label}” — niedozwolona wartość.`);
        out[k] = v; break;
      default: break;
    }
  }
  return out;
}

const I = (min, max, label, extra) => ({ type: 'int', min, max, label, ...extra });
const N = (min, max, label, extra) => ({ type: 'num', min, max, label, ...extra });
const S = (max, label, extra) => ({ type: 'str', max, label, ...extra });
const B = (label) => ({ type: 'bool', label });
const CODE = { re: /^[a-z0-9_]{2,32}$/, reMsg: 'Kod: 2–32 znaków (małe litery, cyfry, _).' };

const SPEC = {
  monsters: {
    code: S(24, 'Kod', { required: true, createOnly: true, ...CODE }),
    name: S(80, 'Nazwa', { required: true }), kind: S(12, 'Typ wyglądu', { required: true }),
    level: I(1, 50, 'Poziom', { required: true }), hp: I(1, 100000000, 'HP', { required: true }),
    atk: I(0, 1000000, 'Atak', { required: true }), def: I(0, 1000000, 'Obrona'),
    exp_reward: I(0, 100000000, 'EXP', { required: true }),
    gold_min: I(0, 100000000, 'Złoto min'), gold_max: I(0, 100000000, 'Złoto max'),
    is_elite: B('Elita'), is_boss: B('Boss'), night_only: B('Tylko nocą'), description: S(500, 'Opis'),
  },
  items: {
    code: S(32, 'Kod', { required: true, createOnly: true, ...CODE }),
    name: S(80, 'Nazwa', { required: true }), description: S(500, 'Opis'),
    slot: S(12, 'Slot', { required: true }), rarity_id: I(1, 5, 'Rzadkość', { required: true }),
    required_level: I(1, 50, 'Wymagany poziom'), class_id: I(1, 100, 'Klasa', { nullable: true }),
    atk: I(-100000, 1000000, 'Obrażenia'), def: I(-100000, 1000000, 'Obrona'),
    hp: I(-100000, 1000000, 'HP'), mp: I(-100000, 1000000, 'MP'),
    str: I(-1000, 10000, 'Siła'), dex: I(-1000, 10000, 'Zręczność'), int: I(-1000, 10000, 'Inteligencja'),
    crit_pct: N(0, 100, 'Krytyk %'), heal_hp: I(0, 100000, 'Leczenie HP'), heal_mp: I(0, 100000, 'Leczenie MP'),
    bag_slots: I(0, 100, 'Sloty torby'), stackable: B('Stackowalny'), max_stack: I(1, 999, 'Maks. stack'),
    tradeable: B('Wymienialny'), buy_price: I(0, 100000000, 'Cena kupna'), sell_price: I(0, 100000000, 'Cena sprzedaży'),
  },
  instances: {
    code: S(24, 'Kod', { required: true, createOnly: true, ...CODE }),
    name: S(60, 'Nazwa', { required: true }), description: S(500, 'Opis'),
    required_level: I(1, 50, 'Wymagany poziom', { required: true }),
    boss_id: I(1, 2147483647, 'Boss', { required: true }), map_code: S(24, 'Mapa'),
  },
  difficulties: {
    name: S(20, 'Nazwa', { required: true }),
    hp_mult: N(0.1, 20, 'Mnożnik HP'), atk_mult: N(0.1, 20, 'Mnożnik ataku'), def_mult: N(0.1, 20, 'Mnożnik obrony'),
    reward_mult: N(0.1, 20, 'Mnożnik nagród'), drop_mult: N(0.1, 20, 'Mnożnik dropu'),
  },
  realms: {
    name: S(60, 'Nazwa', { required: true }), description: S(300, 'Opis'),
    max_players: I(1, 100000, 'Maks. graczy'), exp_rate: N(0.1, 10, 'Mnożnik EXP'),
    drop_rate: N(0.1, 10, 'Mnożnik dropu'), death_penalty: N(0, 1, 'Kara za śmierć (0–1)'),
    is_active: B('Aktywny'),
  },
  game_events: {
    name: S(80, 'Nazwa', { required: true }), description: S(500, 'Opis'),
    starts_at: { type: 'ts', label: 'Start', required: true }, ends_at: { type: 'ts', label: 'Koniec', required: true },
    exp_mult: N(0.1, 10, 'Mnożnik EXP'), gold_mult: N(0.1, 10, 'Mnożnik złota'), drop_mult: N(0.1, 10, 'Mnożnik dropu'),
    is_active: B('Aktywny'),
  },
  game_updates: {
    version: S(20, 'Wersja', { required: true }), title: S(120, 'Tytuł', { required: true }), body: S(8000, 'Treść'),
  },
  characters: {
    level: I(1, 50, 'Poziom'), exp: I(0, 2000000000, 'EXP'), gold: I(0, 2000000000, 'Złoto'),
    hp: I(0, 1000000, 'HP'), max_hp: I(1, 1000000, 'Maks. HP'), mp: I(0, 1000000, 'MP'), max_mp: I(0, 1000000, 'Maks. MP'),
    atk: I(0, 1000000, 'Atak'), def: I(0, 1000000, 'Obrona'),
    str: I(0, 100000, 'Siła'), dex: I(0, 100000, 'Zręczność'), int: I(0, 100000, 'Inteligencja'),
    skill_points: I(0, 1000, 'Punkty umiejętności'),
  },
};

const q = (s) => String(s || '').slice(0, 60).replace(/[\\%_]/g, '\\$&');
const csvCell = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

module.exports = function createAdminRouter({ pool, auth, realtime, startedAt }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const query = (sql, params) => pool.query(sql, params).then((x) => x.rows);
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

  const pid = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 2147483647 * 1000) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
    return n;
  };
  const paging = (req, def = 25) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || def));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    return { limit, page, offset: (page - 1) * limit };
  };
  const insertRow = async (table, data) => {
    const cols = Object.keys(data);
    return one(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      cols.map((c) => data[c]));
  };
  const updateRow = async (table, id, data) => {
    const cols = Object.keys(data);
    if (!cols.length) throw new HttpError(400, 'Brak zmian do zapisania.');
    const row = await one(`UPDATE ${table} SET ${cols.map((c, i) => `"${c}"=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
      [...cols.map((c) => data[c]), id]);
    if (!row) throw new HttpError(404, 'Nie znaleziono rekordu.');
    return row;
  };
  const deleteRow = async (table, id) => {
    const res = await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    if (!res.rowCount) throw new HttpError(404, 'Nie znaleziono rekordu.');
  };

  // ---------- uprawnienia ----------
  const staff = (req, res, next) => {
    if (!['admin', 'moderator'].includes(req.user.role)) {
      cfg.log('warn', 'admin', `Odmowa dostępu do panelu: ${req.user.username}`);
      return next(new HttpError(403, 'Brak uprawnień do panelu administracyjnego.'));
    }
    next();
  };
  const adminOnly = (req, res, next) =>
    req.user.role === 'admin' ? next() : next(new HttpError(403, 'Ta akcja wymaga roli administratora.'));

  r.use(auth, staff);

  // Weryfikacja uprawnień przy logowaniu do panelu
  r.get('/me', (req, res) => res.json({ id: req.user.id, username: req.user.username, role: req.user.role }));

  // =====================================================================
  //  DASHBOARD + MONITOROWANIE
  // =====================================================================
  r.get('/dashboard', wrap(async (req, res) => {
    const [tot, reg, lvl, cls, top, audit, realms] = await Promise.all([
      one(`SELECT (SELECT count(*) FROM accounts) AS accounts,
                  (SELECT count(*) FROM accounts WHERE created_at > now() - interval '24 hours') AS accounts_24h,
                  (SELECT count(*) FROM characters WHERE deleted_at IS NULL) AS characters,
                  (SELECT count(*) FROM accounts WHERE is_banned AND (banned_until IS NULL OR banned_until > now())) AS banned,
                  (SELECT COALESCE(sum(gold),0) FROM characters WHERE deleted_at IS NULL) AS gold_total,
                  (SELECT COALESCE(sum(monsters_killed),0) FROM characters WHERE deleted_at IS NULL) AS kills_total,
                  (SELECT count(*) FROM system_logs WHERE level='error' AND created_at > now() - interval '24 hours') AS errors_24h`),
      query(`SELECT to_char(d,'YYYY-MM-DD') AS day, count(a.id) AS n
               FROM generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') d
               LEFT JOIN accounts a ON a.created_at::date = d::date GROUP BY d ORDER BY d`),
      query(`SELECT ((level - 1) / 10) * 10 + 1 AS from_lvl, count(*) AS n FROM characters WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1`),
      query(`SELECT cl.name, count(*) AS n FROM characters c JOIN classes cl ON cl.id = c.class_id
              WHERE c.deleted_at IS NULL GROUP BY cl.name ORDER BY n DESC`),
      query(`SELECT c.name, cl.name AS class, c.level, c.realm_id, c.monsters_killed
               FROM characters c JOIN classes cl ON cl.id = c.class_id WHERE c.deleted_at IS NULL
              ORDER BY c.level DESC, c.exp DESC LIMIT 10`),
      query(`SELECT admin_name, action, target_type, target_id, created_at FROM admin_audit_log ORDER BY id DESC LIMIT 8`),
      query(`SELECT id, name, max_players FROM realms WHERE is_active ORDER BY name`),
    ]);
    res.json({
      totals: { ...tot, online: realtime.countAll() },
      registrations: reg, levels: lvl, classes: cls, top,
      audit, realms: realms.map((x) => ({ ...x, online: realtime.countOnline(x.id) })),
    });
  }));

  r.get('/online', (req, res) => res.json({ players: realtime.list() }));

  r.get('/logs', wrap(async (req, res) => {
    const { limit, offset } = paging(req, 50);
    const level = ['info', 'warn', 'error'].includes(req.query.level) ? req.query.level : null;
    const source = req.query.source ? String(req.query.source).slice(0, 16) : null;
    const text = q(req.query.q);
    const where = `WHERE ($1::text IS NULL OR level = $1) AND ($2::text IS NULL OR source = $2) AND ($3 = '' OR message ILIKE '%' || $3 || '%')`;
    const [rows, cnt] = await Promise.all([
      query(`SELECT id, level, source, message, meta, created_at FROM system_logs ${where} ORDER BY id DESC LIMIT $4 OFFSET $5`,
        [level, source, text, limit, offset]),
      one(`SELECT count(*) AS n FROM system_logs ${where}`, [level, source, text]),
    ]);
    res.json({ rows, total: cnt.n });
  }));

  r.get('/audit', wrap(async (req, res) => {
    const { limit, offset } = paging(req, 50);
    const [rows, cnt] = await Promise.all([
      query(`SELECT id, admin_name, action, target_type, target_id, details, ip_address::text AS ip, created_at
               FROM admin_audit_log ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      one('SELECT count(*) AS n FROM admin_audit_log'),
    ]);
    res.json({ rows, total: cnt.n });
  }));

  // Raporty
  r.get('/reports', wrap(async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const iv = `${days} days`;
    const [sum, daily, classes, topLevel, topGold, errors] = await Promise.all([
      one(`SELECT (SELECT count(*) FROM accounts WHERE created_at > now() - $1::interval) AS new_accounts,
                  (SELECT count(*) FROM accounts WHERE last_login_at > now() - $1::interval) AS active_accounts,
                  (SELECT count(*) FROM characters WHERE created_at > now() - $1::interval AND deleted_at IS NULL) AS new_characters,
                  (SELECT count(*) FROM character_events WHERE event_type = 'level_up' AND created_at > now() - $1::interval) AS level_ups,
                  (SELECT COALESCE(round(avg(level),1),0) FROM characters WHERE deleted_at IS NULL) AS avg_level,
                  (SELECT count(*) FROM admin_audit_log WHERE created_at > now() - $1::interval) AS admin_actions,
                  (SELECT count(*) FROM system_logs WHERE level = 'error' AND created_at > now() - $1::interval) AS errors,
                  (SELECT count(*) FROM system_logs WHERE source = 'auth' AND level = 'warn' AND created_at > now() - $1::interval) AS failed_logins`, [iv]),
      query(`SELECT to_char(d,'YYYY-MM-DD') AS day,
                    (SELECT count(*) FROM accounts a WHERE a.created_at::date = d::date) AS accounts,
                    (SELECT count(*) FROM characters c WHERE c.created_at::date = d::date) AS characters,
                    (SELECT count(*) FROM system_logs s WHERE s.level='error' AND s.created_at::date = d::date) AS errors
               FROM generate_series((current_date - ($1::int - 1))::timestamp, current_date::timestamp, interval '1 day') d ORDER BY d`, [days]),
      query(`SELECT cl.name, count(*) AS n, round(avg(c.level),1) AS avg_level
               FROM characters c JOIN classes cl ON cl.id = c.class_id WHERE c.deleted_at IS NULL GROUP BY cl.name ORDER BY n DESC`),
      query(`SELECT c.name, cl.name AS class, c.level, c.monsters_killed FROM characters c JOIN classes cl ON cl.id = c.class_id
              WHERE c.deleted_at IS NULL ORDER BY c.level DESC, c.exp DESC LIMIT 10`),
      query(`SELECT c.name, cl.name AS class, c.level, c.gold FROM characters c JOIN classes cl ON cl.id = c.class_id
              WHERE c.deleted_at IS NULL ORDER BY c.gold DESC LIMIT 10`),
      query(`SELECT message, count(*) AS n, max(created_at) AS last_at FROM system_logs
              WHERE level = 'error' AND created_at > now() - $1::interval GROUP BY message ORDER BY n DESC LIMIT 8`, [iv]),
    ]);
    res.json({ days, summary: sum, daily, classes, topLevel, topGold, errors });
  }));

  r.get('/reports/csv', wrap(async (req, res) => {
    const type = req.query.type === 'accounts' ? 'accounts' : 'characters';
    const rows = type === 'accounts'
      ? await query(`SELECT a.username, a.email, a.role, a.created_at, a.last_login_at,
                            (SELECT count(*) FROM characters c WHERE c.account_id = a.id AND c.deleted_at IS NULL) AS characters,
                            (a.is_banned AND (a.banned_until IS NULL OR a.banned_until > now())) AS banned
                       FROM accounts a ORDER BY a.id`)
      : await query(`SELECT c.name, a.username AS account, c.realm_id AS realm, cl.name AS class, c.level, c.exp, c.gold,
                            c.monsters_killed, c.deaths, c.created_at, c.last_saved_at
                       FROM characters c JOIN accounts a ON a.id = c.account_id JOIN classes cl ON cl.id = c.class_id
                      WHERE c.deleted_at IS NULL ORDER BY c.level DESC, c.exp DESC`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const csv = '\uFEFF' + [cols.join(','), ...rows.map((x) => cols.map((c) => csvCell(x[c])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="raport-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    cfg.audit(req, 'report.export', 'report', type);
    res.send(csv);
  }));

  // =====================================================================
  //  UŻYTKOWNICY
  // =====================================================================
  const getUser = async (id) => {
    const u = await one('SELECT id, username, role, is_banned FROM accounts WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Nie znaleziono użytkownika.');
    return u;
  };
  // moderator nie może ruszać administratorów ani innych moderatorów
  const canTouch = (req, target) => {
    if (target.id === req.user.id) throw new HttpError(400, 'Nie możesz wykonać tej akcji na własnym koncie.');
    if (req.user.role !== 'admin' && target.role !== 'player') throw new HttpError(403, 'Moderator może zarządzać tylko kontami graczy.');
  };
  const revokeSessions = (id) => pool.query('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [id]);

  r.get('/users', wrap(async (req, res) => {
    const { limit, offset } = paging(req);
    const text = q(req.query.q);
    const filter = req.query.filter === 'banned' ? 'AND a.is_banned AND (a.banned_until IS NULL OR a.banned_until > now())'
      : ['admin', 'moderator', 'player'].includes(req.query.filter) ? `AND a.role = '${req.query.filter}'` : '';
    const where = `WHERE ($1 = '' OR a.username ILIKE '%' || $1 || '%' OR a.email ILIKE '%' || $1 || '%' OR a.display_name ILIKE '%' || $1 || '%') ${filter}`;
    const [rows, cnt] = await Promise.all([
      query(`SELECT a.id, a.username, a.email, a.display_name, a.bio, a.role, a.max_characters, a.is_banned, a.ban_reason,
                    a.banned_until, a.created_at, a.last_login_at,
                    (SELECT count(*) FROM characters c WHERE c.account_id = a.id AND c.deleted_at IS NULL) AS characters,
                    (a.is_banned AND (a.banned_until IS NULL OR a.banned_until > now())) AS banned_now
               FROM accounts a ${where} ORDER BY a.id DESC LIMIT $2 OFFSET $3`, [text, limit, offset]),
      one(`SELECT count(*) AS n FROM accounts a ${where}`, [text]),
    ]);
    const online = realtime.onlineAccounts();
    res.json({ rows: rows.map((u) => ({ ...u, online: online.has(u.id) })), total: cnt.n });
  }));

  r.post('/users', adminOnly, wrap(async (req, res) => {
    const { username, password, email, role } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{3,24}$/.test(username)) throw new HttpError(400, 'Login: 3–24 znaków (litery, cyfry, _ oraz -).');
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) throw new HttpError(400, 'Hasło musi mieć od 6 do 72 znaków.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Nieprawidłowy adres e-mail.');
    const rl = ['player', 'moderator', 'admin'].includes(role) ? role : 'player';
    let row;
    try {
      row = await one(`INSERT INTO accounts (username, email, password_hash, display_name, role) VALUES ($1,$2,$3,$1,$4) RETURNING id, username, role`,
        [username, email || null, await bcrypt.hash(password, 12), rl]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Login lub e-mail jest już zajęty.');
      throw e;
    }
    cfg.audit(req, 'user.create', 'user', row.id, { username, role: rl });
    res.json(row);
  }));

  r.patch('/users/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    const b = req.body || {};
    const data = {};
    if ('email' in b) {
      if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) throw new HttpError(400, 'Nieprawidłowy adres e-mail.');
      data.email = b.email ? String(b.email).slice(0, 255) : null;
    }
    if ('display_name' in b) data.display_name = String(b.display_name || '').slice(0, 40) || null;
    if ('bio' in b) data.bio = String(b.bio || '').slice(0, 500) || null;
    if ('max_characters' in b) Object.assign(data, clean({ max_characters: b.max_characters }, { max_characters: I(1, 20, 'Limit postaci') }, true));
    if ('role' in b) {
      if (!['player', 'moderator', 'admin'].includes(b.role)) throw new HttpError(400, 'Nieznana rola.');
      if (id === req.user.id && b.role !== target.role) throw new HttpError(400, 'Nie możesz zmienić własnej roli.');
      data.role = b.role;
    }
    try { await updateRow('accounts', id, data); }
    catch (e) { if (e.code === '23505') throw new HttpError(409, 'E-mail jest już zajęty.'); throw e; }
    cfg.audit(req, 'user.update', 'user', id, data);
    res.json({ ok: true });
  }));

  r.delete('/users/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    canTouch(req, target);
    realtime.kickAccount(id, 'Twoje konto zostało usunięte.');
    await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
    cfg.audit(req, 'user.delete', 'user', id, { username: target.username });
    res.json({ ok: true });
  }));

  r.post('/users/:id/reset-password', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    let pass = req.body && req.body.password;
    if (pass !== undefined && pass !== '') {
      if (typeof pass !== 'string' || pass.length < 6 || pass.length > 72) throw new HttpError(400, 'Hasło musi mieć od 6 do 72 znaków.');
    } else {
      pass = crypto.randomBytes(9).toString('base64url');
    }
    await pool.query('UPDATE accounts SET password_hash = $2 WHERE id = $1', [id, await bcrypt.hash(pass, 12)]);
    await revokeSessions(id);
    realtime.kickAccount(id, 'Hasło zostało zresetowane przez administratora.');
    cfg.audit(req, 'user.reset_password', 'user', id, { username: target.username });
    res.json({ password: pass });
  }));

  r.post('/users/:id/ban', staff, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    canTouch(req, target);
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 300);
    const hours = Number(req.body && req.body.hours) || 0;
    if (hours < 0 || hours > 24 * 365 * 10) throw new HttpError(400, 'Nieprawidłowy czas bana.');
    await pool.query(
      `UPDATE accounts SET is_banned = TRUE, ban_reason = $2, banned_at = now(),
              banned_until = CASE WHEN $3::numeric > 0 THEN now() + ($3::numeric * interval '1 hour') END WHERE id = $1`,
      [id, reason || null, hours]);
    await revokeSessions(id);
    realtime.kickAccount(id, 'Konto zablokowane' + (reason ? ': ' + reason : '.'));
    cfg.audit(req, 'user.ban', 'user', id, { username: target.username, reason, hours: hours || 'permanent' });
    res.json({ ok: true });
  }));

  r.post('/users/:id/unban', staff, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    canTouch(req, target);
    await pool.query('UPDATE accounts SET is_banned = FALSE, ban_reason = NULL, banned_until = NULL, banned_at = NULL WHERE id = $1', [id]);
    cfg.audit(req, 'user.unban', 'user', id, { username: target.username });
    res.json({ ok: true });
  }));

  r.post('/users/:id/kick', staff, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const target = await getUser(id);
    canTouch(req, target);
    await revokeSessions(id);
    realtime.kickAccount(id, 'Zostałeś wyrzucony z gry przez administratora.');
    cfg.audit(req, 'user.kick', 'user', id, { username: target.username });
    res.json({ ok: true });
  }));

  r.get('/bans', wrap(async (req, res) => {
    res.json({ rows: await query(
      `SELECT id, username, ban_reason, banned_at, banned_until FROM accounts
        WHERE is_banned AND (banned_until IS NULL OR banned_until > now()) ORDER BY banned_at DESC NULLS LAST`) });
  }));

  // =====================================================================
  //  POSTACIE
  // =====================================================================
  r.get('/characters', wrap(async (req, res) => {
    const { limit, offset } = paging(req);
    const text = q(req.query.q);
    const realm = req.query.realm ? String(req.query.realm).slice(0, 20) : null;
    const cls = CLS_TO_CODE[req.query.class] || (['warrior', 'archer', 'mage'].includes(req.query.class) ? req.query.class : null);
    const where = `WHERE c.deleted_at IS NULL AND ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR a.username ILIKE '%' || $1 || '%')
                     AND ($2::text IS NULL OR c.realm_id = $2) AND ($3::text IS NULL OR cl.code = $3)`;
    const [rows, cnt] = await Promise.all([
      query(`SELECT c.id, c.name, c.realm_id, cl.code AS class_code, cl.name AS class, c.level, c.exp, c.gold, c.hp, c.max_hp,
                    c.monsters_killed, c.last_saved_at, a.id AS account_id, a.username
               FROM characters c JOIN accounts a ON a.id = c.account_id JOIN classes cl ON cl.id = c.class_id
               ${where} ORDER BY c.level DESC, c.exp DESC, c.id LIMIT $4 OFFSET $5`, [text, realm, cls, limit, offset]),
      one(`SELECT count(*) AS n FROM characters c JOIN accounts a ON a.id = c.account_id JOIN classes cl ON cl.id = c.class_id ${where}`, [text, realm, cls]),
    ]);
    res.json({ rows: rows.map((c) => ({ ...c, online: realtime.isCharOnline(c.id) })), total: cnt.n });
  }));

  r.get('/characters/:id', wrap(async (req, res) => {
    const id = pid(req.params.id);
    const c = await one(
      `SELECT c.id, c.name, c.realm_id, c.level, c.exp, c.gold, c.hp, c.max_hp, c.mp, c.max_mp, c.atk, c.def, c.str, c.dex, c.int,
              c.skill_points, c.current_map, c.monsters_killed, c.deaths, c.created_at, c.last_saved_at,
              cl.code AS class_code, cl.name AS class, a.id AS account_id, a.username
         FROM characters c JOIN classes cl ON cl.id = c.class_id JOIN accounts a ON a.id = c.account_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
    if (!c) throw new HttpError(404, 'Nie znaleziono postaci.');
    const [inventory, events] = await Promise.all([
      query('SELECT name, rarity, slot, quantity, equipped_slot, affixes FROM v_inventory WHERE character_id = $1 ORDER BY equipped_slot NULLS LAST, bag_index', [id]),
      query('SELECT event_type, message, created_at FROM character_events WHERE character_id = $1 ORDER BY id DESC LIMIT 15', [id]),
    ]);
    res.json({ ...c, online: realtime.isCharOnline(id), inventory, events });
  }));

  r.patch('/characters/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const b = req.body || {};
    const cur = await one('SELECT * FROM characters WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!cur) throw new HttpError(404, 'Nie znaleziono postaci.');
    const data = clean(b, SPEC.characters, true);
    if (b.class) {
      const code = CLS_TO_CODE[b.class] || b.class;
      const cl = await one('SELECT id, code FROM classes WHERE code = $1', [code]);
      if (!cl) throw new HttpError(400, 'Nieznana klasa.');
      data.class_id = cl.id;
      data._cls = CODE_TO_CLS[cl.code];
    }
    const merged = { ...cur, ...data };
    if (merged.hp > merged.max_hp) throw new HttpError(400, 'HP nie może przekraczać maks. HP.');
    if (merged.mp > merged.max_mp) throw new HttpError(400, 'MP nie może przekraczać maks. MP.');

    // te same zmiany trafiają do zapisu gry (save_data.hero), inaczej gracz zobaczyłby stare wartości
    const heroMap = { level: 'lvl', exp: 'exp', gold: 'gold', hp: 'hp', max_hp: 'maxHp', mp: 'mp', max_mp: 'maxMp', atk: 'atk', def: 'def' };
    const heroPatch = {};
    for (const [col, key] of Object.entries(heroMap)) if (col in data) heroPatch[key] = data[col];
    if (data._cls) heroPatch.cls = data._cls;
    delete data._cls;
    if (!Object.keys(data).length) throw new HttpError(400, 'Brak zmian do zapisania.');

    const cols = Object.keys(data);
    const sets = cols.map((c, i) => `"${c}"=$${i + 1}`);
    const params = cols.map((c) => data[c]);
    params.push(JSON.stringify(heroPatch));
    sets.push(`force_reload = TRUE`,
      `save_data = CASE WHEN save_data IS NULL THEN NULL
                        ELSE jsonb_set(save_data, '{hero}', COALESCE(save_data->'hero', '{}'::jsonb) || $${params.length}::jsonb) END`);
    params.push(id);
    await pool.query(`UPDATE characters SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    realtime.kickChar(id, 'Administrator zmodyfikował Twoją postać. Zaloguj się ponownie.');
    cfg.audit(req, 'character.update', 'character', id, { name: cur.name, changes: data, class: b.class });
    res.json({ ok: true });
  }));

  r.delete('/characters/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const c = await one('UPDATE characters SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING name', [id]);
    if (!c) throw new HttpError(404, 'Nie znaleziono postaci.');
    realtime.kickChar(id, 'Twoja postać została usunięta przez administratora.');
    cfg.audit(req, 'character.delete', 'character', id, { name: c.name });
    res.json({ ok: true });
  }));

  // =====================================================================
  //  SŁOWNIKI (do list wyboru w panelu)
  // =====================================================================
  r.get('/meta', wrap(async (req, res) => {
    const [rarities, slots, classes, difficulties, realms, effects, monsters, items, quests] = await Promise.all([
      query('SELECT id, code, name, emoji, color_hex FROM rarities ORDER BY id'),
      query('SELECT code, name FROM item_slots ORDER BY name'),
      query('SELECT id, code, name FROM classes ORDER BY id'),
      query('SELECT id, code, name FROM difficulties ORDER BY id'),
      query('SELECT id, name FROM realms ORDER BY name'),
      query('SELECT code, name FROM effect_types ORDER BY name'),
      query('SELECT id, name, level, is_boss FROM monsters ORDER BY level, name'),
      query('SELECT id, name, required_level FROM items ORDER BY name'),
      Promise.resolve([]),
    ]);
    res.json({ rarities, slots, classes, difficulties, realms, effects, monsters, items, quests });
  }));

  // =====================================================================
  //  POTWORY
  // =====================================================================
  r.get('/monsters', wrap(async (req, res) => {
    const text = q(req.query.q);
    res.json({ rows: await query(
      `SELECT m.*, (SELECT count(*) FROM monster_drops d WHERE d.monster_id = m.id) AS drops
         FROM monsters m WHERE $1 = '' OR m.name ILIKE '%' || $1 || '%' OR m.code ILIKE '%' || $1 || '%'
        ORDER BY m.level, m.name LIMIT 300`, [text]) });
  }));
  r.post('/monsters', adminOnly, wrap(async (req, res) => {
    const d = clean(req.body, SPEC.monsters, false);
    if (d.gold_min === undefined) d.gold_min = 0;
    if (d.gold_max === undefined) d.gold_max = d.gold_min;
    const row = await insertRow('monsters', d);
    cfg.audit(req, 'monster.create', 'monster', row.id, { code: row.code });
    res.json(row);
  }));
  r.patch('/monsters/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const row = await updateRow('monsters', id, clean(req.body, SPEC.monsters, true));
    cfg.audit(req, 'monster.update', 'monster', id, req.body);
    res.json(row);
  }));
  r.delete('/monsters/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    await deleteRow('monsters', id);
    cfg.audit(req, 'monster.delete', 'monster', id);
    res.json({ ok: true });
  }));
  r.get('/monsters/:id/drops', wrap(async (req, res) => {
    res.json({ rows: await query(
      `SELECT d.item_id, i.name, i.rarity_id, d.drop_chance, d.min_qty, d.max_qty
         FROM monster_drops d JOIN items i ON i.id = d.item_id WHERE d.monster_id = $1 ORDER BY d.drop_chance DESC`, [pid(req.params.id)]) });
  }));
  r.put('/monsters/:id/drops', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const list = Array.isArray(req.body && req.body.drops) ? req.body.drops.slice(0, 200) : null;
    if (!list) throw new HttpError(400, 'Brak listy dropu.');
    const rows = list.map((x) => clean(x, {
      item_id: I(1, 2147483647, 'Przedmiot', { required: true }),
      drop_chance: N(0.00001, 1, 'Szansa dropu', { required: true }),
      min_qty: I(1, 999, 'Min. ilość'), max_qty: I(1, 999, 'Maks. ilość'),
    }, false));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM monster_drops WHERE monster_id = $1', [id]);
      for (const d of rows) {
        const mn = d.min_qty || 1;
        await client.query('INSERT INTO monster_drops (monster_id, item_id, drop_chance, min_qty, max_qty) VALUES ($1,$2,$3,$4,$5)',
          [id, d.item_id, d.drop_chance, mn, Math.max(mn, d.max_qty || mn)]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    cfg.audit(req, 'monster.drops', 'monster', id, { count: rows.length });
    res.json({ ok: true });
  }));

  // =====================================================================
  //  PRZEDMIOTY
  // =====================================================================
  r.get('/items', wrap(async (req, res) => {
    const text = q(req.query.q);
    const rar = parseInt(req.query.rarity, 10) || null;
    const slot = req.query.slot ? String(req.query.slot).slice(0, 12) : null;
    res.json({ rows: await query(
      `SELECT i.*, r.name AS rarity, r.color_hex,
              COALESCE((SELECT json_agg(json_build_object('effect_code', e.effect_code, 'chance_pct', e.chance_pct,
                                                          'magnitude', e.magnitude, 'duration_sec', e.duration_sec))
                          FROM item_effects e WHERE e.item_id = i.id), '[]'::json) AS effects
         FROM items i JOIN rarities r ON r.id = i.rarity_id
        WHERE ($1 = '' OR i.name ILIKE '%' || $1 || '%' OR i.code ILIKE '%' || $1 || '%')
          AND ($2::int IS NULL OR i.rarity_id = $2) AND ($3::text IS NULL OR i.slot = $3)
        ORDER BY i.required_level, i.name LIMIT 500`, [text, rar, slot]) });
  }));
  r.post('/items', adminOnly, wrap(async (req, res) => {
    const d = clean(req.body, SPEC.items, false);
    if (d.slot && !(await one('SELECT 1 FROM item_slots WHERE code = $1', [d.slot]))) throw new HttpError(400, 'Nieznany slot przedmiotu.');
    const row = await insertRow('items', d);
    cfg.audit(req, 'item.create', 'item', row.id, { code: row.code });
    res.json(row);
  }));
  r.patch('/items/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const d = clean(req.body, SPEC.items, true);
    if (d.slot && !(await one('SELECT 1 FROM item_slots WHERE code = $1', [d.slot]))) throw new HttpError(400, 'Nieznany slot przedmiotu.');
    const row = await updateRow('items', id, d);
    cfg.audit(req, 'item.update', 'item', id, d);
    res.json(row);
  }));
  r.delete('/items/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const used = await one('SELECT count(*) AS n FROM character_items WHERE item_id = $1', [id]);
    if (used.n > 0) throw new HttpError(409, `Przedmiot posiada ${used.n} egzemplarzy u graczy — nie można go usunąć.`);
    await deleteRow('items', id);
    cfg.audit(req, 'item.delete', 'item', id);
    res.json({ ok: true });
  }));
  r.put('/items/:id/effects', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const list = Array.isArray(req.body && req.body.effects) ? req.body.effects.slice(0, 10) : null;
    if (!list) throw new HttpError(400, 'Brak listy efektów.');
    const rows = list.map((x) => clean(x, {
      effect_code: S(16, 'Efekt', { required: true }), chance_pct: N(0, 100, 'Szansa %', { required: true }),
      magnitude: N(0, 100000, 'Siła'), duration_sec: N(0, 600, 'Czas (s)'),
    }, false));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM item_effects WHERE item_id = $1', [id]);
      for (const d of rows) {
        await client.query('INSERT INTO item_effects (item_id, effect_code, chance_pct, magnitude, duration_sec) VALUES ($1,$2,$3,$4,$5)',
          [id, d.effect_code, d.chance_pct, d.magnitude || 0, d.duration_sec || 0]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    cfg.audit(req, 'item.effects', 'item', id, { count: rows.length });
    res.json({ ok: true });
  }));

  // =====================================================================
  //  INSTANCJE + POZIOMY TRUDNOŚCI
  // =====================================================================
  r.get('/instances', wrap(async (req, res) => {
    res.json({ rows: await query(
      `SELECT i.*, b.name AS boss_name,
              COALESCE((SELECT json_agg(json_build_object('monster_id', im.monster_id, 'name', m.name, 'wave', im.wave,
                                                          'count_min', im.count_min, 'count_max', im.count_max) ORDER BY im.wave, m.name)
                          FROM instance_monsters im JOIN monsters m ON m.id = im.monster_id WHERE im.instance_id = i.id), '[]'::json) AS monsters,
              (SELECT count(*) FROM instance_runs x WHERE x.instance_id = i.id) AS runs,
              (SELECT count(*) FROM instance_runs x WHERE x.instance_id = i.id AND x.status = 'completed') AS completed
         FROM instances i JOIN monsters b ON b.id = i.boss_id ORDER BY i.required_level`) });
  }));
  r.post('/instances', adminOnly, wrap(async (req, res) => {
    const row = await insertRow('instances', clean(req.body, SPEC.instances, false));
    cfg.audit(req, 'instance.create', 'instance', row.id, { code: row.code });
    res.json(row);
  }));
  r.patch('/instances/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const row = await updateRow('instances', id, clean(req.body, SPEC.instances, true));
    cfg.audit(req, 'instance.update', 'instance', id, req.body);
    res.json(row);
  }));
  r.delete('/instances/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    await deleteRow('instances', id);
    cfg.audit(req, 'instance.delete', 'instance', id);
    res.json({ ok: true });
  }));
  r.put('/instances/:id/monsters', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const list = Array.isArray(req.body && req.body.monsters) ? req.body.monsters.slice(0, 50) : null;
    if (!list) throw new HttpError(400, 'Brak listy potworów.');
    const rows = list.map((x) => clean(x, {
      monster_id: I(1, 2147483647, 'Potwór', { required: true }), wave: I(1, 20, 'Fala'),
      count_min: I(1, 50, 'Min.'), count_max: I(1, 50, 'Maks.'),
    }, false));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM instance_monsters WHERE instance_id = $1', [id]);
      for (const d of rows) {
        const mn = d.count_min || 1;
        await client.query('INSERT INTO instance_monsters (instance_id, monster_id, wave, count_min, count_max) VALUES ($1,$2,$3,$4,$5)',
          [id, d.monster_id, d.wave || 1, mn, Math.max(mn, d.count_max || mn)]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    cfg.audit(req, 'instance.monsters', 'instance', id, { count: rows.length });
    res.json({ ok: true });
  }));
  r.get('/difficulties', wrap(async (req, res) => res.json({ rows: await query('SELECT * FROM difficulties ORDER BY id') })));
  r.patch('/difficulties/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const row = await updateRow('difficulties', id, clean(req.body, SPEC.difficulties, true));
    cfg.audit(req, 'difficulty.update', 'difficulty', id, req.body);
    res.json(row);
  }));

  // =====================================================================
  //  EKONOMIA
  // =====================================================================
  r.get('/economy', wrap(async (req, res) => {
    const s = await cfg.get();
    const [realms, difficulties] = await Promise.all([
      query('SELECT id, name, description, max_players, exp_rate, drop_rate, death_penalty, is_active FROM realms ORDER BY name'),
      query('SELECT id, name, reward_mult, drop_mult FROM difficulties ORDER BY id'),
    ]);
    const withEffective = await Promise.all(realms.map(async (x) => ({ ...x, effective: await cfg.effectiveRules(x) })));
    res.json({ economy: s.economy, events: s.events, realms: withEffective, difficulties });
  }));
  r.put('/economy', adminOnly, wrap(async (req, res) => {
    const d = clean(req.body, { exp: N(0.1, 10, 'Mnożnik EXP', { required: true }), gold: N(0.1, 10, 'Mnożnik złota', { required: true }),
      drop: N(0.1, 10, 'Mnożnik dropu', { required: true }) }, false);
    await pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ('economy', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(d), req.user.id]);
    cfg.invalidate();
    realtime.broadcast(`⚖️ Zmieniono ekonomię gry: EXP ×${d.exp}, złoto ×${d.gold}, drop ×${d.drop} (obowiązuje po ponownym wejściu na serwer).`);
    cfg.audit(req, 'economy.update', 'settings', 'economy', d);
    res.json({ ok: true, economy: d });
  }));
  r.patch('/realms/:id', adminOnly, wrap(async (req, res) => {
    const id = String(req.params.id).slice(0, 20);
    const row = await updateRow('realms', id, clean(req.body, SPEC.realms, true));
    cfg.audit(req, 'realm.update', 'realm', id, req.body);
    res.json(row);
  }));

  // =====================================================================
  //  EVENTY I AKTUALIZACJE
  // =====================================================================
  r.get('/events', wrap(async (req, res) => res.json({ rows: await query(
    `SELECT e.*, (e.is_active AND now() BETWEEN e.starts_at AND e.ends_at) AS running FROM game_events e ORDER BY e.starts_at DESC LIMIT 200`) })));
  r.post('/events', adminOnly, wrap(async (req, res) => {
    const d = clean(req.body, SPEC.game_events, false);
    if (new Date(d.ends_at) <= new Date(d.starts_at)) throw new HttpError(400, 'Koniec eventu musi być po jego starcie.');
    const row = await insertRow('game_events', { ...d, created_by: req.user.id });
    cfg.invalidate();
    cfg.audit(req, 'event.create', 'event', row.id, { name: row.name });
    res.json(row);
  }));
  r.patch('/events/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const row = await updateRow('game_events', id, clean(req.body, SPEC.game_events, true));
    cfg.invalidate();
    cfg.audit(req, 'event.update', 'event', id, req.body);
    res.json(row);
  }));
  r.delete('/events/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    await deleteRow('game_events', id);
    cfg.invalidate();
    cfg.audit(req, 'event.delete', 'event', id);
    res.json({ ok: true });
  }));

  r.get('/updates', wrap(async (req, res) => res.json({ rows: await query('SELECT * FROM game_updates ORDER BY id DESC LIMIT 100') })));
  r.post('/updates', adminOnly, wrap(async (req, res) => {
    const row = await insertRow('game_updates', { ...clean(req.body, SPEC.game_updates, false), created_by: req.user.id });
    cfg.audit(req, 'update.create', 'update', row.id, { version: row.version });
    res.json(row);
  }));
  r.patch('/updates/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const row = await updateRow('game_updates', id, clean(req.body, SPEC.game_updates, true));
    cfg.audit(req, 'update.update', 'update', id, { version: row.version });
    res.json(row);
  }));
  r.delete('/updates/:id', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    await deleteRow('game_updates', id);
    cfg.audit(req, 'update.delete', 'update', id);
    res.json({ ok: true });
  }));
  // Publikacja: sprawdza spójność, ustawia status i (opcjonalnie) ogłasza graczom online
  r.post('/updates/:id/publish', adminOnly, wrap(async (req, res) => {
    const id = pid(req.params.id);
    const u = await one('SELECT * FROM game_updates WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'Nie znaleziono aktualizacji.');
    if (!u.body.trim()) throw new HttpError(400, 'Aktualizacja nie ma treści — uzupełnij opis zmian przed publikacją.');
    await pool.query(`UPDATE game_updates SET status = 'published', published_at = now() WHERE id = $1`, [id]);
    if (!req.body || req.body.broadcast !== false) realtime.broadcast(`📜 Nowa aktualizacja ${u.version}: ${u.title}`);
    cfg.audit(req, 'update.publish', 'update', id, { version: u.version });
    res.json({ ok: true });
  }));

  // =====================================================================
  //  USTAWIENIA SERWERA
  // =====================================================================
  r.get('/settings', wrap(async (req, res) => { const s = await cfg.get(); res.json({ server: s.server, economy: s.economy }); }));
  r.put('/settings', adminOnly, wrap(async (req, res) => {
    const d = clean(req.body && req.body.server, {
      maintenance: B('Tryb konserwacji'), maintenance_msg: S(300, 'Komunikat konserwacji'),
      registration_open: B('Rejestracja otwarta'), motd: S(300, 'Wiadomość dnia'), chat_enabled: B('Czat włączony'),
    }, true);
    const prev = (await cfg.get()).server;
    const next = { ...prev, ...d };
    await pool.query(
      `INSERT INTO settings (key, value, updated_by) VALUES ('server', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(next), req.user.id]);
    cfg.invalidate();
    if (next.maintenance && !prev.maintenance) {
      realtime.kickAll(next.maintenance_msg, true);
      cfg.log('warn', 'server', 'Włączono tryb konserwacji', { by: req.user.username });
    }
    cfg.audit(req, 'settings.update', 'settings', 'server', d);
    res.json({ ok: true, server: next });
  }));
  r.post('/server/reload', adminOnly, wrap(async (req, res) => {
    cfg.invalidate();
    const s = await cfg.get();
    cfg.audit(req, 'server.reload', 'server', null);
    res.json({ ok: true, maintenance: s.server.maintenance, events: s.events.length });
  }));
  r.get('/server/status', wrap(async (req, res) => {
    const db = await one(`SELECT pg_database_size(current_database()) AS size, (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections`);
    const s = await cfg.get();
    const mem = process.memoryUsage();
    res.json({
      uptime_sec: Math.round(process.uptime()), started_at: startedAt, node: process.version,
      memory_mb: Math.round(mem.rss / 1048576), db_size_mb: Math.round(db.size / 1048576 * 10) / 10,
      db_connections: db.connections, online: realtime.countAll(), maintenance: s.server.maintenance,
      active_events: s.events.length,
    });
  }));
  r.post('/broadcast', adminOnly, wrap(async (req, res) => {
    const msg = String((req.body && req.body.message) || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    if (!msg) throw new HttpError(400, 'Wpisz treść ogłoszenia.');
    const n = realtime.broadcast('📢 ' + msg);
    cfg.audit(req, 'server.broadcast', 'server', null, { message: msg, recipients: n });
    res.json({ ok: true, recipients: n });
  }));

  // ---------- błędy bazy -> czytelne komunikaty ----------
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    const map = {
      '23505': [409, 'Taka wartość już istnieje (np. kod lub nazwa).'],
      '23503': [409, 'Rekord jest powiązany z innymi danymi (np. używany jako boss lub w dropie) — najpierw usuń powiązania.'],
      '23514': [400, 'Wartość narusza ograniczenia danych (np. złoto max < min albo koniec eventu przed startem).'],
      '22P02': [400, 'Nieprawidłowy format danych.'],
    };
    if (err && map[err.code]) return res.status(map[err.code][0]).json({ error: map[err.code][1] });
    next(err);
  });

  return r;
};
