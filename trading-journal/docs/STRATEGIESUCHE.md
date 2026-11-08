# Strategiesuche „1.000 Varianten. Eine bleibt.“ (Frost F1)

Stand: 08.11.2026. Ort: Labor, Abschnitt „1.000 Varianten. Eine bleibt.“ (`src/views/labor/search`, Rechner `src/domain/lab/search`). Modellversion `strategiesuche-2`.
Das ist eine **echte Suche**, keine Animation: Es werden tatsächlich 1.000 Einstellungen gerechnet, eine wird gewählt, und nur diese läuft einmal auf Kerzen, die die Auswahl nie gesehen hat. Das Ergebnis ist **ein Hinweis auf eine Kante in diesen Kerzen, keine Prognose und keine Anlageempfehlung**.

## Methode

1. **Zwei Familien teilen sich die 1.000 Varianten.**
   - *Eröffnungs-Range-Ausbruch* (5-Minuten-Kerzen der letzten 60 Tage): **alle 540** Varianten = 2 Sitzungen (New York 13:30–20:00 UTC, London 07:00–13:00 UTC) × 3 Ranges (15 / 30 / 60 Minuten) × 3 Volumen-Schwellen (1,25× / 1,5× / 2×) × 5 Ziele (1 … 3 R) × 3 Stops (Range, Mitte, 1,5 × ATR) × 2 Trendfilter (an / aus). Regeln: `src/domain/lab/search/orb.ts`.
   - *Ausbruch mit Trendfilter* (Kerzenlänge 1h / 4h / 1T und Zeitraum aus dem Versuchsaufbau des Labors): die übrigen **460**, gezogen aus einem Raum von 24.000 Punkten (Long/Short × Rückblick 8–64 × EMA-Filter 0/20/50/100/200 × Stop 1–4 ATR × Ziel 1–4 R × Zeit-Stopp). Gebaut aus dem Regel-Baukasten des Labors (`strategies/rules.ts`).
   - Wer nur eine Familie wählt, bekommt bei Trend die vollen 1.000, bei ORB die 540. Mit „Beide“ sind es genau 1.000, gemischt.
2. **Deterministisch.** Die Ziehung hängt nur vom Seed ab (Standard 20261108), nie von den Kerzen. Gleicher Seed + gleiche Kerzen = byte-genau gleiches Ergebnis (Test). Angezeigt werden Seed, Modellversion und Datenstand (Markt, Kerzenlänge, Zahl der Kerzen/Tage, Zeitraum, Quelle).
3. **Training = die ersten 80 %** der Kerzen (je Familie auf ihrem Datensatz, ORB nach Kalendertagen). Alle Varianten laufen mit Gebühren, Slippage und – beim Trend-Ausbruch – Funding. Das Training bekommt von den Daten **nur seine 80 %** übergeben (die Endtest-Kerzen werden ihm nicht einmal gereicht).
4. **Zielgröße** (die Familien teilen sie): Ø R je Trade nach allen Kosten ÷ Streuung × √min(Trades, 100) (`scoreOf` des Labors). Bis 100 Trades ist das der t-Wert der Erwartung. Mindestzahl Trades im Training: 30 (Trend) bzw. 8 (ORB, ein Trade je Tag) und Erwartung > 0.
5. **Sieger festlegen, dann EIN Endtest** auf den letzten 20 % *seines* Datensatzes. Erst danach laufen die übrigen Varianten auf demselben Endtest – nur um zu zeigen, wo der Sieger in der Verteilung steht („Die beste von 1.000 sieht zufällig gut aus – darum der Endtest“). Diese Zahlen fließen in keine Auswahl ein (Test: andere Endtest-Kerzen ändern Training und Sieger nicht).
6. **Urteil „bestanden“ nur, wenn alle sechs vorab festgelegten Kriterien erfüllt sind**, sonst „verworfen“ mit dem ersten verfehlten als Begründung:

