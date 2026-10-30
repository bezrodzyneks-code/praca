# ⚔️ Królestwo Cieni — backend

Serwer API + WebSocket (Node.js, Express, PostgreSQL) dla Twojej gry. Gra jest już w `public/index.html`,
więc serwer wystawia ją pod tym samym adresem — nic nie trzeba konfigurować po stronie klienta.

## Szybki start

```bash
# 1. Baza (Docker) — schemat i dane startowe załadują się same
docker compose up -d

# 2. Serwer
cp .env.example .env
npm install
npm start
```

Otwórz **http://localhost:8080**, wybierz zakładkę *Online*, załóż konto i graj.
W polu adresu serwera wpisz `http://localhost:8080`.

### Bez Dockera
```bash
createdb krolestwo
psql -d krolestwo -f db/01_schema.sql
psql -d krolestwo -f db/02_seed.sql
psql -d krolestwo -f db/03_migration.sql
```
i ustaw `DATABASE_URL` w `.env`.

## Co jest zaimplementowane

| Funkcja | Endpoint |
|---|---|
| Rejestracja (bcrypt, koszt 12) | `POST /api/register` |
| Logowanie / wylogowanie | `POST /api/login`, `POST /api/logout` |
| Sesje (w bazie tylko SHA-256 tokenu, ważne 30 dni) | nagłówek `Authorization: Bearer …` |
| Profil + zmiana hasła | `GET/POST /api/me` |
| Lista światów + liczba graczy online | `GET /api/realms` |
| Postacie (lista, tworzenie, wczytanie, usunięcie) | `/api/characters…` |
| Zapis gry (JSON + statystyki w kolumnach + bestiariusz) | `POST /api/characters/:id/save` |
| Ranking | `GET /api/ranking?realm=cienie` |
| Multiplayer: pozycje, czat (`/g`, `/w nick`), lista graczy, wspólne walki | WebSocket `/ws` |

Limity: logowanie 15 prób/min, rejestracja 10/min na IP; czat max 1 wiadomość na 0,7 s.

## Ważne ograniczenia

- **Klient jest autorytatywny.** Gra liczy walkę i EXP w przeglądarce, a serwer zapisuje to, co dostanie
  (z walidacją zakresów, ale bez weryfikacji, czy wynik jest uczciwy). Żeby zablokować oszustów,
  trzeba przenieść walkę i dropy na serwer — tabele `combats`, `combat_turns` i `monster_drops` są na to gotowe.
- Klasa **Łotr** z gry jest w bazie zapisana jako **Łucznik** (kod `archer`); serwer tłumaczy nazwy w obie strony.
- Cała baza jest w schemacie `kc`.
- W produkcji: postaw serwer za HTTPS (np. nginx/Caddy — WebSocket przejdzie jako `wss://`) i ustaw `CORS_ORIGIN`.

## Gra z innego urządzenia w tej samej sieci (LAN)

1. Uruchom serwer — w konsoli zobaczysz linię `Inne urządzenia (Wi-Fi): http://192.168.x.x:8080`.
2. Windows: otwórz port w zaporze (PowerShell **jako administrator**):
   `netsh advfirewall firewall add rule name="Krolestwo Cieni" dir=in action=allow protocol=TCP localport=8080 profile=private`
   Sieć Wi-Fi musi być ustawiona jako **Prywatna** (Ustawienia → Sieć → Wi-Fi → właściwości).
3. Na telefonie / drugim komputerze (ten sam Wi-Fi) wpisz w przeglądarce ten adres IP z konsoli.

## Panel administratora

Pełny panel zarządzania (konta, postacie, potwory, przedmioty, instancje, ekonomia, eventy, aktualizacje, logi, raporty, ustawienia) pod `/admin/`. Instrukcja uruchomienia i opis funkcji: **[ADMIN.md](ADMIN.md)**.
