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

- **Seite „Funktionen“**: große Suche „Was willst du tun?“ (versteht Absichten, Tippfehler, Fragesätze), „Zuletzt benutzt“, „Empfohlen / Neu“, **zehn Aufgaben-Kacheln**, Gruppenliste mit
  Zwischenüberschriften und Details (Fehlt noch, So geht’s, Siehe auch). Mobil 2 865 px (3,4 Bildschirme) statt 23 852 px (28,3); selbst die längste Gruppe („Strategie entwickeln & testen“, 20 Funktionen) hat 4 186 px.
- **Registry**: 137 Funktionen (vorher 89), jede in genau einer Gruppe, mit Aufgabe in einfachen Worten, Absichten, Abschnitt, „Siehe auch“, Status.
- **Inhalt-Leiste** (`SectionNav`) auf Markt, Coach, Analyse, Risiko, Labor, Wachstum, Berichte und Einstellungen: ein Chip je Abschnitt, klebt unter dem Header, markiert den Abschnitt in Sicht.
- **Menü (⌘K / Symbol)**: oben das Feld „Was willst du tun?“ (findet jede Funktion) und der Weg „Alle Funktionen →“; Treffer öffnen die Stelle, scrollen weich dorthin und heben sie kurz hervor.
- **Globale Suche (`/`)**: derselbe Scorer – „warum verliere ich“ findet *Leaks & Edges*.
- Unverändert: Dashboard, Dock, Header-Layout.

## 3. Die Karte

Zeile = eine Funktion. „Seite › Abschnitt“ nennt die Karte auf der Seite in ihren eigenen Worten („Fenster“ = ein Blatt über der aktuellen Seite, „–“ + Weg = nichts zum Scrollen, sondern
ein Weg durch die Oberfläche). Der Stand sagt ehrlich, ob die Funktion nur teilweise tut, was ihr Satz sagt (Lücken: Details-Knopf in der Seite oder `note` im Register). Die Tabelle erzeugt
`UEBERSICHT_WRITE=1 npx vitest run tests/unit/features.overview.test.ts` aus dem Register; ohne die Variable prüft derselbe Test, dass sie noch stimmt.

<!-- karte:start (erzeugt aus src/app/features.ts – nicht von Hand ändern) -->

### Heute vorbereiten

_Lage, Plan, Marken und Check-in vor dem ersten Trade._ · 8 Funktionen

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, ob der Markt heute Vorsicht verlangt | Lage-Ampel | Übersicht › Lage-Ampel | teilweise |
| Den Tag in vier Szenarien durchdenken | Tagesplan | Markt › Tagesplan | fertig |
| Preislevel festlegen, die du beobachten willst | Schlüsselmarken | Markt › Schlüsselmarken | fertig |
| Kurz festhalten, wie fit du heute bist | Täglicher Check-in | Wachstum › Check-in | fertig |
| Prüfen, ob du gerade handeln solltest | Bereit-Check vor dem Trade | Wachstum › Bereit für den nächsten Trade? | fertig |
| Dich benachrichtigen lassen, wenn eine Marke erreicht wird | Alarme & Zustellprotokoll | Markt › Alarme & Zustellprotokoll | teilweise |
| Sehen, was heute in deinen Trades auffällt | Heute im Coach | Coach › Heute | fertig |
| Den Tag mit Terminen, Märkten und Marken überblicken | Morgenbriefing „Heute wichtig“ | Markt › Heute wichtig | teilweise |

### Trade prüfen & Chart

_Einstieg prüfen, Chancen finden, den Chart lesen._ · 24 Funktionen

**Einstieg prüfen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Prüfen, ob ein Einstieg gerade gültig ist | Einstiegs-Check | Übersicht › Einstiegs-Check | fertig |
| Verstehen, warum der Check handeln oder auslassen sagt | Warum handeln oder auslassen? | Übersicht › Warum handeln oder auslassen? | fertig |
| Positionsgröße aus Risiko und Stop berechnen | Positionsrechner | Risiko › Rechner | fertig |
| Den Chart spiegeln und die These neu prüfen | Chart spiegeln / Bias prüfen | Markt › Bias-Test | fertig |

