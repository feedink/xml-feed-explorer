const CHANGELOG = [
  { version: '1.8', date: '20.08.2026', changes: [
    'Import reguł wykluczających z innego systemu (przycisk „Importuj reguły" + modal)',
    'Automatyczne mapowanie operatorów i dopasowanie pól z podpowiedzią przy niezgodnych nazwach',
    'Dołączanie kolejnych importów do bieżącego filtra przez OR',
    'Rozkład wyników per filtr (gałęzie OR) — liczniki i podgląd rekordów pojedynczej gałęzi',
    'Przełącznik wartość/lista w warunkach zmieniony na ikonki z tooltipem',
  ]},
  { version: '1.7', date: '19.08.2026', changes: [
    'Pełny eksport XML/XLSX powyżej limitu 250k rekordów',
    'Duplikowanie bloków filtra (przycisk obok usuwania)',
    'Multiline wartości w filtrach — wklej wiele ID/wartości (limit 500 linii)',
  ]},
  { version: '1.6', date: '19.08.2026', changes: [
    'Limit wyświetlania 250k rekordów w UI (ochrona przed crashem przeglądarki)',
    'Informacja o pełnej liczbie pasujących rekordów powyżej limitu',
  ]},
  { version: '1.5', date: '18.08.2026', changes: [
    'Early open — podgląd projektu po pierwszych 200 rekordach, reszta indeksowana w tle',
    'Anulowanie indeksowania z zachowaniem dotychczas wstawionych danych',
  ]},
  { version: '1.4', date: '18.08.2026', changes: [
    'Automatyczne wykrywanie tagu produktu przy imporcie (skan pierwszych 10 MB)',
    'Aktualizacja feedu z zachowaniem zapisanych filtrów',
  ]},
  { version: '1.3', date: '17.08.2026', changes: [
    'Zapisywanie i odtwarzanie filtrów między sesjami',
    'Persystencja widocznych kolumn i aktywnego filtra w projekcie',
    'Hash routing — refresh strony przywraca otwarty projekt',
  ]},
  { version: '1.2', date: '17.08.2026', changes: [
    'Tryb Stream dla plików >= 1 GB (strumieniowanie z dysku)',
    'Zmiana nazwy projektu inline w headerze',
    'Usuwanie wszystkich danych z potwierdzeniem',
  ]},
  { version: '1.1', date: '16.08.2026', changes: [
    'Eksport do XLSX (SheetJS)',
    'Eksport pojedynczego rekordu do XML',
    'Szybkie wyszukiwanie po id/title/url w załadowanych wynikach',
    'Sortowanie kolumn w tabeli',
  ]},
  { version: '1.0', date: '16.08.2026', changes: [
    'Import feedów XML (Google Shopping i podobne)',
    'Przeglądarka rekordów z paginacją i panelem szczegółów',
    'Drzewo filtrów AND/OR z zagnieżdżonymi grupami',
    'Eksport wyników do XML',
    'IndexedDB jako cache danych per projekt',
  ]},
];
