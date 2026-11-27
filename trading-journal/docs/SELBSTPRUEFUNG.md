# Selbstprüfung

Auftrag des Nutzers: „überarbeite alles noch mit den Skills, lass die Startseite so, die ist perfekt, überprüfe dich selbst und schau, ob alles den
Ansprüchen gerecht wird.“ Diese Seite hält fest, was geprüft wurde, womit und wo die Grenze liegt. Zahlen und Behauptungen stehen im Code und in den
Tests; `docs/COVERAGE.md` bleibt die Zeile je Bauplan-Punkt, diese Datei die Zeile je Anforderung des Nutzers.

## Anforderungen des Nutzers

| Anforderung | Wo in der App | Wie geprüft | Grenze |
|---|---|---|---|
| Strategie als Text | Seite „Strategie-Studio“ (`#studio`, `src/views/studio`, `src/domain/strategytext`): Text schreiben, verstehen lassen, Rückfragen beantworten, Backtest | `tests/unit/strategytext.*.test.ts`, `tests/unit/views.studio.test.tsx`, `tests/e2e/studio.spec.ts`; Funktionsfinder: „Strategie als Text“ führt auf den Editor (`tests/e2e/funktionsfinder.spec.ts`) | Nur ein Teil der Bausteine ist in Worten ausdrückbar, der Rest steht als „Unklar“ mit Grund; kein Diktat; die optionale KI liest nur serverseitig (mit Betreiber-Schlüssel) und wird gegen dasselbe Regelschema geprüft, ohne Schlüssel liest die lokale Schicht |
| Muster erkennen | Muster-Entdecker (Labor, unterster Abschnitt; im Studio unter „Weitere Werkzeuge“; `src/views/discovery`, `src/domain/discovery`) | `tests/unit/discovery.*.test.ts` (Merkmale ohne Vorausblick, Permutationstest, Korrektur über alle Prüfungen, 60/40), `tests/unit/views.discovery.test.tsx`, `tests/e2e/discovery.spec.ts` | Ab 80 Trades mit bekanntem R; Beobachtung, keine Ursache; ein Muster aus denselben Trades lässt sich dort nur bestätigen, nicht beweisen (die Karte sagt das) |
| Verbesserung im Hintergrund | Optimierer (Labor „Hintergrund“, Studio „Weitere Werkzeuge“; `src/domain/evolve`, `src/views/evolve`) | `tests/unit/evolve.*.test.ts`, `tests/unit/views.evolve*.test.tsx`, `tests/e2e/evolve.spec.ts` | Läuft nur bei geöffneter App (Web Worker in Zeitscheiben, gedrosselt im Hintergrund-Tab); es gibt keine Server-Jobs; Ergebnis sind Vorschläge – nichts wird ohne ausdrückliche Bestätigung für genau diese Änderung übernommen |
| Mehrere Strategien | Studio: „Alle testen“, Vergleichstabelle, Papierkonten (`src/views/studio`, `src/domain/strategytext/compare.ts`); Labor: Vergleich gespeicherter Läufe | `tests/unit/strategytext.compare.test.ts`, `tests/unit/views.studio.test.tsx`, `tests/e2e/studio.spec.ts` | Höchstens 30 Strategien, 30 Versionen je Strategie, 8 Papierkonten; gleiche Daten und gleiches Train/Test-Fenster; die Zahl der verglichenen Strategien und die Mehrfachtest-Warnung stehen sichtbar dabei |
| Selbstlernen | Optimierer: „Was habe ich gelernt?“ und die Gewichte der Änderungsarten (`src/domain/evolve/learn.ts`, `src/views/evolve/LearnedCard.tsx`); Assistent: „merk dir …“ (`src/assistant/memory.ts`) | `tests/unit/evolve.learn.test.ts`, `tests/unit/views.evolve.test.tsx`, `tests/e2e/assistant.spec.ts` | Kein trainiertes Modell: Zählungen (angenommen, abgelehnt, im Live-Test gut oder schlecht) verschieben nur die Reihenfolge der Versuche (Gewicht 0,3 bis 1,7); jede Aussage nennt Zahl und Stichprobe; das Gedächtnis des Assistenten liegt lokal in den Einstellungen |
| Screenshot-Import ohne Schlüssel | Trades → „Screenshot importieren“ (`src/journal/ocr`): Texterkennung im Browser (tesseract.js, selbst gehostete Dateien) → Vorschau → „Alle N Trades eintragen“ mit „Rückgängig“ | `tests/unit/ocr.*.test.ts`, `tests/e2e/screenshotImport.spec.ts`, `scripts/ocrCheck.ts`; Funktionsfinder: „Screenshot importieren“ öffnet das Sheet | Nicht gesendet, nicht gespeichert. Tesseract verliert bei kleiner Schrift gelegentlich einen Dezimalpunkt (nur die Zahlenprobe markiert das); der echte Bitunix-Screenshot ist mit 18/18 Feldern gemessen, andere Börsen und echte Orderhistorien nur mit Mustern geprüft |
| Funktionsübersicht | Seite „Funktionen“ (`#funktionen`, `src/views/funktionen`, Register `src/app/features.ts`, 141 Funktionen in 10 Aufgaben-Gruppen) und der Finder im Menü (`src/app/NavFinder.tsx`) | `tests/unit/features.registry.test.ts` (Pfade, Anker, Stand-Zeile), `tests/e2e/funktionen*.spec.ts`, `tests/e2e/a11y-funktionen.spec.ts` und neu `tests/e2e/funktionsfinder.spec.ts`: 15 Ziele (Strategie als Text, Muster der Gewinner, Optimierer, Screenshot importieren, Risiko berechnen, Wochenbericht, TradingView-Skript, Check-in, Schlüsselmarken, Backtest, Stresstest, Vorwärtstest, Assistent, Trainings-Modus, Backup) über Seite und Menü, mit echten Klicks, mobil und Desktop – der erste Treffer ist die erwartete Funktion, der Zielabschnitt liegt danach im sichtbaren Bereich oder das Sheet ist offen | Die Suche ist eine tolerante lokale Wortsuche über Aufgaben- und Wortlisten, keine Bedeutungssuche; ein Abschnitt, der erst nach einem Lauf entsteht (Stresstest), sagt das in einer Meldung, statt oben zu bleiben |
| Startseite: nur Barrierefreiheits-Korrekturen, Aussehen gleich | `#overview`, `src/views/overview`, Cockpit (`src/views/cockpit`), Header, Footer, Dock | Runde 5, auf ausdrückliche Erlaubnis des Nutzers (Layout, Texte, Reihenfolge, Animationen und das Dock mit seinen fünf Tabs bleiben): (a) unsichtbare Trefferflächen für die dichten Raster (`data-hit-grid`, `tests/e2e/hitbox.ts`), (b) die kleinste Farbanhebung bis WCAG AA – Kleinschrift dunkel `#5f5f5f` → `#868686`, hell `#6b6b6b` → `#686868` (nur Text; Linien, Punkte und Striche behalten ihren Grauwert über `--color-faint-line`), Plaketten hell ≈ 6 % dunkler, (c) Semantik: die Kennzahlenkacheln sind eine Liste aus sieben Knöpfen statt eines `dl` um Knöpfe, `aria-activedescendant` der Disziplin-Karte nennt nur noch vorhandene Zellen, (d) `overflow-x: clip` um Kopf und Seite (`src/App.tsx`). axe (A + AA, Kontrast), ganzes Dokument, Startseite und Cockpit, dunkel und hell, 390 und 1440 px: vorher Startseite dunkel 23 (Desktop) / 16 (mobil) Kontrastknoten, hell 2 (Kopfzeile, Desktop), dazu überall 14 × `dlitem` und 1 × `definition-list`, mobil 1 × `aria-valid-attr-value`; Cockpit 2 Kontrastknoten (Kopfzeile, Desktop, dunkel und hell) – nachher 0 Verstöße in allen acht Fällen. Treffer ≥ 44 px bei grobem Zeiger (390 px): vorher 119 (Startseite) und 84 (Cockpit) Ziele darunter, nachher 0. Pixelvergleich der ersten Bildschirmseite (Playwright, `animations: disabled`, Stand `55d2c21` gegen jetzt, beide im selben Minutenfenster; Rauschgrenze = derselbe Stand zweimal: 0,000 – 0,025 %): dunkel Startseite 0,34 % (Desktop) / 0,11 % (mobil), Cockpit 0,35 % / 0,37 %; hell Startseite 0,18 % / 0,60 %, Cockpit 0,18 % / 0,58 %. Wo: ausschließlich Kleinschrift (Untertitel und Ticker-Kürzel der Kopfzeile, `+2 offen`, „vor 24 h / jetzt“, Funding-Zeile, Kürzel im Einstiegs-Check, Achsenbeschriftung, Kontostand-Zeile) und – hell – der Text des Hinweises „Lokaler Modus.“ (dunkleres Bernstein); die Zeichnung der Karten, Linien und Kurven ist unverändert. `tests/e2e/selbstpruefung.spec.ts`, `a11y.spec.ts` und `touch.spec.ts` schließen Startseite und Cockpit jetzt ein | Das Aussehen ist NICHT pixelgleich: die Kleinschrift ist heller (das ist die Korrektur), im hellen Thema Plaketten und der Hinweis „Lokaler Modus.“ etwas dunkler. Der Einstiegs-Check wechselt mit der Uhr (Kerzenschluss) – eine Fläche, die in jedem Pixelvergleich schwankt. `src/app/Dock.tsx` hat weiterhin +2 Zeilen (Seite „Strategie-Studio“), die fünf Dock-Tabs sind unberührt; das Menü-Overlay `src/app/CommandNav.tsx` kam von der Funktionsübersicht |
| Hinweis „Keine professionelle Finanzberatung.“ | `src/ui/AnalysisNote.tsx`: ein ruhiger Satz am Ende von Markt, Analyse, Risiko, Coach, Berichte, Wachstum, Labor, Strategie-Studio und Setups, in „Üben“ und „Was wäre wenn“; im Assistenten eine Dauerzeile unter dem Eingabefeld; Markdown-Bericht, Druckbericht und Pine-Kopf tragen ihn ebenfalls. Bestehende Sätze in Karten (Studio, Muster-Entdecker, Optimierer) bleiben | `tests/unit/ui.analysisNote.test.tsx` (Wortlaut, Lesbarkeit, kein Import in Übersicht, Cockpit, Dock, Header, Footer), `tests/e2e/selbstpruefung.spec.ts` (genau ein Hinweis am Ende jeder Seite, keiner auf Übersicht und Cockpit, einer im Assistenten auch nach einer Antwort) | Nicht in jeder Antwortblase und nicht auf Konto, Preise, Community, Einstellungen, Funktionen (dort gibt es keine Analyse). „Insights“ liegt auf der Startseite und bekommt deshalb keinen eigenen Hinweis. Die App sendet keine Orders und baut keinen Weg dafür |
| Quelle und Stand | `src/ui/SourceStand.tsx`: Markt (Anbieter, Abruf, letzter Schluss je Zeiteinheit, `MarktStand`), Labor-Lauf (Quelle, Zeitraum), Korrelation und Benchmark; Trend-Struktur und Ähnliche Situationen hatten ihr „Stand“ schon, Studio ebenfalls | `tests/unit/ui.sourceStand.test.tsx` (Format, „keine Daten“, jede Quelle hat einen Namen), `tests/e2e/selbstpruefung.spec.ts` (Zeile auf Markt, jede Angabe ist eine Zeit oder „keine Daten“) | Fehlt noch als eigene Zeile: Risiko-Rechner (Live-Preis), Liquidation und Exposure, die Karten des Coachs, der Live-Check auf der Setups-Seite (hat nur die Pille Live / Veraltet); die Quellenzeilen der Startseite (Lage, Signal, Marktkarte) sind unberührt. Wo eine Zeit fehlt, steht „keine Daten“ – nichts wird geschätzt |

