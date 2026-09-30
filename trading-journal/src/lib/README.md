# `src/lib` – formatting, parsing, ids, dates

Pure helpers, no React. All are 1:1 ports of the original bundle (alias in parentheses) so the numbers and strings
match the legacy app character for character. Locale is `de-DE`; minus is U+2212 `−`; null/NaN/±∞ → `–`.

## `format.ts` (bundle `V`, `Xe`, `so`)
```ts
import { fmt, n0, n1, n2, signed, pct, pct0, r, price, date, time, dateTime, pf, mio, colorClass, toneClass, isFin, minus } from "@/lib/format";
```
| export | signature | example |
|---|---|---|
| `n0` / `n1` / `n2` | `(x: number \| null \| undefined) => string` | `n0(85900)` → `"85.900"`, `n2(-1.2)` → `"−1,20"` |
| `signed(x, d = 2)` | `d: 0 \| 1 \| 2` | `signed(396)` → `"+396,00"`, `signed(-12.5, 0)` → `"−13"` |
| `pct(x, plus = true)` | fraction → `"+5,0 %"` (1 decimal, plain space before `%`) | `pct(-0.0059)` → `"−0,6 %"` |
| `pct0(x)` | fraction → `"40 %"` (no sign, **no** U+2212 replacement — bundle quirk) | |
| `r(x)` | `"+3,96 R"` | |
| `price(x)` | 4 decimals below 10, else 2; no U+2212 | `price(84000.5)` → `"84.000,5"` |
| `date(d)` / `time(d)` / `dateTime(d)` | `"12.03.26"` / `"09:05"` / `"12.03., 09:05"` (invalid → `"–"` / `""` / `"–"`) | |
| `pf(x)` | `"–" \| "∞" \| n2` | |
| `mio(v)` | axis tick: `"1,5 Mio"` for ≥ 1e6 else `n0` | |
| `colorClass(x)` (`Xe`) / `toneClass(x)` (`so`) | `"text-fg" \| "text-win" \| "text-loss"` | |
| `fmt` | object with all formatters (`fmt.n2 === n2`) | |
| `DASH`, `MINUS`, `INFINITY_SIGN` | the three special characters | |

## `parse.ts` (bundle `rt`, `nt`, `XM`)
- `parseNumber(x: unknown): number | null` (`rt`) – tolerant: `"85.900,5"` → `85900.5`, `"85.900"` → `85.9`, `"1 234,5"` → `1234.5`, `""`/`"abc"`/`NaN` → `null`.
- `toInputString(x)` (`nt`, alias `formatNumberInput`) – `1234.5` → `"1234,5"`, `null` → `""`.
- `fractionToPercentInput(0.6215)` → `"62,15"`; `percentInputToFraction("62,15")` → `0.6215` (settings form).
- `sanitizeUrl(x)` (`XM`) – keeps the trimmed string only if it starts with `http(s)://`, else `""`.
- `toNonNegativeInt(x)` – `Math.max(0, Math.round(x || 0))` (Hyblock `deltaCandles`).

## `ids.ts` (bundle `Lf`)
- `newId(prefix)` = `prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)`.
- Helpers: `newTradeId()` (`t_`), `newReadingId()` (`h_`), `newSetupId()` (`s_`), `newChecklistItemId()` (`c`), `newRuleId()` (`g`, NEW).

## `dates.ts` (bundle `tt`, `Cg`, `BG`, `YM`)
- `tradeTime(t)` (`tt`) – `new Date(t.date || t.createdAt || 0)`; `"YYYY-MM-DDTHH:mm"` parses as **local** time.
- `nowLocalInput(now?)` (`Cg`) – `"YYYY-MM-DDTHH:mm"` for `<input type="datetime-local">`.
- `MONTHS_SHORT` (`BG`, `"Mär"`), `WEEKDAYS` (`YM`, index = `getDay()`), `weekdayName(d)`.
- Buckets (all local time): `monthKey(d)` → `"2026-03"`, `monthLabel("2026-03")` → `"Mär 26"`, `weekKey(d)` → `"2026-W09"` (ISO week, Monday start), `weekLabel` → `"KW 9"`, `weekStart(d)` (Monday 00:00), `isoWeek(d)`, `localDateKey(d)`, `startOfLocalDay("YYYY-MM-DD")`, `daysBetween(a, b)` (fractional), `bucketBy(list, keyOf)`.

## `cn.ts`
`cn(...classes)` – clsx + tailwind-merge (owned by the lead).
