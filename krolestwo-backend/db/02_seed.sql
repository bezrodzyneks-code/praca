-- =====================================================================
--  KRÓLESTWO CIENI — dane startowe
--  Wartości potworów, mikstur, klas i questów pochodzą z kodu gry (HTML).
--  Dodatkowe przedmioty / potwory / instancje wynikają z opisu projektu.
-- =====================================================================

BEGIN;
SET search_path = kc, public;

-- ---------- Światy ----------
INSERT INTO realms (id, name, description) VALUES
 ('cienie',  'Cienie',  'Główny świat — standardowe tempo zdobywania EXP.'),
 ('mrok',    'Mrok',    'Świat dla weteranów.');

-- ---------- Klasy ----------
-- HP/MP/ATK/DEF na poziom wyliczone jak w grze:
--   hp +18% bazy, mp +15%, atk/def +22% bazy +1.
INSERT INTO classes (id, code, name, emoji, combat_style, description,
    base_hp, base_mp, base_atk, base_def, base_str, base_dex, base_int,
    hp_per_level, mp_per_level, atk_per_level, def_per_level, str_per_level, dex_per_level, int_per_level) VALUES
 (1,'warrior','Wojownik','⚔️','Walka w zwarciu, tarcza i miecz',
    'Wytrzymały bohater pierwszej linii. Ogłusza, rozbija grupy wrogów i znosi najwięcej obrażeń.',
    60,10, 9,6, 10,5,3,   11,2, 3,2, 2,1,0),
 (2,'archer','Łucznik','🏹','Walka z dystansu i szybkie ataki',
    'Zwinny strzelec i zabójca. Wysoki krytyk, szybkie ataki i trucizny.',
    46,18, 7,4, 5,12,4,   8,3, 3,2, 1,2,0),
 (3,'mage','Mag','🔮','Zaklęcia obszarowe i magia żywiołów',
    'Kruchy, ale zabójczy. Ogień, lód i błyskawice — najwyższe obrażenia w grze.',
    38,35, 5,2, 3,5,12,   7,5, 2,1, 0,1,2);

-- ---------- Tabela EXP:  floor(40 * 1.35^(lvl-1)) ----------
INSERT INTO level_exp (level, exp_to_next)
SELECT l, CASE WHEN l = 50 THEN NULL ELSE floor(40 * power(1.35, l - 1))::bigint END
  FROM generate_series(1, 50) AS l;

-- ---------- Rzadkość ----------
INSERT INTO rarities (id, code, name, emoji, color_hex, min_affixes, max_affixes, sell_mult) VALUES
 (1,'common',   'Zwykły',     '⚪','#B4B8BE',0,1,1.0),
 (2,'rare',     'Rzadki',     '🟢','#5FBF6A',1,1,1.5),
 (3,'magic',    'Magiczny',   '🔵','#7FA8E8',1,2,2.5),
 (4,'epic',     'Epicki',     '🟣','#C47FE8',2,3,4.0),
 (5,'legendary','Legendarny', '🟠','#F29A2E',3,4,8.0);

-- ---------- Sloty ----------
INSERT INTO item_slots (code, name, is_equipment) VALUES
 ('weapon','Broń',true),('head','Hełm',true),('chest','Zbroja',true),('boots','Buty',true),
 ('cloak','Płaszcz',true),('amulet','Amulet',true),('ring','Pierścień',true),
 ('consumable','Mikstura',false),('special','Przedmiot specjalny',false),('bag','Torba',false);

INSERT INTO equip_slots (code, name, item_slot) VALUES
 ('head','Hełm','head'),('amulet','Amulet','amulet'),('cloak','Płaszcz','cloak'),('chest','Zbroja','chest'),
 ('weapon','Broń','weapon'),('ring1','Pierścień 1','ring'),('ring2','Pierścień 2','ring'),('boots','Buty','boots');

-- ---------- Efekty ----------
INSERT INTO effect_types (code, name, description) VALUES
 ('burn',     'Podpalenie',       'Obrażenia od ognia w czasie.'),
 ('poison',   'Zatrucie',         'Obrażenia od trucizny w czasie.'),
 ('freeze',   'Zamrożenie',       'Spowalnia lub unieruchamia cel.'),
 ('stun',     'Ogłuszenie',       'Cel traci turę.'),
 ('lifesteal','Kradzież życia',   'Leczy za część zadanych obrażeń.'),
 ('bleed',    'Krwawienie',       'Obrażenia fizyczne w czasie.');

