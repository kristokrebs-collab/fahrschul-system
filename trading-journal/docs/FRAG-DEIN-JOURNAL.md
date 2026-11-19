# Frag dein Journal: die Fragetypen und ihre Grenzen (Paket F2)

Stand: 08.11.2026. Berichte › **Frag dein Journal** (Chip „Frag dein Journal“ in der „Inhalt“-Leiste). Eine Frage auf Deutsch wird getippt, die
Antwort kommt als **drei Karten** mit den echten Zahlen, den betroffenen Trades und einer ehrlichen Aussage, wie belastbar die Stichprobe ist.

**Was das ist.** Eine lokale, deterministische Auswertung: die Frage wird von einem **Regel-Parser** in einen Fragetyp mit Filtern und Zeitraum
übersetzt (`src/domain/coach/nlq/parse.ts`, neu: `audit.ts`), über die **echten abgeschlossenen Trades** gerechnet (`aggregate`, die
Aufschlüsselungen der Analyse, die Verhaltensmuster des Coachs) und als Karten gezeigt (`src/domain/ask`). **Kein Sprachmodell, kein Netz, kein
Raten.** Dieselbe Maschine beantwortet auch den Coach-Chat („Frag deinen Coach“, Seite Coach): es gibt keine zweite Auswertung. Die Funktions-Suche
(`src/app/features.ts`, Seite „Funktionen“, `/`) findet **Seiten und Funktionen**; „Frag dein Journal“ rechnet **Zahlen aus deinen Trades**.

## Die Fragetypen (ein geschlossener Satz)

| # | Fragetyp | Beispiel | Antwort (drei Karten) | Quelle der Zahlen |
|---|---|---|---|---|
| 1 | **Verluste** einer Auswahl (Setup, Paar, Richtung, Wochentag, Zeitraum …) | „Verluste im Setup Breakout letzten Monat“ | Verluste „k von n“ · Summe der Verluste (Geld und R) · größter Verlust | `nlq/audit.ts` (`outcomes`) über `selectTrades` |
| 2 | **Trades ohne Stopp** | „Trades ohne Stopp“, „Stopp vergessen“ | ohne Stopp „k von n“ · Ergebnis dieser Trades · Ø pro Trade ohne / mit Stopp | `audit.ts` (`noStop`), Regel wie `brokenRules` (Stopp leer oder ≤ 0) |
| 3 | **Checkliste ausgelassen** | „Wie oft habe ich die Checkliste ausgelassen?“ | nicht vollständig „k von n“ · davon gar nichts abgehakt · Ø R vollständig / sonst | `audit.ts` (`checklist`), `EnrichedTrade.complete` / `checked` |
| 4 | **Trades ohne Review** | „Trades ohne Review“ | ohne Review „k von n“ · neuester ohne Review · Ergebnis dieser Trades | `audit.ts` (`noReview`), `reviewed()` des Coachs (Notiz, Psych-Eintrag, Tags oder Bewertung) |
| 5 | **Beste / schwächste Gruppe** | „Beste Wochentage“, „Welche Session ist am profitabelsten?“ | die drei Gruppen auf Platz 1 bis 3 mit Zahl und Trades | `breakdown` der Analyse (P03), Mindestprobe 3 Trades je Gruppe |
| 6 | **Eine Kennzahl** | „Größter Verlust dieses Jahr“, „Win-Rate bei Fade“, „Ø R letzte Woche“ | die Kennzahl · Trades · Netto (bzw. die Begleitzahlen) | `aggregate`, `metricValue` |
| 7 | **Zwei Seiten oder Zeiträume vergleichen** | „Vergleiche Long und Short“, „diesen Monat gegen letzten Monat“ | Kennzahl A · Kennzahl B · Win-Rate beider | `compareAnswer` mit Welch- bzw. Anteilstest |
| 8 | **Verhaltensmuster** | „Wie oft habe ich den Stop verschoben?“, „Was kosten mich Revenge-Trades?“ | Vorkommen · P&L dieser Trades · gegen saubere Trades | die Detektoren des Coachs (`behaviorReport`) |
| 9 | **Ein Zeitraum im Überblick** | „Wie war letzte Woche?“ | Trades · Netto · Win-Rate | `summaryAnswer` |

Filter, die in jede Frage passen: Setup (Name), Richtung, Konto, Wochentag, Session, Paar / Coin, Hebel, Überzeugung, Timeframe, Gefühl, `#Tag`.
Zeiträume: heute, gestern, diese / letzte Woche, diesen / letzten Monat, dieses / letztes Jahr, „im Mai“, „Q3 2026“, „letzte 30 Tage“, „seit März“ …
Alle Wörter stehen in `src/domain/coach/nlq/lexicon.ts` und `parse.ts`; die Tests prüfen jeden Fragetyp gegen von Hand gerechnete Werte.