**Chancen finden**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Die stärksten Setups mit Plan sehen | Beste Setups | Markt › Beste Setups | fertig |
| Deine Beobachtungsliste nach Setups absuchen | Chancen-Scanner | Markt › Watchlist-Scanner | teilweise |
| Aktien und Krypto nach Chart-Setups absuchen | Aktien-Scanner | Aktien › Scanner | teilweise |
| Prüfen, was nach ähnlichen Lagen geschah | Ähnliche Situationen | Markt › Ähnliche Situationen | fertig |
| Sehen, wie die Top-Trader positioniert sind | Top-Trader-Positionierung | Übersicht › Top Trader · Binance | fertig |
| Prüfen, ob eine Seite des Marktes überfüllt ist | Squeeze-Beobachtung | Markt › Squeeze-Beobachtung | teilweise |
| Termine sehen, die für den Handel zählen | Ereigniskalender | Markt › Termine | teilweise |

**Aktien beobachten**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Titel merken und ihren Kurs im Blick behalten | Watchlist (Aktien und Krypto) | Aktien › Watchlist | fertig |
| Schlagzeilen zu deiner Watchlist lesen | News-Monitor (Watchlist) | Aktien › News | teilweise |
| Sehen, welche Aktiengeschäfte Kongressmitglieder gemeldet haben | Kongress-Tracker | Aktien › Kongress | teilweise |

**Chart & Einstellungen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Den Live-Chart mit Boxen und Zielen ansehen | Box-zu-Box-Chart | Markt › Box-Chart | fertig |
| Sehen, in welcher Phase die Box gerade ist | Box-Status | Markt › Box-Status | teilweise |
| Trendlinien auf Preis und RSI prüfen | Preis- & RSI-Struktur | Markt › Preis- & RSI-Struktur | fertig |
| Linien und Pfeile in den Chart eines Trades zeichnen | Zeichnungen im Trade-Chart | Trades – Trades → Trade öffnen → Chart → Zeichnen | teilweise |
| Scanner, Mindestnote und Box-Alarme einstellen | Box-Einstellungen & Box-Alarme | Markt › Box-Einstellungen | fertig |

**Handelsplan**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Den Moment finden, in dem die Range bricht | Einstiegs-Timer (Handelsplan) | Handelsplan › Einstieg | teilweise |
| Stop und Ziel festlegen, bevor man einsteigt | Ausstiegsplan: Stop und Ziel (Handelsplan) | Handelsplan › Ausstieg | fertig |
| Ganze Einheiten innerhalb deiner vier Grenzen wählen | Positionsgröße im Handelsplan | Handelsplan › Größe | teilweise |
| Prüfen, ob der Plan deine Grenzen einhält | Risiko-Check des Handelsplans | Handelsplan › Risiko-Check | fertig |
| Den fertigen Plan als Text oder CSV mitnehmen | Ticket zum Kopieren (Handelsplan) | Handelsplan › Ticket | fertig |

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
| Break-even, Trailing und Teilziel testen | Break-even, Trailing & Teilziel | Labor › Strategie & Kosten | teilweise |
| Ein Setup oder Signal als Idee ins Labor übernehmen | Diese Idee testen | Markt › Beste Setups | fertig |
| Deine Setups durchsuchen und vergleichen | Setup-Bibliothek (Journal) | Entscheidungsgrundlagen › Entscheidungsgrundlagen | teilweise |
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
| Prüfen, ob das Ergebnis nur Overfitting ist | Robustheit: Overfitting, Walk-forward, Heatmap | Labor › Overfitting-Check | fertig |
| Sehen, was jeder Filter wirklich bringt | Varianten- und Filtervergleich | Labor › Varianten- und Filtervergleich | teilweise |
| Prüfen, wie empfindlich die Idee auf Zahlen reagiert | Parameter-Raster | Labor › Parameter-Raster | fertig |
| Eine Strategie schrittweise verbessern lassen, ohne dich zu überanpassen | Hintergrund-Optimierer | Labor › Optimierer | teilweise |
| Einen Handelsplan durchspielen, bevor Geld im Spiel ist | Zeitmaschine (Plan durchspielen) | Labor › Zeitmaschine | fertig |

