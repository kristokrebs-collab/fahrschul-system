# `src/domain/keylevels` – Schlüsselmarken (F09), Tagesplan (F08), mehrstufige Alarme (F22)

Pure TypeScript, no React, no I/O. The live side (candles, store, alert runtime, protocol) is `src/market/keylevels`, the
cards are `src/views/schluesselmarken` (Markt page), the explanation of the live signal (F10) is `src/domain/decision`.

```ts
import { allKeyLevels, evaluateLevel, buildDayPlan, stepStages } from "@/domain/keylevels";

const levels = allKeyLevels(settings);                      // the five fixed levels (derived) + the user's own
const ev = evaluateLevel(level, candlesOfLevelTf, now);     // waiting | provisional | confirmed | invalidated | unknown
const plan = buildDayPlan({ entries, precedence: "higher" }); // range | long | short | wait
```

## Model (`types.ts`, `config.ts`)

A key level has an own name, a market symbol, a price, ONE timeframe (`30m 1h 2h 3h 4h 1D 1W`), a direction (`above` /
`below`) and ONE trigger rule – separate on purpose:

| Rule | Confirmed when | Provisional? |
|---|---|---|
| `touch` | a wick reaches the level (`high >= level` / `low <= level`) – irrevocable | no (a fact, basis `intrabar`) |
| `running` | the candle CLOSES beyond (strict) | **only this rule**: the forming candle beyond the level, until it closes |
| `close` | one candle closes beyond (strict: a close ON the level does not count) | no (reason text says „Schluss steht aus“) |
| `closes` | N (2 … 10) consecutive closes beyond; a miss resets the count | no (`progress` = n of N) |
| `buffer` | a close beyond level ± distance (`%` of the level or `× ATR(14)`; the ATR is the one of the candle BEFORE) | no |
| `retest` | a close beyond (break), then a LATER candle comes back within the tolerance of the level and closes beyond again; a close back through the level before that takes the break back | no |

Extras per level: `invalidation` (a close beyond it kills a triggered level), `priority` 1 … 9, `role` in the plan (`auto` =
above → Long-Trigger, below → Short-Trigger; `long` / `short` / `stop` / `info`), `since`, `enabled`, `alerts`
(`LevelAlertRule`: on, the four stages, one-shot / recurring).

### Status (`evaluate.ts`)

`evaluateLevel(level, candles, now)` is pure and deterministic. Rules it keeps:

- **No lookahead.** A candle that opened after `now` does not exist; a candle counts as closed only when the feed says
  closed AND its close time has passed `now`.
- **Unknown never confirms.** No candles, candles older than two intervals, an unusable price, an ATR distance without 15
  candles → `unknown` (own reason text), never `confirmed`, never a guessed `waiting`.
- **The level's own timeframe.** The caller passes the candles of `level.tf`; there is no fallback timeframe.
- **State machine over the closed candles since `level.since`** (a level made today never confirms on yesterday's
  candles; the first candle that counts is the first that OPENED at or after `since`; a forming candle that opened
  earlier contributes only its current price): waiting → confirmed → invalidated (a close back across the level, or beyond
  `invalidation`) → confirmed again with the next fulfilment. `since = null` (the five fixed levels) is stateless: the latest closed
  candle (the latest N for `closes`) decides – what `scenario()` always did.
- **Intrabar and close are logged apart**: `events[]` carry `basis: "intrabar" | "close"` (`provisional`, `unconfirmed`
  = went over intrabar but closed back, `touch`, `break`, `confirmed`, `retest`, `invalidated`).
- Long and short are exact mirrors (tests mirror every series around the level and compare).

### Migration of the five fixed levels

They are **not copied**. `legacyKeyLevels(settings.market)` derives read-only `KeyLevel`s on every read (`id` =
`legacy:<key>`, kind `close`, tf `4h` / `1W`, `since: null`, no alerts): `longTrigger`, `longStop`, `shortTrigger`,
`invalidation` (4H), `lowerHigh` (1W). A `0` ("nicht gesetzt") is left out. The stored values stay in `settings.market`
(Einstellungen card, chart lines, exports, the other journal version), nothing can drift apart or get lost; an edit in
Einstellungen shows up in the model. Behaviour parity is pinned by tests (`domain.keylevels.evaluate`: every
`scenario()` verdict on a grid of closes; `domain.keylevels.plan`: the plan of the fixed levels = `scenario()`'s four-way
classifier, `bear` → Short with „harte Invalidierung unterschritten“). `scenario()`, `evaluateTrigger()`, the chart's
`setLevels()` and the overview's active-scenario highlight are untouched.

