# Übersicht: Was kann die App – und wo steht es?

Karte **Aufgabe → Seite → Abschnitt**. Sie ist aus dem Funktionsregister (`src/app/features.ts`) erzeugt und mit der echten App abgeglichen (Playwright,
390 und 1280 px, Seed-Journal, Stand 24.10.2026). Dieselben Zeilen stehen in der Seite „Funktionen“, in der Suche, im Menü-Finder und beim Assistenten;
`tests/unit/features.registry.test.ts` hält sie ehrlich, `tests/e2e/funktionen-anker.spec.ts` prüft, dass jeder Anker im DOM seiner Seite steht.

## 1. Bestandsaufnahme (vor dem Umbau)

Gemessen mit `vite preview` + Playwright, mobil 390 × 844 (ein Bildschirm ≈ 844 px):

| Seite | Höhe mobil | Bildschirme | Abschnitte / Karten | Wie man hinkommt |
|---|---|---|---|---|
| Übersicht (Dashboard, unverändert) | 17 418 px | 20,6 | 25 Überschriften, darunter 11 Karten „Auswertung“ ab Bildschirm 12 | Dock |
| Trades | 3 221 px | 3,8 | Liste mit Filter | Dock |
| Entscheidungsgrundlagen | 6 559 px | 7,8 | 8 Karten + Zuordnen + Grundregeln | Dock |
| Einstellungen | 13 779 px | 16,3 | 15 Karten ohne Abschnittsnamen | Dock |
| Markt | 12 647 px | 15,0 | 11 Karten – Alarme erst ab Bildschirm 14, Scanner 13, Tagesplan 11, Schlüsselmarken 9 | Dock |
| Analyse | 8 626 px | 10,2 | 6 Abschnitte, 13 Karten | nur Menü / Suche / `g a` |
| Risiko | 7 553 px | 8,9 | 5 Abschnitte, 10 Karten | nur Menü / Suche |
| Coach | 6 518 px | 7,7 | 11 Karten – Verpasste Chancen ab Bildschirm 6, Datenqualität 7 | nur Menü / Suche |
| Berichte | 5 811 px | 6,9 | bis zu 12 Karten | nur Menü / Suche |
| Labor | 8 868 px | 10,5 | 10 Abschnitte (5 erst nach einem Lauf) – TradingView ab Bildschirm 5, Versionen & Playbooks ab 9 | nur Menü / Suche |
| Wachstum | 7 529 px | 8,9 | 6 Abschnitte, 13 Karten – Wochenverlauf ab Bildschirm 8 | nur Menü / Suche |
| Community / Konto | 1 770 / 1 264 px | 2,1 / 1,5 | ohne Cloud je eine Karte | nur Menü / Suche |
| Cockpit | 4 962 px | 5,9 | eigene Widgets | nur Menü / Suche |
| Preise | 5 695 px | 6,7 | Tarife, Vergleich, FAQ | nur Menü / Suche |
| **Funktionen (alt)** | **23 852 px** | **28,3** | **89 Karten in einer Liste, 8 Gruppen** | nur Menü / Suche / `g f` |

**Was dabei auffiel** (der Grund, warum man Dinge „selbst nicht findet“):

1. **Elf der 16 Seiten stehen nicht im Dock** – nur das Menü (⌘K / Symbol oben rechts), die Suche (`/`), `g` + Buchstabe und der Assistent führen hin. Im Menü stand die Funktionsliste
   als 16. Eintrag in einem Raster kleiner Kacheln.
2. **Lange Seiten ohne Inhaltsverzeichnis**: Markt (15 Bildschirme), Einstellungen (16), Analyse, Labor (je 10) – wer „Alarme“ oder „Backup“ suchte, scrollte blind.
3. **Die alte Funktionsseite war selbst ein Scroll-Marathon** (28 Bildschirme, 89 gleich große Karten, 8 Gruppen – „Auswerten & Lernen“ allein mit 29 Karten) und kannte nur 89 Funktionen: 48
   sichtbare Karten hatten keinen Eintrag (11 Auswertungs-Karten der Übersicht, 10 der Analyse, 9 des Wachstums, 3 des Risikos, 10 Einstellungskarten, 2 des Coachs, Trade eintragen, Zuordnen, Tarifvergleich).
   Was nicht im Register stand, fand auch die Suche nicht.
4. **Nur über einen Weg erreichbar** (kein Abschnitt zum Scrollen): Trade-Replay, Was wäre wenn, Üben, Zustand beim Einstieg, Zeichnungen (alle im Trade-Detail), Aus Screenshot übernehmen
   (Editor), CSV-Import, Tastenkürzel und Assistent (Fenster über der Seite). Die Karte unten nennt den Weg.
5. **Nur über den Assistenten** ist keine Seite und keine Karte allein erreichbar (Notizen merken und Sprache gibt es nur im Assistenten selbst); er beantwortet „Wo finde ich …?“ aus demselben Register und öffnet die Stelle.
6. **Gleiche Namen an verschiedenen Orten**: „Serien“ (Risiko, Analyse, Wachstum), „Vergleich“ (Analyse, Labor, Berichte), „Grundregeln“ (Einstellungen und Entscheidungsgrundlagen),
   „Verteilung“ / „R-Verteilung“. Das Register unterscheidet sie mit eigenen Namen („Verlustserien“, „Gewinn- und Verlustserien“, „Laufende Serien“).
