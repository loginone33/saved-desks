# Information about Bug Fix / Informacje o naprawie

## Issue / Problem
Podczas próby zapisania biurka (workspace layout), kliknięcie przycisku **Zapisz** w oknie dialogowym nie powodowało żadnej akcji (okno nie zamykało się, a biurko nie było zapisywane).

## Cause / Przyczyna
W logach systemowych GNOME Shell (`journalctl`) występował błąd typu `TypeError`:
`JS ERROR: TypeError: window.get_maximized is not a function`

W nowszych wersjach GNOME Shell / Mutter (GJS):
1. `window.get_maximized()` oraz `window.is_maximized()` nie są dostępne jako metody na obiekcie `Meta.Window`.
2. Stan maksymalizacji okna jest przechowywany w właściwości GObject `window.maximized` (bitmaska flag `Meta.MaximizeFlags`).

Ponieważ wywołanie `window.get_maximized()` zgłaszało nieobsłużony błąd JavaScript wewnątrz funkcji zapisującej `_doSaveCurrentWorkspace`, wykonanie skryptu przerywało się przed zapisaniem pliku i przed zamknięciem okna modalnego.

## Solution / Rozwiązanie
1. **Pobieranie stanu maksymalizacji (`_getMaximizedState`)**:
   - Zastąpiono `window.get_maximized()` bezpiecznym odczytem właściwości `window.maximized` z wywołaniem zastępczym `window.get_maximized()` w razie potrzeby.
2. **Sprawdzanie maksymalizacji (`_isMaximized`)**:
   - Zastąpiono nieistniejące `window.is_maximized()` porównaniem `_getMaximizedState(window) === Meta.MaximizeFlags.BOTH`.
3. **Dodatkowa obsługa błędów (Try-Catch)**:
   - Dodano bloki `try...catch` w oknie modalnym `SaveDeskDialog` oraz w metodzie `getDesks()`, aby ew. błędy były rejestrowane w konsoli bez blokowania interfejsu użytkownika.
4. **Wsparcie dla GNOME Shell 49/50**:
   - Zaktualizowano `metadata.json` o numery wersji `49` i `50`.

---

## Issue 2: Brak przywracania pozycji i rozmiarów okien po załadowaniu biurka

### Przyczyna / Causes
1. **Niezgodność identyfikatorów aplikacji (`appId` / `wmClass`)**:
   - Przy zapisywaniu biurka zapisywane były identyfikatory typu `com.microsoft.Edge.flextop.msedge-...desktop` lub `libreoffice-writer.desktop`.
   - Podczas otwierania nowego okna (`_onWindowCreated`) klasa okna (`wm_class`) wynosiła np. `msedge-...` lub `soffice`. Proste porównanie `appId === pending.appId` zwracało `-1` (brak dopasowania), przez co funkcja przywracania geometrii pomijała okna.
2. **Błąd liczby argumentów w `window.tile()` (GNOME Shell 50)**:
   - Wywołanie `window.tile(Meta.TileMode.LEFT, false)` przekazywało 2 argumenty do funkcji C przyjmującej 1 argument, co w GJS generowało wyjątek i blokowało kafelkowanie okien.
3. **Zdarzenia asynchroniczne przy tworzeniu okien Wayland**:
   - Okna aplikacji GTK/Electron po uruchomieniu renegocjowały swój rozmiar z serwerem Wayland po wyemitowaniu sygnału `window-created`, nadpisując pojedyncze próby pozycjonowania.

### Rozwiązanie / Solution
1. **Wielopoziomowe dopasowywanie okien (`_isWindowMatch`)**:
   - Zbudowano algorytm porównujący `appId`, `wmClass`, `wmClassInstance`, `gtkAppId` oraz `sandboxAppId` (dopasowanie bezpośrednie, bez uwzględniania wielkości liter, bez rozszerzenia `.desktop` oraz po nazwach bazowych).
   - Dodano zapisywanie `wmClass` i `wmClassInstance` podczas zapisywania biurka.
2. **Poprawienie wywołania `window.tile()`**:
   - Usunięto zbędny drugi argument z wywołania `window.tile(mode)` dla zgodności z API GNOME Shell 50.
3. **Sprytny mechanizm uruchamiania aplikacji (`_launchApp`)**:
   - Dodano wyszukiwanie w `AppSystem`, `DesktopAppInfo` oraz w folderze aplikacji użytkownika (`~/.local/share/applications`).
4. **Wielostopniowe aplikowanie geometrii (geometry retry sequence)**:
   - Zaimplementowano sekwencję pozycjonowania okien w interwałach: 0ms, 50ms, 200ms, 500ms, 1000ms i 2000ms, co gwarantuje utrwalenie pozycji i wymiarów okien na sesjach Wayland/X11.

---

## Issue 3: Pomylenie pakietów LibreOffice (Calc vs Writer), PWAs i odkafelkowywanie okien (terminali na środku)

