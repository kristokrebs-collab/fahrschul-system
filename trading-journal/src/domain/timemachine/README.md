# `src/domain/timemachine` – Zeitmaschine (trader-timemachine)

Ein Handelsplan (Richtung, Einstieg, Stop, Ziel) wird **durchgespielt, bevor Geld im Spiel ist**: (a) 10 000 simulierte Sitzungen aus den
echten Kerzen des Markts und (b) jedes frühere Mal, als der Aufbau in diesen Kerzen ausgelöst hätte. Beides läuft durch **dieselbe Engine**
wie das Labor (`src/domain/backtest/engine.ts`): Stop vor Ziel innerhalb einer Kerze (liegen beide in einer Kerze, zählt der Stop), Lücke
über den Stop füllt zur Eröffnung, Taker-Gebühr und Slippage auf Einstieg und Stop, Maker-Gebühr auf das Ziel, Funding je 8-h-Abrechnung,
Zeitstopp, optional Break-even und Trailing. Rein, deterministisch, **ohne Sprachmodell**, JSON-sicher (die Rechnung läuft in einem Web
Worker). Die Zahlen sind Wahrscheinlichkeiten, keine Zusagen; der Spezifikation (`trader-timemachine`) folgt das Urteil Wort für Wort.

| Datei | Inhalt |
|---|---|
| `types.ts` | `TmInput` / `TmResult` (alles JSON), Plan, Auslöser, Optionen (`defaultOptions`), Konstanten (`TM_RUNS` 10 000, `TM_SEED` 19, `MIN_POOL_BARS` 200, `MIN_EVENTS` 20 …) |
| `plan.ts` | `checkPlan` / `checkInput` (deutsche Gründe), `targetROf`, `relativeOf` (der Plan als Regel: Abstände in ATR, Lage in der Spanne), `parsePrice` („85.900“ neben einem Preis dieser Größe = 85 900) |
| `pool.ts` | `buildPool`: jede echte Kerze als vier Verhältnisse zur Vorkerze, Tageszeit-Fenster (Radius wächst, bis ≥ 30 Kerzen drin sind), Lücken, Trend entfernen, Schwankung „wie heute“ |
| `play.ts` | die Engine für einen Trade: `playSegment`, Verwaltung, `excursionR` (größte Gegenbewegung), `costInR` |
| `sim.ts` | Teil (a): `SimJob` – eine Sitzung = Einstiegspreis + `horizon` aus dem Pool gezogene Kerzen (Einzelkerzen oder Blöcke aufeinanderfolgender), Seed je Lauf |
| `history.ts` | Teil (b): `HistoryJob` – die frühere Suche, eine Position nach der anderen, Market / Limit / Stop-Aufträge |
| `job.ts` | `createTmJob`: Phasen Kerzen → Sitzungen → Fächer → Vorfälle → Auswerten, `step(deadline)`; `runTimeMachineSync` für Tests |
| `host.ts`, `tm.worker.ts`, `tmRunner.ts` | Nachrichten (`run` / `abort` → `progress` / `done` / `error` / `aborted`), Scheiben mit Ruhe (Handy: 14 ms Arbeit, 6 ms Ruhe), Inline-Worker; ohne Worker (`file:`, Einzeldatei, Absturz, Stille > 20 s) derselbe Host im Hauptthread – gleiches Ergebnis |
| `stats.ts` | Wilson-Intervall, t-Intervall, Quantile, Histogramm auf runden Kanten (−1 R und Ziel liegen auf Kanten) |
| `texts.ts` | Urteil (`verdictOf`), Vergleich (`compareOf`), Hinweise (`notesOf`), Annahmen (`assumptionsOf`), Zusammenfassung (`summaryLines`) – ein Wortlaut für Karte, Blatt und Assistent |

## Teil (a) – die simulierten Sitzungen

- **Pool.** Jede Kerze wird zu `(Open, High, Low, Close) ÷ Schluss der Vorkerze` (nach einem Loch: ÷ eigene Eröffnung – eine Lücke wird nicht in die
  Sitzung getragen). Eine simulierte Kerze ist der aktuelle Kurs mal diese Verhältnisse; die **erste** öffnet auf dem Einstiegspreis und behält ihre Form.