7. **Was erst nach einer Aktion da ist** (Labor-Diagnose, Belastungstest, Prüfbericht, Forward-Test-Konten …) oder nur mit Cloud-Konto (Konto, Community, Börse): das Register sagt es (`needs`),
   das Öffnen sagt es ehrlich, statt oben stehen zu bleiben.

## 2. Was jetzt anders ist

- **Seite „Funktionen“**: große Suche „Was willst du tun?“ (versteht Absichten, Tippfehler, Fragesätze), „Zuletzt benutzt“, „Empfohlen / Neu“, **zwölf Aufgaben-Kacheln**, Gruppenliste mit
  Zwischenüberschriften und Details (Fehlt noch, So geht’s, Siehe auch). Mobil 2 865 px (3,4 Bildschirme) statt 23 852 px (28,3) – gemessen mit zehn Kacheln, vor Runde 8; die längste Gruppe („Auswerten & Berichte“) hat jetzt 28 Funktionen in fünf Blöcken zu höchstens sieben.
- **Registry**: 171 Funktionen (vorher 89), jede in genau einer von zwölf Gruppen, mit Aufgabe in einfachen Worten, Absichten, Abschnitt, „Siehe auch“, Status.
- **Inhalt-Leiste** (`SectionNav`) auf Markt, Coach, Analyse, Risiko, Labor, Wachstum, Berichte und Einstellungen: ein Chip je Abschnitt, klebt unter dem Header, markiert den Abschnitt in Sicht.
- **Menü (⌘K / Symbol)**: oben das Feld „Was willst du tun?“ (findet jede Funktion) und der Weg „Alle Funktionen →“; Treffer öffnen die Stelle, scrollen weich dorthin und heben sie kurz hervor.
- **Globale Suche (`/`)**: derselbe Scorer – „warum verliere ich“ findet *Leaks & Edges*.
- Unverändert: Dashboard, Dock, Header-Layout.

## 2b. Zusammenhang & Navigation (Feinschliff, Runde 8)

Nach dem Umbau stand fest, **wo** jede Funktion ist. Jetzt geht es darum, dass Zusammengehöriges auch zusammen steht und sich gegenseitig zeigt.

**Karte der Zusammenhänge** (was zusammengehört, wo es steht, was jetzt verbindet):

| Zusammenhang | Wo es steht | Was jetzt verbindet |
|---|---|---|
| Handelsplan ↔ Zeitmaschine ↔ Verwaltung ↔ Alarme | Plan (5 Schritte), Labor (Zeitmaschine, Verwaltung testen/vergleichen), Markt (Alarme) | eigene Gruppe „Trade planen“ im Register (8 Funktionen, auch die Zeitmaschine); Siehe-auch im Ausstieg (→ Verwaltung testen / vergleichen), im Labor (Zeitmaschine → Handelsplan, Verwaltung → Verwaltung planen); der Ticket-Schritt hat „Plan → 3 Alarme“ schon selbst |
| Aktien ↔ Analyst ↔ Kongress ↔ News | alles auf der Seite Aktien | eigene Gruppe „Aktien beobachten & bewerten“ (7), vorher auf zwei Gruppen und drei Zwischenüberschriften verteilt; Siehe-auch Aktien ↔ Handelsplan / Krypto-Scanner |
| Transaktionsbuch ↔ Berichte ↔ Termine | Buch und Berichte auf einer Seite; Termine auf Markt | Buch steht in der Gruppe „Berichte“; Gebühren & Funding (Analyse) ↔ Transaktionsbuch; Termine gehören zu „Heute wichtig“ und „Ereignisphasen“ (Markt), nicht zu den Berichten |
| Datenarchiv ↔ Squeeze ↔ Box | Archiv in Einstellungen, Squeeze und Box auf Markt | die Squeeze-Karte führt selbst zum Archiv (Knöpfe, wo es leer ist); die Archiv-Karte führt zurück (Siehe auch) |
| Playbooks ↔ Labor ↔ Forward-Test | alle im Labor, „Teilen per Link“ in Community | Playbook, Forward-Test und Versionen als Nachbarn im Register; Siehe-auch Community (Teilen) → Playbook |
| Belege ↔ Community | Ergebnisbeleg in Community, Bericht-Export in Berichte | Siehe-auch im Export → Ergebnisbeleg (nur mit Cloud-Konto) |
| Tagesplan ↔ Handelsplan | Markt, Plan | Siehe-auch unter dem Tagesplan |
| Positionsrechner ↔ Handelsplan | Risiko, Plan | Siehe-auch im Rechner |