| # | Kriterium | Trend | ORB |
|---|---|---|---|
| 1 | Training: genug Trades, Erwartung > 0 R nach Kosten | ≥ 30 | ≥ 8 |
| 2 | Endtest: genug Trades | ≥ 15 | ≥ 4 |
| 3 | Endtest: Erwartung nach Kosten > 0 | ja | ja |
| 4 | Endtest hält die Trainings-Zahl | ≥ 50 % | ≥ 50 % |
| 5 | Endtest vom Zufall unterscheidbar (ein einzelner, ungesehener Test) | p ≤ 0,10 | p ≤ 0,10 |
| 6 | Training übersteht die Mehrfachtest-Korrektur: das p des Siegers, um die Zahl der Versuche (1.000) korrigiert (Šidák) | ≤ 0,10 | ≤ 0,10 |

   Der **Rang** des Siegers im Endtest unter allen bewertbaren Varianten (nach Erwartung ÷ Streuung) und die Verteilung werden gezeigt, sind aber kein Kriterium: R-Vielfache verschiedener Stop-/Ziel-Aufbauten sind nur grob vergleichbar, ein echter Treffer kann dort mittelmäßig stehen (gemessen in einer früheren Fassung der Testdaten: 3 von 10 Läufen mit eingebautem Muster fielen am Rang durch, obwohl der Endtest p < 0,001 hatte). Der **Deflated Sharpe** des Overfit-Checks wird bewusst nicht benutzt: Seine Glücksgrenze wächst mit der Streuung der Varianten und hielt Märkte mit echter Kante für Glück (gemessen DSR ≈ 0).
7. **Speichern:** jede fertige Suche legt ihre Zusammenfassung (Regeln, Zahlen, Urteil, Seed, Version, Datenstand) in diesem Browser ab (`storageKey("labor-search")`, versioniert, höchstens 8; eine andere Modellversion wird beim Lesen verworfen, nicht repariert). Die 1.000 Kurven werden nicht abgelegt – Neu suchen mit demselben Seed und denselben Kerzen zeichnet sie wieder. Es geht nichts verloren, was sich nicht neu rechnen ließe. Die Karte zeigt, wie oft auf demselben Markt schon gesucht wurde: jede weitere Suche (anderer Seed, anderer Zeitraum) ist ein weiterer Mehrfachtest.
8. **Rechenzeit:** Der Lab-Worker (Nachricht `search`) rechnet in 40-ms-Häppchen, die Seite bleibt flüssig; Abbrechen beendet den Worker sofort; ohne Worker (Einzeldatei, `file:`) rechnet dasselbe in Leerlauf-Häppchen. Fortschritt mit echter Zahl („412 von 1.000 geprüft“). Gemessen: eine Suche über 1.000 Trend-Varianten auf 4.800 Kerzen etwa 0,3 s, ORB mit 540 Varianten auf 130 Tagen etwa 0,1 s (im Test, Node).

## Aktueller Kandidat (nur nach „bestanden“)

Die Regeln der Siegervariante laufen auf den **aktuellen** Kerzen. Die Karte zeigt Signal (Long / Short / „Heute kein Signal – warte“), Einstieg (Bezug: letzter Schluss; gefüllt wird zur Eröffnung der nächsten Kerze), Stop und Ziel aus den Regeln, beim Eröffnungs-Range-Ausbruch **die Gründe einzeln** (Ausbruch, Volumen-Faktor „3,0×“, Trend ja/nein, Note A+/A/B/C) – nur wenn heute wirklich ein Signal vorliegt. Ein Signal gibt es nur auf der **letzten geschlossenen Kerze** (neue Flanke bzw. erste Kerze außerhalb der Range); kam es früher, steht „kein Einstieg mehr“ – die Regeln steigen nie nachträglich ein. Kerzen, die nicht mehr aktuell sind, geben keine Aussage.

- **Positionsgröße** über den Risikorechner (`positionSize`) mit den **eigenen** Risikoeinstellungen: das Risiko je Trade zählt nur, wenn der Nutzer es selbst gespeichert hat (`settings.risk.riskPerTradePct`); sonst steht dort „Lege dein eigenes Risiko fest“ und es erscheint **keine** Größe. Kapital = Konto-Kapital aus den Einstellungen (mit dem Konto genannt), Gebühren/Slippage = seine Risiko-Einstellungen, Hebel-Regel = seine.
- **„In Handelsplan übernehmen“** öffnet den vorhandenen Handelsplan vorbefüllt (Richtung, Einstieg, Stop, Ziel als eigene Preise; Hinweis „Aus deiner Strategiesuche übernommen“). Es wird nichts bestellt, nichts gespeichert, kein Paper-/Journal-Eintrag – die gibt es nur auf den eigenen Knöpfen des Plans.
- Bei „verworfen“ gibt es **keinen** Kandidaten: „Strategie war nicht belastbar – anderen Zeitraum oder andere Familie probieren.“
- Text: „Kandidat aus deiner Strategiesuche, keine Anlageempfehlung. Vergangene Ergebnisse sagen nichts über die Zukunft.“ Gebühren und Slippage sind in der Größe eingerechnet, Funding nicht.

