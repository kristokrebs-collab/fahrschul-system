# `src/views/wachstum` – "Wachstum" (P08)

`WachstumView` (export of `index.ts`, `h1` "Wachstum") – psychology made measurable and progress steered to the
**process**: discipline, journaling, rule-keeping, routines. Never P&L or a trade count – a trade count is only ever an
upper limit, challenges never need a trade, records and levels are process records, outcome goals are never
celebrated. The whole journal (no account switch: this is about the person); a goal narrows itself with its scope. All
numbers come from `@/domain/growth` and `@/domain/psych` (see their READMEs), which reuse the coach's behaviour events
(P04 `eventsOf`), the discipline days (Auswertung) and the P05 limits / pause – nothing is re-derived.

| Section (lg, 12 columns) | Cards |
|---|---|
| header | `PageHeader` (title, lead with `WACHSTUM_LEAD_FILL` = `storageKey("fill-wachstum")`, "Check-in") |
| Heute | `CheckInCard` (5: mood glyph, stress / energy / sleep, the words, the last 7 days, open reviews) · `PreTradeCheck` (7) |
| Serien | `StreakBoard` (12: journal, check-in, green days in the limits, discipline) |
| Ziele | `GoalsCard` (12: the three most urgent goals, the rest folded) |
| Challenges & Gewohnheiten | `ChallengeCard` (5) · `HabitGrid` (7) |
| Psyche | `TrackersCard` (7) · `MoodCard` (5) · `DiaryCard` (12) |
| Fortschritt | `SkillRadar` (5) · `BestsCard` (7) · `ProgressCard` (12) |

Phones: one column in the same order, no horizontal scroll at 390 px. Every cell is a `Reveal`; section titles rise
letter by letter (`SectionTitle` of the Analyse page). The sheets (check-in, goal, post-trade review) and the "Ziel
erreicht" wipe are portalled to `document.body` (fixed layers never sit inside the page's transformed subtree).

## Cards and effects
- **Check-in** (`CheckInSheet.tsx`, `CheckInCard.tsx`): the mood as five abstract **dot-matrix glyphs** (falling chevrons,
  a sinking arc, a flat line, a rising arc, a burst – no emojis; the big glyph cross-fades through the phosphor), stress
  / energy / sleep on the **elastic slider** (`ui.tsx` `ElasticSlider`: the thumb follows the pointer on a soft spring,
  stretches with its own velocity like the elastic `Switch`, snaps to the step; `role="slider"`, arrows / Page / Home /
  End; one rect read per gesture, React state only per step), the words (+ own words), today's habits. Writes the day
  journal (`saveDay`: `mood` + `checkin`); "Leeren" removes it (the whole entry when nothing else is left). The card
  shows the last 7 days as glyph tiles rising one after another.
