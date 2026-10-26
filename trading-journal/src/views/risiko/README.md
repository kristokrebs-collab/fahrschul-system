# `src/views/risiko` – "Risiko" (P05)

`RisikoView` (export of `index.ts`, `h1` "Risiko") – tools before the trade and limits that work live, over the account
of the Hero's switch (`uiStore.acc`). All numbers come from `@/domain/risk` (see its README). The page never blocks the
journal: it measures, warns and offers the pause, and the user can override it.

| Section (lg, 12 columns) | Cards |
|---|---|
| header | `PageHeader` (title, lead with `RISIKO_LEAD_FILL` = `storageKey("fill-risiko")`, account switch) |
| Jetzt | `LimitsCard` (7) · `ExposureCard` (5) |
| Vor dem Trade | `CalculatorCard` (7) · `LiquidationCard` (5) |
| Portfolio | `ScenarioCard` (8) · `MarginCard` (4) |
| Muster | `CorrelationCard` (7) · `StreakCard` (5) · `RiskSpreadCard` (12) |
| Einstellungen | `RiskSettingsCard` (12) |

Phones: one column in the same order, no horizontal scroll at 390 px. Every cell is a `Reveal`; section titles rise
letter by letter (`SectionTitle` of the Analyse page).

## Cards and effects
- **Live-Limits** (`LimitsCard.tsx`): the daily loss as a `LiquidGauge` tank that turns signal red from `warnAt`; six
  `RingGauge`s (week, drawdown, open risk, largest loss today, trades today, leverage) with the warn marker as needle –
  the arc turns red as it passes the needle and an upward crossing flashes a halo. A breach sends one red `BorderBeam`
  lap round the card (`RiskCard beam`, clipped). The pause: an error `StatusPill` whose ring runs to `endsAt` with
  "Pause · mm:ss" on `nowMv` (no render per second) and `HoldConfirm` "Limit überschreiben" (hold = do it, a tap asks
  inline; logged in the guard store with its end). Only the three strongest warnings are listed.
- **Exposure** (`ExposureCard.tsx`): gross / net / hedged / effective leverage, the net exposure as a signed `DotMatrix`
  VU meter (√-scaled, MotionValue on `priceMv`), the unrealised P&L as `LiveText` (smooth glide + tick flash), the four
  biggest assets (long right / short left, growing from the centre), the open legs. Without P11: "Nur Journal-Daten".