**Seiten und Tasten.** Reihenfolge überall dieselbe: Übersicht, Trades, Entscheidungsgrundlagen, Markt, Einstellungen (das Dock), dann Handelsplan, Aktien, Risiko · Analyse, Berichte, Coach, Wachstum ·
Labor, Strategie-Studio · Community, Cockpit, Konto, Preise, Funktionen. In der Befehlsnavigation sind die Zahlen 1–5 genau die Dock-Tabs (vorher stand „Einstellungen“ auf 4 und „Markt“ auf 5);
6–9 sind Handelsplan, Aktien, Risiko, Analyse. `[` und `]` laufen in derselben Reihenfolge, die Seitenwechsel schieben in dieser Richtung, die Buchstaben nach `g` stehen so im Tastenblatt
(h Handelsplan, i Aktien, u Strategie-Studio, f Funktionen, …; je Seite ein Buchstabe, geprüft). Die jüngsten Seiten (Handelsplan, Aktien, Strategie-Studio) tragen in der Navigation ein kleines „Neu“, bis sie einmal offen waren.

**Glossar (ein Wort pro Ding).**

| Wort | Bedeutung hier | Nicht zu verwechseln mit |
|---|---|---|
| Entscheidungsgrundlage | Regeln und Checkliste, die du bei einem Trade wählst (Seite, Dock, Auswahl im Trade); im Alltag oft „Setup“ | **Setup** in Markt und Aktien: ein vom Scanner gefundener Chart-Aufbau (Box-Setup, Scanner-Treffer) |
| Box | Preisspanne mit Rand oben und unten (Box-zu-Box-Chart) | – |
| Schlüsselmarke | eigener Preis mit Regel, Status und Alarm (Markt) | **Chart-Level**: feste Linien aus den Einstellungen (Trigger, Invalidierung) |
| Tagesplan · Handelsplan · Verbesserungsplan | der ganze Tag in vier Szenarien (Markt) · ein einzelner Trade in fünf Schritten (Seite Handelsplan) · die nächsten Schritte im Coach | – |
| Ticket | der fertige Plan als Text oder CSV zum Kopieren; die App sendet nie eine Order | Order |
| Verwaltung | was nach dem Einstieg geschieht (Break-even, Trailing, Teilziel): planen (Handelsplan), testen (Labor), vergleichen (Labor) | – |
| Backtest · Forward-Test · Zeitmaschine · Replay | Regel auf alter Historie · Regel live auf neuen Kerzen (virtuelles Konto) · ein Plan durch viele neu gemischte und echte frühere Sitzungen (Wahrscheinlichkeit) · einen eigenen Trade Kerze für Kerze nachspielen | Demokonto (nur in der Demo) |
| Datenarchiv | Marktzahlen, die diese App auf diesem Gerät mitschreibt (aus, bis du es einschaltest) | Börsenhistorie nachladen: einmal die letzten Tage von der Börse holen |
| Check-in · Bereit-Check · Einstiegs-Check · Risiko-Check | täglicher Zustand · Hinweis, ob du gerade handeln solltest · Regelprüfung eines Einstiegs · Plan gegen deine Limits | – |
| Serien | Verlustserien (Risiko), Gewinn- und Verlustserien (Analyse), Gewohnheits-Serien (Wachstum) | – |
| Watchlist | deine Titel (Krypto und Aktien) | früher auch „Beobachtungsliste“ (jetzt nur noch als Suchwort) |
| Beleg | nachprüfbarer Ergebnislink (Community) | die Belege einer Wochenreview-Aussage (Trades als Beweis) |

## 3. Die Karte

Zeile = eine Funktion. „Seite › Abschnitt“ nennt die Karte auf der Seite in ihren eigenen Worten („Fenster“ = ein Blatt über der aktuellen Seite, „–“ + Weg = nichts zum Scrollen, sondern
ein Weg durch die Oberfläche). Der Stand sagt ehrlich, ob die Funktion nur teilweise tut, was ihr Satz sagt (Lücken: Details-Knopf in der Seite oder `note` im Register). Die Tabelle erzeugt
`UEBERSICHT_WRITE=1 npx vitest run tests/unit/features.overview.test.ts` aus dem Register; ohne die Variable prüft derselbe Test, dass sie noch stimmt.

<!-- karte:start (erzeugt aus src/app/features.ts – nicht von Hand ändern) -->

### Heute vorbereiten

_Lage, Plan, Marken und Check-in vor dem ersten Trade._ · 9 Funktionen

**Lage & Plan**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, ob der Markt heute Vorsicht verlangt | Lage-Ampel | Übersicht › Lage-Ampel | teilweise |
| Den Tag mit Terminen, Märkten und Marken überblicken | Morgenbriefing „Heute wichtig“ | Markt › Heute wichtig | teilweise |
| Den Tag in vier Szenarien durchdenken | Tagesplan | Markt › Tagesplan | fertig |
| Preislevel festlegen, die du beobachten willst | Schlüsselmarken | Markt › Schlüsselmarken | fertig |

**Alarme**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Dich benachrichtigen lassen, wenn eine Marke erreicht wird | Alarme & Zustellprotokoll | Markt › Alarme & Zustellprotokoll | teilweise |
| Per E-Mail Bescheid bekommen, auch wenn die App zu ist | E-Mail-Alarm bei geschlossener App | Markt › Alarme & Zustellprotokoll › E-Mail-Alarm | teilweise |