-- ---------- Poziomy trudności (z gry: DIFF) ----------
INSERT INTO difficulties (id, code, name, hp_mult, atk_mult, def_mult, reward_mult, drop_mult) VALUES
 (1,'normal','Normalny', 1.0,1.0,1.0, 1.0,1.0),
 (2,'hard',  'Trudny',   1.6,1.6,1.3, 1.8,1.5),
 (3,'hell',  'Piekielny',2.4,2.4,1.7, 3.0,2.5);

-- ---------- Afiksy (z gry: AFFIX_POOL) ----------
INSERT INTO affix_types (code, name, min_roll, max_roll, is_pct) VALUES
 ('hp',  'maks. HP',            6,16,false),
 ('mp',  'maks. MP',            4,10,false),
 ('crit','szansa na krytyk',    2, 5,true),
 ('ms',  'szybkość ruchu',      3, 7,true),
 ('ls',  'kradzież życia',      2, 4,true),
 ('atkp','do ataku',            1, 3,false),
 ('defp','do obrony',           1, 3,false);

-- ---------- Umiejętności (nazwy i wymagania z gry) ----------
-- Wojownik i Mag — dokładnie jak w grze. Łucznik = klasa „Łotr” z gry
-- (zmień nazwy, jeśli wolisz zachować Łotra).
INSERT INTO skills (class_id, code, name, kind, required_level, mp_cost, cooldown_sec, damage_mult, description)
SELECT c.id, v.code, v.name, v.kind, v.lvl, v.mp, v.cd, v.mult, v.descr
  FROM (VALUES
 ('warrior','bash',        'Cios Tarczy',          'active', 1,  5, 5.0, 1.5,'Uderzenie tarczą z ogłuszeniem.'),
 ('warrior','whirl',       'Wir Ostrzy',           'active', 3, 10, 8.0, 0.45,'Seria cięć dookoła postaci.'),
 ('warrior','warcry',      'Okrzyk Bojowy',        'active', 5, 12,24.0, NULL,'Zwiększa atak i obronę.'),
 ('warrior','charge',      'Szarża',               'active', 8,  8, 9.0, 1.8,'Natarcie raniące wrogów na drodze.'),
 ('warrior','quake',       'Trzęsienie Ziemi',     'active',12, 14,12.0, 2.0,'Wstrząs obszarowy ze spowolnieniem.'),
 ('warrior','rampage',     'Szał Bitewny',         'active',18, 20,40.0, NULL,'Szybsze ataki i kradzież życia.'),
 ('warrior','toughness',   'Twarda Skóra',         'passive',1,  0, 0,   NULL,'+8 maks. HP i +1 obrony na rank.'),
 ('warrior','weaponmaster','Mistrz Broni',         'passive',2,  0, 0,   NULL,'+2% krytyka i +1.5 ataku na rank.'),

 ('mage','fireball',   'Kula Ognia',              'active', 1, 12, 0.0, 2.4,'Pocisk ognia z podpaleniem.'),
 ('mage','nova',       'Lodowa Nova',             'active', 3, 14, 8.0, NULL,'Eksplozja lodu zamrażająca wrogów.'),
 ('mage','manashield', 'Tarcza Many',             'active', 5, 15,20.0, NULL,'Obrażenia pochłaniane przez MP.'),
 ('mage','chain',      'Błyskawica Łańcuchowa',   'active', 8, 16, 9.0, 1.8,'Piorun przeskakujący między wrogami.'),
 ('mage','blink',      'Błysk',                   'active',12, 10,10.0, NULL,'Teleportacja na krótki dystans.'),
 ('mage','meteor',     'Deszcz Meteorów',         'active',18, 28,35.0, 3.0,'Spadające meteory na wskazany obszar.'),
 ('mage','arcane',     'Moc Arkanów',             'passive',1,  0, 0,   NULL,'Zwiększa siłę zaklęć.'),
 ('mage','meditation', 'Medytacja',               'passive',2,  0, 0,   NULL,'Przyspiesza regenerację MP.'),

 ('archer','assassinate','Skrytobójstwo',         'active', 1,  8, 4.0, 2.0,'Śmiertelny strzał w plecy z bonusem krytyka.'),
 ('archer','daggers',    'Rzut Sztyletów',        'active', 3, 10, 6.0, 1.2,'Wachlarz sztyletów przed postacią.'),
 ('archer','poison',     'Zatrute Ostrza',        'active', 5, 12,18.0, NULL,'Ataki zatruwają cel.'),
 ('archer','smoke',      'Bomba Dymna',           'active', 8, 12,14.0, NULL,'Zasłona dymna dezorientuje wrogów.'),
 ('archer','flurry',     'Taniec Ostrzy',         'active',12, 16,10.0, 0.6,'Seria błyskawicznych ataków.'),
 ('archer','deathmark',  'Znak Śmierci',          'active',18, 22,30.0, NULL,'Oznaczony cel otrzymuje więcej obrażeń.'),
 ('archer','agility',    'Zwinność',              'passive',1,  0, 0,   NULL,'Zwiększa szybkość i unik.'),
 ('archer','bloodthirst','Żądza Krwi',            'passive',2,  0, 0,   NULL,'Kradzież życia przy krytykach.')
 ) AS v(cls, code, name, kind, lvl, mp, cd, mult, descr)
  JOIN classes c ON c.code = v.cls;