## Prüfung der Labor-Funktionen auf Look-ahead (nicht blind vertraut)

Gelesen und per Test belegt: `engine.ts` (Entscheidung am Schluss von Kerze i, Füllung zur Eröffnung von i + 1, Stop vor Ziel, Lücke füllt zur Eröffnung), `strategies/rules.ts` `evalConds` (EMA rekursiv, Hoch/Tief nur aus Kerzen davor), `bars.atrSeries` (Wilder).
- **Abschneide-Test:** das Signal von Kerze t bleibt gleich, wenn alle Kerzen nach t fehlen (30 Varianten × 12 Stellen, auch für die ATR); **Verschiebe-Test:** andere Zukunft ab t ändert keinen Trade bis t.
- **Befund (geringfügig, Engine unverändert):** die Funding-Marke einer Abrechnung genau am Fensterrand liest den Schluss der *nächsten* Kerze (`priceAt`). Wirkung auf R ≈ 1e-7, aber formal ein Blick voraus über die Grenze Training/Endtest. Darum bekommt das Training nur seine eigenen Kerzen (Test belegt Leck und Lösung). In der Engine selbst wurde nichts geändert, damit bestehende Labor-Zahlen gleich bleiben.
- **Bekannte Optimismen der Engine** (nicht behoben, hier benannt): ein Limit-Ziel füllt, sobald die Kerze es berührt (keine Warteschlange); bei Tageskerzen ist das Funding-Mark der Schluss der Kerze, in der es abgerechnet wird.

## Belege (Tests, alle grün) und Zahlen

- (a) **Eingebautes Muster, Trend-Familie** (Impuls nach Schluss über dem 20-Kerzen-Hoch, ohne Netto-Drift; 40 Pfade à 4.800 Kerzen): bestanden 35 von 40; der Sieger-Rückblick lag in **40 von 40** Läufen bei 18–22 (36-mal genau 20 = wahrer Parameter). Die 5 Verworfenen: 4× „Endtest hält 50 % nicht“, 1× zu wenige Endtest-Trades. Test: 10 Pfade, ≥ 8 bestanden, Rückblick 16–24, Profil über alle 1.000 (Rückblick 16–28 klar über ≥ 40).
- (a) **Eingebautes Muster, ORB** (NY, Range 60, Volumen 3× nach der Range; 130 Tage): bestanden **29 von 30**; der Verworfene scheitert an den zu wenigen Endtest-Tagen (< 4 Trades). Sieger immer New York, Volumen-Schwelle ≤ 2.
- (b) **Reiner Zufallspfad, Trend:** **0 von 200** Fehlalarmen (Random Walk 4.800 Kerzen, Seeds 5001–5200; erste Ursachen der Ablehnung: zu wenige Endtest-Trades 69, Endtest nicht positiv 71, nicht signifikant 29, hält 50 % nicht 22, Mehrfachtest 8, kein Sieger 1). Test pinnt ≤ 10 % (40 Pfade, ≤ 4) und ≤ 10 % auf Pfaden mit wechselnder Schwankung (20 Pfade).
- (b) **Reiner Zufallspfad, ORB:** **0 von 100** (130 Tage); meist fehlt schon im Training die Mindestzahl Trades. Test pinnt ≤ 10 % (30 Pfade).
- Die Mehrfachtest-Korrektur trennt sauber: auf Zufallspfaden lag das korrigierte p in 197 von 200 Läufen bei ≥ 0,5 (die drei anderen bei 0,22–0,33), mit eingebautem Muster bei 0.
- (c) kein Look-ahead (siehe oben); der Endtest fließt nie in die Auswahl (Test für beide Familien).
- (d) **Zähler 1.000:** die Engine läuft wirklich 1.000-mal im Training (mit gekürzten Kerzen) und 1.000-mal im Endtest (der Sieger genau einmal, vor allen anderen) – gezählt am Aufruf von `runBacktest` (`lab.search.count.test.ts`); Determinismus, beliebige Zeit-Häppchen, Fortschritt nur aufwärts.
- (e) Die Animation nutzt die echten Kurven: die Szene hält dieselben Arrays wie das Ergebnis, die Blitze sind genau die Wechsel des laufenden Bestwerts (unabhängig nachgerechnet), der Sieger schließt die Folge, die gezeichneten Punkte der gestrichelten Siegerlinie liegen auf den Werten von `curves.winner` (`views.labor.search.test.tsx`).
- Eröffnungs-Range gegen Handrechnung (`lab.orb.test.ts`, 16 Fälle): Range, Signal nur binnen 3 Stunden, Gründe (Volumen 300 ÷ 100 = 3,0×, Trend, Note A+ / A / B / C), Einstieg zur Eröffnung der Folgekerze, Stop vor Ziel in einer Kerze, **Lücke über den Stop** füllt zur Eröffnung (−1,19 R statt −1), **Zeit-Stopp** am Sitzungsende, **Gebühren** (Einstieg 102,2 × 0,05 % + Ziel 108,6 × 0,02 % = 0,07282 → 2,0 R − 0,0228 R = +1,9772 R), Short gespiegelt, Slippage verschlechtert, kein Blick voraus.