## Was nicht verstanden wird, wird nicht beantwortet

Erkennt der Parser eine Frage nicht, steht da **„So kann ich das noch nicht beantworten.“** mit drei Beispielfragen (Knopf: ein Tipp stellt die Frage).
Das gilt auch, wenn **ein einziges Wort** keine Tabelle kennt (`src/domain/ask/words.ts`): „Win-Rate bei Bitcoinn“ liefert nicht die Win-Rate
aller Trades, sondern „Ich kenne das Wort „bitcoinn“ nicht – und ich rate nicht.“ Ebenfalls abgelehnt:

- **zwei Fragen in einer** („Vergleiche Long und Short ohne Stopp“) – es wird nicht still eine davon weggelassen;
- **Prognose und Rat** („Was soll ich morgen traden?“, „Wie wird das Wetter?“) – die Frage geht nur ans Journal, nie an den Markt;
- ein **Überblick ohne Zeitraum und ohne Auswahl** („Wie war es?“).

Eine verstandene Frage ohne Trades sagt das offen („Für Letzter Monat · Breakout gibt es keine abgeschlossenen Trades.“), nie eine stille Null. Ein
„größter Verlust“ über lauter Gewinner heißt „Kein Verlusttrade …“, nie ein Gewinn mit falschem Etikett.

## Grenzen (ehrlich)

- **Nur abgeschlossene Trades.** Offene Trades zählen nicht (auch nicht bei „ohne Stopp“); der Satz steht in der Belastbarkeitszeile der Antwort.
- **Ohne Stopp kein R.** Trades ohne Stopp stehen nur in Geld; Summen in R decken nur die Trades mit R ab (steht in der Antwort).
- **Review heißt hier:** Notiz, Notiz nach dem Trade, Psych-Eintrag, Tags oder Bewertung (`reviewed()`); ein anderer Begriff von „Review“ wird nicht erraten.
- **Checkliste:** nur Trades, die eine Checkliste haben (Setup- oder Regel-Punkte). „Ausgelassen“ = nicht vollständig abgehakt; „davon gar nichts“ = kein einziger Haken.
  Der Vergleich der Ø R ist **kein Beweis**, dass die Checkliste die Ursache ist (steht in der Antwort).
- **Plural zählt:** „Verluste“ meint die verlierenden Trades, „Verlust“ die Summe. „Gewinne“ (Summe, wie beim Coach) und „Gewinner“ (Liste) bleiben beim Coach-Verhalten.
- **Stichprobe:** Karten tragen „n“; unter 10 Trades heißt es „zu wenig Daten“, ab 30 „klar“ (Gruppen: gegen den Rest getestet, FDR-korrigiert).
  Eine Gruppe mit weniger als 3 Trades kommt nicht in die Rangliste, solange andere da sind.
- **Betroffene Trades:** „Betroffene Trades (n)“ öffnet die neuesten 8; jede Zeile öffnet den Trade. Eine Trades-Liste mit genau diesen IDs gibt es (noch) nicht;
  die übrigen findest du in Trades über die Filter.
- **Keine Empfehlung.** Die Antworten sind Rückblick auf die eigenen Trades, keine Prognose und keine Anlageempfehlung.
- **Schimmer:** die Rechnung dauert Millisekunden; die halbe Sekunde „Durchsuche 214 Trades …“ (mit der echten Zahl) ist eine bewusste Pause für das Auge und
  entfällt unter „Bewegung reduzieren“.
- **Sprache:** nur Deutsch, ohne Tippfehler-Korrektur (ein unbekanntes Wort wird gemeldet, nicht „verbessert“); Fachwörter außerhalb der Tabellen
  (Sortino, Kelly …) werden von dieser Leiste nicht beantwortet – sie stehen in Analyse.

## Belege

`tests/unit/ask.test.ts` (jeder Fragetyp mit von Hand gerechneten Erwartungen auf einem festen 12-Trade-Journal `ask.fixtures.ts`; nicht verstandene Fragen;
die Beispiele sind selbst Fragen, die beantwortet werden; die alten Coach-Fragen laufen weiter), `tests/unit/views.frost.test.tsx` (Punkt → Leiste → Schimmer →
drei Karten, Unbekanntes, Trades dahinter, reduzierte Bewegung, kein `fetch`), `tests/unit/psych.guard.test.ts` Block 6 (lokal: kein Netz, kein Modell),
`tests/e2e/frost-f2.spec.ts` (Handy und Desktop, offline, axe hell und dunkel, Touch ≥ 44 px, kein Layoutsprung), Bilder in `docs/audit/img-frost/`.
