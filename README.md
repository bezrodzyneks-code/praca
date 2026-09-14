Projekt Python – aplikacja z bazą danych
Opis projektu

Projekt przedstawia aplikację stworzoną w języku Python, której głównym zadaniem jest obsługa i przechowywanie danych w bazie danych.

Aplikacja składa się z głównego programu oraz modułu odpowiedzialnego za komunikację z bazą danych. Użytkownik może wykonywać operacje na danych za pomocą przygotowanego interfejsu aplikacji.

Projekt został wykonany w celach edukacyjnych w ramach nauki programowania, obsługi baz danych oraz pracy z systemem kontroli wersji Git.

Technologie
Python – główny język programowania
SQLite – baza danych
Git – system kontroli wersji
GitHub – przechowywanie i udostępnianie kodu źródłowego
Struktura projektu
praca/
├── main.py          # główny plik programu
├── database.py      # obsługa połączenia z bazą danych
├── database.db      # baza danych
└── README.md        # dokumentacja projektu

Baza danych

Aplikacja korzysta z bazy danych SQLite, która umożliwia przechowywanie danych lokalnie w pliku database.db.

Za komunikację z bazą danych odpowiada osobny moduł database.py. Dzięki temu kod odpowiedzialny za obsługę danych jest oddzielony od głównej logiki programu.

Uruchomienie projektu

Aby uruchomić aplikację, należy posiadać zainstalowanego Pythona.

Następnie należy sklonować repozytorium:

git clone https://github.com/bezrodzyneks-code/praca.git


Przejść do katalogu projektu:

cd praca


Uruchomić program:

python main.py

Autor

Projekt wykonany w ramach nauki programowania w języku Python.

Licencja

Projekt udostępniony jest na licencji MIT.

Pełna treść licencji znajduje się w pliku LICENSE.