**Dein Zustand**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Kurz festhalten, wie fit du heute bist | Täglicher Check-in | Wachstum › Check-in | fertig |
| Prüfen, ob du gerade handeln solltest | Bereit-Check vor dem Trade | Wachstum › Bereit für den nächsten Trade? | fertig |
| Sehen, was heute in deinen Trades auffällt | Heute im Coach | Coach › Heute | fertig |

### Trade prüfen & Chart

_Einstieg prüfen, Chancen finden, den Chart lesen._ · 16 Funktionen

**Einstieg prüfen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prüfen, ob ein Einstieg gerade gültig ist | Einstiegs-Check | Übersicht › Einstiegs-Check | fertig |
| Verstehen, warum der Check handeln oder auslassen sagt | Warum handeln oder auslassen? | Übersicht › Warum handeln oder auslassen? | fertig |
| Den Chart spiegeln und die These neu prüfen | Chart spiegeln / Bias prüfen | Markt › Bias-Test | fertig |
| Positionsgröße aus Risiko und Stop berechnen | Positionsrechner | Risiko › Rechner | fertig |

**Chancen finden**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Die stärksten Setups mit Plan sehen | Beste Setups | Markt › Beste Setups | fertig |
| Deine Watchlist nach Setups absuchen | Chancen-Scanner | Markt › Watchlist-Scanner | teilweise |
| Prüfen, was nach ähnlichen Lagen geschah | Ähnliche Situationen | Markt › Ähnliche Situationen | fertig |
| Sehen, wie die Top-Trader positioniert sind | Top-Trader-Positionierung | Übersicht › Top Trader · Binance | fertig |
| Sehen, ob die größten Konten netto Long oder Short sind – und seit wann | Top-Trader netto (Binance) | Übersicht › Einstiegs-Check › Top-Trader (Binance) | teilweise |
| Prüfen, ob eine Seite des Marktes überfüllt ist | Squeeze-Beobachtung | Markt › Squeeze-Beobachtung | teilweise |
| Termine sehen, die für den Handel zählen | Ereigniskalender | Markt › Termine | teilweise |

**Chart lesen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Den Live-Chart mit Boxen (Preisspannen) und Zielen ansehen | Box-zu-Box-Chart | Markt › Box-Chart | fertig |
| Sehen, in welcher Phase die Box gerade ist | Box-Status | Markt › Box-Status | teilweise |
| Trendlinien auf Preis und RSI prüfen | Preis- & RSI-Struktur | Markt › Preis- & RSI-Struktur | fertig |
| Linien und Pfeile in den Chart eines Trades zeichnen | Zeichnungen im Trade-Chart | Trades – Trades → Trade öffnen → Chart → Zeichnen | teilweise |
| Scanner, Mindestnote und Box-Alarme einstellen | Box-Einstellungen & Box-Alarme | Markt › Box-Einstellungen | fertig |

### Aktien beobachten & bewerten

_Scannen, beobachten, lesen und bewerten – Aktien und Krypto._ · 7 Funktionen

**Finden & beobachten**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Aktien und Krypto nach Chart-Setups absuchen | Aktien-Scanner | Aktien › Scanner | teilweise |
| Titel merken und ihren Kurs im Blick behalten | Watchlist (Aktien und Krypto) | Aktien › Watchlist | fertig |
| Schlagzeilen zu deiner Watchlist lesen | News-Monitor (Watchlist) | Aktien › News | teilweise |
| Sehen, welche Aktiengeschäfte Mitglieder des US-Kongresses gemeldet haben | Kongress-Tracker | Aktien › Kongress | teilweise |

**Zahlen & Bewertung**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, was eine Firma zuletzt gemeldet hat | Zahlen-Analyst | Aktien › Analyse · Zahlen | teilweise |
| Den fairen Wert einer Aktie aus künftigen Gewinnen als Spanne rechnen | DCF-Rechner | Aktien › Analyse · Bewertung | fertig |
| Eine Kaufthese festhalten und gegen neue Zahlen prüfen | Kaufthese | Aktien › Analyse · These | teilweise |

### Trade planen

_Vom Einstieg über Stop und Größe bis zum Ticket – und durchgespielt._ · 8 Funktionen

**Plan bauen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Den Moment finden, in dem der Kurs aus seiner Spanne ausbricht | Handelsplan: Einstieg | Handelsplan › Einstieg | teilweise |
| Stop und Ziel festlegen, bevor du einsteigst | Handelsplan: Ausstieg (Stop und Ziel) | Handelsplan › Ausstieg | fertig |
| Vor dem Einstieg festlegen, wann der Stop nachgezogen wird | Handelsplan: Verwaltung planen | Handelsplan › Ausstieg · Verwaltung nach dem Einstieg | fertig |
| Eine Größe wählen, die deine Limits einhält | Handelsplan: Größe | Handelsplan › Größe | teilweise |

**Plan prüfen & mitnehmen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prüfen, ob der Plan deine Grenzen einhält | Handelsplan: Risiko-Check | Handelsplan › Risiko-Check | fertig |
| Prüfen, ob sich deine Größe gerade sauber handeln lässt | Handelsplan: Ausführbarkeit jetzt (Spread und Tiefe) | Handelsplan › Ticket › Ausführbarkeit jetzt | teilweise |
| Einen Handelsplan durchspielen, bevor Geld im Spiel ist | Zeitmaschine (Plan durchspielen) | Labor › Zeitmaschine | fertig |
| Den fertigen Plan als Text oder CSV mitnehmen | Handelsplan: Ticket zum Kopieren | Handelsplan › Ticket | fertig |