**Live prüfen & teilen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Eine Regel auf neuen Kerzen live mitlaufen lassen | Forward-Test (virtuelles Konto) | Labor › Forward-Test | fertig |
| TradingView-Ergebnisse mit dem Labor vergleichen | TradingView-Vergleich | Labor › Export gegen Labor-Lauf | teilweise |
| Aus deiner Idee ein TradingView-Skript machen | Pine-Export für TradingView | Labor › Pine-Skript für TradingView | fertig |
| Eine Strategie als Datei weitergeben oder einlesen | Playbook exportieren und importieren | Labor › Playbook austauschen | teilweise |

### Aus Fehlern lernen

_Warum du verlierst, was du verpasst, was du ändern kannst._ · 16 Funktionen

**Fehler & Muster**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Herausfinden, was deine Gewinner und Verlierer gemeinsam haben | Muster-Entdecker | Labor › Muster-Entdecker | fertig |
| Sehen, wo du Geld verlierst und wo dein Vorteil liegt | Leaks & Edges | Coach › Leaks & Edges | fertig |
| Muster wie Revenge-Trading und Overtrading erkennen | Verhaltensmuster & Timeline | Coach › Timeline | fertig |
| Sehen, was dich deine Fehler gekostet haben | Fehler-Kosten | Übersicht › Fehler-Kosten | fertig |
| Eigene Fehler-Stichworte für Trades festlegen | Fehler-Tags festlegen | Einstellungen › Fehler-Tags | fertig |

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

### Auswerten & Berichte

_Kennzahlen, Verläufe und Berichte zu deinen Trades._ · 31 Funktionen

**Berichte**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einen Bericht für Woche, Monat oder Jahr lesen | Wochen- & Monatsberichte | Berichte | fertig |
| Die Woche mit Befunden und Belegen durchgehen | Wochenreview | Berichte › Wochenreview | fertig |
| Sehen, was dir das Journal im Monat gebracht hat | Persönlicher Monatsnutzen | Berichte › Persönlicher Monatsnutzen | fertig |
| Berichte als PDF, CSV oder Markdown speichern | Berichte exportieren | Berichte › Export | fertig |
| Einen kurzen Rückblick auf Woche oder Monat lesen | Rückblick | Übersicht › Rückblick | fertig |
| Käufe, Verkäufe, Gebühren und Funding als Buch prüfen | Transaktionsbuch | Berichte › Transaktionsbuch | teilweise |

**Kennzahlen & Vergleiche**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Die wichtigsten Kennzahlen deines Tradings mit Unsicherheit sehen | Kennzahlen (Sharpe, SQN, Kelly) | Analyse › Kennzahlen | fertig |
| Sehen, was Gebühren und Funding dich kosten | Gebühren & Funding | Analyse › Kosten | fertig |
| Das Ergebnis nach Setup, Session oder Wochentag aufteilen | Aufschlüsselung nach Setup, Session, Wochentag … | Analyse › Breakdown | fertig |
| Einen Überblick über deinen Vorteil bekommen | Edge-Score | Übersicht › Edge-Score | fertig |
| Die auffälligsten Befunde aus deinen Trades lesen | Erkenntnisse | Übersicht › Erkenntnisse | fertig |
| Dich mit dem Markt vergleichen | Benchmark: Konto gegen Markt | Analyse › Benchmark | fertig |
| Zwei Zeiträume, Konten oder Setups vergleichen | Zeiträume und Konten vergleichen | Analyse › Vergleich | fertig |
| Vergleichen, wie eigene, Regelwerk- und KI-Trades abschneiden | Mensch, Regelwerk oder KI – wer entscheidet besser? | Analyse › Vergleich · Entscheidung | teilweise |
| Eine eigene Kennzahl berechnen lassen | Eigene Kennzahl | Analyse › Eigene Kennzahl | fertig |

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