-- =====================================================================
--  PRZEDMIOTY
-- =====================================================================
-- kolumny: code, nazwa, slot, rzadkość, wym.poziom, klasa, atk, def, hp, mp, str, dex, int, crit, heal_hp, heal_mp, bag, cena_kupna, cena_sprzedaży
INSERT INTO items (code, name, slot, rarity_id, required_level, class_id,
                   atk, def, hp, mp, str, dex, int, crit_pct, heal_hp, heal_mp, bag_slots,
                   stackable, max_stack, buy_price, sell_price)
SELECT v.code, v.name, v.slot, r.id, v.lvl, c.id,
       v.atk, v.def, v.hp, v.mp, v.str, v.dex, v.int, v.crit, v.hh, v.hm, v.bag,
       v.slot IN ('consumable','special'), CASE WHEN v.slot IN ('consumable','special') THEN 20 ELSE 1 END,
       v.buy, v.sell
  FROM (VALUES
 -- code, name, slot, rarity, lvl, class, atk,def,hp,mp,str,dex,int,crit, healHP,healMP,bag, buy, sell
 -- Przedmioty z gry
 ('sword1','Zardzewiały Miecz','weapon','common',1,'warrior', 2,0,0,0,0,0,0,0, 0,0,0, 18,6),
 ('armor1','Skórzana Zbroja','chest','common',1,NULL, 0,2,0,0,0,0,0,0, 0,0,0, 16,5),
 ('helm1','Żelazny Hełm','head','common',1,NULL, 0,2,0,0,0,0,0,0, 0,0,0, 20,7),
 ('boots1','Skórzane Buty','boots','common',1,NULL, 0,1,0,0,0,0,0,0, 0,0,0, 14,4),
 ('amulet1','Amulet Cienia','amulet','rare',5,NULL, 3,1,0,0,0,0,0,0, 0,0,0, 55,18),
 ('ring1','Pierścień Mocy','ring','rare',5,NULL, 4,0,0,0,0,0,0,0, 0,0,0, 60,20),
 ('sword2','Miecz Strażnika','weapon','rare',5,'warrior', 5,0,0,0,2,0,0,0, 0,0,0, 70,23),
 ('armor2','Zbroja Płytowa','chest','rare',6,'warrior', 0,5,0,0,0,0,0,0, 0,0,0, 75,25),
 ('helm2','Hełm Strażnika Cieni','head','rare',7,NULL, 1,4,0,0,0,0,0,0, 0,0,0, 80,27),
 ('boots2','Buty Cienia','boots','rare',6,NULL, 0,3,0,0,0,0,0,0, 0,0,0, 65,22),
 ('cloak1','Płaszcz Nocy','cloak','epic',10,NULL, 2,5,0,0,0,0,0,0, 0,0,0, 140,47),
 ('blade1','Klinga Pogromcy','weapon','epic',10,'warrior', 6,0,0,0,3,0,0,2, 0,0,0, 150,50),
 ('ring2','Sygnet Nekromanty','ring','epic',12,NULL, 5,2,0,0,0,0,2,0, 0,0,0, 160,53),
 ('bag1','Torba Podróżna','bag','rare',1,NULL, 0,0,0,0,0,0,0,0, 0,0,8, 60,20),
 -- Mikstury i przedmioty specjalne
 ('potion1','Mikstura Zdrowia','consumable','common',1,NULL, 0,0,0,0,0,0,0,0, 30,0,0, 10,3),
 ('potion2','Wielka Mikstura Zdrowia','consumable','rare',5,NULL, 0,0,0,0,0,0,0,0, 70,0,0, 24,8),
 ('potion3','Mikstura Many','consumable','common',1,NULL, 0,0,0,0,0,0,0,0, 0,30,0, 12,4),
 ('potion4','Eliksir Życia','consumable','magic',25,NULL, 0,0,0,0,0,0,0,0, 220,0,0, 90,30),
 ('scroll_return','Zwój Powrotu','special','common',1,NULL, 0,0,0,0,0,0,0,0, 0,0,0, 30,10),
 ('revive_stone','Kamień Wskrzeszenia','special','epic',10,NULL, 0,0,0,0,0,0,0,0, 0,0,0, 0,150),
 -- Broń: Wojownik
 ('sword3','Miecz Zaklęty','weapon','magic',15,'warrior', 24,0,0,0,5,0,0,0, 0,0,0, 0,90),
 ('sword_flame','Miecz Płomienia','weapon','legendary',20,'warrior', 85,0,0,0,12,0,0,0, 0,0,0, 0,600),
 ('axe_titan','Topór Tytana','weapon','epic',30,'warrior', 120,0,40,0,18,0,0,3, 0,0,0, 0,420),
 ('blade_abyss','Ostrze Otchłani','weapon','legendary',50,'warrior', 260,0,120,0,30,5,0,6, 0,0,0, 0,2500),
 -- Broń: Łucznik
 ('bow1','Krótki Łuk','weapon','common',1,'archer', 3,0,0,0,0,1,0,0, 0,0,0, 22,7),
 ('bow2','Łuk Łowcy','weapon','rare',8,'archer', 9,0,0,0,0,4,0,2, 0,0,0, 85,28),
 ('bow3','Łuk Cieniostrzałów','weapon','magic',16,'archer', 30,0,0,0,0,8,0,4, 0,0,0, 0,110),
 ('bow_storm','Łuk Burzy','weapon','epic',30,'archer', 95,0,0,0,0,16,0,6, 0,0,0, 0,400),
 ('bow_ash','Łuk Popiołu','weapon','legendary',40,'archer', 170,0,0,0,0,24,0,8, 0,0,0, 0,1400),
 -- Broń: Mag
 ('staff1','Kostur Ucznia','weapon','common',1,'mage', 3,0,0,5,0,0,2,0, 0,0,0, 22,7),
 ('staff2','Kostur Cienia','weapon','magic',12,'mage', 18,0,0,15,0,0,7,0, 0,0,0, 0,85),
 ('staff_frost','Kostur Szronu','weapon','epic',24,'mage', 70,0,0,40,0,0,15,0, 0,0,0, 0,330),
 ('staff_arch','Kostur Arcymaga','weapon','legendary',40,'mage', 180,0,0,80,0,0,28,3, 0,0,0, 0,1500),
 -- Zbroje
 ('robe1','Szata Adepta','chest','rare',5,'mage', 0,2,0,10,0,0,3,0, 0,0,0, 70,24),
 ('leather2','Skórzana Kurtka Łowcy','chest','rare',5,'archer', 0,3,0,0,0,3,0,0, 0,0,0, 70,24),
 ('plate_dragon','Zbroja Smoczej Łuski','chest','epic',35,'warrior', 0,45,150,0,10,0,0,0, 0,0,0, 0,520),
 ('robe_void','Szata Pustki','chest','epic',35,'mage', 10,28,60,90,0,0,18,0, 0,0,0, 0,520),
 ('cloak_ash','Płaszcz Popiołu','cloak','magic',22,NULL, 3,14,30,0,0,3,0,0, 0,0,0, 0,120),
 ('helm_dark','Korona Władcy Ciemności','head','legendary',50,NULL, 30,60,150,50,10,10,10,5, 0,0,0, 0,3000),
 ('boots_wind','Buty Wichru','boots','magic',18,NULL, 0,8,0,0,0,6,0,0, 0,0,0, 0,95),
 ('amulet_dragon','Amulet Smoczego Serca','amulet','epic',32,NULL, 20,10,100,30,6,0,0,2, 0,0,0, 0,360),
 ('ring_blood','Pierścień Krwawego Księżyca','ring','magic',20,NULL, 15,0,0,0,0,0,0,3, 0,0,0, 0,130)
 ) AS v(code,name,slot,rar,lvl,cls, atk,def,hp,mp,str,dex,int,crit, hh,hm,bag, buy,sell)
  JOIN rarities r ON r.code = v.rar
  LEFT JOIN classes c ON c.code = v.cls;

