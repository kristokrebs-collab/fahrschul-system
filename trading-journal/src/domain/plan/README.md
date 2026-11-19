# Handelsplan (`plan/`, F44 · F39 · F41 · F22)

Die Kette der Skills `trader-entry → trader-exit → trader-budget → trader-risk` (+ Alarme aus `trader-alerts`) als reine, deterministische
Rechnung. **Marktneutral:** die Eingabe ist ein Symbol und seine Kerzen – Krypto-Kerzen kommen von Binance, Aktien-Kerzen über den
Aktien-Datenvertrag (Yahoo Finance, `@/market/plan/stockCandles.ts`); der Rechenkern merkt den Unterschied nur dort, wo eine Aktie wirklich anders ist (unten:
„Aktien“). Nichts hier liest die Uhr, den Speicher oder das Netz: `now` und alle Eingaben werden übergeben. Die App **sendet nie eine Order** und hat keine Broker-Anbindung; das Ticket ist Text zum Kopieren.

```
Kerzen + Symbol ─▶ entryTimer ─▶ exitPlan ─▶ positionSizing ─▶ riskCheck ─▶ buildTicket        (model.ts verkettet alles: buildPlanModel)
```

| Datei | Inhalt |
| --- | --- |
| `time.ts` | Zeitzonen über `Intl` (`wallIn`, `offsetMinutes`, `zonedToUtc` mit Lücke/Überlappung), Tagesschlüssel `YYYY-MM-DD`, Uhrzeit- und Zonentexte. |
| `sessions.ts` | Die fünf Sitzungen: Tagesbeginn UTC, Asien (Tokio 9:00), London (8:00), New York (9:30), US-Börse (9:30 New York = 15:30 Berlin; 14:30 in den Wochen, in denen die USA schon, Europa noch nicht auf Sommerzeit steht). NYSE-Feiertage und vorzeitige Schlüsse 2026/2027 (`NYSE_HOLIDAYS`, `NYSE_EARLY_CLOSE`, 13:00, Stand im Text), `sessionDay`, `latestSession`, `flatByMs`. |
| `entry.ts` | **Einstiegs-Timer.** Range = Hoch/Tief der ersten N Minuten; Signal = die erste **voll geschlossene** Kerze, deren Schluss **strikt** außerhalb liegt (Long über dem Hoch, Short unter dem Tief); nie auf der Kerze, die die Range schließt oder noch läuft; Lücke → `no-data`, nach dem letzten Einstieg → `expired`; optionaler Volumenfilter. Jede Antwort trägt ihre Gründe in Worten. `atrOf` = einfacher Mittelwert der letzten 14 True Ranges. |
| `exit.ts` | **Ausstiegsplan.** Stop: Range-Mitte, andere Seite der Range, ATR-Vielfaches, Prozent, eigener Preis – immer **weg vom Einstieg** gerundet; Ziel: R-Vielfaches, Range-Projektion, Schlüsselmarke, eigener Preis – auf den nächsten Kursschritt (Hälften weg von null). Abgelehnt (nie stillschweigend geändert): Stop auf der falschen Seite, Risiko unter 0,05 % des Kurses, Ziel auf der falschen Seite, „flat by“ vor dem Einstieg. ATR-Hinweis: unter 0,5 ATR „zu eng“, über 3 ATR „zu weit“ – **Richtwerte der App**, keine Regel des Skills. |
| `size.ts` | **Größe in ganzen Einheiten** innerhalb von vier Grenzen: Verlust pro Trade, Positionsdeckel (% des Kontos), Kaufkraft (Hebel, Cash-Puffer), Rest des Tageslimits. Verlust je Einheit = Abstand zum Stop plus Gebühren und Slippage (`positionSize` aus `@/domain/risk`). Die kleinste Menge gewinnt, abgerundet auf den Mengenschritt; `binding` nennt die bindende Grenze. Zu weit oder unter dem Mindestwert → Ablehnung mit Grund, **keine** stille Verkleinerung. |
| `risk.ts` | **Risiko-Check** gegen die Limits der Risiko-Seite (`limitStatus`, `riskLimits`, `riskPreview`, `rrCalc`, `cooldownWarning` – nichts doppelt gerechnet): Stop gesetzt, Verlust am Stop gegen das Limit, Chance-Risiko, Tageslimit samt diesem Trade, Trades heute, offenes Risiko, Hebel, Liquidation, Pause, Alter des Preises. Ampel Grün/Gelb/Rot; **Rot sperrt das Ticket** (nur auf dieser Seite, die App sperrt nichts). |
| `ticket.ts` | `buildTicket`: Zeilen, Text und CSV (Richtung, Einstieg, Stop, Ziel, Größe, max. Verlust, Quelle + Stand) – „Nur ein Plan zum Kopieren …“. |
| `form.ts` | `PlanForm` (Markt, Kerzenlänge, Sitzung, Range, Regeln, Konto, Risiko, Hebel …) und `formOf`: jede gespeicherte Form wird geprüft und auf Gültiges gesetzt; das Kürzel muss zum Markt der Sitzung passen (Krypto 3–20 Zeichen, Aktie ein bis fünf Buchstaben mit Klassenzusatz, sonst fällt es auf ein Beispiel zurück). |
| `market.ts` | Welcher Markt ein Kürzel ist, nach seiner Form (`symbolMarket`: Paar mit USDT/USDC = Krypto, ein bis fünf Buchstaben = US-Aktie; `symbolFits`, `formMarket`). |
| `link.ts` | Der Link in den Plan: `parsePlanLink("#plan?symbol=AAPL&side=long")` → was verstanden wurde (Kürzel, Markt, Richtung) und was übergangen und **gesagt** wird (`ignored`); `linkPatch` / `formPatchFor` = die Änderungen am Formular (ein Marktwechsel bringt die Sitzung mit und lässt zurück, was nur für den alten Markt galt: eigenen Einstiegspreis, Kurs- und Mengenschritt, Uhrzeit, absolute Stop-/Ziel-Preise, den Tag); `planLinkHash` baut den Link, den die Seite Aktien schreibt. |
| `feed.ts` | `feedLag`: wo der Kerzenstrom einer Aktie gegen die Uhr steht, solange die Sitzung läuft – wann die neueste geschlossene Kerze schloss, wann die nächste fällig war (zwei Minuten Gnade), wann zuletzt gehandelt wurde (über 15 Minuten wird es gesagt). Fakten, keine geschätzte Verzögerung. |