**Aktien: Zahlen & Bewertung**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Sehen, was eine Firma zuletzt gemeldet hat | Zahlen-Analyst | Aktien › Analyse · Zahlen | teilweise |
| Den Wert einer Aktie als Spanne durchrechnen | DCF-Rechner | Aktien › Analyse · Bewertung | fertig |
| Eine Kaufthese festhalten und gegen neue Zahlen prüfen | Kaufthese | Aktien › Analyse · These | teilweise |

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
| Sehen, wie lange du dranbleibst | Laufende Serien | Wachstum › Laufende Serien | fertig |

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

_Trades hineinbekommen, ordnen, sichern und prüfen._ · 12 Funktionen

**Eintragen & importieren**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einen Trade von Hand eintragen | Trade eintragen | Übersicht › Trade eintragen | fertig |
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

**Sichern & prüfen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Das Journal sichern oder wiederherstellen | Backup & Wiederherstellung | Einstellungen › Daten | fertig |
| Prüfen, ob die Marktdaten aktuell sind | Datenstatus | Einstellungen › Live-Daten | teilweise |
| Marktzahlen und Analysezustände auf diesem Gerät mitschreiben | Datenarchiv | Einstellungen › Datenarchiv | teilweise |
| Prüfen, ob Alarme und Kerzen zuverlässig angekommen sind | Daten- und Alarmqualität | Coach › Daten- und Alarmqualität | teilweise |

### Community & Teilen

_Gruppen, Mentoren und Teilen – freiwillig und datensparsam._ · 7 Funktionen

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Einer Gruppe beitreten oder eine anlegen | Gruppen & Einladungen | Community | teilweise |
| Dich freiwillig mit anderen vergleichen | Rangliste (freiwillig) | Community | teilweise |
| Mit einem Mentor oder Schüler zusammenarbeiten | Mentor-Modus | Community | fertig |
| Einen Trade oder ein Setup per Link teilen | Teilen per Link | Community | teilweise |
| Trades in der Gruppe besprechen | Reviews & Kommentare | Community | fertig |
| Eine Kursstrecke in der Gruppe vorab einschätzen und später prüfen | Chartfälle mit Hypothese vorab | Community › Gruppe › Chartfälle | fertig |
| Meine Ergebnisse als nachprüfbaren Beleg teilen | Ergebnisbeleg | Community › Teilen › Ergebnisbeleg | fertig |

### Konto, Einstellungen & Hilfe

_Konto, Tarif, Oberfläche, Einstellungen und Hilfe._ · 19 Funktionen

**Konto & Tarif**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Anmelden, synchronisieren und das Konto verwalten | Konto & Cloud-Sync | Konto | fertig |
| Per E-Mail Bescheid bekommen, auch wenn die App zu ist | E-Mail-Alarm bei geschlossener App | Markt › Alarme & Zustellprotokoll › E-Mail-Alarm | teilweise |
| Tarif wählen, Abo verwalten oder kündigen | Abo & Tarife | Preise | fertig |
| Sehen, welcher Tarif welche Funktion enthält | Tarife im Vergleich | Preise › Alle Funktionen im Vergleich | fertig |
| Freunde einladen und Gutschrift erhalten | Freunde einladen (Empfehlungscode) | Konto | teilweise |

**Einstellungen**

| Aufgabe | Funktion | Seite › Abschnitt | Stand |
|---|---|---|---|
| Startkapital, Währung und Konten festlegen | Konten und Startkapital | Einstellungen › Konten | fertig |
| Zeiteinheiten, Gewichte und Schwellen des Einstiegs-Checks anpassen | Einstiegs-Check einstellen | Einstellungen › Einstiegs-Check | fertig |
| Die Lage-Ampel ein- oder ausschalten und anpassen | Lage-Ampel einstellen | Einstellungen › Lage-Ampel | fertig |
| Feste Preislevel für den Chart eintragen | Chart-Level manuell | Einstellungen › Chart-Level · manuell | fertig |
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