## Grenzen (ehrlich)

- **Mehrfachtest-Verzerrung:** die beste von 1.000 sieht fast immer zufällig gut aus. Der Endtest ist ein einzelner Test, das Training wird korrigiert – trotzdem ist jede weitere Suche (anderer Seed, Zeitraum, Markt) ein weiterer Versuch; wer so lange sucht, bis etwas besteht, betrügt sich selbst.
- **Wenig Daten:** ORB hat in 60 Tagen höchstens ~45 Trainings- und ~12 Endtest-Tage. „Bestanden“ ist dort selten, „verworfen wegen zu weniger Trades“ häufig – das ist die ehrliche Antwort, nicht ein Fehler.
- **Marktregime wechseln.** Eine Kante der Vergangenheit kann verschwinden; eine Ausreißerphase (z. B. ein Trendjahr) kann alles bestehen lassen.
- **Nur gegen Fixtures, synthetische Märkte mit bekannter Wahrheit und Binance-Kerzen geprüft, nicht live.** Kein Forward-Test dieser Suche.
- **Funding** ist bei ORB nicht eingerechnet (16:00 UTC liegt in der New-York-Sitzung); der Trend-Ausbruch nutzt das Funding des Labors (Historie, flach oder aus – wie im Versuchsaufbau). Beim Eröffnungs-Range-Ausbruch gelten Taker-/Maker-Gebühren und die Slippage des Versuchsaufbaus (Standard Binance 0,05 % / 0,02 %).
- **Kerzen:** Binance USDⓈ-M, geschlossene Kerzen. Die 5-Minuten-Kerzen kommen direkt oder über den EU-Proxy der App; **ohne Verbindung gibt es einen ehrlichen Fehler, keine Ersatzdaten.** Die Ersatzquellen des Labors (Bybit, Spot) gelten für die Trend-Familie wie im Labor und werden im Datenstand benannt.
- **Demo:** Mit Test-Vorlagen (Fixture, z. B. im Showroom) steht „Demo-Daten (Test-Vorlage), keine Marktkerzen“ – nur dann.
- **Tages-Replay** (Kerze für Kerze) baut ein späteres Paket; die reine Funktion dafür steht bereit: `orbSession(prep, tag, params, costs)` → Range, Signal, Gründe, Note, Ausführungsverlauf (`path` je Kerze, Ausstieg, R, Kosten).

## Offen

- Kein Forward-Test der Gewinner-Variante in dieser Suche (der Forward-Test des Labors kann sie nicht direkt übernehmen: die Regeln sind keine „Eigene Idee“); die Variante als Entwurf der „Eigenen Idee“ zu speichern ist nicht gebaut.
- Der Rang als Kriterium ist verworfen (siehe oben); ein faireres Vergleichsmaß unter Stop-/Ziel-Aufbauten wäre eine Verbesserung.
- E2E gegen echte Marktdaten gibt es nur mit Netz-Mocks; ein Lauf mit echtem Binance-Zugriff steht aus.
