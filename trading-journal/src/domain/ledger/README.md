# `src/domain/ledger` – Transaktionsbuch (F70), eine Hilfsrechnung

Reine Domain (kein React, kein I/O). Die Oberfläche ist der Abschnitt „Transaktionsbuch“ der Berichte-Seite (`src/views/berichte/ledger`).

**Was es ist:** das Journal als Buch. Je Zeile Zeit (UTC, angezeigt in der gewählten Zone), Konto, Markt, Art (**Eröffnen · Schließen · Gebühr · Funding**), Kauf/Verkauf, Richtung, Menge, Preis, Gebühr, Funding und – bei einer Schließung – das **realisierte Ergebnis** in der Handelswährung (`settings.currency`), brutto, nach FIFO zugeordnet. **Was es nicht ist:** keine Steuerberechnung, keine Haltefrist (Eröffnung und Schließung sind nur Datumsspalten, bei Short ist Eröffnung der Verkauf), kein Buchhaltungsformat. Der Kopf jedes Exports und der Druckansicht lautet **„Hilfsrechnung ohne Steuerberatung; Steuerregeln prüft eine Fachperson“** (`LEDGER_NOTE`).

## Zeilen (`build.ts`)

Quelle sind die Trades des Journals (auch Börsen-Sync, CSV, Handeintrag):

- **mit Ausführungen** (`fills`): eine Zeile je Ausführung, mit der gebuchten Gebühr der Ausführung. Bleibt bei einem geschlossenen Eintrag ein Rest offen (geöffnet − geschlossen), schließt eine eigene Zeile „Rest“ ihn zum Ausstiegskurs des Eintrags (wie `deriveTrade`), markiert `rest`; ohne Ausstiegskurs kommt der Eintrag auf die Klärliste.
- **ohne Ausführungen**: Eröffnen aus Einstiegskurs und Menge (`size ÷ entry`, sonst `qty` – die Regel des Journals), Schließen aus Ausstiegskurs und `exitDate`.
- **Gebühr:** Zählt wie im Journal (`effectiveFees`) – die Gebühr des Eintrags, wenn gesetzt, sonst die Summe der Ausführungen. Summieren sich die Ausführungs-Gebühren auf die des Eintrags (oder fehlt sie), stehen sie je Zeile; sonst steht die Gebühr des Eintrags als eigene Zeile `Gebühr` (markiert `lump`, bei Abweichung `fee-diff`). Fehlt beides: Hinweis `fee-missing`, nichts wird geschätzt.
- **Funding:** `fundingFees` ist im Journal eine Summe je Eintrag – eigene Zeile `Funding` zur Zeit der Schließung, markiert `lump`. Fehlt es, obwohl zwischen Eröffnen und Schließen eine Abrechnung des Standardrasters (00/08/16 UTC) lag: `funding-missing` (nicht bei Spot).
- **Zeit:** das Journal speichert die Wanduhr ohne Zone (`sourceZone` = Zone des Geräts); `displayZone` wählt, in welcher Zone das Buch gelesen wird. Das Jahr einer Schließung hängt von dieser Zone ab (Test: Mitternacht Berlin = 18:30 am Vortag in New York).

## FIFO (`build.ts`)

Schließungen werden den Eröffnungen first-in-first-out zugeordnet, je Richtung; Teilschließungen verbrauchen den ältesten Posten zuerst. Ergebnis je Posten = `(Schlusskurs − Einstiegskurs) × Menge × Richtung`. `scope: "position"` (Standard) ordnet **innerhalb eines Journal-Eintrags** zu (derselbe Zuschnitt, in dem das Journal sein eigenes Ergebnis rechnet), `scope: "market"` lässt alle Einträge eines Kontos und Marktes eine Reihe teilen (ein noch offener Eintrag kann dann das Schließen eines anderen übernehmen; der Vergleich mit dem Journal entfällt). Eine Schließung ohne passenden Einstieg wird **nicht bewertet**: `unmatchedQty`, Hinweis `gap`, der offene Einstieg bleibt in `openLots`. Offene Positionen sind nicht bewertet.

## Jahreszusammenfassung

`summarize(rows, zone)`: Ergebnis im Jahr der Schließung (Gewinne und Verluste je zugeordnetem Posten, brutto), Gebühren und Funding im Jahr der Zahlung, `net = brutto − Gebühren − Funding`, dazu Zeilen mit Hinweis, das Ergebnis in möglichen Dubletten und die Menge ohne Einstieg.

## Abgleich-Hinweise (sichtbar markiert statt geraten)

`gap` Lücke im Bestand · `duplicate` mögliche Dublette (gleiche Minute, Markt, Menge, Preis in verschiedenen Einträgen; gleiche Börsen-ID; Handeingabe neben dem Börsen-Sync über `reconcile` aus `src/exchanges`) – **markiert, nie entfernt** · `fee-missing` · `fee-diff` · `funding-missing` · `time-missing` (die Zeit des Eintrags steht ersatzweise da) · `diff` Abweichung vom Journal (FIFO statt Durchschnittspreis, von Hand eingetragenes Ergebnis, fehlende Gebühr; beide Zahlen bleiben stehen) · `order` Schließen vor Eröffnen · `rest`, `lump` (Lesehilfen). Was sich nicht in Zeilen übersetzen lässt (Zeit unlesbar, Einstieg/Menge fehlen, Ausstieg fehlt), steht in `unresolved` (die Klärliste) und verschwindet nicht.

## Export (`export.ts`)

`ledgerToCsv(ledger, year, now)` (Buch + Jahreszusammenfassung) und `matchesToCsv` (eine Zeile je zugeordnetem Posten) im CSV-Dialekt der App (BOM, `;`, Dezimalkomma, Formelschutz). Kopf: der Hinweis, Währung, Zeitzone, Zuordnung, Erstellzeit, Zone der Journal-Zeiten, was nicht enthalten ist.

## Nicht enthalten (und so benannt)

Spot-Wallets und Blockchain-Importe, Ein-/Auszahlungen, Überweisungen zwischen Konten oder Wallets (kein Scheingewinn aus Verschieben – es gibt gar keine Überweisungszeilen), Staking/Rewards/Airdrops, Fiat-Umrechnung, Bestandsabstimmung gegen Kontostände, Steuer-/Buchhaltungsformate, ein unveränderlicher Rohbeleg mit Korrekturhistorie. Deshalb steht F70 in `docs/COVERAGE.md` auf „teilweise“.

## Tests

`tests/unit/ledger.domain.test.ts` (FIFO-Handrechnungen: Long mit Nachkauf und Teilschließungen über den Jahreswechsel, Short, Gebühren-/Funding-Zeilen, Lücke, Rest, Klärliste, Dubletten, Zeitzonen, CSV), `tests/unit/views.berichte.ledger.test.tsx`, e2e `tests/e2e/ledger.spec.ts`.