## Was die Selbstprüfung gemessen hat

Alle Seiten (`overview trades setups settings markt analyse risiko coach berichte labor wachstum community cockpit konto preise funktionen studio`),
dunkel und hell, mobil 390 × 844 (grober Zeiger) und Desktop 1280 × 800, gegen den Produktionsbau; Screenshots lagen nur im Arbeitsverzeichnis.

- **Seitliches Scrollen:** keine Seite ragt bei 390 px aus dem Bild (Dokument und jedes sichtbare Element geprüft).
- **Befunde und Korrekturen:** Setup-Karten sprangen von Überschrift 1 auf 3 (jetzt Ebene 2); der Posteingang im Coach zeigte auf einen nicht vorhandenen Inhalt
  (`aria-controls`); die CSV-Datei im Labor hatte kein Label; im Preis stand ein `aria-label` auf einem Element ohne Rolle; der Name einer Schlüsselmarke wurde
  mit „…“ abgeschnitten (jetzt Umbruch); Chips, Export-Knöpfe, Archiv, Watchlist und die Steuerung der Simulation hatten bei grobem Zeiger weniger als 44 px
  Trefferfläche (jetzt 44 px).
- **Touch-Tests der Tablets (`tests/e2e/touch.spec.ts`, 1280 × 800 und 1692 × 978):** im Stand vor der Selbstprüfung waren „Seite Einstellungen“ und „Overlays“ rot – die Skalen für Stress und
  Zuversicht im Editor waren 28 px breit (jetzt 44 px bei grobem Zeiger), und die seitlich scrollende „Inhalt“-Leiste und 1-px-Dateifelder zählten als Ziele (jetzt ausgenommen, mit Grund im Test).
  Mein erster Entwurf des Hinweises hat die Setups-Seite zerlegt (er spannte sich über zwölf Spalten eines Ein-Spalten-Rasters); der Touch-Test der Setups-Seite hat das gefunden, jetzt spannt nur eine
  12-Spalten-Seite ihn selbst, und `selbstpruefung.spec.ts` prüft, dass der Hinweis unter dem Seitenkopf in dessen Spalte steht.