`settings.keyLevels` (versioned passthrough, `Settings.keyLevels?: unknown`): `{ v: 1, levels, precedence, alerts,
planToast }`. Reading is lenient (`keyLevelsCfgOf`); writing (`withKeyLevels`) keeps every unknown key of the root and every
entry this version cannot read (`rejected`, e.g. a timeframe or rule from a newer version – never repaired to a default),
and returns the same object when nothing changed. Absent until the user adds a level (old settings get no new key).

## Timeframes (`timeframes.ts`)

30m = 2 × `kline_15m`; 1h / 2h / 3h = 1 × / 2 × / 3 × `kline_1h`; 4h = `kline_4h`; 1D = `kline_1d`; 1W = `kline_1w`.
`timeframeAvailability(feeds)` says per timeframe whether the feed serves it right now, with the reason otherwise
(„15m-Kerzen werden geladen …“, „Die aktuelle Datenquelle liefert keine …“, „Der Live-Markt läuft nicht …“). The editor
shows an unavailable timeframe **disabled with the reason** – nothing is ever substituted.

## Tagesplan (`plan.ts`, F08)

`buildDayPlan({ entries, precedence, price })` → `{ active: range | long | short | wait, reason, headline, detail, scenarios[4],
precedenceNote, decidedBy, key }`; every scenario has `trigger`, `invalidation` and one line `changes` („Was den Plan
ändert“). A trigger is *fired* only when `confirmed`; `provisional` arms a scenario (never activates it), `unknown` never
counts. Both sides fired (timeframes disagree) → the **explicit `precedence`** decides: `higher` (default, the bigger
timeframe), `lower`, `priority` (1 = best) or `wait`; a tie waits. Only a long or only a short trigger is no range (→ wait);
no candles for the triggers → wait because of missing data. The invalidation of a scenario is the level's own
`invalidation`, else the nearest `stop` level behind it, else „Schluss zurück unter/über den Trigger“.
`planChange(prev, plan, now, last)` decides whether a change is announced: never on the first plan, never into / out of a
data gap, never for another level of the same scenario, the same flip not twice within 30 min. The toast is on by
default only once the user has an own enabled level (`planToastOn`) – users of the five fixed levels see nothing new.

## Alarme (`alerts.ts`, F22)

Stages in order: **prepare** (price within the prepare distance short of the trigger – or a provisional running break),
**confirm**, **retest** (price came back to the level and held), **invalid**. `currentStage(observation)` gives the one stage
a level is in; `stepStages(memory, observation, rule, now)` fires it only when it is higher than anything the cycle already
reached (no „Vorbereitung“ after „Bestätigung“; a jump straight to a confirmation sends one message). A stage that is
switched off still advances the cycle silently (switching it on later replays nothing). One-shot: each stage at most
once, ever; recurring: a new cycle after the price went away again (`waiting` and out of the prepare distance) or the
level left `invalidated`. Delivery (`decideDelivery`): channels → active hours (`inActiveHours`, device time, wraps over
midnight) → dedupe (same level + cycle + stage never twice; same level + stage within the cooldown). Every outcome
(`sent`, `duplicate`, `hours`, `channels`) is a line of the **Zustellprotokoll** (`DeliveryRecord`, capped at 200,
`appendDelivery`, `parseDeliveryLog`).

**Limit, said in the UI as well:** alerts run only while the app is open in a browser tab (a background tab is fine, a
closed tab or browser is not). Server-side monitoring (F21) is not part of this and not promised anywhere.

Tests: `tests/unit/domain.keylevels.{evaluate,config,plan,alerts}.test.ts`, `tests/unit/market.keylevels.test.ts`,
`tests/unit/views.schluesselmarken*.test.ts(x)`, `tests/e2e/keylevels.spec.ts`.