### Risiko & Disziplin

_Limits, Exposure und Regeln, bevor es teuer wird._ · 12 Funktionen

**Offenes Risiko**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, wie viel Risiko gerade offen ist | Gesamtrisiko & Exposure | Risiko › Exposure | fertig |
| Prüfen, welche Märkte gemeinsam laufen | Korrelation der Märkte | Risiko › Korrelation | fertig |
| Den Abstand zur Liquidation prüfen | Margin & Liquidation | Risiko › Liquidation | teilweise |
| Durchspielen, was ein Kurssprung mit deinen Positionen macht | Szenario-Schock | Risiko › Szenario | fertig |

**Limits & Regeln**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Tages- und Wochenverlust im Blick behalten | Verlustlimits & Pause | Risiko › Live-Limits | fertig |
| Tagesverlust, Trade-Risiko und Trades pro Tag einstellen | Risiko-Einstellungen | Risiko › Risiko-Einstellungen | fertig |
| Tagesverlust und Trade-Anzahl begrenzen | Disziplin-Grenzen | Einstellungen › Disziplin-Grenzen | fertig |
| Deine festen Handelsregeln pflegen | Grundregeln | Einstellungen › Grundregeln | fertig |

**Serien & Ruin**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prüfen, wie lang Verlustserien bei deiner Trefferquote werden können | Verlustserien | Risiko › Serien | fertig |
| Durchspielen, wie schlimm eine Pechsträhne werden kann | Monte Carlo & Verlustserien | Analyse › Monte Carlo | fertig |
| Das Risiko eines großen Kontoverlusts abschätzen | Risk of Ruin | Analyse › Risk of Ruin | fertig |
| Sehen, welche Strategie wie viel Risiko trägt | Risiko je Strategie | Risiko › Risiko je Strategie | fertig |

### Strategie entwickeln & testen

_Eine Idee bauen und gegen echte Historie prüfen._ · 23 Funktionen

**Idee bauen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Eine Strategie in eigenen Worten aufschreiben und testen | Strategie-Studio (Strategie als Text) | Strategie-Studio › Strategie-Studio | teilweise |
| Eigene Handelsregeln aus Bausteinen bauen | Eigene Idee (Regelbaukasten) | Labor › Strategie & Kosten | teilweise |
| Weitere Indikatoren in deinen Regeln nutzen | Indikator-Bausteine (Donchian bis Funding) | Labor › Strategie & Kosten · Eigene Idee | teilweise |
| Mit einer bekannten Strategie als Vorlage starten | Strategie-Bibliothek (32 Vorlagen) | Labor › Strategie & Kosten · Eigene Idee | teilweise |
| Break-even, Trailing und Teilziel testen | Verwaltung testen: Break-even, Trailing & Teilziel | Labor › Strategie & Kosten | teilweise |
| Ein Setup oder Signal als Idee ins Labor übernehmen | Diese Idee testen | Markt › Beste Setups | fertig |
| Frühere Fassungen deines Entwurfs ansehen | Versionen der Entwürfe | Labor › Versionen deiner Entwürfe | fertig |

**Test & Ergebnis**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Eine Strategie auf echter Historie testen | Backtest-Labor | Labor | fertig |
| Verstehen, warum ein Test schwach ausfiel | Diagnose: Warum so schwach? | Labor › Diagnose | fertig |
| Mehrere Testläufe nebeneinander vergleichen | Läufe vergleichen | Labor › Vergleich | fertig |
| Prüfen, ob die Strategie zu deinem Handeln passt | Passt die Strategie zu dir? | Labor › Passt zu dir? | teilweise |

**Härtetest**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prüfen, ob die Strategie höhere Kosten übersteht | Kosten- und Belastungstest | Labor › Kosten- und Belastungstest | fertig |
| Den Test auf Ausreißer und Datenlücken prüfen | Strategie-Prüfbericht | Labor › Strategie-Prüfbericht | fertig |
| Prüfen, ob die Strategie nur zur Vergangenheit passt (Overfitting) | Robustheit: Overfitting, Walk-forward, Heatmap | Labor › Overfitting-Check | fertig |
| Prüfen, wie empfindlich die Idee auf Zahlen reagiert | Parameter-Raster | Labor › Parameter-Raster | fertig |
| Sehen, was jeder Filter wirklich bringt | Varianten- und Filtervergleich | Labor › Varianten- und Filtervergleich | teilweise |
| Sehen, ob Break-even oder Trailing dem Ergebnis hilft oder schadet | Verwaltung vergleichen | Labor › Verwaltung vergleichen | fertig |
| Eine Strategie schrittweise verbessern lassen, ohne dich zu überanpassen | Hintergrund-Optimierer | Labor › Optimierer | teilweise |

