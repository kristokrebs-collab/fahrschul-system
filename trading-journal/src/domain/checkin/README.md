# `src/domain/checkin` – täglicher Check-in (F61)

Pure rules; the answers are the `checkin` key of the day entry (`@/domain/psych/checkin`), the UI is `src/views/wachstum`
(see its README, section F61).

- `day.ts` – `dayKeyIn(ms, tz)` (the calendar day of a time zone via `Intl`: midnight and 23 h / 25 h days correct),
  `isValidTimeZone`, `deviceTimeZone`, `minutesOfDayIn`, `parseClock`, `shiftDayKey`, `nextWallTime`.
- `config.ts` – `settings.checkin` `{ v:1, prompt, timeZone, reminder, fields, custom[] }`: versioned passthrough settings key; `fields`
  merge per key and `custom` per id in the three-way settings merge; a missing key = defaults (older journals unchanged).
- `prompt.ts` – `decidePrompt(env)` (one pure decision from clock, zone, day entries, sync / intro / blocked state and the device
  snooze), `snoozeFor` (reminder time else two hours), `isLateFill`.
- `evaluate.ts` – `joinCheckins` (trades that started after the answers were last changed; skipped / late / untimed / no-check-in
  days counted, not read as a state), `correlationMatrix` (Spearman, `MIN_CHECKIN_N` = 8 days), `notableLines` (relation, never cause).