- **Pre-trade check** (`PreTradeCheck.tsx`): "Bereit" / "Noch nicht bereit" / "Pause" from today's check-in, the checklist
  (the Grundregeln, else four standard points; ticks per device and day) and the **P05 risk guard** (`useRiskBase` /
  `useLimitReport` / the guard's override) plus today's revenge / tilt events. The verdict is a dot-matrix word (BEREIT ·
  OFFEN · PAUSE, phosphor cross-fade), the score a `ConfidenceMeter`, a running pause an error `StatusPill` whose ring
  runs to its end ("Pause · mm:ss" on `nowMv`). Advice only.
- **Post-trade review** (`PostTradeReview.tsx`): plan followed?, stress now (the trade editor's `Meter5`), exit reason,
  execution rating (`RatingDots`), one learning – written into the trade (`followedPlan`, `rating`, `psych.*`; every other
  field kept). `PostTradeReviewHost` (P14, App.tsx) watches real saves (fresh, ≤ `BULK_SAVE`, a decision of the trader –
  the coach watcher's rules) for a trade that just closed without a review and opens the prompt once the editor and the
  detail are closed; "Später" skips it for the session, the switch turns the prompt off per device. The sheet renders
  once even when the page and the host both mount it (`useSheetOwner`).
- **Streaks** (`StreakBadge.tsx`): `RollingDigits`, a radar `PulseDot` (`rings={2}`, finite) on running streaks, "Rekord"
  when the running streak is the best; a streak that grew since this device last saw it bursts once
  (`celebrateStreak`, white echo from 5).
- **Goals** (`GoalCard.tsx`, `GoalSheet.tsx`): `RingGauge` with `passColor` (win-green + halo flash on reaching the target;
  a limit fills with its period while it holds, red once broken), the hold milestones as a `MilestoneRail` that lights up
  period by period (≤ 4 steps), the last periods as dots, the coach's "why", a self-check for `custom` goals, remove with
  an inline confirmation. The sheet offers process templates (review, plan, checklist, no rule break, no revenge, no FOMO,
  daily check-in, plan before the market, "Max. 3 Trades am Tag" as an upper limit, risk ≤ 1 %) or an own goal; saved
  through the Wave-0 `addGoalFromDraft`. A reached goal (`transitions.tsx` `useGrowthTransitions`): `status: "done"`, one
  `celebrateRecord` burst from its card and ONE `FullscreenWipe` "Ziel erreicht" (red curtain, dot-matrix "ZIEL", the
  goals, auto-close) – outcome goals are marked done quietly.
- **Challenges** (`ChallengeCard.tsx`): the running challenges and the deck are dealt into their grid on first view
  (`CardSpread` "deal"); "Karte ziehen" flips the top card out (the back turns to the edge and lifts, the front comes
  round on `spring.pop` and rests flat) – the first card matches the most frequent pattern (`suggestChallenges`);
  "Andere Karte" / "Annehmen". A running card shows its days as cells; done / failed are written back once by
  `useGrowthTransitions` (streak burst + toast, or an honest toast with the first violation). Below: the mastered ones.
- **Habits** (`HabitGrid.tsx`): one `HeatGridReveal` per habit (5 weeks, 3 on phones), cascading from TODAY outward;
  manual habits ticked right here or in the check-in, automatic ones (check-in, plan, review) count themselves; 30-day
  rate, streak, add (suggestions + own words), hide.
- **Trackers** (`TrackersCard.tsx`): the most frequent pattern as the headline (count, cost in R, self-reported days, one
  red `SpotlightSweep`), the others as rows with 8 weekly bars rising on first view; all quiet is said so.
- **Mood & result** (`MoodCard.tsx`): only the clearest factor(s) with enough data – diverging bars per level (Ø R right
  green / left red) growing from the zero line, n, ρ, the verdict; under the minimum an honest progress line.
- **Diary** (`DiaryCard.tsx`): `ScrubTimeline` over the last 10 entries (bars tinted by the day's feeling); the entry under
  the playhead opens beside it (state changes only when the day changes); trades open their detail.
- **Skills** (`SkillRadar.tsx`): six process axes, polygon grows from the centre (`spring.smooth`), corners pop
  (`spring.pop`), the profile of 30 days ago as a dashed ghost, level per axis with its change; a level-up this device has
  not seen runs one `SpotlightSweep` (win) – the first visit only remembers.
- **Bests** (`BestsCard.tsx`): process records; a beaten record decodes (`TextScramble`) and bursts once
  (`celebrateRecord`); the next three milestones with progress bars.
- **Weekly progress** (`ProgressCard.tsx`): Ø discipline and journaling as `EquityDraw` lines, check-in days and rule
  breaks as rising columns, each with its 4-week change; gaps instead of fake zeros.

## State
- `hooks.ts`: `useGrowthBase` (the prepared journal per data change + hour; `now` = end of the current hour), `useToday`,
  `useGoals`, `useChallenges`, `useStreaks`, `useTrackers`, `useDeck`, `useHabits`, `useFactors`, `useDiary`, `useSkills`,
  `useBests`, `useSeries`.
- `actions.ts`: every write through the journal store with an honest error toast (`saveCheckin`, `setHabitDone`,
  `addGoal`, `patchGoal`, `patchMany`, `startChallenge`, `patchChallenge`, `addHabit`, `archiveHabit`, `saveReview`).
- `growthStore.ts`: open sheets, the review queue, the wipe (memory); per device in `localStorage` (try/catch):
  `storageKey("growth-pretrade")` (today's ticks), `storageKey("growth-seen")` (celebrated streaks / records / levels –
  celebrations play once), `storageKey("growth-review")` (automatic prompt off).
- `widgets.tsx`: `WACHSTUM_WIDGETS` for the P13 cockpit (check-in, readiness, streaks).

## Motion / 120 Hz
Tokens only; transform / opacity / clip-path / filter; slider, timeline and gauges run on MotionValues (no React render
per frame); `useReducedFx` → end states (no stretch, no flips, static grids); finite loops only (pings 3×, DotMatrix
presets rest); decorative layers `aria-hidden`; no new `aria-live` (toasts via `pushToast`); reveals end at
`transform: none`. No new `layoutId`s.

## Wiring (P14)
Register `wachstum` (key `w`) → `WachstumView`; mount `<PostTradeReviewHost />` in App.tsx (leaf with `data-layer`, after
SetupEditor, before Celebrate). Until then the dev harness `dev/wachstum.html` (Vite dev server) renders the page with
the real journal store, the trade editor + detail, the risk guard host and the review host.

## Tests
- `tests/unit/views.wachstum.test.tsx` – empty / filled, check-in, readiness + pause, goals, deck, habits, reviews
  (manual + automatic), sheet owner, the reached goal, `addGoalFromDraft` through the real store, widgets.
- `tests/e2e/wachstum.spec.ts` – seeded journal on mobile + desktop (`PW_WACHSTUM_URL`, default `/dev/wachstum.html`;
  `P08_SHOTS=<dir>` writes review screenshots).

## Täglicher Check-in beim ersten Öffnen (F61)

`DailyCheckinHost` (a leaf in `app/DeferredHosts.tsx`, gate `growth`) opens the check-in sheet ONCE per calendar day of the
trader's configured time zone (`openCheckin(day, true)`: **Später** / **Heute überspringen** / **Erledigt**). The decision
is the pure `decidePrompt` of `@/domain/checkin` (clock injectable: the `now` prop, `setCheckinClock` for the sheet):

- **One record per user and date, on every device**: the outcome (`checkin.status` `done` | `skipped`) lives in the synced
  day entry (`tj2-days` / the cloud `day` row), so a second device that has synced does not ask again; until its first
  sync landed (`useSyncStatus` connecting / syncing, at most 12 s) it waits instead of asking for what is already
  answered. Two offline devices that both answer fall back to the day-entry merge (newer `updatedAt` wins) – one record per day
  stays. An open prompt closes quietly when another device's outcome arrives and nothing was typed.
- **The day** is `dayKeyIn(now, tz)` (`Intl`, not device getters): correct at 00:00, on the 23 h / 25 h days of a clock
  change (tests: 29.03. / 25.10.2026) and when the device zone differs from the configured one.
- **When it does not ask**: before the intro / onboarding is done (a first run with an empty journal is the tour's), over an
  editor, the trade detail, a replay, another sheet or dialog (`backStackState().want`), before sync, when the trader
  switched it off (account: `settings.checkin.prompt`, device: `storageKey("checkin-device")` `{ prompt: false }`).
- **Später** is per device (`storageKey("checkin-snooze")` `{ day, until }`): until the reminder time (`settings.checkin.reminder`
  `HH:mm` in the zone) when it is still ahead, else two hours; the next day ignores it.
- **Fields** (`settings.checkin.fields`, switchable in "Felder und Erinnerung anpassen" inside the sheet): Stimmung, Schlafdauer,
  Schlafqualität, Stress, Konzentration, Energie, verfügbare Zeit, geplante Session, Tagesrisiko, Kommentar, Gefühle, Gewohnheiten
  + up to five own questions with a 1–N scale (`custom`). New journals ask the original check-in plus Konzentration. Every value
  starts unset and stays absent from the record until set – nothing is pre-filled, no health data beyond the trader's own entries.
- **Honesty of the record** (`dailyCheckinInput`): `firstAt` (never moves), `editedAt` (moves only when an ANSWER changes, not a habit
  tick), `late` – a check-in saved on a later day than it describes is marked **nachgetragen** (badge in the sheet) and never counts as
  known at entry. A skipped day is not a check-in (`checkinOf` → `null`, not a streak day, the Heute card says "Heute übersprungen").
- **Evaluation** (`CheckInInsights`, Psyche section): per day the trades that STARTED AFTER the answers were last changed – count,
  plan adherence, risk, result in R, quick re-entries (≤ 15 min after the previous exit, only where the exit time is known) –
  rank-correlated (ρ) with each check-in value; under 8 days a pair stays blank. The card names the sample, what was left out
  (skipped, nachgetragen, trades before the check-in, no check-in) and says "keine Diagnose, keine Kausalität".
- **Private**: the data is the day journal; nothing in `src/social`, the community views or the social functions reads it (guarded by a
  test). `useToday` counts "today" in the configured zone; streaks / habit grids keep the device day.

Tests: `tests/unit/domain.checkin.test.ts` (days, DST, prompt decision, config merge, bookkeeping, evaluation, privacy guard),
`tests/unit/views.checkin.test.tsx` (host with an injected clock, Später / Überspringen / Erledigt, no second prompt, next day,
sync / editor gating, late fill, settings, the card), `tests/e2e/checkin.spec.ts` (pinned clock: skip → reload → 23:59 → next day).