**Live prüfen & teilen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Eine Regel auf neuen Kerzen live mitlaufen lassen | Forward-Test (virtuelles Konto) | Labor › Forward-Test | fertig |
| TradingView-Ergebnisse mit dem Labor vergleichen | TradingView-Vergleich | Labor › Export gegen Labor-Lauf | teilweise |
| Prüfen, ob das Labor einen Indikator wie TradingView rechnet | Indikator-Vertrag und Abgleich | Labor › Indikator-Vertrag und Abgleich | teilweise |
| Aus deiner Idee ein TradingView-Skript machen | Pine-Export für TradingView | Labor › Pine-Skript für TradingView | fertig |
| Eine Strategie als Datei weitergeben oder einlesen | Playbook exportieren und importieren | Labor › Playbook austauschen | teilweise |

### Aus Fehlern lernen

_Warum du verlierst, was du verpasst, was du ändern kannst._ · 17 Funktionen

**Fehler & Muster**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, wo du Geld verlierst und wo dein Vorteil liegt | Leaks & Edges | Coach › Leaks & Edges | fertig |
| Muster wie Revenge-Trading und Overtrading erkennen | Verhaltensmuster & Timeline | Coach › Timeline | fertig |
| Sehen, was dich deine Fehler gekostet haben | Fehler-Kosten | Übersicht › Fehler-Kosten | fertig |
| Eigene Fehler-Stichworte für Trades festlegen | Fehler-Tags festlegen | Einstellungen › Fehler-Tags | fertig |
| Herausfinden, was deine Gewinner und Verlierer gemeinsam haben | Muster-Entdecker | Labor › Muster-Entdecker | fertig |

**Coach**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Deine teuersten Muster und die Lektion der Woche sehen | Coach | Coach › Coach | fertig |
| Dem Coach Fragen zu deinen Trades stellen | Frag deinen Coach | Coach › Frag deinen Coach | fertig |
| Die drei wichtigsten nächsten Schritte sehen | Verbesserungsplan | Coach › Verbesserungsplan | fertig |
| Dein Handelsprofil in Eigenschaften sehen | Dein Handelsprofil | Coach › Dein Profil | fertig |

**Signale**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Alle Meldungen der App an einem Ort ansehen | Signal-Posteingang | Coach › Signal-Posteingang | teilweise |
| Signale sehen, die du nicht gehandelt hast | Verpasste Chancen | Coach › Verpasste Chancen | teilweise |
| Prüfen, was nach einem Signal wirklich passierte | Ausgang je Signal | Coach › Verpasste Chancen | fertig |
| Auswerten, wie gut deine Signale waren | Signalbilanz | Coach › Signalbilanz | teilweise |

**Trades nachbereiten**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einen Trade Kerze für Kerze nachspielen | Trade-Replay | Trades – Trades → Trade öffnen → Replay | fertig |
| Einen Trade mit anderem Stop oder Ausstieg nachrechnen | Was wäre wenn | Trades – Trades → Trade öffnen → Was wäre wenn | fertig |
| Nachlesen, wie der Check beim Einstieg aussah | Zustand beim Einstieg | Trades – Trades → Trade öffnen → Signal beim Einstieg | teilweise |
| Die Begründung oder eine Notiz zum Trade einsprechen | Spracheingabe für Notizen | Trades – Trade eintragen → Begründung → Diktieren | teilweise |

### Auswerten & Berichte

_Kennzahlen, Verläufe und Berichte zu deinen Trades._ · 28 Funktionen

**Berichte**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einen Bericht für Woche, Monat oder Jahr lesen | Wochen- & Monatsberichte | Berichte | fertig |
| Die Woche mit Befunden und Belegen durchgehen | Wochenreview | Berichte › Wochenreview | fertig |
| Sehen, was dir das Journal im Monat gebracht hat | Persönlicher Monatsnutzen | Berichte › Persönlicher Monatsnutzen | fertig |
| Einen kurzen Rückblick auf Woche oder Monat lesen | Rückblick | Übersicht › Rückblick | fertig |
| Käufe, Verkäufe, Gebühren und Funding als Buch prüfen | Transaktionsbuch | Berichte › Transaktionsbuch | teilweise |
| Berichte als PDF, CSV oder Markdown speichern | Berichte exportieren | Berichte › Export | fertig |

**Kennzahlen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Die wichtigsten Kennzahlen deines Tradings mit Unsicherheit sehen | Kennzahlen (Sharpe, SQN, Kelly) | Analyse › Kennzahlen | fertig |
| Einen Überblick über deinen Vorteil bekommen | Edge-Score | Übersicht › Edge-Score | fertig |
| Die auffälligsten Befunde aus deinen Trades lesen | Erkenntnisse | Übersicht › Erkenntnisse | fertig |
| Das Ergebnis nach Setup, Session oder Wochentag aufteilen | Aufschlüsselung nach Setup, Session, Wochentag … | Analyse › Breakdown | fertig |
| Sehen, was Gebühren und Funding dich kosten | Gebühren & Funding | Analyse › Kosten | fertig |
| Eine eigene Kennzahl berechnen lassen | Eigene Kennzahl | Analyse › Eigene Kennzahl | fertig |

