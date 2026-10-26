# Handelsplan (`plan/`, F44 · F39 · F41 · F22)

Die Kette der Skills `trader-entry → trader-exit → trader-budget → trader-risk` (+ Alarme aus `trader-alerts`) als reine, deterministische
Rechnung. **Marktneutral:** die Eingabe ist ein Symbol und seine Kerzen – Krypto-Kerzen kommen heute von Binance (`@/market/plan`), Aktien-Kerzen
über den Datenvertrag, sobald ihn jemand liefert; am Rechenkern ändert das nichts. Nichts hier liest die Uhr, den Speicher oder das Netz: `now`
und alle Eingaben werden übergeben. Die App **sendet nie eine Order** und hat keine Broker-Anbindung; das Ticket ist Text zum Kopieren.

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
| `form.ts` | `PlanForm` (Markt, Kerzenlänge, Sitzung, Range, Regeln, Konto, Risiko, Hebel …) und `formOf`: jede gespeicherte Form wird geprüft und auf Gültiges gesetzt. |
| `config.ts` | `settings.plan` = `{ v: 1, prefs, plans }`, versioniert, **Passthrough** (unbekannte Schlüssel und unlesbare Pläne bleiben erhalten, `rejected`); höchstens 20 Pläne; `withPlanCfg` gibt dasselbe Objekt zurück, wenn sich nichts ändert; die Pläne sind eine Id-Liste (Cloud-Merge je Eintrag). |
| `alarms.ts` | „Plan → 3 Alarme“: Stop und Ziel als Schlüsselmarken (30m, Berührung, Rolle Info – `planAlarmLevels`), „flat by close“ als **Erinnerung zur Uhrzeit** (`dueFlatBy`, `nextFlatBy`; das Marken-Modell kennt nur Preise). Eine Erinnerung, die erst nach mehr als 12 Stunden gefunden wird, gilt still als verpasst. |
| `model.ts` | `buildPlanModel`: verkettet die Schritte, setzt den Zustand je Schritt (`done` / `warn` / `blocked` / `todo`, ein Schritt ist `current`) und liefert je Schritt die **Annahmen** in Worten (`assumptions`). `candleWindow`: 40 Kerzen Vorlauf (ATR) bis `min(jetzt, Ende der Sitzung)`. |

## Entscheidungen, die der Nutzer treffen kann

- **Krypto-Sitzung:** ein Tag hat kein Ende wie eine Börse – Sitzungsende (24:00 des Tagesbeginns / Asien / London / New York) und der **letzte Einstieg** (`CRYPTO_CUTOFF_MIN` = 240 Minuten) sind Annahmen der App und stehen so im Text; „Letzter Einstieg“ ist einstellbar.
- **Mengen- und Kursschritt** kommen nicht live von der Börse: Mengenschritt 0,001 (Krypto) bzw. 1 (Aktien), Kursschritt aus den Kerzen abgeleitet; beides einstellbar.
- **Gebühren und Slippage** sind die Annahmen der Risiko-Einstellungen, keine Messung am Markt.

## Tests

`tests/unit/plan.{sessions,entry,exit,size,risk,config,model}.test.ts` – jede Funktion mit **Handrechnung im Test** (Sommerzeit, Rundung, bindende Grenze, Ablehnungen).
Zahlenbeispiel der Festdaten (`tests/e2e/mocks/planCandles.ts`): Range 99.880–100.250, Signal Long 100.380, Stop 100.065, Ziel 2R 101.010, 0,037 BTC, Verlust am Stop 17,21 USDT.
Jeder Abschnitt der Seite endet mit „Keine professionelle Finanzberatung.“ und der Quelle samt Stand der Kerzen.