-- Efekty specjalne przedmiotów
INSERT INTO item_effects (item_id, effect_code, chance_pct, magnitude, duration_sec)
SELECT i.id, v.eff, v.chance, v.mag, v.dur
  FROM (VALUES
   ('sword_flame','burn',     8.0, 12, 4),     -- „Szansa podpalenia: 8%”
   ('axe_titan',  'stun',     5.0,  0, 1),
   ('blade_abyss','lifesteal',100, 5,  0),     -- stała kradzież życia 5%
   ('bow_storm',  'poison',  10.0,  9, 5),
   ('bow_ash',    'burn',    12.0, 20, 4),
   ('staff_frost','freeze',  10.0,  0, 2),
   ('staff_arch', 'burn',    15.0, 25, 4),
   ('ring_blood', 'bleed',    6.0,  6, 4)
  ) AS v(code, eff, chance, mag, dur)
  JOIN items i ON i.code = v.code;

UPDATE items SET description = 'Klinga owinięta żywym ogniem. Każde cięcie może podpalić przeciwnika.' WHERE code = 'sword_flame';

-- =====================================================================
--  POTWORY
-- =====================================================================
-- Potwory z gry (MONSTER_DEFS). Obrona = ~45% ataku (gra jej nie definiuje).
INSERT INTO monsters (code, name, kind, level, hp, atk, def, exp_reward, gold_min, gold_max, is_elite, is_boss, night_only)
SELECT code, name, kind, lvl, hp, atk, round(atk * 0.45)::int, exp, greatest(gold - round(gold*0.3)::int,0), gold + round(gold*0.3)::int, elite, boss, night
  FROM (VALUES
 ('rat','Szczur Cienia','rat',1,18,3,12,5,false,false,false),
 ('goblin','Goblin Grabieżca','goblin',3,30,5,20,9,false,false,false),
 ('wolf','Wilk Cienia','wolf',4,34,6,24,11,false,false,false),
 ('spider','Leśny Pająk','spider',5,32,7,26,12,false,false,false),
 ('skeleton','Szkielet Wartownik','skeleton',7,46,8,34,15,false,false,false),
 ('ghost','Błędny Duch','ghost',8,40,9,36,16,false,false,true),
 ('cryptskel','Strażnik Krypty','skeleton',10,70,11,50,22,false,false,false),
 ('cryptghost','Upiór Krypty','ghost',11,62,12,52,23,false,false,false),
 ('cryptlord','Lord Krypty','skeleton',12,260,15,260,140,true,false,false),
 ('druid','Skażony Druid','druid',14,96,15,70,30,false,false,false),
 ('darkwolf','Wilk Przeklętego Gaju','wolf',15,104,16,74,32,false,false,false),
 ('ent','Przeklęty Ent','orc',16,380,20,300,160,true,false,false),
 ('bogspider','Bagienny Pająk','spider',17,80,13,60,26,false,false,false),
 ('bogwraith','Bagienne Widmo','ghost',18,78,14,62,27,false,false,false),
 ('ancientsk','Starożytny Szkielet','skeleton',22,110,17,84,38,false,false,false),
 ('orcruin','Orkowy Grabieżca Ruin','orc',23,120,19,90,42,false,false,false),
 ('minespider','Kopalniany Pająk','spider',24,140,21,96,44,false,false,false),
 ('mineorc','Ork Kopacz','orc',25,150,23,104,48,false,false,false),
 ('frostwolf','Mroźny Wilk','wolf',27,150,23,110,52,false,false,false),
 ('minefore','Brygadzista Orków','orc',27,520,30,420,220,true,false,false),
 ('mountorc','Górski Ork','orc',28,160,25,118,56,false,false,false),
 ('cavespider','Jaskiniowy Pająk','spider',32,190,29,140,66,false,false,false),
 ('wyrmling','Smoczy Pomiot','dragon',34,260,34,190,90,true,false,false),
 ('demonlesser','Pomniejszy Demon','demon',37,230,36,170,80,false,false,false),
 ('demongreat','Demon Zniszczenia','demon',39,300,42,220,100,true,false,false),
 ('fortorc','Elitarny Strażnik Twierdzy','orc',42,340,44,250,120,true,false,false),
 ('fortdemon','Demon Bramy','demon',44,380,48,280,135,true,false,false),
 ('voidghost','Widmo Pustki','ghost',47,420,52,300,150,false,false,false),
 ('shadowknight','Rycerz Cienia','demon',48,520,56,340,170,true,false,false),
 ('shadowlord','Władca Cieni','dragon',50,1400,70,1200,900,false,true,false),
 ('voidking','Cień Pradawny','dragon',50,2600,80,2500,1500,false,true,false)
 ) AS m(code,name,kind,lvl,hp,atk,exp,gold,elite,boss,night);

