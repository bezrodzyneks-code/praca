-- =====================================================================
--  Panel administratora: ustawienia, logi, audyt, eventy, aktualizacje
--  Uruchom po 01, 02 i 03:  psql -d krolestwo -f db/04_admin.sql
-- =====================================================================
SET search_path = kc, public;

-- ---------- Czasowe bany i wymuszenie przeładowania postaci ----------
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;   -- NULL + is_banned = ban permanentny
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS banned_at    TIMESTAMPTZ;
-- Gdy admin zmieni postać, zapis z przeglądarki gracza nie może jej nadpisać
ALTER TABLE characters ADD COLUMN IF NOT EXISTS force_reload BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------- Ustawienia (klucz → JSON) ----------
CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(40) PRIMARY KEY,
    value       JSONB       NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  BIGINT REFERENCES accounts(id) ON DELETE SET NULL
);

INSERT INTO settings (key, value, description) VALUES
 ('economy', '{"exp":1,"gold":1,"drop":1}',
    'Globalne mnożniki: EXP, złoto, szansa na drop (mnożą się z regułami świata i eventami).'),
 ('server',  '{"maintenance":false,"maintenance_msg":"Trwają prace techniczne. Zapraszamy za chwilę.","registration_open":true,"motd":"","chat_enabled":true}',
    'Ustawienia serwera: tryb konserwacji, rejestracja, wiadomość dnia, czat.')
ON CONFLICT (key) DO NOTHING;

-- ---------- Dziennik działań administratorów ----------
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    admin_id    BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    admin_name  VARCHAR(24) NOT NULL,
    action      VARCHAR(40) NOT NULL,        -- np. user.ban, item.update, economy.update
    target_type VARCHAR(20),
    target_id   TEXT,
    details     JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_admin   ON admin_audit_log (admin_id);

-- ---------- Logi systemowe ----------
CREATE TABLE IF NOT EXISTS system_logs (
    id         BIGSERIAL PRIMARY KEY,
    level      VARCHAR(5)  NOT NULL CHECK (level IN ('info','warn','error')),
    source     VARCHAR(16) NOT NULL,         -- auth, server, admin, game, db
    message    TEXT        NOT NULL,
    meta       JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_syslog_created ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_syslog_level   ON system_logs (level, created_at DESC);

-- ---------- Eventy czasowe (podwójny EXP itp.) ----------
CREATE TABLE IF NOT EXISTS game_events (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    description TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    exp_mult    NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (exp_mult  BETWEEN 0.1 AND 10),
    gold_mult   NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (gold_mult BETWEEN 0.1 AND 10),
    drop_mult   NUMERIC(4,2) NOT NULL DEFAULT 1 CHECK (drop_mult BETWEEN 0.1 AND 10),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by  BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS ix_events_time ON game_events (starts_at, ends_at);

-- ---------- Aktualizacje / patch notes ----------
CREATE TABLE IF NOT EXISTS game_updates (
    id           SERIAL PRIMARY KEY,
    version      VARCHAR(20) NOT NULL,
    title        VARCHAR(120) NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    status       VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    published_at TIMESTAMPTZ,
    created_by   BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO game_updates (version, title, body, status, published_at)
SELECT '1.0.0', 'Start Królestwa Cieni',
       'Pierwsza wersja online: konta, trzy klasy, instancje, czat i multiplayer.', 'published', now()
 WHERE NOT EXISTS (SELECT 1 FROM game_updates);

-- Widok: aktualnie aktywne eventy
CREATE OR REPLACE VIEW v_active_events AS
SELECT * FROM game_events WHERE is_active AND now() BETWEEN starts_at AND ends_at;
