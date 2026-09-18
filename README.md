# ⚔️ Królestwo Cieni

**Królestwo Cieni** to przeglądarkowa gra RPG, w której gracz rozwija swoją postać od 1 do 50 poziomu, walczy z potworami, zdobywa doświadczenie oraz przedmioty i przechodzi coraz trudniejsze instancje.

## 🎮 Główne funkcje

### 👤 System kont
- Rejestracja użytkownika
- Logowanie
- Wylogowanie
- Bezpieczne hashowanie haseł
- Profil gracza
- Edycja podstawowych danych
- System sesji

### 🧙 Postać
Gracz może wybrać jedną z trzech klas:

- ⚔️ Wojownik
- 🏹 Łucznik
- 🔮 Mag

Każda klasa posiada własne:
- statystyki,
- umiejętności,
- wyposażenie,
- sposób walki.

Maksymalny poziom postaci: **50**.

### 📈 Rozwój postaci

Za pokonywanie potworów i wykonywanie zadań gracz otrzymuje EXP.

Po zdobyciu odpowiedniej ilości EXP postać awansuje na kolejny poziom.

Podczas rozwoju zwiększają się m.in.:

- HP
- atak
- obrona
- siła
- zręczność
- inteligencja

### 👹 System potworów

Każdy potwór posiada:

- nazwę,
- poziom,
- HP,
- atak,
- obronę,
- ilość przyznawanego EXP,
- ilość złota,
- tabelę możliwego dropu.

Przykładowe potwory:

| Potwór | Poziom |
|---|---:|
| Szczur | 1 |
| Goblin | 5 |
| Zombie | 10 |
| Pająk | 15 |
| Królowa Pająków | 20 |
| Demon | 30 |
| Smok Cienia | 40 |
| Władca Ciemności | 50 |

### ⚔️ System walki

Gracz może zaatakować potwora.

Walka może przebiegać w turach:

1. Gracz wybiera akcję.
2. Postać wykonuje atak.
3. Potwór wykonuje kontratak.
4. System sprawdza HP.
5. Walka kończy się zwycięstwem lub porażką.

Gracz może używać:

- zwykłego ataku,
- umiejętności,
- mikstur,
- przedmiotów specjalnych.

### 🏰 Instancje

Instancje są specjalnymi lokacjami zawierającymi grupy potworów oraz bossa.

Przykładowe instancje:

| Instancja | Wymagany poziom | Boss |
|---|---:|---|
| Kopalnia Goblinów | 5 | Wódz Goblinów |
| Krypta Umarłych | 10 | Nekromanta |
| Pajęcza Grota | 20 | Królowa Arachnidów |
| Zamek Demonów | 30 | Książę Piekieł |
| Smocze Pustkowie | 40 | Smok Popiołu |
| Otchłań | 50 | Władca Ciemności |

Każda instancja może posiadać trzy poziomy trudności:

- Normalny
- Trudny
- Piekielny

Wyższy poziom trudności zwiększa ryzyko, ale pozwala zdobyć lepsze nagrody.

### 🎒 Ekwipunek

Przedmioty posiadają różne statystyki i poziomy rzadkości:

- ⚪ Zwykły
- 🟢 Rzadki
- 🔵 Magiczny
- 🟣 Epicki
- 🟠 Legendarny

Przykładowy przedmiot:

```text
Miecz Płomienia

Wymagany poziom: 20
Obrażenia: +85
Siła: +12
Szansa podpalenia: 8%

Rzadkość: LEGENDARNY