| `ticket.ts` | `buildTicket`: Zeilen, Text und CSV (Richtung, Einstieg, Stop, Ziel, Größe, max. Verlust, **Verwaltung – nur wenn geplant**, Quelle + Stand) – „Nur ein Plan zum Kopieren …“. |
| `form.ts` | `PlanForm` (Markt, Kerzenlänge, Sitzung, Range, Regeln, **Verwaltung `manage`**, Konto, Risiko, Hebel …) und `formOf`: jede gespeicherte Form wird geprüft und auf Gültiges gesetzt. |
| `config.ts` | `settings.plan` = `{ v: 1, prefs, plans }`, versioniert, **Passthrough** (unbekannte Schlüssel und unlesbare Pläne bleiben erhalten, `rejected`); höchstens 20 Pläne; `withPlanCfg` gibt dasselbe Objekt zurück, wenn sich nichts ändert; die Pläne sind eine Id-Liste (Cloud-Merge je Eintrag). |
| `manage.ts` | **Verwaltungsplan (F65).** `ManageSpec` = die Regeln des Backtests (`ExitsCfg`: Break-even, Teilziel, Trailing; gleiche Wertebereiche, pinned im Test); `managePlan` rechnet aus Einstieg, Stop, Ziel, Menge, Schritten, Gebühr, Slippage und ATR den **Ablauf** (Auslöser, neuer Stop, Teilmenge und Gewinn nach Gebühren, erster Trailing-Stop; Long und Short) und **Beispielrechnungen einzelner Wege** in Geld und R (Stop zuerst, Ziel, Break-even greift, Teilziel dann Stop oder Ziel, Trailing dreht um). Netto-Break-even = der Preis, bei dem der Rest mit Gebühren und Slippage auf null kommt (`netBreakEvenPrice`, mit dem Teilgewinn gegengerechnet), AUFgerundet auf den Kursschritt; der Stop wird nur nachgezogen. Was nie greifen kann (Auslöser oder Teilziel hinter dem Ziel, Teilmenge unter einem Mengenschritt, ATR fehlt) ist eine Anmerkung mit Grund, kein stilles Weglassen. Keine Prognose, keine Order. |
| `alarms.ts` | „Plan → 3 Alarme“ (mit geplanter Verwaltung 4: dazu der Auslöser als Schlüsselmarke „Plan-Verwaltung“, `SavedPlan.manageTrigger` / `PlanAlarms.triggerId`): Stop und Ziel als Schlüsselmarken (30m, Berührung, Rolle Info – `planAlarmLevels`), „flat by close“ als **Erinnerung zur Uhrzeit** (`dueFlatBy`, `nextFlatBy`; das Marken-Modell kennt nur Preise). Eine Erinnerung, die erst nach mehr als 12 Stunden gefunden wird, gilt still als verpasst. |
| `model.ts` | `buildPlanModel`: verkettet die Schritte, setzt den Zustand je Schritt (`done` / `warn` / `blocked` / `todo`, ein Schritt ist `current`) und liefert je Schritt die **Annahmen** in Worten (`assumptions`). `candleWindow`: 40 Kerzen Vorlauf (ATR) bis `min(jetzt, Ende der Sitzung)`. |

