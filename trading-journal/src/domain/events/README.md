# `src/domain/events` – Ereigniskalender, Strategiefilter, Morgenbriefing (F43)

Reine Domain (kein React, kein I/O, die Uhr ist immer ein Parameter). Die Oberfläche steht in `src/views/termine` (Markt-Seite), der Labor-Filter in `src/views/labor/EventFilter.tsx`.

**Drei Arten von Termin – und jeder Eintrag nennt seine Art** (`CalendarEvent.source`: Quelle, Regel, geprüft am, Link):

| Art | Was | Quelle der Regel (geprüft am 25.10.2026) |
|---|---|---|
| Regel | **Funding** 00:00 / 08:00 / 16:00 UTC (`rules.ts`) | OKX-Hilfe („every 8 hours (00:00, 08:00, and 16:00 UTC) by default, unless specified otherwise (i.e. every 1, 2 or 4 hours)“) und Bitunix-API (`fundingInterval` 8, `nextFundingTime` 00:00 UTC). Binance und Bybit waren von hier nicht erreichbar (451 / 403): nicht als geprüft genannt. |
| Regel | **Verfall** von Optionen und Futures: letzter Freitag des Monats 08:00 UTC, Quartalsverfall = März / Juni / September / Dezember (`rules.ts`) | Öffentliche Deribit-API (`public/get_instruments`): 30.10.2026, 27.11.2026, 25.12.2026, 26.03.2027, 25.06.2027, 24.09.2027 – alle Freitag 08:00 UTC (Fixture `tests/unit/fixtures/deribit-btc-futures-2026-10-25.json`). |
| Regel | **US-Börse** 09:30 / 16:00 Uhr New Yorker Zeit, Sommerzeit der USA über `Intl`, NYSE-Feiertage, frühe Schließung 13:00 (`usMarket.ts`, `usEvents.ts`) | NYSE „Holidays & Trading Hours“ 2025–2027 (Fixture `tests/unit/fixtures/nyse-holidays-2025-2027.json`: der Test vergleicht jeden Feiertag und jede frühe Schließung). Regeln: Sonntag → Montag, Samstag → Freitag (Neujahr auf Samstag: kein Ausgleich), Karfreitag über die Gregorianische Osterformel, Juneteenth ab 2022, früh: Tag nach Thanksgiving, 24.12. und 3.7. an Handelstagen Mo–Do. **Nicht berechenbar, darum nicht enthalten:** Sonderschließungen (Trauertage, Stürme). |
| Regel | **Wochenende** nach UTC (`rules.ts`) | Kalender. |
| Öffentliche Liste | **FOMC-Entscheidung**: ganztägig am New Yorker Tag des zweiten Sitzungstages (`fomc.ts`, `data/fomc.json`, 56 Sitzungen 2021–2027) | `federalreserve.gov/monetarypolicy/fomccalendars.htm`, abgerufen 25.10.2026 (Seitenstand 07.10.2026). Die Seite nennt **keine Uhrzeit** – darum kein Uhrzeit-Eintrag. Die Mitteilung trägt auf der Seite das Datum des zweiten Tages. Laut Seite ist jeder Termin vorläufig, bis er in der Sitzung davor bestätigt wird. Die Abstimmung ohne Sitzung vom 22.08.2025 fehlt (keine Sitzung). Außerhalb 2021–2027 ist die Antwort „keine Daten“ (`null`), nie „kein Termin“. Zweite, unabhängige Quelle für 2026: der Wirtschaftskalender des TradingView-Konnektors (7 Entscheidungstage Jan–Okt, abgerufen 25.10.2026, Fixture `tv-fed-rate-decisions-2026.json`) – gleiche Tage; seine Uhrzeiten werden nicht übernommen. |
| Eigener Eintrag | Name, Zeit, Wichtigkeit (`own.ts`) | Der Nutzer. `settings.events` = `{ v: 1, items: [{ id, title, at (ms UTC), importance, note }] }`, versionierter Passthrough-Schlüssel wie `settings.keyLevels`: strenges Lesen je Eintrag (Unlesbares bleibt unberührt in `rejected`), Cloud-/Zwei-Tab-Merge je Termin (`id`). |