- **Tageszeit.** Slot = Platz im UTC-Tag (`floor((t mod 24 h) ÷ Kerzenlänge)`); zu jeder Tageszeit werden Kerzen derselben Tageszeit (± Radius) gezogen.
  Radius 2 ab 24 Slots, sonst 0; er wächst, bis das Fenster ≥ 30 Kerzen hat (dünn: Hinweis). Tageskerzen haben einen Slot.
- **Block-Bootstrap** (Standard, Blöcke à 6): aufeinanderfolgende echte Kerzen bleiben beieinander (Ballungen von Schwankung und kurze Trends); „Einzeln“ zieht jede
  Kerze für sich. Ein Block endet an einer Lücke der Daten.
- **Schwankung „wie heute“** (Standard): die Log-Verhältnisse jeder echten Kerze × Spanne(heute) ÷ Spanne(vor dieser Kerze), die Spanne = mittlere Kerzenspanne des
  letzten Tages (so mittelt sich die Tageszeit heraus und bleibt im Pool); Faktor auf ¼ … 4 begrenzt. Ein Plan, dessen Stop in ATR gedacht ist, wird so mit der heutigen
  ATR beurteilt, nicht mit dem Durchschnitt der Historie. „Wie früher“ lässt die Kerzen, wie sie waren.
- **Trend.** „Behalten“ (Standard): der Drift der Historie fließt ein und wird im Hinweis benannt (R je Sitzung); „Entfernen“ multipliziert alle Verhältnisse mit exp(−Drift).
- **Seed.** `runSeed(seed, k)` mischt Seed und Laufnummer zu einem 32-Bit-Wert; jeder Lauf hat seinen eigenen Zufall (mulberry32). Das Ergebnis hängt nicht davon ab, wie die Arbeit
  in Scheiben zerlegt wird, und Lauf k lässt sich allein wiederholen (`SimJob.candlesOf(k)`). Standard 19 (wie im Skill); der Seed steht in jedem Ergebnis und in der Karte.
- **Auswertung.** Anteile Ziel zuerst / Stop zuerst / weder noch (und „nachgezogener Stop“, wenn Break-even oder Trailing an sind) mit 95 %-Wilson-Intervall; Erwartungswert in R nach Kosten mit
  t-Intervall (die Spanne beschreibt nur das **Rechenrauschen**, nicht die Unsicherheit der Zukunft – so steht es in der UI); Kosten in R; Histogramm; schlechtester / 5 % / Median / Durchschnitt / 95 % /
  bester Lauf; Zeit bis zum Ausgang (Quartile in Kerzen) und größte Gegenbewegung; Fächer (Perzentile des Kurses in R je Kerze über **alle** Läufe – die Sitzung läuft bis zu ihrem Ende, was der Trade auch tut) mit 36
  Einzelpfaden, die dort enden, wo der Trade endete; Anteil der Läufe, die am Ende im Plus liegen.

## Teil (b) – frühere Vorfälle

Der Plan wird in eine Regel übersetzt (`relativeOf`: Abstände in ATR zum Schluss, Lage in der Spanne der letzten N Kerzen, oder das feste Preisniveau) und in Zeitreihenfolge auf die echten Kerzen angewandt,
**eine Position nach der anderen** (nach dem Ausstieg geht die Suche an dieser Kerze weiter):

| Auslöser | Entscheidung am Schluss einer Kerze |
|---|---|
| `close` – gleiche Abstände | Einstiegsniveau = Schluss + Abstand · ATR(damals); Stop und Ziel in denselben ATR-Abständen. Ohne Einstiegsbedingung ist jeder Schluss ein möglicher Einstieg (Basisrate), nacheinander. |
| `range` – gleiche Lage in der Range | Einstieg „jetzt“: der Schluss kommt in dieselbe Zone der Spanne (± 10 % der Höhe) – ein Auslöser entsteht beim Eintritt in die Zone; Limit / Stop: Niveau an derselben Stelle der Spanne |
| `level` – dieses Preisniveau | der feste Preis; jedes Mal, wenn der Kurs ihn von **derselben Seite** erreicht (Schluss davor auf dieser Seite) |