### Przyczyna / Causes
1. **Błąd odczytu metody `window.get_tile_mode()` w GJS**:
   - Odczyt stany kafelkowania jako `window.tile_mode` zwracał `undefined`, ponieważ w GJS jest to metoda `window.get_tile_mode()`.
   - Z tego powodu funkcja `_applyGeometry` przy każdej z ponawianych prób (0ms, 50ms, 200ms...) uznawała okno za niekafelkowane i wywoływała `window.move_resize_frame(...)`.
   - W Mutter/Wayland wywołanie `move_resize_frame` na skafelkowanym oknie anuluje stan kafelkowania i zmienia okno w pływające, po czym GNOME Shell umieszcza je na środku ekranu (stąd terminale i Calc na środku).
2. **Wczesne dopasowywanie okien przed ustawieniem tytułu / WM_CLASS**:
   - Aplikacje takie jak LibreOffice (`soffice.bin`) oraz aplikacje PWA Chrome podczas wyemitowania sygnału `window-created` posiadają tymczasowe lub puste tytuły i `wm_class` (np. `soffice` zamiast `libreoffice-calc`).
   - Bezpośrednia ocena w momencie `window-created` przydzielała ujemne punkty lub dopasowywała okno nieprawidłowo.
3. **Dopasowywanie aplikacji PWA Chrome**:
   - Aplikacje PWA korzystają z unikalnych 32-znakowych identyfikatorów (haszy). Brak ich uwzględnienia powodował mylenie aplikacji PWA.

### Rozwiązanie / Solution
1. **Metoda `_getTileMode(window)`**:
   - Dodano bezpieczny odczyt `window.get_tile_mode()`. Dzięki temu po jednokrotnym skafelkowaniu okna (`window.tile(TILE_LEFT/RIGHT)`), kolejne próby nie wywołują `move_resize_frame`, a okno zachowuje stan skafelkowania (lewo/prawo).
2. **Asynchroniczne re-dopasowanie i obsługa sygnałów (`notify::title`, `notify::wm-class`)**:
   - Jeśli okno w momencie utworzenia nie posiada jeszcze wyrazistych cech (`bestScore < 500`), rozszerzenie podłącza nasłuchiwanie sygnałów zmiany tytułu i klasy okna oraz ponawia dopasowanie w interwałach czasowych. Gdy LibreOffice ustawi swój tytuł ("Bez tytułu 2 — LibreOffice Calc"), następuje precyzyjne przydzielenie pozycji (Calc -> prawo, Writer -> lewo).
3. **Dopasowywanie haszy PWA Chrome**:
   - Wyodrębniono automatyczne dopasowywanie 32-znakowych haszy aplikacji Chrome PWA w `_calculateMatchScore`.

---

## Issue 4: Skakanie okien (Nautilus) oraz lądowanie w złych miejscach (WhatsApp na środku, Nautilus na lewo)

### Przyczyna / Causes
1. **Konflikt wywołań `window.tile()` z `window.move_resize_frame()`**:
   - W funkcji `_applyGeometry`, bezpośrednio po wywołaniu `window.tile(TILE_LEFT/RIGHT)`, odczytywano stan kafelkowania przez `this._getTileMode(window)`.
   - W serwerze kompozycji Mutter (GNOME Shell 50/Wayland) stan kafelkowania w `window.get_tile_mode()` aktualizowany jest asynchronicznie w kolejnej pętli zdarzeń (main loop tick).
   - W rezultacie warunek `if (!tiled)` w tej samej mikrosekundzie ewaluował się jako `true` i natychmiast wywoływał `window.move_resize_frame(...)`.
   - Wywołanie `move_resize_frame` od-kafelkowywało okno i zmieniało je w pływające, a sekwencja czasowa ponawiania (0ms, 50ms, 200ms, 500ms, 1000ms, 2000ms) powodowała 6-krotne wywoływanie naprzemiennie `window.tile()` i `move_resize_frame()`. Powodowało to efekt "skakania" okna po ekranie, a ostatecznie Mutter umieszczał Nautilus po lewej stronie, a WhatsApp na środku.

### Rozwiązanie / Solution
1. **Separacja wywołań w `_applyGeometry`**:
   - Poprawiono logikę tak, że wywołanie `window.tile(TILE_LEFT/RIGHT)` ustawia flagę powodzenia `tileSuccess = true` bez odwoływania się do natychmiastowego odczytu `_getTileMode(window)`.
   - Dzięki temu `move_resize_frame` nie jest wywoływany i nie anuluje stanu kafelkowania okna.
2. **Korekta progu dopasowania dla ostatniego okna**:
   - Zmodyfikowano fallback dla pojedynczych oczekujących okien (`bestScore >= 100`), aby całkowicie obce okna o wyniku `0` nie przechwytywały pozycji innych aplikacji podczas uruchamiania.