Nichts ist geschätzt: kein CPI-, NFP- oder Earnings-Datum ohne Quelle – wer eines kennt, trägt es selbst ein.

## Dateien

| Datei | Was |
|---|---|
| `zone.ts` | Wanduhr ⇄ Zeitpunkt in jeder IANA-Zone über `Intl` (`wallToUtc`, `wallOf`, `wallStringToUtc` für die Journal-Zeit „2026-10-12T09:30“, `offsetLabel`, `formatStamp`, `ZONE_CHOICES`). Eine doppelte Ortszeit (Herbst) ist der frühere Zeitpunkt, eine fehlende (Frühling) wird mit dem alten Versatz gelesen. Gemeinsam mit dem Transaktionsbuch. |
| `types.ts` | `CalendarEvent`, `OwnEvent`, Arten, Gruppen der Chips (`KIND_GROUPS`). |
| `rules.ts` · `usMarket.ts` · `usEvents.ts` · `fomc.ts` · `own.ts` | die Termine oben. |
| `calendar.ts` | `eventsBetween({from, to, kinds, own})` (sortiert, `[from, to)`), `nextEvents`, `isSoon` („gleich“ = in höchstens 60 Minuten, nicht ganztägig), `untilText`, `groupByDay`, `monthGrid` (Montag zuerst). |
| `phases.ts` | **Strategiefilter**: `phaseMembership(ms)` (0–2 h vor Funding, 0–4 h nach Funding, Verfallstag, FOMC-Tag, US-Open-Stunde, Wochenende; dreiwertig: ja / nein / `null` = die Daten reichen nicht) und `analyzePhases(trades)`: je Phase n, Trefferquote (Wilson-Intervall) und Ø R innen gegen außen; Unterschied als Welch-Test (R) bzw. Differenz der Anteile, **Benjamini-Hochberg über alle verglichenen Phasen**, Urteil `klar` / `tendenz` / `offen` / `zu wenig` (unter 10 Trades auf einer Seite) mit denselben Werkzeugen wie die Auswertung (`@/domain/analytics/stats`). Eine Beobachtung mit Stichprobe, nie eine Ursache. |
| `filterKinds.ts` · `filterMask.ts` | Labor-Filter „Keine Einstiege X Minuten vor/nach einem Termin“: `eventMask(bars, execSec, minutes, kinds)` – Einstieg = Eröffnung der Kerze nach dem Signal; nur Funding, Verfall, US-Open (gelten für jede Kerze jedes Backtests); FOMC und eigene Termine sind **nicht** wählbar (die Liste endet 2027), das Labor sagt es mit Grund. Verdrahtet in `@/domain/lab/filters` (`FilterId` `event`, `eventMinutes`, `eventKinds`; erscheint in `filterInfos` erst, wenn gewählt – wie der Muster-Filter). |
| `briefing.ts` · `text.ts` | **Morgenbriefing** `buildBriefing(input)`: Überblick · Termine heute · Märkte & Watchlist · Schlüsselmarken · Alarme · Check-in · Worauf achten – jede Zeile `{text, source, at}`, Fehlendes „keine Daten“ (`missing`), keine Nachricht, kein Trade-Vorschlag. `briefingParagraph` = dieselbe Aussage als Absatz für den Assistenten (Quelle und Zeit in Klammern). `text.ts` = deutsche Sätze der Phasenauswertung. |

## Tests

`tests/unit/events.domain.test.ts` (Handrechnung: letzter Freitag über den Jahreswechsel, im Schaltjahr, Deribit-Instrumente, NYSE-Tabelle, Sommerzeit-Wochen, FOMC-Liste, Phasen, Filtermaske, Briefing), `tests/unit/lab.eventfilter.test.ts` (Maske auf echten 4h-Kerzen, Filtervergleich), `tests/unit/views.termine.test.tsx`, `tests/unit/views.labor.eventfilter.test.tsx`, `tests/unit/assistant.briefing.test.ts`, e2e `tests/e2e/termine.spec.ts`.