**Vergleiche**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Dich mit dem Markt vergleichen | Benchmark: Konto gegen Markt | Analyse › Benchmark | fertig |
| Zwei Zeiträume, Konten oder Setups vergleichen | Zeiträume und Konten vergleichen | Analyse › Vergleich | fertig |
| Vergleichen, wie eigene, Regelwerk- und KI-Trades abschneiden | Mensch, Regelwerk oder KI – wer entscheidet besser? | Analyse › Vergleich · Entscheidung | teilweise |

**Wann und wo**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, zu welcher Zeit du am besten tradest | Wochentag × Uhrzeit | Analyse › Wochentag × Uhrzeit | fertig |
| Sessions und Tageszeiten deiner Trades vergleichen | Zeit & Session | Übersicht › Zeit & Session | fertig |
| Gute und schlechte Tage im Kalender sehen | P&L-Kalender | Übersicht › P&L-Kalender | fertig |
| Prüfen, ob starke Signale besser abschneiden | Ergebnis nach Signal-Stärke | Übersicht › Ergebnis nach Signal-Stärke | fertig |
| Sehen, wie diszipliniert du gehandelt hast | Disziplin-Auswertung | Übersicht › Disziplin | fertig |
| Prüfen, wie die Trades rund um Termine liefen | Ereignisphasen und Terminfilter | Markt › Ereignisphasen | teilweise |

**Verlauf & Verteilung**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Den Verlauf deiner Rückschläge ansehen | Drawdown-Verlauf | Übersicht › Drawdown | fertig |
| Sehen, wie sich deine Ergebnisse in R verteilen | R-Verteilung | Übersicht › R-Verteilung | fertig |
| Gewinner und Verlierer gegenüberstellen | Gewinner vs. Verlierer | Übersicht › Gewinner vs. Verlierer | fertig |
| Prüfen, ob wenige Ausreißer dein Ergebnis tragen | Verteilung und Ausreißer | Analyse › Verteilung | fertig |
| Sehen, ob sich deine Form verbessert oder verschlechtert | Rollierende Form | Analyse › Rollierend | fertig |
| Prüfen, ob deine Serien normal sind | Gewinn- und Verlustserien | Analyse › Serien | fertig |
| Prüfen, wie weit Trades gegen oder für dich liefen | MAE / MFE | Analyse › MAE / MFE | fertig |

### Üben & Wachsen

_Training, Ziele, Gewohnheiten und Fortschritt._ · 13 Funktionen

**Üben**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Situationen aus deinem Journal üben | Üben (Lernmodus) | Trades (Fenster: training) | fertig |
| Eine Verbesserung eine Woche lang ausprobieren | Wochenexperiment | Berichte › Wochenexperiment | fertig |

**Gewohnheiten & Ziele**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prozessziele setzen und verfolgen | Ziele, Challenges & Gewohnheiten | Wachstum › Aktive Ziele | fertig |
| Eine Challenge starten | Challenges | Wachstum › Challenges | fertig |
| Tägliche Gewohnheiten abhaken | Gewohnheiten | Wachstum › Gewohnheiten | fertig |
| Sehen, wie lange du bei deinen Gewohnheiten dranbleibst | Gewohnheits-Serien | Wachstum › Laufende Serien | fertig |

**Psyche**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, wie Schlaf und Stimmung mit deinen Trades zusammenhängen | Check-in und Handelstag | Wachstum › Check-in und Handelstag | fertig |
| Stimmung und Ergebnis gegenüberstellen | Stimmung & Ergebnis | Wachstum › Stimmung & Ergebnis | fertig |
| Gefühle zu Trades festhalten | Emotionstagebuch | Wachstum › Emotionstagebuch | fertig |
| Typische Muster über die Zeit verfolgen | Muster-Tracker | Wachstum › Muster-Tracker | fertig |

**Fortschritt**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Deine Fähigkeiten als Stufen sehen | Skill-Stufen | Wachstum › Skill-Stufen | fertig |
| Persönliche Bestleistungen und Meilensteine sehen | Bestleistungen | Wachstum › Bestleistungen | fertig |
| Deinen Fortschritt Woche für Woche sehen | Wochenverlauf | Wachstum › Wochenverlauf | fertig |

### Trades eintragen & Daten

_Trades hineinbekommen, ordnen, sichern und prüfen._ · 16 Funktionen

**Eintragen & importieren**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einen Trade von Hand eintragen | Trade eintragen | Übersicht › Trade eintragen | fertig |
| Festlegen, welche Felder du beim Eintragen immer siehst | Trade-Formular anpassen | Übersicht › Trade eintragen › Felder anpassen | fertig |
| Einen neuen Trade mit den Einstellungen des letzten starten | Letzten Trade duplizieren | Trades › Alle Trades | fertig |
| Trades aus einem Screenshot deiner Börsen-Historie eintragen | Screenshot importieren | Trades (Fenster: shotImport) | fertig |
| Einen Trade aus einem Screenshot übernehmen | Aus Screenshot übernehmen (KI, optional) | Übersicht › Trade eintragen | fertig |
| Trades aus einer CSV-Datei einlesen | CSV-Import | Einstellungen › Daten | fertig |
| Deine Börse verbinden, damit Trades von selbst kommen | Börsen-Anbindung (Bitunix) | Konto | fertig |
| Trades per TradingView-Alert oder Webhook anlegen lassen | TradingView-Webhook & API | Konto | teilweise |

