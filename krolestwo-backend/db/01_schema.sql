-- =====================================================================
--  KRÓLESTWO CIENI — schemat bazy danych (PostgreSQL 13+)
--  Uruchom najpierw ten plik, potem 02_seed.sql
--      psql -U postgres -d krolestwo -f 01_schema.sql
--      psql -U postgres -d krolestwo -f 02_seed.sql
-- =====================================================================

BEGIN;

DROP SCHEMA IF EXISTS kc CASCADE;
CREATE SCHEMA kc;
SET search_path = kc, public;

-- =====================================================================
--  1. KONTA, SESJE, ŚWIATY
-- =====================================================================

CREATE TABLE accounts (
    id             BIGSERIAL PRIMARY KEY,
    username       VARCHAR(24)  NOT NULL CHECK (username ~ '^[A-Za-z0-9_\-]{3,24}$'),
    email          VARCHAR(255),
    -- NIGDY nie zapisuj hasła jawnie. Tu trafia wynik argon2id / bcrypt
    -- policzony w aplikacji (np. "$argon2id$v=19$m=65536,t=3,p=4$...").
    password_hash  TEXT         NOT NULL,
    display_name   VARCHAR(40),
    bio            VARCHAR(500),
    avatar_url     TEXT,
    role           VARCHAR(12)  NOT NULL DEFAULT 'player' CHECK (role IN ('player','moderator','admin')),
    max_characters SMALLINT     NOT NULL DEFAULT 3 CHECK (max_characters BETWEEN 1 AND 20),
    is_banned      BOOLEAN      NOT NULL DEFAULT FALSE,
    ban_reason     TEXT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_accounts_username ON accounts (lower(username));
CREATE UNIQUE INDEX ux_accounts_email    ON accounts (lower(email)) WHERE email IS NOT NULL;

-- Sesje: w bazie trzymamy tylko SHA-256 tokenu, nie sam token.
CREATE TABLE sessions (
    id          BIGSERIAL PRIMARY KEY,
    account_id  BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash  CHAR(64)    NOT NULL UNIQUE,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
    revoked_at  TIMESTAMPTZ            -- wylogowanie = ustawienie tej daty
);
CREATE INDEX ix_sessions_account ON sessions (account_id);
CREATE INDEX ix_sessions_active  ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE realms (
    id          VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL,
    description TEXT,
    max_players INT         NOT NULL DEFAULT 500,
    exp_rate    NUMERIC(4,2) NOT NULL DEFAULT 1.00,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

-- =====================================================================
--  2. SŁOWNIKI: klasy, poziomy, rzadkość, sloty, efekty
-- =====================================================================

CREATE TABLE classes (
    id           SMALLINT PRIMARY KEY,
    code         VARCHAR(20) NOT NULL UNIQUE,
    name         VARCHAR(40) NOT NULL,
    emoji        VARCHAR(8),
    combat_style VARCHAR(60) NOT NULL,
    description  TEXT,
    -- statystyki startowe (poziom 1)
    base_hp  INT NOT NULL, base_mp  INT NOT NULL,
    base_atk INT NOT NULL, base_def INT NOT NULL,
    base_str INT NOT NULL, base_dex INT NOT NULL, base_int INT NOT NULL,
    -- przyrost na każdy poziom
    hp_per_level  INT NOT NULL, mp_per_level  INT NOT NULL,
    atk_per_level INT NOT NULL, def_per_level INT NOT NULL,
    str_per_level INT NOT NULL, dex_per_level INT NOT NULL, int_per_level INT NOT NULL
);

-- Tabela EXP: ile trzeba zdobyć, żeby przejść z poziomu N na N+1.
CREATE TABLE level_exp (
    level       SMALLINT PRIMARY KEY CHECK (level BETWEEN 1 AND 50),
    exp_to_next BIGINT            -- NULL na poziomie 50 (maksymalny)
);

CREATE TABLE rarities (
    id          SMALLINT PRIMARY KEY,
    code        VARCHAR(12) NOT NULL UNIQUE,
    name        VARCHAR(20) NOT NULL,
    emoji       VARCHAR(8),
    color_hex   CHAR(7)     NOT NULL,
    min_affixes SMALLINT    NOT NULL DEFAULT 0,
    max_affixes SMALLINT    NOT NULL DEFAULT 0,
    sell_mult   NUMERIC(4,2) NOT NULL DEFAULT 1
);

CREATE TABLE item_slots (
    code         VARCHAR(12) PRIMARY KEY,   -- slot typu przedmiotu
    name         VARCHAR(30) NOT NULL,
    is_equipment BOOLEAN NOT NULL            -- czy można założyć
);

-- Sloty ekwipunku postaci (pierścienie mają 2 miejsca)
CREATE TABLE equip_slots (
    code      VARCHAR(12) PRIMARY KEY,
    name      VARCHAR(30) NOT NULL,
    item_slot VARCHAR(12) NOT NULL REFERENCES item_slots(code)
);

CREATE TABLE effect_types (
    code        VARCHAR(16) PRIMARY KEY,
    name        VARCHAR(40) NOT NULL,
    description TEXT
);

CREATE TABLE difficulties (
    id           SMALLINT PRIMARY KEY,
    code         VARCHAR(12) NOT NULL UNIQUE,
    name         VARCHAR(20) NOT NULL,
    hp_mult      NUMERIC(4,2) NOT NULL,
    atk_mult     NUMERIC(4,2) NOT NULL,
    def_mult     NUMERIC(4,2) NOT NULL,
    reward_mult  NUMERIC(4,2) NOT NULL,   -- EXP i złoto
    drop_mult    NUMERIC(4,2) NOT NULL    -- szansa na drop
);

-- =====================================================================
--  3. UMIEJĘTNOŚCI
-- =====================================================================

CREATE TABLE skills (
    id             SMALLSERIAL PRIMARY KEY,
    class_id       SMALLINT    NOT NULL REFERENCES classes(id),
    code           VARCHAR(24) NOT NULL,
    name           VARCHAR(50) NOT NULL,
    kind           VARCHAR(8)  NOT NULL CHECK (kind IN ('active','passive')),
    required_level SMALLINT    NOT NULL DEFAULT 1 CHECK (required_level BETWEEN 1 AND 50),
    max_rank       SMALLINT    NOT NULL DEFAULT 10,
    mp_cost        INT         NOT NULL DEFAULT 0,
    cooldown_sec   NUMERIC(5,1) NOT NULL DEFAULT 0,
    damage_mult    NUMERIC(5,2),             -- mnożnik obrażeń (rank 1)
    description    TEXT,
    UNIQUE (class_id, code)
);

-- =====================================================================
--  4. POSTAĆ
-- =====================================================================

CREATE TABLE characters (
    id            BIGSERIAL PRIMARY KEY,
    account_id    BIGINT      NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    realm_id      VARCHAR(20) NOT NULL REFERENCES realms(id),
    name          VARCHAR(24) NOT NULL CHECK (char_length(name) BETWEEN 3 AND 24),
    class_id      SMALLINT    NOT NULL REFERENCES classes(id),

    level         SMALLINT    NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 50),
    exp           BIGINT      NOT NULL DEFAULT 0 CHECK (exp >= 0),
    gold          BIGINT      NOT NULL DEFAULT 20 CHECK (gold >= 0),

    hp      INT NOT NULL CHECK (hp >= 0),  max_hp INT NOT NULL CHECK (max_hp > 0),
    mp      INT NOT NULL CHECK (mp >= 0),  max_mp INT NOT NULL CHECK (max_mp >= 0),
    atk     INT NOT NULL, def INT NOT NULL,
    str     INT NOT NULL, dex INT NOT NULL, int INT NOT NULL,
    skill_points  SMALLINT    NOT NULL DEFAULT 0 CHECK (skill_points >= 0),

    current_map   VARCHAR(24) NOT NULL DEFAULT 'town',
    pos_x         NUMERIC(8,2) NOT NULL DEFAULT 0,
    pos_y         NUMERIC(8,2) NOT NULL DEFAULT 0,
    bag_capacity  SMALLINT    NOT NULL DEFAULT 20,

    monsters_killed INT    NOT NULL DEFAULT 0,
    deaths          INT    NOT NULL DEFAULT 0,
    playtime_sec    BIGINT NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,                 -- miękkie usuwanie

    CHECK (hp <= max_hp AND mp <= max_mp)
);
CREATE UNIQUE INDEX ux_characters_name ON characters (realm_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX ix_characters_account ON characters (account_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_characters_ranking ON characters (level DESC, exp DESC) WHERE deleted_at IS NULL;

CREATE TABLE character_skills (
    character_id BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    skill_id     SMALLINT NOT NULL REFERENCES skills(id),
    rank         SMALLINT NOT NULL DEFAULT 1 CHECK (rank >= 1),
    learned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, skill_id)
);

-- Pasek skrótów (klawisze 1-6)
CREATE TABLE character_hotbar (
    character_id BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    slot_no      SMALLINT NOT NULL CHECK (slot_no BETWEEN 1 AND 6),
    skill_id     SMALLINT NOT NULL REFERENCES skills(id),
    PRIMARY KEY (character_id, slot_no)
);

-- Historia zdarzeń postaci (awanse, zakupy, zgony, questy...)
CREATE TABLE character_events (
    id           BIGSERIAL PRIMARY KEY,
    character_id BIGINT      NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    event_type   VARCHAR(24) NOT NULL,   -- level_up, death, quest_done, drop, purchase...
    message      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_char ON character_events (character_id, created_at DESC);

-- =====================================================================
--  5. PRZEDMIOTY I EKWIPUNEK
-- =====================================================================

-- Szablony przedmiotów (katalog)
CREATE TABLE items (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(32) NOT NULL UNIQUE,
    name           VARCHAR(80) NOT NULL,
    description    TEXT,
    slot           VARCHAR(12) NOT NULL REFERENCES item_slots(code),
    rarity_id      SMALLINT    NOT NULL REFERENCES rarities(id),
    required_level SMALLINT    NOT NULL DEFAULT 1 CHECK (required_level BETWEEN 1 AND 50),
    class_id       SMALLINT    REFERENCES classes(id),   -- NULL = każda klasa

    atk INT NOT NULL DEFAULT 0,  def INT NOT NULL DEFAULT 0,
    hp  INT NOT NULL DEFAULT 0,  mp  INT NOT NULL DEFAULT 0,
    str INT NOT NULL DEFAULT 0,  dex INT NOT NULL DEFAULT 0, int INT NOT NULL DEFAULT 0,
    crit_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,

    heal_hp    INT NOT NULL DEFAULT 0,     -- mikstury
    heal_mp    INT NOT NULL DEFAULT 0,
    bag_slots  SMALLINT NOT NULL DEFAULT 0, -- torby

    stackable  BOOLEAN NOT NULL DEFAULT FALSE,
    max_stack  SMALLINT NOT NULL DEFAULT 1,
    tradeable  BOOLEAN NOT NULL DEFAULT TRUE,
    buy_price  INT NOT NULL DEFAULT 0,     -- 0 = nie do kupienia w sklepie
    sell_price INT NOT NULL DEFAULT 0
);
CREATE INDEX ix_items_level ON items (required_level, rarity_id);

-- Efekty specjalne przedmiotu, np. „Szansa podpalenia: 8%”
CREATE TABLE item_effects (
    item_id      INT         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    effect_code  VARCHAR(16) NOT NULL REFERENCES effect_types(code),
    chance_pct   NUMERIC(5,2) NOT NULL CHECK (chance_pct BETWEEN 0 AND 100),
    magnitude    NUMERIC(8,2) NOT NULL DEFAULT 0,   -- np. obrażenia/tyk albo % kradzieży
    duration_sec NUMERIC(5,1) NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, effect_code)
);

-- Losowe afiksy (bonusy z dropu)
CREATE TABLE affix_types (
    code     VARCHAR(8) PRIMARY KEY,
    name     VARCHAR(40) NOT NULL,
    min_roll INT NOT NULL,
    max_roll INT NOT NULL,
    is_pct   BOOLEAN NOT NULL DEFAULT FALSE
);

-- Konkretne egzemplarze przedmiotów należące do postaci
CREATE TABLE character_items (
    id             BIGSERIAL PRIMARY KEY,
    character_id   BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    item_id        INT      NOT NULL REFERENCES items(id),
    quantity       INT      NOT NULL DEFAULT 1 CHECK (quantity > 0),
    equipped_slot  VARCHAR(12) REFERENCES equip_slots(code),  -- NULL = w plecaku
    bag_index      SMALLINT,                                  -- pozycja w plecaku
    acquired_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    source         VARCHAR(16) NOT NULL DEFAULT 'drop'
                   CHECK (source IN ('drop','shop','quest','chest','craft','admin')),
    CHECK (NOT (equipped_slot IS NOT NULL AND bag_index IS NOT NULL))
);
-- jedna rzecz na slot, jedna rzecz na pozycję plecaka
CREATE UNIQUE INDEX ux_char_equipped ON character_items (character_id, equipped_slot) WHERE equipped_slot IS NOT NULL;
CREATE UNIQUE INDEX ux_char_bag_pos  ON character_items (character_id, bag_index)     WHERE bag_index IS NOT NULL;
CREATE INDEX ix_char_items_char ON character_items (character_id);

CREATE TABLE character_item_affixes (
    character_item_id BIGINT      NOT NULL REFERENCES character_items(id) ON DELETE CASCADE,
    affix_code        VARCHAR(8)  NOT NULL REFERENCES affix_types(code),
    value             INT         NOT NULL,
    PRIMARY KEY (character_item_id, affix_code)
);

-- =====================================================================
--  6. POTWORY I DROP
-- =====================================================================

CREATE TABLE monsters (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(24) NOT NULL UNIQUE,
    name        VARCHAR(80) NOT NULL,
    kind        VARCHAR(12) NOT NULL,       -- archetyp wizualny: rat, goblin, spider, ghost...
    level       SMALLINT    NOT NULL CHECK (level BETWEEN 1 AND 50),
    hp          INT NOT NULL CHECK (hp > 0),
    atk         INT NOT NULL,
    def         INT NOT NULL DEFAULT 0,
    exp_reward  INT NOT NULL,
    gold_min    INT NOT NULL DEFAULT 0,
    gold_max    INT NOT NULL DEFAULT 0,
    is_elite    BOOLEAN NOT NULL DEFAULT FALSE,
    is_boss     BOOLEAN NOT NULL DEFAULT FALSE,
    night_only  BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    CHECK (gold_max >= gold_min)
);
CREATE INDEX ix_monsters_level ON monsters (level);

-- Tabela dropu
CREATE TABLE monster_drops (
    monster_id  INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    item_id     INT NOT NULL REFERENCES items(id)    ON DELETE CASCADE,
    drop_chance NUMERIC(6,5) NOT NULL CHECK (drop_chance > 0 AND drop_chance <= 1),
    min_qty     SMALLINT NOT NULL DEFAULT 1,
    max_qty     SMALLINT NOT NULL DEFAULT 1,
    PRIMARY KEY (monster_id, item_id),
    CHECK (max_qty >= min_qty)
);

-- Bestiariusz gracza
CREATE TABLE character_bestiary (
    character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    monster_id    INT    NOT NULL REFERENCES monsters(id),
    kills         INT    NOT NULL DEFAULT 0,
    first_kill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, monster_id)
);

-- =====================================================================
--  7. INSTANCJE
-- =====================================================================

CREATE TABLE instances (
    id             SMALLSERIAL PRIMARY KEY,
    code           VARCHAR(24) NOT NULL UNIQUE,
    name           VARCHAR(60) NOT NULL,
    description    TEXT,
    required_level SMALLINT    NOT NULL CHECK (required_level BETWEEN 1 AND 50),
    boss_id        INT         NOT NULL REFERENCES monsters(id),
    map_code       VARCHAR(24)
);

-- Grupy potworów w instancji (przed bossem)
CREATE TABLE instance_monsters (
    instance_id SMALLINT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    monster_id  INT      NOT NULL REFERENCES monsters(id),
    wave        SMALLINT NOT NULL DEFAULT 1,
    count_min   SMALLINT NOT NULL DEFAULT 1,
    count_max   SMALLINT NOT NULL DEFAULT 3,
    PRIMARY KEY (instance_id, monster_id, wave),
    CHECK (count_max >= count_min)
);

-- Przejścia instancji przez graczy
CREATE TABLE instance_runs (
    id            BIGSERIAL PRIMARY KEY,
    character_id  BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    instance_id   SMALLINT NOT NULL REFERENCES instances(id),
    difficulty_id SMALLINT NOT NULL REFERENCES difficulties(id),
    status        VARCHAR(12) NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','completed','failed','abandoned')),
    current_wave  SMALLINT NOT NULL DEFAULT 1,
    monsters_killed INT    NOT NULL DEFAULT 0,
    exp_gained    BIGINT   NOT NULL DEFAULT 0,
    gold_gained   BIGINT   NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX ix_runs_char ON instance_runs (character_id, started_at DESC);
-- jedna aktywna instancja na postać
CREATE UNIQUE INDEX ux_runs_active ON instance_runs (character_id) WHERE status = 'in_progress';

-- Rekordy: najlepsze ukończenia
CREATE TABLE character_instance_clears (
    character_id  BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    instance_id   SMALLINT NOT NULL REFERENCES instances(id),
    difficulty_id SMALLINT NOT NULL REFERENCES difficulties(id),
    clears        INT      NOT NULL DEFAULT 1,
    best_time_sec INT,
    last_clear_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, instance_id, difficulty_id)
);

-- =====================================================================
--  8. WALKA (turowa)
-- =====================================================================

CREATE TABLE combats (
    id             BIGSERIAL PRIMARY KEY,
    character_id   BIGINT   NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    monster_id     INT      NOT NULL REFERENCES monsters(id),
    instance_run_id BIGINT  REFERENCES instance_runs(id) ON DELETE SET NULL,
    difficulty_id  SMALLINT REFERENCES difficulties(id),
    status         VARCHAR(8) NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost','fled')),
    -- statystyki potwora w tej walce (po mnożnikach trudności)
    monster_max_hp INT NOT NULL, monster_hp INT NOT NULL,
    monster_atk    INT NOT NULL, monster_def INT NOT NULL,
    player_hp_start INT NOT NULL, player_hp_end INT,
    turns          INT NOT NULL DEFAULT 0,
    exp_gained     INT NOT NULL DEFAULT 0,
    gold_gained    INT NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at       TIMESTAMPTZ
);
CREATE INDEX ix_combats_char ON combats (character_id, started_at DESC);
CREATE UNIQUE INDEX ux_combat_active ON combats (character_id) WHERE status = 'active';

CREATE TABLE combat_turns (
    id            BIGSERIAL PRIMARY KEY,
    combat_id     BIGINT   NOT NULL REFERENCES combats(id) ON DELETE CASCADE,
    turn_no       INT      NOT NULL,
    actor         VARCHAR(8)  NOT NULL CHECK (actor IN ('player','monster')),
    action        VARCHAR(12) NOT NULL CHECK (action IN ('attack','skill','potion','special_item','counter','flee')),
    skill_id      SMALLINT REFERENCES skills(id),
    item_id       INT      REFERENCES items(id),
    damage        INT NOT NULL DEFAULT 0,
    healing       INT NOT NULL DEFAULT 0,
    is_crit       BOOLEAN NOT NULL DEFAULT FALSE,
    effect_code   VARCHAR(16) REFERENCES effect_types(code),
    player_hp_after  INT NOT NULL,
    monster_hp_after INT NOT NULL,
    UNIQUE (combat_id, turn_no, actor)
);

-- =====================================================================
--  9. QUESTY
-- =====================================================================

CREATE TABLE quests (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(24) NOT NULL UNIQUE,
    name         VARCHAR(80) NOT NULL,
    description  TEXT,
    giver_npc    VARCHAR(30),
    min_level    SMALLINT NOT NULL DEFAULT 1,
    quest_type   VARCHAR(8) NOT NULL CHECK (quest_type IN ('kill','collect','boss')),
    target_count INT NOT NULL DEFAULT 1,
    reward_gold  INT NOT NULL DEFAULT 0,
    reward_exp   INT NOT NULL DEFAULT 0,
    reward_item_id INT REFERENCES items(id)
);

-- Potwory zaliczane do celu questa (kill / boss)
CREATE TABLE quest_targets (
    quest_id   INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    monster_id INT NOT NULL REFERENCES monsters(id),
    PRIMARY KEY (quest_id, monster_id)
);

CREATE TABLE character_quests (
    character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    quest_id     INT    NOT NULL REFERENCES quests(id),
    status       VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
    progress     INT    NOT NULL DEFAULT 0,
    accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (character_id, quest_id)
);

-- =====================================================================
--  10. FUNKCJE I TRIGGERY
-- =====================================================================

-- Auto-aktualizacja accounts.updated_at
CREATE FUNCTION trg_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- Limit postaci na konto (accounts.max_characters, domyślnie 3) w obrębie świata
CREATE FUNCTION trg_limit_characters() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max INT; v_cnt INT;
BEGIN
    SELECT max_characters INTO v_max FROM accounts WHERE id = NEW.account_id FOR UPDATE;
    SELECT count(*) INTO v_cnt FROM characters
     WHERE account_id = NEW.account_id AND realm_id = NEW.realm_id AND deleted_at IS NULL;
    IF v_cnt >= v_max THEN
        RAISE EXCEPTION 'Limit % postaci na świat został osiągnięty', v_max
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER characters_limit BEFORE INSERT ON characters
    FOR EACH ROW EXECUTE FUNCTION trg_limit_characters();

-- Tworzenie postaci: statystyki z klasy + pierwsza umiejętność + mikstura
CREATE FUNCTION create_character(p_account BIGINT, p_realm VARCHAR, p_name VARCHAR, p_class_code VARCHAR)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE c classes%ROWTYPE; v_id BIGINT; v_sk SMALLINT; v_potion INT;
BEGIN
    SELECT * INTO c FROM classes WHERE code = p_class_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nieznana klasa: %', p_class_code; END IF;

    INSERT INTO characters (account_id, realm_id, name, class_id,
                            hp, max_hp, mp, max_mp, atk, def, str, dex, int, skill_points)
    VALUES (p_account, p_realm, p_name, c.id,
            c.base_hp, c.base_hp, c.base_mp, c.base_mp, c.base_atk, c.base_def,
            c.base_str, c.base_dex, c.base_int, 1)
    RETURNING id INTO v_id;

    SELECT id INTO v_potion FROM items WHERE code = 'potion1';
    IF v_potion IS NOT NULL THEN
        INSERT INTO character_items (character_id, item_id, quantity, bag_index, source)
        VALUES (v_id, v_potion, 1, 0, 'admin');
    END IF;

    INSERT INTO character_events (character_id, event_type, message)
    VALUES (v_id, 'created', 'Postać ' || p_name || ' (' || c.name || ') wkracza do Królestwa Cieni.');
    RETURN v_id;
END $$;

-- Przyznawanie EXP + automatyczny awans (do poziomu 50)
-- Zwraca nowy poziom.
CREATE FUNCTION grant_exp(p_char BIGINT, p_amount BIGINT) RETURNS SMALLINT LANGUAGE plpgsql AS $$
DECLARE ch characters%ROWTYPE; cl classes%ROWTYPE; need BIGINT; lv SMALLINT; ups INT := 0;
BEGIN
    SELECT * INTO ch FROM characters WHERE id = p_char FOR UPDATE;
    SELECT * INTO cl FROM classes WHERE id = ch.class_id;
    ch.exp := ch.exp + GREATEST(p_amount, 0);

    LOOP
        EXIT WHEN ch.level >= 50;
        SELECT exp_to_next INTO need FROM level_exp WHERE level = ch.level;
        EXIT WHEN ch.exp < need;
        ch.exp   := ch.exp - need;
        ch.level := ch.level + 1;
        ch.max_hp := ch.max_hp + cl.hp_per_level;   ch.max_mp := ch.max_mp + cl.mp_per_level;
        ch.atk := ch.atk + cl.atk_per_level;        ch.def := ch.def + cl.def_per_level;
        ch.str := ch.str + cl.str_per_level;        ch.dex := ch.dex + cl.dex_per_level;
        ch.int := ch.int + cl.int_per_level;
        ch.skill_points := ch.skill_points + 1;
        ch.hp := ch.max_hp;  ch.mp := ch.max_mp;     -- pełne leczenie przy awansie
        ups := ups + 1;
        INSERT INTO character_events (character_id, event_type, message)
        VALUES (p_char, 'level_up', 'Awans na poziom ' || ch.level || '!');
    END LOOP;

    IF ch.level >= 50 THEN ch.exp := 0; END IF;   -- na maksie EXP nie rośnie

    UPDATE characters SET level = ch.level, exp = ch.exp,
           max_hp = ch.max_hp, max_mp = ch.max_mp, hp = ch.hp, mp = ch.mp,
           atk = ch.atk, def = ch.def, str = ch.str, dex = ch.dex, int = ch.int,
           skill_points = ch.skill_points
     WHERE id = p_char;
    RETURN ch.level;
END $$;

-- Zaliczenie zabicia potwora: bestiariusz, licznik, postęp questów
CREATE FUNCTION record_kill(p_char BIGINT, p_monster INT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE characters SET monsters_killed = monsters_killed + 1 WHERE id = p_char;

    INSERT INTO character_bestiary (character_id, monster_id, kills)
    VALUES (p_char, p_monster, 1)
    ON CONFLICT (character_id, monster_id) DO UPDATE SET kills = character_bestiary.kills + 1;

    UPDATE character_quests cq
       SET progress = LEAST(cq.progress + 1, q.target_count),
           status = CASE WHEN cq.progress + 1 >= q.target_count THEN 'completed' ELSE cq.status END,
           completed_at = CASE WHEN cq.progress + 1 >= q.target_count THEN now() END
      FROM quests q
     WHERE cq.quest_id = q.id AND cq.character_id = p_char AND cq.status = 'active'
       AND EXISTS (SELECT 1 FROM quest_targets t WHERE t.quest_id = q.id AND t.monster_id = p_monster);
END $$;

-- =====================================================================
--  11. WIDOKI
-- =====================================================================

CREATE VIEW v_character_summary AS
SELECT ch.id, a.username, ch.realm_id, ch.name, cl.name AS class, ch.level, ch.exp,
       le.exp_to_next, ch.gold, ch.hp, ch.max_hp, ch.mp, ch.max_mp,
       ch.atk, ch.def, ch.str, ch.dex, ch.int, ch.skill_points,
       ch.monsters_killed, ch.deaths, ch.last_saved_at
  FROM characters ch
  JOIN accounts a  ON a.id = ch.account_id
  JOIN classes  cl ON cl.id = ch.class_id
  JOIN level_exp le ON le.level = ch.level
 WHERE ch.deleted_at IS NULL;

CREATE VIEW v_ranking AS
SELECT row_number() OVER (PARTITION BY realm_id ORDER BY level DESC, exp DESC, id) AS place,
       realm_id, name, class, level, exp, monsters_killed
  FROM v_character_summary;

CREATE VIEW v_monster_drops AS
SELECT m.name AS monster, m.level AS monster_level, i.name AS item, r.name AS rarity,
       d.drop_chance, d.min_qty, d.max_qty
  FROM monster_drops d
  JOIN monsters m ON m.id = d.monster_id
  JOIN items    i ON i.id = d.item_id
  JOIN rarities r ON r.id = i.rarity_id;

CREATE VIEW v_inventory AS
SELECT ci.character_id, ci.id AS character_item_id, i.name, r.name AS rarity, i.slot,
       ci.quantity, ci.equipped_slot, ci.bag_index,
       (SELECT string_agg(af.name || ' +' || cia.value || CASE WHEN af.is_pct THEN '%' ELSE '' END, ', ')
          FROM character_item_affixes cia JOIN affix_types af ON af.code = cia.affix_code
         WHERE cia.character_item_id = ci.id) AS affixes
  FROM character_items ci
  JOIN items i ON i.id = ci.item_id
  JOIN rarities r ON r.id = i.rarity_id;

COMMIT;
