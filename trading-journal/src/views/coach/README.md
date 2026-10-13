# `src/views/coach` – "Coach" (P04)

`CoachView` (export of `index.ts`, `h1` "Coach") – a rule-based, evidence-first trading coach over the account of the
Hero's switch (`uiStore.acc`). Everything is computed on the device from the journal by `@/domain/coach` (see its
README): deterministic, with evidence trades, minimum samples and an honest confidence. Nothing here needs a server or
an API key; the optional AI wording (`ask.ts`) only rephrases numbers that were already computed.

| Row (lg, 12 columns) | Cards |
|---|---|
| header | `PageHeader` (title, lead with `COACH_LEAD_FILL` = `storageKey("fill-coach")`, account switch) |
| Hero | `HeroCard` (12) – trading score as the hero numeral, lesson of the week, rotating tips, the score's parts |
| Fragen · Heute | `ChatCard` (7) · `TodayCard` (5) |
| Leaks & Edges | `EdgesCard` (12) |
| Plan · Timeline | `PlanCard` (5) · `TimelineCard` (7) |
| Profil | `ProfileCard` (12) |

Phones: one column in the same order, no horizontal scroll at 390 px. Every cell is a `Reveal` (ends at
`transform: none`).

## Cards and effects
- **Hero** (`HeroCard.tsx`): the trading score as the one big number (`ScoreHero`: Doto in the size of Analyse's Sharpe,
  `NumberCascade`, `/ 100` muted in Plex Sans, the verdict pill; no `COACH` wordmark – the `h1` says it), the lesson of the week – the
  first time per lesson (`storageKey("coach-lesson-<hash>")`) its words fill in with `PixelTextFill`, afterwards the key
  phrase carries a `TactileHighlight` (`tab={false}`); short tips cycle with `TextMorph` (finite, `aria-hidden`, the list
  is in an `sr-only` copy); the score's parts (`ScoreParts`: Edge · Disziplin · Risikokonstanz · Journaling as four
  growing bars, the biggest lever), "Zu wenig Daten" under 10 trades.
- **Frag deinen Coach** (`ChatCard.tsx`): German questions → `askJournal` (`@/domain/coach/nlq`). "Coach denkt …"
  shimmers for one reveal, then the answer types itself (`CoachStream`, 65 ms / character, capped), the facts land with
  `ValueFlash`, bars grow (`scaleX`), a line answer draws (`EquityDraw`), the `ConfidenceMeter` fills, the evidence trades
  cascade (`StaggerItem`, `TradeRows`). Suggestion chips from the journal (`suggestQuestions`) and the follow-ups of the
  last answer. A question the parser does not understand gets the honest fallback with examples – never a guess.
  History in memory (`coachStore.ts`, max 12).
- **Optional AI wording** (`ask.ts`): "Mit KI formulieren" is shown only when the cloud is configured, the user is signed
  in, the plan has `coachAi` and the server says `GET /api/v1/coach/ask → { enabled: true }` (asked once per session).
  Without a key nothing of it is visible – no broken button. The request carries the computed answer only (facts,
  evidence aggregates); note excerpts of the evidence trades go along only after the opt-in switch (`settings.coach.ai.notes`).
  A refusal / unverified number / error keeps the computed answer and says so in one line.
- **Heute** (`TodayCard.tsx`): trades, P&L and patterns of today, the patterns as rows (open the trade), the live alert of
  the watcher (advice + "Pause · mm:ss" as an error / warn `StatusPill` whose ring runs down on `useNowMv` – no render per
  second), "Fokus heute" = the first plan step. A critical alert sends one signal-red `BorderBeam` lap (clipped wrapper).
- **Leaks & Edges** (`EdgesCard.tsx`): edges and leaks from `findEdges` (single factors and 2-way combinations, `minN`,
  bootstrap CI, BH-FDR, stability over both halves). Edges show a `ConfidenceMeter` and "klar / Tendenz"; leaks get one
  red `SpotlightSweep`; each item: Ø R vs. the rest with the CI, n, the halves, the what-if ("ohne diese Trades" / "nur
  diese Trades", with CI) and the evidence trades in an expander. Below 2 × `minN` closed trades: honest empty state.
- **Plan** (`PlanCard.tsx`): the three strongest recommendations as a `MilestoneRail`, each with its week status
  (`goalActual` of the reports domain). "Plan übernehmen" pins the plan (`settings.coach.plan`) and creates the goals
  (`addGoalFromDraft`, P08); "Neuen Vorschlag übernehmen" when the pinned plan differs from today's analysis; "Plan lösen".
- **Timeline** (`TimelineCard.tsx`): every detected behaviour, newest first, grouped by day, filter chips with counts
  (`aria-pressed`), rows open the trade, 30 per page.
- **Profil** (`ProfileCard.tsx`): Personal Trading Intelligence – strengths, weaknesses, best time / asset / setup, the
  traits orbiting (`OrbitSpread`, focusable group). Under 10 trades an empty state.

## Watcher, trade panel, state
- `CoachWatcher.tsx`: **`useCoachWatch()` / `CoachWatcher`** – after a save, `coachAlert` (pure, domain) compares the
  journal before and after; a new pattern of severity ≥ 2 on the saved trade becomes ONE toast (advice + suggested
  pause) and the live alert of the Heute card. Bulk changes (> 3 records: import, restore, sync), stale records
  (`updatedAt` older than 5 min) and changes the app makes on its own (`MACHINE_FIELDS`: the MAE / MFE backfill,
  drawings) are ignored; each event is toasted once per session; the work runs off the save's task.
- `TradeCoachPanel.tsx`: **`<TradeCoachPanel tradeId />`** for the trade detail – grade A–D (`spring.pop`), verdict,
  plan vs. execution, MAE / MFE, rules, context, triggered behaviours, similar trades (buttons open them). Sections are
  `StaggerItem`s, so they cascade with the detail body. Renders nothing for an unknown id.
- `hooks.ts`: `eventsOf` (detectors, cached per enriched list + settings + days), `analyse` (edges, recommendations,
  plan, score, profile, lesson, tips; cached per closed list), `useCoachBase`, `useMinuteClock`, `useCoach`.
- `coachStore.ts`: chat history, live alert, timeline filter (per tab, in memory).
- `ui.tsx`: shared bits (verdict badge, severity dot, bars / line chart, evidence rows, key-value list).

## Contracts for the integrator (P14)
- page `coach` → `CoachView` (lazy), `h1` "Coach".
- App.tsx: `<CoachWatcher />` once, as a leaf with `data-layer`, after `SetupEditor`, before `Celebrate`.
- `src/overlays/TradeDetail.tsx`: `<TradeCoachPanel tradeId={trade.id} />` (e.g. under the psyche section).
- Gate: plan feature `coach` (page), `coachAi` (AI wording – checked here as well).
