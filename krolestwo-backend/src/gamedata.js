'use strict';
// Dane gry używane WYŁĄCZNIE do walidacji zapisu postaci (saveGuard.js).
// To lustro stałych z public/index.html (ITEM_POOL, MONSTER_DEFS, SKILL_DEFS, AFFIX_POOL, formuła EXP, QUESTS).
// Gdy zmienisz te tabele w kliencie, zaktualizuj je tutaj — inaczej serwer potraktuje nowe wpisy jako nieznane.
// Wartości z panelu admina (tabele items/monsters w bazie) mają pierwszeństwo, jeśli są WIĘKSZE (patrz saveGuard.js).

// Przedmioty, które gra potrafi wygenerować (id -> wartości bazowe). Wszystko spoza tej listy jest odrzucane.
const ITEMS = {
  sword1: { name: "Zardzewiały Miecz", rarity: "common", slot: "weapon", atk: 2, price: 18 },
  armor1: { name: "Skórzana Zbroja", rarity: "common", slot: "chest", def: 2, price: 16 },
  helm1: { name: "Żelazny Hełm", rarity: "common", slot: "head", def: 2, price: 20 },
  boots1: { name: "Skórzane Buty", rarity: "common", slot: "boots", def: 1, price: 14 },
  amulet1: { name: "Amulet Cienia", rarity: "rare", slot: "amulet", atk: 3, def: 1, price: 55 },
  ring1: { name: "Pierścień Mocy", rarity: "rare", slot: "ring", atk: 4, price: 60 },
  sword2: { name: "Miecz Strażnika", rarity: "rare", slot: "weapon", atk: 5, price: 70 },
  armor2: { name: "Zbroja Płytowa", rarity: "rare", slot: "chest", def: 5, price: 75 },
  helm2: { name: "Hełm Strażnika Cieni", rarity: "rare", slot: "head", def: 4, atk: 1, price: 80 },
  boots2: { name: "Buty Cienia", rarity: "rare", slot: "boots", def: 3, price: 65 },
  cloak1: { name: "Płaszcz Nocy", rarity: "epic", slot: "cloak", def: 5, atk: 2, price: 140 },
  blade1: { name: "Klinga Pogromcy", rarity: "epic", slot: "weapon", atk: 6, price: 150 },
  ring2: { name: "Sygnet Nekromanty", rarity: "epic", slot: "ring", atk: 5, def: 2, price: 160 },
  potion1: { name: "Mikstura Zdrowia", rarity: "potion", slot: "consumable", heal: 30, price: 10 },
  potion2: { name: "Wielka Mikstura Zdrowia", rarity: "potion", slot: "consumable", heal: 70, price: 24 },
  bag1: { name: "Torba Podróżna", rarity: "rare", slot: "bag", bag: 8, price: 60 },
};