`market` füllt zur nächsten Eröffnung; `limit` (der Kurs kommt zurück) und `stop` (er bricht durch) füllen in der Kerze zum Niveau oder zur Eröffnung, wenn die Kerze schon dahinter öffnete; sie warten `validBars` Kerzen
(Preisniveau: so lange es dauert). **Grenzen innerhalb der Einstiegskerze:** nach einem Limit-Einstieg zählt das Ziel in dieser Kerze nicht (Reihenfolge von Hoch und Tief unbekannt), der Stop schon; eine Kerze mit Stop
und Ziel zählt als Stop (`ambiguous`, gezählt). Ein Trade, der am Ende der Daten noch offen ist, steht in `openAtEnd` und geht in keine Zahl ein. Jeder Vorfall: Einstieg, Ausgang, Dauer, R, größte Gegenbewegung / Bewegung.

## Mindeststichprobe, Vergleich, Urteil

- Unter 200 brauchbaren Kerzen rechnet nichts (Grund mit Zahl). Unter 20 Vorfällen wird **nicht verglichen** (Beispiele, kein Beleg), unter 10 gibt es keine Prozentwerte der echten Vorfälle.
- **Vergleich** Simulation ↔ Vorfälle (Ziel / Stop / weder noch / Erwartungswert): Warnhinweis, wenn die Simulation **außerhalb** des 95-%-Intervalls der Vorfälle liegt **und** der Abstand ≥ 10 Prozentpunkte
  bzw. ≥ 0,25 R beträgt.
- **Urteil** wie im Skill: nur die Läufe, die eine Seite erreichten (mind. 30); das Ziel muss in 1 ÷ (1 + R) der entschiedenen Läufe zuerst kommen (50 % bei 1 R, 33 % bei 2 R, 25 % bei 3 R); < 5 Punkte daneben:
  „Nahe an einer Münze“ (1 R) / „Nahe am Break-even“, 5–15: „Neigt zum Ziel / Stop“, ≥ 15: „Deutlich …“. Zusatzzeilen: über 40 % „weder noch“; Erwartungswert in die andere Richtung; Erwartungswert von null nicht zu
  unterscheiden.

## Ehrlichkeit

Nichts wird geschätzt und als Fakt ausgegeben: unlesbare Pläne und zu wenige Kerzen werden mit Grund abgelehnt; Annahmen (Kosten, Block-Bootstrap, Trend, Schwankung, Engine-Regeln, Limits der Vorfälle-Suche) stehen
in `assumptionsOf` und in der Karte; die App sendet **nie** Orders.

## Tests

`tests/unit/timemachine.sim.test.ts` – Wahrscheinlichkeiten gegen **Handrechnung** auf einem Gitter-Markt (jede Kerze ×1,01 oder ÷1,01: Ruin-Aufgabe, P(Ziel zuerst) = a ÷ (a + b), bei Aufwärtsdrift p = 0,6 die Formel
`(1 − r^a) ÷ (1 − r^(a+b))`; Gebühren verschieben den Erwartungswert um genau die Kosten der Ausstiege), Seed / Wiederholbarkeit / Zerlegung in Scheiben, jeder Lauf = `runBacktest` auf denselben Kerzen, Tageszeit, Break-even;
`timemachine.history.test.ts` (von Hand gebaute Kerzen mit bekannter Lösung, Short gespiegelt, Kosten, echte BTCUSDT-4h-Kerzen: keine Überlappung, kein Blick in die Zukunft, dieselbe Engine);
`timemachine.core.test.ts` (Statistik, Plan, Pool, Urteil, Vergleich); `timemachine.runner.test.ts` (Job, Host-Protokoll, Worker-Datei mit gespieltem `self`, Runner ohne Worker, Abbruch, Rückfall).
