# 🛡️ Panel administratora — Królestwo Cieni

Panel działa pod adresem **http://localhost:8080/admin/** (ten sam serwer co gra).

## Uruchomienie (jednorazowo)

1. **Dodaj tabele panelu do bazy** (plik `db/04_admin.sql`; wymaga wcześniejszych `01`–`03`):
   ```bash
   # Docker (baza już istnieje, więc init nie uruchomi się drugi raz):
   docker compose exec -T db psql -U kc -d krolestwo < db/04_admin.sql
   # albo lokalny PostgreSQL:
   psql -U kc -d krolestwo -f db/04_admin.sql
   ```
   Na świeżej bazie (`docker compose down -v && docker compose up -d`) wszystko załaduje się samo.
2. **Utwórz konto administratora**:
   ```bash
   npm run make-admin -- TwojLogin TwojeHaslo          # nowe konto z rolą admin
   npm run make-admin -- IstniejacyLogin               # awans istniejącego konta
   npm run make-admin -- Login "" moderator            # rola moderatora
   ```
3. Uruchom serwer (`npm start`) i wejdź na `/admin/`.

## Role

| Rola | Uprawnienia |
|---|---|
| **Administrator** | wszystko |
| **Moderator** | pulpit, raporty, logi, podgląd użytkowników i postaci, **bany / odbanowanie / wyrzucanie graczy** (tylko kont zwykłych graczy) |
| **Gracz** | brak dostępu — logowanie do panelu kończy się komunikatem o braku uprawnień |

## Mapowanie na przypadki użycia z dokumentacji

| UC | Funkcja | Zakładka panelu |
|---|---|---|
| 10 | Logowanie do panelu + weryfikacja uprawnień | ekran logowania |
| 11 | Dodawanie / usuwanie kont, edycja danych, reset hasła, blokada | **Użytkownicy** |
| 12 | Edycja statystyk, zmiana klasy, usuwanie postaci | **Postacie** |
| 13 | Dodawanie i edycja potworów (+ tabela dropu) | **Potwory** |
| 14 | Dodawanie i edycja instancji, potworów w falach, trudności | **Instancje** |
| 15 | Dodawanie przedmiotów, edycja statystyk, ustawianie rzadkości, efekty | **Przedmioty** |
| 16 | Modyfikacja nagród: mnożniki EXP / złota / dropu, reguły światów | **Ekonomia** |
| 17 | Monitoring graczy, logi systemowe, raporty (CSV) | **Pulpit**, **Logi**, **Raporty** |
| 18 | Eventy czasowe i publikacja aktualizacji (patch notes) | **Eventy**, **Aktualizacje** |
| 19 | Ustawienia serwera, bany, tryb konserwacji, ogłoszenia | **Ustawienia** |

## Jak zmiany trafiają do gry

- **Mnożniki EXP / złota / dropu** (ekonomia + reguły świata + aktywne eventy) są liczone na serwerze i wysyłane graczowi przy wejściu do świata. Gracze online dostają komunikat na czacie i muszą wejść ponownie, aby nowe wartości zadziałały.
- **Potwory i przedmioty z gry** (HP, atak, EXP, złoto, nazwy, obrażenia, obrona, ceny) są pobierane z `GET /api/config` i nadpisują wartości domyślne w kliencie. Zmiany działają dla nowo pojawiających się potworów.
- **Edycja postaci** zapisuje zmiany w kolumnach **i** w zapisie gry (`save_data`), po czym rozłącza gracza. Zapis ze starej karty przeglądarki jest odrzucany (błąd 409), żeby nie nadpisał zmian admina.
- **Tryb konserwacji** wyrzuca graczy i blokuje logowanie zwykłych kont (admini i moderatorzy mogą wejść). Komunikat pokazuje się też na ekranie logowania gry.
- **Eventy** włączają się i wyłączają automatycznie według harmonogramu; gracze widzą je na ekranie logowania i na czacie.
- Każda akcja administratora trafia do **dziennika działań** (zakładka Logi → Dziennik administratorów).

## Ograniczenia

- Potwory i przedmioty **dodane** w panelu istnieją w bazie (instancje, drop, bestiariusz), ale gra w przeglądarce ma własne mapy i katalog — nowy potwór nie pojawi się sam na mapie, dopóki nie zostanie dodany w kodzie klienta.
- Walka nadal liczy się w przeglądarce (klient jest autorytatywny) — panel nie wykrywa oszustw.