-- Potwory z opisu projektu + bossowie instancji (statystyki zbalansowane do krzywej z gry)
INSERT INTO monsters (code, name, kind, level, hp, atk, def, exp_reward, gold_min, gold_max, is_elite, is_boss, night_only, description) VALUES
 ('zombie',        'Zombie',             'zombie', 10, 85,   12, 5,  55,   18, 30,  false,false,false,'Powolne, ale odporne truchło.'),
 ('queenspider',   'Królowa Pająków',    'spider', 20, 520,  24, 11, 310,  150,250, true, false,false,'Matka wszystkich pająków lasu.'),
 ('shadowdragon',  'Smok Cienia',        'dragon', 40, 1500, 55, 25, 900,  500,800, true, false,false,'Smok wykuty z mroku.'),
 ('darklord',      'Władca Ciemności',   'demon',  50, 3200, 90, 40, 3000, 2000,3000,false,true, false,'Ostateczny wróg Królestwa Cieni.'),
 ('boss_goblin',   'Wódz Goblinów',      'goblin', 5,  220,  10, 4,  150,  80, 130, false,true, false,'Przywódca goblinów z kopalni.'),
 ('boss_necro',    'Nekromanta',         'druid',  10, 480,  17, 7,  360,  180,280, false,true, false,'Wskrzesza poległych w krypcie.'),
 ('boss_arach',    'Królowa Arachnidów', 'spider', 20, 900,  30, 13, 700,  350,550, false,true, false,'Władczyni Pajęczej Groty.'),
 ('boss_prince',   'Książę Piekieł',     'demon',  30, 1500, 46, 21, 1300, 700,1100,false,true, false,'Wiekowy demon zasiadający w zamku.'),
 ('boss_ashdragon','Smok Popiołu',       'dragon', 40, 2400, 62, 28, 2100, 1100,1700,false,true,false,'Smok spopielający wszystko na pustkowiu.');

