'use strict';
// Nadaje rolę administratora (lub moderatora) istniejącemu kontem albo tworzy nowe konto.
//   npm run make-admin -- NAZWA              -> awansuje istniejące konto
//   npm run make-admin -- NAZWA HASŁO        -> tworzy konto (jeśli nie istnieje) i nadaje rolę admina
//   npm run make-admin -- NAZWA "" moderator -> nadaje rolę moderatora
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  const [, , username, password, roleArg] = process.argv;
  const role = roleArg === 'moderator' ? 'moderator' : roleArg === 'player' ? 'player' : 'admin';
  if (!username) {
    console.error('Użycie: npm run make-admin -- NAZWA [HASŁO] [admin|moderator|player]');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://kc:kc_password@localhost:5432/krolestwo',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const found = await pool.query('SELECT id FROM kc.accounts WHERE lower(username) = lower($1)', [username]);
    if (found.rows[0]) {
      await pool.query('UPDATE kc.accounts SET role = $2 WHERE id = $1', [found.rows[0].id, role]);
      console.log(`✔ Konto „${username}” ma teraz rolę: ${role}.`);
    } else {
      if (!password || password.length < 6) {
        console.error('Konto nie istnieje. Podaj hasło (min. 6 znaków), aby je utworzyć:\n  npm run make-admin -- ' + username + ' TwojeHaslo');
        process.exit(1);
      }
      if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) { console.error('Login: 3–24 znaków (litery, cyfry, _ oraz -).'); process.exit(1); }
      await pool.query(
        'INSERT INTO kc.accounts (username, password_hash, display_name, role) VALUES ($1,$2,$1,$3)',
        [username, await bcrypt.hash(password, 12), role]);
      console.log(`✔ Utworzono konto „${username}” z rolą: ${role}.`);
    }
    console.log('Panel administratora: http://localhost:' + (process.env.PORT || 8080) + '/admin/');
  } catch (e) {
    console.error('Błąd:', e.message.includes('role') ? 'brak kolumny „role” — uruchom najpierw db/01_schema.sql.' : e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