**Ansehen & ordnen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Deine Trades filtern, sortieren und Ansichten speichern | Trades filtern & Ansichten speichern | Trades | fertig |
| Trades automatisch einem Setup zuordnen | Trades automatisch zuordnen | Entscheidungsgrundlagen › Automatisch zuordnen | fertig |
| Deine Setups durchsuchen und vergleichen | Entscheidungsgrundlagen (deine Setups) | Entscheidungsgrundlagen › Entscheidungsgrundlagen | teilweise |

**Sichern & prüfen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Das Journal sichern oder wiederherstellen | Backup & Wiederherstellung | Einstellungen › Daten | fertig |
| Prüfen, ob die Marktdaten aktuell sind | Datenstatus | Einstellungen › Live-Daten | teilweise |
| Marktzahlen und Analyse-Stände auf diesem Gerät aufzeichnen | Datenarchiv | Einstellungen › Datenarchiv | teilweise |
| Die letzten Tage Marktzahlen von Binance einmal nachholen | Börsenhistorie nachladen | Einstellungen › Datenarchiv › Börsenhistorie nachladen | teilweise |
| Prüfen, ob Alarme und Kerzen zuverlässig angekommen sind | Daten- und Alarmqualität | Coach › Daten- und Alarmqualität | teilweise |

### Community & Teilen

_Gruppen, Mentoren und Teilen – freiwillig und datensparsam._ · 7 Funktionen

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einer Gruppe beitreten oder eine anlegen | Gruppen & Einladungen | Community | teilweise |
| Mit einem Mentor oder Schüler zusammenarbeiten | Mentor-Modus | Community | fertig |
| Trades in der Gruppe besprechen | Reviews & Kommentare | Community | fertig |
| Eine Kursstrecke in der Gruppe vorab einschätzen und später prüfen | Chartfälle mit Hypothese vorab | Community › Gruppe › Chartfälle | fertig |
| Einen Trade oder ein Setup per Link teilen | Teilen per Link | Community | teilweise |
| Deine Ergebnisse als nachprüfbaren Beleg teilen | Ergebnisbeleg | Community › Teilen › Ergebnisbeleg | fertig |
| Dich freiwillig mit anderen vergleichen | Rangliste (freiwillig) | Community | teilweise |

### Konto, Einstellungen & Hilfe

_Konto, Tarif, Oberfläche, Einstellungen und Hilfe._ · 18 Funktionen

**Konto & Tarif**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Anmelden, synchronisieren und das Konto verwalten | Konto & Cloud-Sync | Konto | fertig |
| Tarif wählen, Abo verwalten oder kündigen | Abo & Tarife | Preise | fertig |
| Sehen, welcher Tarif welche Funktion enthält | Tarife im Vergleich | Preise › Alle Funktionen im Vergleich | fertig |
| Freunde einladen und Gutschrift erhalten | Freunde einladen (Empfehlungscode) | Konto | teilweise |

**Einstellungen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Startkapital, Währung und Konten festlegen | Konten und Startkapital | Einstellungen › Konten | fertig |
| Zeiteinheiten, Gewichte und Schwellen des Einstiegs-Checks anpassen | Einstiegs-Check einstellen | Einstellungen › Einstiegs-Check | fertig |
| Die Lage-Ampel ein- oder ausschalten und anpassen | Lage-Ampel einstellen | Einstellungen › Lage-Ampel | fertig |
| Feste Preislevel für den Chart eintragen | Chart-Level (feste Linien) | Einstellungen › Chart-Level · manuell | fertig |
| Deine Backtest-Zahlen als Vergleichswert hinterlegen | Backtest-Referenz | Einstellungen › Backtest-Referenz | fertig |
| Hyblock-Daten anbinden | Hyblock-Connector | Einstellungen › Hyblock-Connector | fertig |
| App installieren, Speicher und Version ansehen | Version & Speicher | Einstellungen › Version & Speicher | fertig |

**Hilfe & Oberfläche**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Hell, Dunkel und Akzentfarbe wählen | Darstellung: Hell, Dunkel, Akzent | Einstellungen › Darstellung | fertig |
| Dein eigenes Dashboard zusammenstellen | Eigenes Dashboard (Cockpit) | Cockpit | fertig |
| Fragen stellen und die App per Sprache bedienen | Assistent | Übersicht (Fenster: assistant) | teilweise |
| Mit Tasten schneller navigieren | Tastenkürzel | Einstellungen (Fenster: shortcuts) | fertig |
| Nachlesen, was eine Kennzahl bedeutet | Erklärungen zu Kennzahlen | Übersicht – Karten und Kacheln mit Info-Symbol antippen (Übersicht, Markt, Setups) | teilweise |
| Die Einführung noch einmal ansehen | Einführung noch einmal ansehen | Einstellungen › Einführung & Hilfe | fertig |
| Die App in fünf Schritten mit Beispieldaten ausprobieren | Demo mit Beispieldaten | Funktionen › Demo ausprobieren | fertig |

<!-- karte:end -->