-- =====================================================================
--  DROP — generowany regułą
--    • przedmiot może wypaść z potwora, jeśli wymagany poziom mieści się w
--      [poziom potwora - 8, poziom potwora + 2]
--    • epicki / legendarny: tylko elity i bossowie
--    • szansa bazowa wg rzadkości; elita x2, boss x5
--    • mikstury wypadają z każdego potwora
-- =====================================================================
INSERT INTO monster_drops (monster_id, item_id, drop_chance, min_qty, max_qty)
SELECT m.id, i.id,
       LEAST(0.60, round((
         CASE r.code WHEN 'common' THEN 0.080 WHEN 'rare' THEN 0.040 WHEN 'magic' THEN 0.020
                     WHEN 'epic'   THEN 0.008 WHEN 'legendary' THEN 0.002 END
         * CASE WHEN m.is_boss THEN 5 WHEN m.is_elite THEN 2 ELSE 1 END
       )::numeric, 5)),
       1, 1
  FROM monsters m
  JOIN items i    ON i.slot IN ('weapon','head','chest','boots','cloak','amulet','ring')
                 AND i.required_level BETWEEN m.level - 8 AND m.level + 2
                 AND i.buy_price >= 0
  JOIN rarities r ON r.id = i.rarity_id
 WHERE r.code IN ('common','rare','magic')
    OR (r.code IN ('epic','legendary') AND (m.is_elite OR m.is_boss));

