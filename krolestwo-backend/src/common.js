'use strict';
const crypto = require('crypto');

// Klient gry używa nazw: Wojownik / Mag / Łotr. W bazie klasy mają kody.
const CLS_TO_CODE = { 'Wojownik': 'warrior', 'Mag': 'mage', 'Łotr': 'archer', 'Łucznik': 'archer' };
const CODE_TO_CLS = { warrior: 'Wojownik', mage: 'Mag', archer: 'Łotr' };

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { CLS_TO_CODE, CODE_TO_CLS, sha256, HttpError };
