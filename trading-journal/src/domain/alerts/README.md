# `src/domain/alerts` – die vier Alarme (C2)

Reine Funktionen, keine Uhr, kein Netz. Server (`netlify/functions/_lib/alerts/*`) und Browser (`src/views/settings/alerts/*`) lesen dieselbe Quelle.

| Datei | Inhalt |
|---|---|
| `types.ts` | die vier Ereignisse (`green_warn`, `green_confirm`, `red_warn`, `red_confirm`), `AlertReading` (was eine Quelle über EINEN Markt sagt: `held`, `margin`, `approach`), das Interface `AlertSource`, `AlertMemory`, `AlertFire` |
| `engine.ts` | `stepAlerts(memory, readings, opts)` → Ereignisse + neues Gedächtnis. Schwelle, Hysterese, ein Ereignis je Sprung, Reihenfolge, Zyklen, erster Blick still, Wiederholungssperre, veraltete Ablesung, Dedup-Schlüssel `Konto|Markt|Zyklus|Ereignis|Nummer` |
| `config.ts` | `AlertPrefs`, Standard (alles aus), `alertPrefsOf` (toleranter, begrenzter Leser), Tarifprüfung `checkPrefsAgainstLimits` / `limitPrefsToPlan` |
| `quiet.ts` | Ruhezeit in der Zeitzone des Nutzers (`isQuiet`, `quietEndsAt`) |
| `delivery.ts` | `planDeliveries` (ein Eintrag je Kanal: wartet / übersprungen mit Grund), Statusvokabular, Gründe auf Deutsch, Wartezeiten, Twilio-Status → unser Status, `phoneBudget`, `deliveryKey` |
| `phone.ts` | E.164 weltweit (`parsePhone`), Maske, Einwilligungstext und -version, Ansage (`alertCallText`) und TwiML |
| `replay.ts` | `replayWhale`: dieselbe Quelle und dieselbe Engine Punkt für Punkt über einen Verlauf gespielt (Marken der Wal-Karte); erster Blick still, eine Lücke beendet einen Lauf |
| `sources/*` | `industryReadings` (Regel des Branchen-Trends, Abstand zu Stop / Einstiegslinie), `whaleReading` (Top-Trader-Long-Anteil gegen 50 %), `keyLevelReading` (eigene Schlüsselmarken) |

Ehrlich: Ein Alarm weist auf eine Regel hin, die der Nutzer eingestellt hat – keine Beratung, keine Order; die Ansage sagt nie, was zu tun ist. Der Branchen-Trend hängt an Daten, die ein bis zwei Monate hinterherhinken. „Top-Trader“ sind Binance-Gruppen, keine Wale.

Tests: `tests/unit/alerts.engine.test.ts`, `alerts.domain.test.ts`; Server: `alerts.run`, `alerts.deliver`, `alerts.functions`; Datenbank: `supabase/tests/0014_alerts.test.sql`; E2E: `tests/e2e/alarme.spec.ts`.