-- Mikstury: zdrowia do lvl 24, Eliksir od 20
INSERT INTO monster_drops (monster_id, item_id, drop_chance, min_qty, max_qty)
SELECT m.id, i.id,
       CASE i.code WHEN 'potion1' THEN 0.15 WHEN 'potion2' THEN 0.07 WHEN 'potion3' THEN 0.08 WHEN 'potion4' THEN 0.03 END
       * CASE WHEN m.is_boss THEN 3 ELSE 1 END,
       1, CASE WHEN m.is_boss THEN 3 ELSE 1 END
  FROM monsters m JOIN items i ON i.code IN ('potion1','potion2','potion3','potion4')
 WHERE (i.code = 'potion1' AND m.level <= 25)
    OR (i.code = 'potion2' AND m.level >= 5)
    OR (i.code = 'potion3' AND m.level >= 3)
    OR (i.code = 'potion4' AND m.level >= 20);

-- Kamień Wskrzeszenia — rzadki drop z bossów
INSERT INTO monster_drops (monster_id, item_id, drop_chance)
SELECT m.id, i.id, 0.05 FROM monsters m, items i WHERE m.is_boss AND i.code = 'revive_stone';

-- Gwarantowane legendarki z bossów instancji (niski %), niezależnie od okna poziomu
INSERT INTO monster_drops (monster_id, item_id, drop_chance)
SELECT m.id, i.id, v.chance FROM (VALUES
   ('boss_necro',    'ring_blood',   0.06),
   ('boss_arach',    'sword_flame',  0.04),   -- Miecz Płomienia (lvl 20)
   ('boss_arach',    'staff_frost',  0.04),
   ('boss_prince',   'axe_titan',    0.05),
   ('boss_ashdragon','bow_ash',      0.04),
   ('boss_ashdragon','staff_arch',   0.04),
   ('darklord',      'blade_abyss',  0.05),
   ('darklord',      'helm_dark',    0.05)
 ) AS v(mon, itm, chance)
 JOIN monsters m ON m.code = v.mon JOIN items i ON i.code = v.itm
ON CONFLICT (monster_id, item_id) DO UPDATE SET drop_chance = EXCLUDED.drop_chance;

-- =====================================================================
--  INSTANCJE
-- =====================================================================
INSERT INTO instances (code, name, description, required_level, boss_id, map_code)
SELECT v.code, v.name, v.descr, v.lvl, m.id, v.map
  FROM (VALUES
   ('goblin_mine','Kopalnia Goblinów','Zawalone sztolnie roją się od goblinów.',5,'boss_goblin','mine'),
   ('crypt',      'Krypta Umarłych',   'Starożytna krypta pełna nieumarłych.',10,'boss_necro','crypt'),
   ('spider_cave','Pajęcza Grota',     'Lepkie sieci i niezliczone pająki.',20,'boss_arach','cave'),
   ('demon_castle','Zamek Demonów',    'Twierdza piekielnych sił.',30,'boss_prince','demonlands'),
   ('dragon_waste','Smocze Pustkowie', 'Wypalona kraina smoków.',40,'boss_ashdragon','fortress'),
   ('abyss',      'Otchłań',           'Serce Królestwa Cieni.',50,'darklord','shadowrealm')
  ) AS v(code,name,descr,lvl,boss,map)
  JOIN monsters m ON m.code = v.boss;