// Potwory (kod -> poziom i nagrody). Służy do sprawdzania kodów w bestiariuszu i do limitów nagród.
const MONSTERS = {
  rat: { lvl: 1, exp: 12, gold: 5 },
  goblin: { lvl: 3, exp: 20, gold: 9 },
  wolf: { lvl: 4, exp: 24, gold: 11 },
  spider: { lvl: 5, exp: 26, gold: 12 },
  skeleton: { lvl: 7, exp: 34, gold: 15 },
  ghost: { lvl: 8, exp: 36, gold: 16 },
  bogspider: { lvl: 17, exp: 60, gold: 26 },
  bogwraith: { lvl: 18, exp: 62, gold: 27 },
  ancientsk: { lvl: 22, exp: 84, gold: 38 },
  orcruin: { lvl: 23, exp: 90, gold: 42 },
  frostwolf: { lvl: 27, exp: 110, gold: 52 },
  mountorc: { lvl: 28, exp: 118, gold: 56 },
  cavespider: { lvl: 32, exp: 140, gold: 66 },
  wyrmling: { lvl: 34, exp: 190, gold: 90 },
  demonlesser: { lvl: 37, exp: 170, gold: 80 },
  demongreat: { lvl: 39, exp: 220, gold: 100 },
  fortorc: { lvl: 42, exp: 250, gold: 120 },
  fortdemon: { lvl: 44, exp: 280, gold: 135 },
  cryptskel: { lvl: 10, exp: 50, gold: 22 },
  cryptghost: { lvl: 11, exp: 52, gold: 23 },
  cryptlord: { lvl: 12, exp: 260, gold: 140 },
  druid: { lvl: 14, exp: 70, gold: 30 },
  darkwolf: { lvl: 15, exp: 74, gold: 32 },
  ent: { lvl: 16, exp: 300, gold: 160 },
  minespider: { lvl: 24, exp: 96, gold: 44 },
  mineorc: { lvl: 25, exp: 104, gold: 48 },
  minefore: { lvl: 27, exp: 420, gold: 220 },
  voidghost: { lvl: 47, exp: 300, gold: 150 },
  shadowknight: { lvl: 48, exp: 340, gold: 170 },
  voidking: { lvl: 50, exp: 2500, gold: 1500 },
  shadowlord: { lvl: 50, exp: 1200, gold: 900 },
};

// Największa jednorazowa nagroda za quest (public/index.html, QUESTS): do limitu przy przejściu quest -> 'done'.
const QUEST_MAX = { gold: 900, exp: 1200 };

// Zakres afiksów (AFFIX_POOL): v losowane w [min, max]; afiksy "płaskie" rosną z poziomem postaci (x(1+(lvl-1)*0.07)).
const AFFIXES = {
  hp: { min: 6, max: 16, flat: true },
  mp: { min: 4, max: 10, flat: true },
  crit: { min: 2, max: 5, flat: false },
  ms: { min: 3, max: 7, flat: false },
  ls: { min: 2, max: 4, flat: false },
  atkp: { min: 1, max: 3, flat: true },
  defp: { min: 1, max: 3, flat: true },
};
// Maksymalna liczba afiksów wg rzadkości (rollAffixes): epic 2, rare 1, common 0-1, reszta 0.
const AFFIX_COUNT = { epic: 2, rare: 1, common: 1 };

const EQUIP_SLOTS = ['head', 'amulet', 'cloak', 'chest', 'weapon', 'ring1', 'ring2', 'boots'];
const RARITIES = ['common', 'rare', 'epic', 'potion'];

// Umiejętności klas (SKILL_DEFS). Maks. ranga 7; suma rang nie może przekroczyć poziomu (skillPointsAvail).
const SKILLS = {
  Wojownik: ['bash', 'whirl', 'warcry', 'charge', 'quake', 'rampage', 'toughness', 'weaponmaster'],
  Mag: ['fireball', 'nova', 'manashield', 'chain', 'blink', 'meteor', 'arcane', 'meditation'],
  'Łotr': ['assassinate', 'daggers', 'poison', 'smoke', 'flurry', 'deathmark', 'agility', 'bloodthirst'],
};
const SKILL_MAX_RANK = 7;
// Premie z umiejętności pasywnych (applyPassives): ranga -> premie do statystyk.
const PASSIVES = {
  toughness: (r) => ({ maxHp: 8 * r, def: r }),
  weaponmaster: (r) => ({ crit: 0.02 * r, atk: Math.round(1.5 * r) }),
  arcane: (r) => ({ atk: 2 * r, maxMp: 6 * r }),
  agility: (r) => ({ crit: 0.02 * r, ms: 0.03 * r }),
  bloodthirst: (r) => ({ ls: 0.015 * r, atk: Math.round(1.5 * r) }),
};

module.exports = { ITEMS, MONSTERS, QUEST_MAX, AFFIXES, AFFIX_COUNT, EQUIP_SLOTS, RARITIES, SKILLS, SKILL_MAX_RANK, PASSIVES };