- **Rechner** (`CalculatorCard.tsx`): account, side, pair, capital, risk % (chips 0,5 / 1 / 2 %), leverage; entry with
  "Live" (live pair: `LiveText` price), stop chips (% · ATR · box edge · structure – box / structure / ATR from the
  Box-zu-Box store's 4h bars, live pair only), target chips (1 / 2 / 3 R · box targets). Results cascade in
  (`NumberCascade`, after `tween.debounce`; a chip fill cascades again), R:R in Doto with `ValueFlash`, breakeven, the
  needed win rate, the liquidation. Over the leverage rule / the capital: the result block shakes once (`useShake`) and
  names the size the rule allows. "In Trade übernehmen" → `openEditor({ draft })` (account, side, pair, entry, stop,
  target, size = notional, qty, leverage, isolated margin, liq. price, status open, date now).
- **Liquidation** (`LiquidationCard.tsx`): the nearest liquidation as a `NumberCascade` headline, the planned position
  and the five closest legs with distance in % and ATR, a danger bar per row, "Näherung", a liquidation in front of the
  stop flagged; a liquidation under 2 % fires the red beam.
- **Margin** (`MarginCard.tsx`): with an exchange connection the bound margin as a round `LiquidGauge`; without one an
  honest empty state (no fake numbers).
- **Szenario** (`ScenarioCard.tsx`): the P&L curve over ±30 % drawn once (`EquityDraw`); the slider drives ONE
  MotionValue – a marker rides the curve, a band opens from 0 % (clip-path), the readouts are MotionValue text; the
  liquidation kinks are red dots. Crossing a liquidation renders once: the leg dissolves (`DissolveOut`) and returns
  when the slider goes back. Presets glide (`spring.smooth`).
- **Korrelation** (`CorrelationCard.tsx`): ρ matrix of the traded pairs (`HeatGridReveal` from the strongest pair; red =
  runs together), clusters named, "Erneut laden" after a failed fetch.
- **Serien** (`StreakCard.tsx`): expected longest losing streak (analytic + MC) vs. the current one, dots popping in.
- **Risiko je Strategie** (`RiskSpreadCard.tsx`): mean / ± sd / max per setup or asset on a shared axis, the per-trade
  limit as a dashed red line, the steadiest strategy marked with `TactileHighlight`.
- **Risiko-Einstellungen** (`RiskSettingsCard.tsx`): writes at once (`settings.risk`; the daily loss, loss per trade and
  trades per day go into `settings.discipline` – the same values as the settings page's "Disziplin-Grenzen"); invalid
  values shake and are refused; the guard switch; the editable maintenance-tier table.

## State, hooks, guard
- `hooks.ts`: `useMinute` (one render per minute), `useRiskBase`, `useLimitReport`, `useMarks`, `useExposure`,
  `useLiveUpnl` (MotionValue) and the editor contract **`useRiskPreview(draft)`** (P14 binds it into the TradeEditor).
- `guard.ts`: **`useRiskGuard()` / `RiskGuardHost`** – after a save one toast with the strongest NEW warning and the
  pause; per-device store `storageKey("risk-guard")` (close marks of fresh saves, the override). Bulk changes (import,
  restore, sync snapshot: more than 3 records) are ignored.
- `riskStore.ts`: calculator inputs and the spread grouping (per tab, in memory); `parseInput` / `toInput`.
- `model.ts`: liquidation rows, scenario legs, the pairs to correlate (open first, then the most traded, ≤ 8).
- `widgets.tsx`: `RISIKO_WIDGETS` for the P13 cockpit (limits, exposure, calculator).

## Motion / 120 Hz
Tokens only; transform / opacity / clip-path (the slider, marker, band and readouts are MotionValues – zero React
renders while dragging); `useReducedFx` → final states; finite loops (the VU meter sleeps once its history is flat,
the "1D" wave only while the daily candles load); decorative layers `aria-hidden`; no new `aria-live`.

## Wiring (P14)
Register `risiko` → `RisikoView`; mount `RiskGuardHost` in App.tsx; bind `useRiskPreview` in the TradeEditor. Until then
the dev harness `dev/risiko.html` (Vite dev server) renders the page with the real journal store, `bootMarket`, the
trade editor, the trade detail, the guard host, toasts and confetti.

## Tests
- `tests/unit/views.risiko.test.tsx` – empty / filled states, the pause override, calculator → editor draft, settings,
  guard, preview, widgets.
- `tests/e2e/risiko.spec.ts` – real Box-zu-Box market, seeded journal (`PW_RISIKO_URL`, default `/dev/risiko.html`).

## Inhalt-Leiste (Auffindbarkeit)

Unter dem Seitenkopf sitzt die `SectionNav` (`src/primitives/SectionNav.tsx`): ein Chip je Abschnitt, klebt unter dem Header, markiert den sichtbaren Abschnitt (`aria-current="location"`), ein Tipp scrollt weich (reduzierte Bewegung: Sprung) und hebt den Titel kurz hervor. Fünf Chips für Jetzt, Vor dem Trade, Portfolio, Muster, Einstellungen (`Section section=…` → `data-section` am Abschnittstitel). Test: `tests/e2e/funktionen-anker.spec.ts` (jeder Chip landet unter der Leiste), `tests/unit/primitives.sectionNav.test.tsx`.

## Verwaltung im Positionsrechner (F65)
Unter dem Ergebnis des Rechners (`risk-calc`) steht, sobald es ein gültiges Ergebnis gibt, die Karte „Verwaltung nach dem Einstieg“ (`risk-manage`, `CalcManage.tsx`, eigener lazy Chunk): dieselbe Karte und dieselbe Rechnung (`managePlan`) wie im Handelsplan, mit Richtung, Einstieg, Stop und Ziel des Rechners und der Menge, die er aus dem Risiko gerechnet hat (auf 0,001 abgerundet). Gebühr und Slippage sind die der Risiko-Einstellungen; Kurs- und Mengenschritt kennt der Rechner nicht (Kursschritt höchstens 0,01, steht unter „Annahmen und Grenzen“). Die Wahl der Regeln liegt pro Gerät (`storageKey("calc-manage")`). Test: `tests/unit/views.risiko.manage.test.tsx`.