INSERT INTO instance_monsters (instance_id, monster_id, wave, count_min, count_max)
SELECT i.id, m.id, v.wave, v.cmin, v.cmax FROM (VALUES
  ('goblin_mine','goblin',      1,3,5), ('goblin_mine','wolf',       2,2,3), ('goblin_mine','spider',  2,1,2),
  ('crypt','skeleton',          1,3,4), ('crypt','cryptskel',        2,3,4), ('crypt','cryptghost',    2,2,3), ('crypt','cryptlord',3,1,1),
  ('spider_cave','spider',      1,4,6), ('spider_cave','bogspider',  2,3,4), ('spider_cave','minespider',2,2,3), ('spider_cave','queenspider',3,1,1),
  ('demon_castle','demonlesser',1,3,5), ('demon_castle','demongreat',2,2,3), ('demon_castle','cavespider',1,2,3),
  ('dragon_waste','fortorc',    1,3,4), ('dragon_waste','wyrmling',  2,2,3), ('dragon_waste','shadowdragon',3,1,1),
  ('abyss','voidghost',         1,4,6), ('abyss','shadowknight',     2,3,4), ('abyss','fortdemon',     2,2,3), ('abyss','shadowlord',3,1,1)
 ) AS v(inst, mon, wave, cmin, cmax)
 JOIN instances i ON i.code = v.inst JOIN monsters m ON m.code = v.mon;

-- =====================================================================
--  QUESTY (z gry: QUESTS)
-- =====================================================================
INSERT INTO quests (code, name, description, giver_npc, min_level, quest_type, target_count, reward_gold, reward_exp, reward_item_id)
SELECT v.code, v.name, v.descr, v.npc, v.minlvl, v.type, v.cnt, v.gold, v.exp, i.id FROM (VALUES
 ('q_rats','Oczyszczenie Okolic','Pokonaj 5 szkodników w okolicach miasta i lasu.','karczmarz',1,'kill',5,40,30,NULL),
 ('q_lostcaravan','Zaginiony Kupiec','Znajdź zaginiony towar ukryty w Lesie Cieni.','kupiec',3,'collect',1,60,50,'ring1'),
 ('q_farm','Szkodniki na Polach','Pokonaj 6 wilków, szczurów lub goblinów na Opuszczonych Polach.','rolnik',3,'kill',6,70,60,'boots1'),
 ('q_witch','Duchy Bagien','Pokonaj 4 widma w Zapomnianych Bagnach.','morga',14,'kill',4,160,220,'amulet1'),
 ('q_mine','Orkowie w Sztolniach','Pokonaj 5 orków kopaczy w Opuszczonej Kopalni.','gornik',22,'kill',5,320,480,'helm2'),
 ('q_shadowlord','Władca Cieni','Wkrocz do Twierdzy Cieni i pokonaj Władcę Cieni.','straznik',40,'boss',1,900,1200,'cloak1')
) AS v(code,name,descr,npc,minlvl,type,cnt,gold,exp,reward)
LEFT JOIN items i ON i.code = v.reward;

INSERT INTO quest_targets (quest_id, monster_id)
SELECT q.id, m.id FROM (VALUES
 ('q_rats','rat'),('q_rats','goblin'),
 ('q_farm','rat'),('q_farm','wolf'),('q_farm','goblin'),
 ('q_witch','bogwraith'),('q_witch','ghost'),
 ('q_mine','mineorc'),
 ('q_shadowlord','shadowlord')
) AS v(q, mon) JOIN quests q ON q.code = v.q JOIN monsters m ON m.code = v.mon;

COMMIT;

-- =====================================================================
--  PRZYKŁADOWE ZAPYTANIA
-- =====================================================================
--  -- rejestracja (hash z aplikacji!):
--  INSERT INTO kc.accounts (username, email, password_hash) VALUES ('bohater','a@b.pl','$argon2id$...');
--  -- nowa postać:
--  SELECT kc.create_character(1, 'cienie', 'Aragorn', 'warrior');
--  -- EXP po walce:
--  SELECT kc.grant_exp(1, 500);  SELECT kc.record_kill(1, (SELECT id FROM kc.monsters WHERE code='goblin'));
--  -- tabela dropu potwora:
--  SELECT * FROM kc.v_monster_drops WHERE monster = 'Wódz Goblinów' ORDER BY drop_chance DESC;
