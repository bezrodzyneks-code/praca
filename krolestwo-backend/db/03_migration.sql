-- Dodatki potrzebne backendowi (uruchamiane po 01 i 02)
SET search_path = kc, public;

-- Pełny zapis stanu gry wysyłany przez klienta (ekwipunek, mapa, questy, umiejętności...)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS save_data JSONB;

-- Reguły świata widoczne w kliencie: EXP ×, Łupy ×, kara za śmierć
ALTER TABLE realms ADD COLUMN IF NOT EXISTS drop_rate     NUMERIC(4,2) NOT NULL DEFAULT 1.00;
ALTER TABLE realms ADD COLUMN IF NOT EXISTS death_penalty NUMERIC(3,2) NOT NULL DEFAULT 0.10;

UPDATE realms SET exp_rate = 1.0, drop_rate = 1.0, death_penalty = 0.10 WHERE id = 'cienie';
UPDATE realms SET exp_rate = 0.8, drop_rate = 1.5, death_penalty = 0.25, max_players = 200 WHERE id = 'mrok';