## Aktien (US-Börse)

Die Sitzung „US-Börse“ (9:30–16:00 New York, Feiertage und 13-Uhr-Schlüsse 2026/2027, Sommerzeit) war schon da; ab jetzt gibt es Kerzen dafür. Was der Kern bei einer Aktie anders macht (`model.ts`):

- **Ganze Stück:** Mengenschritt 1 (`DEFAULT_LOT`), „Stück“ als Einheit (`unitOf`); wer Bruchstücke beim Broker hat, trägt den Schritt selbst ein.
- **Kursschritt 1 Cent** (`STOCK_TICK`), unter einem Dollar 0,0001 – nach der Börsenregel, **nicht** aus den Kerzen abgeleitet (Yahoo liefert Kurse mit bis zu sechs Stellen). Ein eingegebener Schritt gilt. Der Einstieg (Schluss der Signal-Kerze oder Range-Rand) wird auf diesen Schritt gerundet, auf dem Gleichstand zum schlechteren Preis, und das steht in „Angenommen“; die Kerzen selbst bleiben unverändert, ein getippter Einstiegspreis auch.
- **Währung USD** (`STOCK_CURRENCY`): das Kapital des Kontos wird 1 : 1 als USD gelesen – die App rechnet nicht um; in einem Euro-Journal sagt „Angenommen“ das ausdrücklich. Die Zeilen des Risiko-Checks sprechen dieselbe Währung.
- **Kein Hebel:** gerechnet wird mit 1× (die Wahl im Formular wirkt bei Aktien nicht, bleibt aber für den Weg zurück zu Krypto); keine Liquidation, keine Funding-Zeile, das Ticket nennt keinen Hebel. Short ist möglich, aber Leihbestand, Marge und Leihgebühr kennt die App nicht (steht in „Angenommen“).
- **ATR nur aus der Sitzung** (so war es schon: Krypto darf Kerzen vor der Sitzung nehmen, eine Aktie nicht – die Nacht ist eine Lücke).
- **Quelle und Verzögerung:** `sourceNotes` (was die Quelle über sich sagt: inoffiziell, möglicherweise verzögert, Intraday nur wenige Wochen) kommen unter „Angenommen“ von Schritt 1; `lag` ist die laufende Verzögerungszeile. Der Preis für den Risiko-Check ist so alt wie der letzte Handel, den die Quelle meldet.
- **Alarme:** Schlüsselmarken lesen nur den Krypto-Live-Markt – ein Aktien-Plan bekommt darum nur die Erinnerung „flat by close“ (`PlanAlarms` mit leeren Ids), keine Marken, die nie bewertet würden.

## Entscheidungen, die der Nutzer treffen kann

- **Krypto-Sitzung:** ein Tag hat kein Ende wie eine Börse – Sitzungsende (24:00 des Tagesbeginns / Asien / London / New York) und der **letzte Einstieg** (`CRYPTO_CUTOFF_MIN` = 240 Minuten) sind Annahmen der App und stehen so im Text; „Letzter Einstieg“ ist einstellbar.
- **Mengen- und Kursschritt** kommen nicht live von der Börse: Mengenschritt 0,001 (Krypto) bzw. 1 (Aktien), Kursschritt bei Krypto aus den Kerzen abgeleitet, bei Aktien 1 Cent (0,0001 unter einem Dollar); beides einstellbar.
- **Aktien in Euro-Journalen:** keine Umrechnung – das Kapital wird als USD gelesen (steht in „Angenommen“). Wer in EUR führt, passt das Kapital selbst an.
- **Gebühren und Slippage** sind die Annahmen der Risiko-Einstellungen, keine Messung am Markt.

## Tests

`tests/unit/plan.{sessions,entry,exit,size,risk,config,model,link,stocks}.test.ts` – jede Funktion mit **Handrechnung im Test** (Sommerzeit, Rundung, bindende Grenze, Ablehnungen). `plan.stocks`: die AAPL-Sitzung
(`tests/e2e/mocks/planStockCandles.ts`): Range 184,50–185,60, Signal Long 185,90, Stop 185,05, Ziel 187,60, 20 Stück (der Deckel bindet) = 3.718,00 USD, Verlust am Stop 22,56 USD; dazu Kursschritt, Hebel, Währung, Short, `feedLag`.
`plan.link`: der Link, die Marktform eines Kürzels, der Wechsel zwischen Krypto und Aktien.
Zahlenbeispiel der Festdaten (`tests/e2e/mocks/planCandles.ts`): Range 99.880–100.250, Signal Long 100.380, Stop 100.065, Ziel 2R 101.010, 0,037 BTC, Verlust am Stop 17,21 USDT.
Jeder Abschnitt der Seite endet mit „Keine professionelle Finanzberatung.“ und der Quelle samt Stand der Kerzen.