- **Kontrast:** In der dunklen Darstellung hat `--color-faint` (#5f5f5f) nur etwa 3 : 1. Auf allen Seiten und in Sheets gilt `#8c8c8c` (≥ 4,5 : 1 auf allen Flächen,
  `src/styles/themes.css`); auf Startseite, Cockpit, Kopf- und Fußzeile (Runde 5) die kleinste Anhebung, die auf den dort gemessenen Flächen (#060606 … #1f1f1f) AA erreicht: `#868686`.
  Hell: `#6b6b6b` (4,46 : 1 auf dem Grund der Kopfzeile) bleibt auf den Seiten, Startseite / Cockpit / Kopf- und Fußzeile `#686868`. Farbige Plaketten, Statuspillen und der Hinweis
  „Lokaler Modus.“ (Text in Gewinn-, Verlust- und Warnfarbe auf der eigenen Tönung, hell 3,9 – 4,5 : 1) tragen dort ≥ 4,5 : 1: `#096f37`, `#bd1a25`, `#8a5100`; die Zahlen starker Kalendertage
  und die vorläufigen Texte (`--color-win-soft` / `--color-loss-soft`) haben eigene, tiefere Töne (`--cal-*`, `--tint-ink-*`).
- **Test, der vom Wochentag abhing:** `ReportReadyHost` in `tests/unit/views.berichte.test.tsx` erwartet einen „Bericht bereit“ und war an Sonntagen rot (die Frist einer Woche
  ist 6 Tage); `Date` ist dort jetzt auf einen Mittwoch festgelegt (Timer bleiben echt).
- **Platzhalter und Englisch:** keine „Kommt gleich“-Platzhalter, kein `undefined` oder `NaN` im Text; englisch sind nur Fachwörter (Open Interest, Weekly Close, die
  Pine-Felder `open` / `close`) und der eigene Satz „Trade the best, fuck the rest“.
- **axe (WCAG 2.1 A + AA, Kontrast):** `tests/e2e/selbstpruefung.spec.ts` prüft den Inhalt von 14 Seiten in beiden Themen und beiden Größen: keine Verstöße.

## Offen (ehrlich)

- **Startseite und Cockpit (Runde 5, behoben):** Kleinschrift, `dl` / `dt` / `dd`, das ungültige `aria-activedescendant`, die Kopfzeile (3,1 : 1 dunkel, 3,9 : 1 hell), die Plaketten
  (4,2 – 4,5 : 1 → ≥ 4,5 : 1) und die Trefferflächen der Raster sind behoben und gemessen (Zeile oben). Was bleibt: (1) Die dichten Raster (Disziplin-Kalender, Wochentag × Uhrzeit)
  haben keine 44-px-Fläche je Zelle – das geht neben dem Nachbarn nicht; das Raster ist das Ziel (Zellen 14 – 21 px, Raster-Abstand 17 – 24 px, ein unsichtbarer Rand von 12 – 16 px, ein Tipp
  wählt die nächste Zelle; `heat-grid.spec.ts` tippt echt). WCAG 2.5.8 (24 px) erfüllt nur die Wochentag-Karte; der Disziplin-Kalender hat die Entsprechung „Letzte Handelstage“ (44-px-Knöpfe)
  und die Pfeiltasten. (2) Die Kleinschrift ist per Pixelmessung nicht auf jeder Fläche geprüft: axe sieht Flächen mit Verlauf oder Bild (Hero, Signal-Karte: ≈ 800 Elemente „nicht prüfbar“) nicht; die Pixelmessung
  (Text ausblenden, Hintergrund abtasten, `scratchpad`-Skript, nicht im Repo) findet dort nur Übergangsbilder, aber sie ist eine Stichprobe. (3) Stark getönte Verlusttage im P&L-Kalender (Rot auf Rot)
  wurden mit einem tieferen Ton für die Zahl und helleren Tag-Zahlen abgesichert, aber nur mit den Testdaten gemessen (ein Gewinn-Tag).
- **Beim Wechsel von der Startseite (Runde 5, behoben):** der Überstand (bis 14 px, ≈ 0,35 s) kam – gemessen – von der einlaufenden Seite (die randlose „Inhalt“-Leiste der Markt-Seite unter
  `scale(.985) translateX(16px)`), die Zeiger der Bias-Leiste waren schon von ihren Karten beschnitten. `overflow-x: clip` um Kopf und Seite (`src/App.tsx`) hält das Dokument nie breiter als den
  Bildschirm (`pages.spec.ts`: Breite in jedem Frame beim Wechsel, vorher rot, jetzt grün).
- **Setups, grober Zeiger, 1280 px:** der gemeldete Treffer-Streifen von 40 px statt 44 ließ sich im jetzigen Stand nicht mehr nachstellen (`touch.spec.ts` „page setups“ auf `tablet-1280` und `tablet`: 0 Treffer,
  eigene Messung auf 390 und 1280 px: 0); die Umschalter im Seitenkopf sind 44 px hoch.
- **Quelle und Stand:** die Liste in der Tabelle oben; der Hinweis am Seitenende ersetzt keine Quelle bei einer einzelnen Zahl.
- **Abdeckung:** `docs/COVERAGE.md` stimmt in Pfaden (alle genannten Dateien und Tests existieren), Stand-Zeile (32 fertig · 33 teilweise · 9 fehlt) und den
  stichprobenartig nachgezählten Zahlen (33 Bausteine, 32 Bibliothekskarten, 9 CSV-Formate, 20 / 240 Versionen, 8 / 5 / 250 Konten, 80 und 20 als Mindestmengen).
  Nicht belegt sind die Aussagen zu echten Konten (Supabase, Stripe, Bitunix, Anthropic): die Tests laufen gegen Mocks, und das steht in den Zeilen.

## Runde 13 – Funktionsprüfung

Auftrag: „halte dich genau an die Funktionsprüfung“ – die Tabellen von `ABNAHME-40`, `UX-MATRIX-74`, `PRODUKTABGLEICH` und `COVERAGE` gegen den **Produktionsbau** halten (`npm run build`, ausgeliefert mit den Headern aus `netlify.toml` – CSP, HSTS, gzip – über einen kleinen eigenen Static-Server; der Cloud-Bau `npm run build:e2e-cloud` gegen die Supabase-/Stripe-Mocks). Chromium (Playwright 1.63), Profile: Galaxy-Tab 1692 × 978 (Touch, grober Zeiger) und Handy 390 × 844, dunkel und hell. **Ehrlich zur Umgebung:** die Maschine war während der Läufe mit anderen Aufträgen stark belegt (Load 15 – 45 auf 4 Kernen, einmal Neustart); Zeitmessungen (LCP, TBT, INP) sind deshalb **nicht aussagekräftig**, zwei Specs liefen in Zeitüberschreitungen und bestanden beim Wiederholen (siehe unten). Was nur mit echten Geräten oder Diensten prüfbar ist, steht am Ende.

### Seiten, Zustände, Zugänglichkeit

| Anforderung | Ergebnis | Beleg |
|---|---|---|
| Alle 19 Seiten (`overview trades setups settings markt analyse risiko coach berichte labor wachstum community cockpit konto preise funktionen studio plan aktien`), 2 Größen × 2 Themen = 76 Läufe: keine Konsolenfehler oder -warnungen, keine fehlgeschlagene oder mit ≥ 400 beantwortete Anfrage (Märkte gemockt) | bestanden | Messlauf je Seite (Konsole, Netz, Überstand, CLS, axe); 0 von 76 mit Befund |
| axe (WCAG 2.1 A + AA, Kontrast) auf jeder Seite, beide Größen, beide Themen | bestanden (0 Verstöße) | dieselben 76 Läufe |
| Kein seitliches Scrollen | bestanden | dieselben 76 Läufe |
| Layoutsprünge CLS ≤ 0,02 | bestanden für alle Seiten (≤ 0,006). **Grenze Startseite:** 0,0135 – 0,0170 bei ruhiger Maschine (0,0153 allein gemessen), aber 0,026 – 0,037 unter Last; Quelle: die Karte „Lage“ ändert ihre Höhe (222 → 200 px), wenn ihre Daten ankommen. Die Startseite ist laut Auftrag nicht angefasst; Berichte gehört einem anderen Auftrag | `layout-shift`-Einträge mit Quellen, `tests/e2e/layout-shift.spec.ts` |
| Touch-Ziele ≥ 44 px bei grobem Zeiger, **Handy**, alle Seiten | **behoben:** Einstellungen hatte drei Stellen unter 44 px; danach bestanden | neu `tests/e2e/touch-mobile.spec.ts` (16 Seiten; vorher rot, nachher grün). Die seitlich scrollende „Inhalt“-Leiste bleibt ausgenommen, Grund wie in `touch.spec.ts` |
| Touch-Ziele, **Galaxy-Tab 1692**, alle 19 Seiten | bestanden (nur die ausgenommene „Inhalt“-Leiste) | Messlauf mit `hitbox.ts`; `touch.spec.ts` deckt dort 5 Seiten + Overlays |
| Leere Zustände (leeres Journal), Tablet + Handy, dunkel (38 Läufe) | **behoben:** Coach (axe `aria-prohibited-attr`), Trades-Leerzustand (Tippfläche 30 px); sonst bestanden. Einmal „color-contrast ×3“ auf Funktionen (Handy, leer) unter Höchstlast gesehen, in weiteren Läufen nicht reproduzierbar | Messlauf; `tests/e2e/funktionspruefung.spec.ts` |
| Rechtsseiten (Impressum, Datenschutz, AGB, Widerruf, Hinweise via `?rechtliches=`), 2 Größen × 2 Themen = 20 Läufe | bestanden: axe 0, kein Überstand, Escape schließt. **Behoben:** Tab verließ das Fenster (siehe „Behoben“) | Messlauf; `funktionspruefung.spec.ts` |
| `#preise` und Anmeldung / Gate (Cloud-Bau gegen Mocks) | bestanden | `gate`, `preise`, `konto-b1`, `kaufstrecke`, `cloud` auf Tablet + Handy: 44 bestanden, 0 rot (die übrigen Fälle laufen nur auf anderen Profilen) |
| Fokusreihenfolge / Tastatur | bestanden: Reihenfolge Kopf → Seitenleiste → Seite → Fußzeile, jeder Stopp mit sichtbarem Ring, nichts verdeckt; Fenster halten Tab (Rechtliches, Backup-Import, Navigation, Screenshot-Import, Trade-Editor in 70 Tab-Drücken). **Grenze:** es gibt keinen „Zum Inhalt springen“-Link, nur Landmarken; von der Kopfzeile bis zum Seiteninhalt sind es ≈ 30 Tab-Stopps. Empfehlung, nicht gebaut (ändert den ersten Tab-Stopp jeder Seite, auch der Startseite) | Messlauf Tab-Reihenfolge; `motion.a11y.test.tsx` |
| Offline-Verhalten | bestanden: eine noch nicht geladene Seite offline = ehrlicher Platzhalter, lädt nach „online“; das Journal bleibt lokal nutzbar. **Grenze:** kein Service Worker – ein **kalter Start ohne Netz** zeigt die Offline-Seite des Browsers (installierbar, aber nicht offline-first) | `reliability.spec.ts` (ein Lauf rot durch die Maschinenlast, beim Wiederholen auf Handy und Tablet grün); `ABNAHME-40` Nr. 30 |

### Funktions-Durchläufe als Nutzer (lokale Daten)

| Anforderung | Ergebnis | Beleg |
|---|---|---|
| Trade anlegen / bearbeiten / löschen (Papierkorb mit „Rückgängig“), „Speichern & neu“, Enter im Feld, Verwerfen-Frage bei Escape, offener Trade | bestanden: leere Eingabe und `−5` / `abc` zeigen die Meldung am Feld, `80.000,5` wird 80000,5, Bearbeiten übernimmt die Werte. **Grenze (Altlast, 1:1-Port des Parsers):** `85.900` ohne Komma wird als 85,9 gelesen, nicht als 85 900 – die Seite warnt dabei nicht | eigener Durchlauf auf leerem Profil; `trades.spec.ts`, `editor.spec.ts` (Tablet + Handy grün) |
| Screenshot-Import (Fixture `tests/fixtures/ocr/bitunix-positionshistorie-1.jpg`) | bestanden: 2 Trades, 1 abgeschnittene Karte gemeldet, „Alle 2 Trades eintragen“, „Rückgängig“; unter den Produktions-Headern ohne CSP-Verstoß (WebAssembly, Worker, Sprachdaten) | `screenshotImport.spec.ts` (Handy), CSP-Lauf |
| Export / Import-Backup | bestanden: JSON (13 Trades, Schema 1) und CSV (BOM, `;`) laden herunter; das JSON in einem leeren Profil: gleiche 13 IDs, Vorschau „13 Trades, 8 Grundlagen, 3 Ablesungen“ | eigener Rundlauf; `data.spec.ts` grün |
| Einstellungen | bestanden | `settings.spec.ts` |
| Filter / Suche (Trades, Finder, Navigation) | bestanden: Gewinner 6, Verlierer 4, „btc“ 12 von 13, unsinnige Suche 0 Zeilen mit Hinweis; 15 Ziele des Funktionsfinders mit echten Klicks | `funktionsfinder`, `search`, `navigation` (Tablet + Handy grün) |
| Strategiesuche „1.000 Varianten“, Strategie-Studio | bestanden | `labor-search.spec.ts`, `studio.spec.ts` |
| Tarif- / Gate-Fluss ohne Backend | bestanden, **nur Mock** (Fremddienste nicht live) | siehe Gate-Zeile; `ABNAHME-40` Nr. 1 – 8 |
| Bewegung / Reduced Motion, Navigation mobil und Desktop, Suche mit Rückkehr, Original-Screenshots | bestanden | `motion-global`, `shell-frame`, `nav-groups`, `funktionsfinder-rueckkehr`, `screenshot-originale`, `interaktionen` (ein Radial-Share-Lauf rot unter Last, allein grün) |
| UX-Matrix (74) / Abdeckung: „Ort in der App“ führt dorthin | bestanden über das Funktionsregister (`features.registry.test.ts`, `ux.matrix.test.ts`) und den Finder; **nicht** jede der 74 Zeilen wurde einzeln im Browser durchgespielt, ihr Status bleibt der in `COVERAGE.md` benannte | vollständiger Vitest-Lauf |

### Importwege gegen kaputte und riesige Dateien

| Datei | Ergebnis |
|---|---|
| Backup-JSON: leer, kein JSON, `[]`, falsche Form, `__proto__`-Schlüssel, 201 MB | abgelehnt oder harmlos, kein Absturz, keine Prototyp-Verschmutzung; **behoben:** englische Meldung, leere Datei und `[]` |
| Backup-ZIP: kaputt, leer, ohne Manifest, ZIP-Bombe (1 GB Nullen) | abgelehnt mit deutscher Meldung („beschädigt“, „keine ZIP-Datei“, „Manifest fehlt“, „nicht von diesem Journal erzeugt“), Journal unverändert |
| CSV: leer, binär, nur Kopfzeile, 21 MB, Zelle mit `<img onerror>` | abgelehnt oder leere Vorschau, kein Skript läuft; **behoben:** leere Datei sagt es |
| Bild: 0 Byte, Text als `.png`, SVG mit Skript, 30 000 × 30 000 PNG (855 KB) | „ließ sich nicht als Bild lesen“, kein Absturz; SVG wird nicht ausgeführt |
| OCR-Dateien gesperrt / 404 / Unsinn (erstes Auslesen ohne Netz) | **behoben:** die Meldung nennt Verbindung und den einmaligen Download |

### Leistung und Erstladung

| Anforderung | Ergebnis | Beleg |
|---|---|---|
| Budget (`npm run build && npm run budget`) | JS **662,3 / 800 KiB**, CSS **52,5 / 52,5 KiB** (vorher 661,8 / 52,5; Rest ≈ 80 Byte; die Korrekturen nutzen nur bereits vorhandene Klassen `min-h-tap`, `gap-3.5`) | `npm run budget` |
| Lazy-Chunks | bestanden: Seiten und Hosts bleiben eigene Chunks; nach dem ersten Bild laden Seiten-Chunks im Leerlauf nach (≈ 160 Skripte), ohne Fehlschlag oder 404 | Netzprotokoll des ersten Besuchs |
| Schrift ohne Sprung | **behoben (billig):** die woff2-Dateien wurden erst nach dem ersten Skript angefragt (Plex Sans 0,3 s, Plex Mono 3,8 s nach dem ersten Bild, angekommen bei ≈ 7 s) – bis dahin Ersatzschrift, dann ein Sprung. Jetzt `rel=preload` für Sans und Mono 400 / 500 / 600 (4 Dateien, 80 KB): angekommen bei 1,6 – 2,6 s statt 2,7 – 7,3 s (Handy-Profil, 4× CPU, Slow 4G). Doto (nur Startseite, 5 KB) bleibt beim Stylesheet. Kein „nicht benutzt“-Hinweis auf den 19 Seiten | `scripts/fontPreload.ts`, `tests/unit/build.fontPreload.test.ts` |
| LCP / INP / TBT auf 4× CPU, Slow 4G, 390 px | **nicht belastbar:** FCP ≈ 2,0 s; LCP 7 – 10 s, TBT 8 – 21 s, INP 1,0 – 1,8 s bei Load 19 – 45 der Maschine und zusätzlicher 4-facher Drosselung – Obergrenzen, keine Gerätewerte. Messung auf ruhigem Gerät steht aus (`ABNAHME-40` Nr. 24) | Messlauf mit `PerformanceObserver` |

### Sicherheit und Härtung ohne Backend-Änderung

| Anforderung | Ergebnis | Beleg |
|---|---|---|
| CSP / Header stimmig (Stripe, Supabase, Binance, Bybit, OKX) | bestanden: unter den Headern aus `netlify.toml` 0 Verstöße auf allen 19 Seiten, im OCR (WebAssembly, Worker, Sprachdaten aus `/ocr/`), im Labor-Backtest (Worker) und im Monte-Carlo. Jeder Host, den der Code anspricht, steht in `connect-src`; `wss://stream.bybit.com` steht dort ohne Verwendung (harmlos). **Nicht live prüfbar:** Stripe.js; Stripe empfiehlt zusätzlich `img-src https://*.stripe.com` – erst beim Test mit dem Betreiber-Konto entscheiden | Messlauf mit `securitypolicyviolation`-Hörer |
| Keine Geheimnisse im Bundle | bestanden: `dist/` ohne `sk_`, `rk_`, `whsec_`, `service_role`, JWT, PEM, `sk-ant`; Treffer sind nur Namen von Umgebungsvariablen in Hinweistexten und der Prüfer, der `sb_secret_` ablehnt; keine Sourcemaps; `secretGuard` bleibt als Bau-Wächter | `grep` über `dist/`, `scripts/secretGuard.ts` |
| Eingabevalidierung der Importwege | siehe Tabelle oben | eigene Läufe + `security.*`-Unit-Tests |

### Behoben (je mit Regressionstest)

| Fehler | Korrektur | Test |
|---|---|---|
| Backup importieren zeigte zod-Englisch („settings: Expected object, received number“); leere Datei = „Kein gültiges JSON“; ein bares `[]` galt als Backup mit 0 / 0 / 0 (mit „Ersetzen“ leert es das Journal) | `src/lib/zodDe.ts`, `src/store/backup.ts` | `import.errorsDe.test.ts`, `overlays.import.test.tsx`, `funktionspruefung.spec.ts` |
| CSV importieren: leere Datei öffnete die Spaltenzuordnung ohne etwas zuzuordnen | `CsvImportSheet.tsx` | `exchange.ui.test.tsx` |
| Einstellungen, Handy: „Vorschau“ / „Logo wiederholen“, „Einführung starten“ / „Alle Tastenkürzel“ und die zwei Rückmeldungs-Schalter überdeckten sich in der Tippfläche (30-px-Knöpfe, umgebrochene Zeile, 40 px Mittenabstand) | `MotionSection.tsx`, `OnboardingCard.tsx` | `touch-mobile.spec.ts` (vorher rot) |
| Trades ohne Einträge, Handy: „Trade eintragen“ / „Filter zurücksetzen“ hatten nur 30 px Tippfläche (der Glanz des Leerzustands überschreibt die 44-px-Fläche) | `TradesView.tsx` (`min-h-tap`) | `funktionspruefung.spec.ts` |
| Coach / Assistent: Gruppe „Vorschläge“ ohne Rolle (axe `aria-prohibited-attr`, schwer) | `ChatCard.tsx`, `AssistantHost.tsx` (`role="group"`) | `funktionspruefung.spec.ts` |
| Rechtliches: jeder dritte Tab landete auf `<body>` – die Tab-Falle hielt den letzten Knopf der Umschalter-Gruppe (`tabindex=-1`) für den letzten Stopp; gilt für jedes Fenster, das mit einer solchen Gruppe endet | `src/motion/a11y.ts` | `motion.a11y.test.tsx` (2 Fälle, vorher rot), `funktionspruefung.spec.ts` |
| Screenshot lesen ohne Netz (erstes Mal): „Das Auslesen hat nicht geklappt.“ ohne Grund | `ocr/browser.ts`, `OcrImportSheet.tsx` | `ocr.engineLoad.test.ts`, `ocr.sheet.test.tsx` |
| Preise ohne Abos: „Keine Abos in dieser Version – In dieser Version gibt es keine Abos – …“ (doppelt) | `billing/strings.ts` | `billing.ui.test.tsx` |
| Schrift erst nach dem Skript angefragt | `scripts/fontPreload.ts`, `vite.config.ts` | `build.fontPreload.test.ts` |

### Nur mit echten Geräten oder Diensten prüfbar (hier nicht geprüft)

- Echte Telefone und Tablets (Samsung Internet, Safari, Firefox), Touch-Gefühl, Bildschirmleser (TalkBack, VoiceOver, NVDA); axe prüft nur einen Teil von WCAG, ein Nachweis nach EN 301 549 liegt nicht vor.
- Leistung auf ruhigem Gerät (LCP, INP, TBT): hier nur Obergrenzen unter Last.
- Alle Fremddienste: Supabase, Stripe (Stripe.js und seine CSP), Twilio, Resend, Binance, TradingView, Anthropic – nur Mocks (`ABNAHME-40`: „nur Mock“).
- Die Header auf Netlify selbst (hier mit den Headern aus `netlify.toml` lokal nachgestellt; Verstöße zeigen sich sonst erst im Deploy-Preview).
- Nicht wiederholt: die 74 Zeilen der UX-Matrix einzeln im Browser; Berichte, Scanner / Rechner, Zahlung / Betrieb gehören anderen Aufträgen.

**Stand der Gesamtprüfung:** `npx tsc -b` und `npm run lint` ohne Befund; `npm run build && npm run budget` grün (662,3 / 800 KiB JS, 52,5 / 52,5 KiB CSS). Vollständiger `npx vitest run`: 9 671 Tests grün, 12 rot – alle durch Zeitgrenzen unter der Maschinenlast (Load 20 – 45); einzeln oder mit zwei Workern wiederholt sind alle 670 Dateien grün (`views.aktien` auch auf dem unveränderten Stand `5fa335a3` grün).
