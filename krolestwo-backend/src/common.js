'use strict';
const crypto = require('crypto');

// Klient gry używa nazw: Wojownik / Mag / Łotr. W bazie klasy mają kody.
const CLS_TO_CODE = { 'Wojownik': 'warrior', 'Mag': 'mage', 'Łotr': 'archer', 'Łucznik': 'archer' };
const CODE_TO_CLS = { warrior: 'Wojownik', mage: 'Mag', archer: 'Łotr' };

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Adres bazy musi pochodzić ze środowiska (.env) — w kodzie nie ma już zaszytego hasła.
// Produkcja (NODE_ENV=production) wymaga adresu z własnym, mocnym hasłem.
const WEAK_DB_PASSWORDS = new Set(['kc_password', 'password', 'postgres', 'changeme', 'zmien_haslo', 'twoje_haslo', 'ustaw_wlasne_haslo']);
function getDatabaseUrl() {
  const prod = process.env.NODE_ENV === 'production';
  const fail = (msg) => { console.error('[config] ' + msg); process.exit(1); };
  const url = process.env.DATABASE_URL;
  if (!url) fail('Brak DATABASE_URL. Skopiuj .env.example do .env i ustaw własne hasło do bazy.');
  let pass = null;
  try { pass = decodeURIComponent(new URL(url).password || ''); } catch { /* nietypowy format — pg sam go obsłuży */ }
  if (prod) {
    if (pass === null) fail('DATABASE_URL ma nieprawidłowy format (znaki specjalne w haśle zakoduj procentowo).');
    if (!pass || pass.length < 12 || WEAK_DB_PASSWORDS.has(pass.toLowerCase())) {
      fail('W produkcji DATABASE_URL musi zawierać własne, mocne hasło (min. 12 znaków, nie domyślne).');
    }
  } else if (pass !== null && (!pass || WEAK_DB_PASSWORDS.has(pass.toLowerCase()))) {
    console.warn('[config] OSTRZEŻENIE: słabe lub domyślne hasło do bazy. Dozwolone tylko lokalnie — produkcja je odrzuci.');
  }
  return url;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { CLS_TO_CODE, CODE_TO_CLS, sha256, HttpError, getDatabaseUrl };
