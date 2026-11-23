'use strict';
// Sprawdza, czy src/gamedata.js (dane używane przez ochronę zapisu) zgadza się z tabelami w public/index.html.
// Uruchom po każdej zmianie przedmiotów, potworów, umiejętności, afiksów lub questów w grze:
//   node scripts/check-gamedata.js [ścieżka/do/index.html]
// Kod wyjścia 0 = zgodne, 1 = rozbieżności (wypisane poniżej).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const G = require('../src/gamedata');
const { xpNeeded } = require('../src/saveGuard');

const file = process.argv[2] || path.join(__dirname, '..', 'public', 'index.html');
const src = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
const problems = [];
const bad = (m) => problems.push(m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = (from, to) => { const a = src.indexOf(from); if (a < 0) { bad(`brak "${from}" w kliencie`); return ''; } const b = src.indexOf(to, a); return src.slice(a, b < 0 ? undefined : b); };

// --- przedmioty ---
const items = {};
for (const m of section('const ITEM_POOL=[', '];').matchAll(/\{id:'([a-z0-9_]+)',name:'([^']+)',rarity:'([a-z]+)',slot:'([a-z]+)'((?:,[a-z]+:\d+)*)\}/g)) {
  const o = { name: m[2], rarity: m[3], slot: m[4] };
  for (const kv of m[5].split(',').filter(Boolean)) { const [k, v] = kv.split(':'); o[k] = +v; }
  items[m[1]] = o;
}
const poolCount = (section('const ITEM_POOL=[', '];').match(/\{id:'/g) || []).length;
if (poolCount !== Object.keys(items).length) bad(`ITEM_POOL: odczytano ${Object.keys(items).length} z ${poolCount} wpisów (zmienił się format zapisu?)`);
for (const id of new Set([...Object.keys(items), ...Object.keys(G.ITEMS)])) {
  if (!items[id]) bad(`przedmiot ${id}: jest w gamedata.js, brak w kliencie`);
  else if (!G.ITEMS[id]) bad(`przedmiot ${id}: jest w kliencie, brak w gamedata.js (serwer usunie go z toreb!)`);
  else if (!eq(Object.entries(items[id]).sort(), Object.entries(G.ITEMS[id]).sort())) bad(`przedmiot ${id}: różne wartości (klient ${JSON.stringify(items[id])}, gamedata ${JSON.stringify(G.ITEMS[id])})`);
}

// --- potwory ---
const mons = {};
for (const m of section('const MONSTER_DEFS', '\n};').matchAll(/^\s+([a-z_0-9]+):\s*\{name:'[^']*',\s*kind:'[a-z]+',\s*lvl:(\d+),\s*hp:(\d+),\s*atk:(\d+),\s*exp:(\d+),\s*gold:(\d+)/gm)) mons[m[1]] = { lvl: +m[2], exp: +m[5], gold: +m[6] };
for (const c of new Set([...Object.keys(mons), ...Object.keys(G.MONSTERS)])) {
  if (!mons[c]) bad(`potwór ${c}: jest w gamedata.js, brak w kliencie`);
  else if (!G.MONSTERS[c]) bad(`potwór ${c}: jest w kliencie, brak w gamedata.js (zabójstwa zostaną odrzucone)`);
  else if (!eq(mons[c], G.MONSTERS[c])) bad(`potwór ${c}: różne wartości (klient ${JSON.stringify(mons[c])}, gamedata ${JSON.stringify(G.MONSTERS[c])})`);
}

// --- afiksy, sloty, questy, krzywa EXP ---
const aff = {};
for (const m of section('const AFFIX_POOL=[', '];').matchAll(/\{k:'([a-z]+)',min:(\d+),max:(\d+)/g)) aff[m[1]] = { min: +m[2], max: +m[3] };
const flat = (src.match(/const FLAT_AFFIX=new Set\(\[([^\]]*)\]\)/) || [, ''])[1].match(/'([a-z]+)'/g) || [];
for (const k of new Set([...Object.keys(aff), ...Object.keys(G.AFFIXES)])) {
  const g = G.AFFIXES[k], c = aff[k];
  if (!c || !g) bad(`afiks ${k}: ${c ? 'brak w gamedata.js' : 'brak w kliencie'}`);
  else if (c.min !== g.min || c.max !== g.max || g.flat !== flat.includes(`'${k}'`)) bad(`afiks ${k}: różne wartości (klient ${JSON.stringify({ ...c, flat: flat.includes(`'${k}'`) })}, gamedata ${JSON.stringify(g)})`);
}
const slots = [...section('const EQUIP_SLOTS=[', '];').matchAll(/\{id:'([a-z0-9]+)'/g)].map((m) => m[1]);
if (!eq(slots, G.EQUIP_SLOTS)) bad(`EQUIP_SLOTS: klient ${slots}, gamedata ${G.EQUIP_SLOTS}`);
const q = [...src.matchAll(/reward\s*:\s*\{([^}]*)\}/g)].map((m) => ({ gold: +((m[1].match(/gold:(\d+)/) || [, 0])[1]), exp: +((m[1].match(/exp:(\d+)/) || [, 0])[1]) }));
const qMax = { gold: Math.max(0, ...q.map((x) => x.gold)), exp: Math.max(0, ...q.map((x) => x.exp)) };
if (qMax.gold > G.QUEST_MAX.gold || qMax.exp > G.QUEST_MAX.exp) bad(`nagrody questów: w kliencie max ${JSON.stringify(qMax)}, w gamedata.js QUEST_MAX ${JSON.stringify(G.QUEST_MAX)} (za niskie — uczciwe nagrody będą obcinane)`);
const xpFn = (src.match(/function xpNeeded\(lvl\)\{ return ([^}]*); \}/) || [])[1];
if (!xpFn) bad('nie znaleziono xpNeeded w kliencie'); else { const f = new Function('lvl', 'return ' + xpFn); for (let l = 1; l <= 50; l++) if (f(l) !== xpNeeded(l)) { bad(`xpNeeded(${l}): klient ${f(l)}, serwer ${xpNeeded(l)} (zmieniona krzywa EXP)`); break; } }

// --- umiejętności (wykonujemy tabelę SKILL_DEFS z klienta i porównujemy id oraz premie pasywne) ---
try {
  const from = src.indexOf('const lerp='), a = src.indexOf('const SKILL_DEFS={'), b = src.indexOf('\n};', a) + 3;
  const ctx = vm.createContext({}); vm.runInContext(src.slice(from, b) + ';this.D=SKILL_DEFS;', ctx);
  for (const cls of new Set([...Object.keys(ctx.D), ...Object.keys(G.SKILLS)])) {
    const ids = (ctx.D[cls] || []).map((d) => d.id);
    if (!eq(ids, G.SKILLS[cls])) bad(`umiejętności klasy ${cls}: klient ${ids}, gamedata ${G.SKILLS[cls]}`);
  }
  const all = Object.values(ctx.D).flat().filter((d) => d.kind === 'passive');
  for (const d of all) {
    if (!G.PASSIVES[d.id] && Object.keys(d.p(1)).some((k) => ['maxHp', 'maxMp', 'atk', 'def', 'crit', 'ms', 'ls'].includes(k))) bad(`pasyw ${d.id}: premie do statystyk w kliencie, brak w gamedata.js`);
    if (G.PASSIVES[d.id]) for (let r = 1; r <= G.SKILL_MAX_RANK; r++) {
      const c = d.p(r), g = G.PASSIVES[d.id](r);
      for (const k of ['maxHp', 'maxMp', 'atk', 'def', 'crit', 'ms', 'ls']) if (Math.abs((c[k] || 0) - (g[k] || 0)) > 1e-9) bad(`pasyw ${d.id} ranga ${r}: ${k} klient ${c[k] || 0}, gamedata ${g[k] || 0}`);
    }
  }
} catch (e) { bad('nie udało się odczytać SKILL_DEFS z klienta: ' + e.message); }

if (problems.length) { console.error(`NIEZGODNOŚĆ gamedata.js z ${path.basename(file)} (${problems.length}):\n - ` + problems.join('\n - ')); process.exit(1); }
console.log(`OK: gamedata.js zgadza się z ${path.basename(file)} (${Object.keys(items).length} przedmiotów, ${Object.keys(mons).length} potworów, ${Object.keys(aff).length} afiksów, umiejętności klas, krzywa EXP, nagrody questów).`);
