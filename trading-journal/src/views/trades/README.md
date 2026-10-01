# `src/views/trades` – Alle Trades page

Bundle `H$` (Plan 6.2). Import from `@/views/trades`.

| export | notes |
|---|---|
| `TradesView`, `PageHeader`, `TRADES_LEAD` | page: header (`{n} Trades` count rolls), filters, KPI strip, table (desktop) / cards (mobile). `PageHeader { title; lead; count?; action? }`: the signal dot pops (`spring.pop`), title words rise 10 px out of a 4 px blur `stagger.words` apart (y on `spring.enter`, opacity/blur on `tween.reveal`), count and lead follow; the `h1` itself never animates; static under reduced motion. Same page enter as the setups/settings `PageHeader`. |
| `TradeFilters`, `SEARCH_DEBOUNCE_MS` | search (150 ms debounce = `tween.debounce`; a hairline under the field fills over exactly the debounce, restarting per keystroke), setup select, Segmented account / result / side, count pill morphing on `spring.island`. |
| `TradesTable`, `SortHeader` | table with the shared row highlight and the sliding sort indicator (see layoutIds), detail ghost `trade-{id}` measured with transform-free offsets. |
| `TradesCards` | mobile cards (`layoutId="trade-{id}"` source of the detail morph, not while the detail is open). |
| `KpiStrip`, `RowHighlight`, `rowGeometry` (`offsetWithin`, `measureRow`, `insetBox`, `sameBox`) | |
| `tradesModel` (`filterTrades`, `sortTrades`, `listKey`, `rowsKey`, `sortArrow`, `countLabel`, `setupNameOf`, `NO_SETUP`) | pure |
| `tradeCells` (`SideTag`, `ResultBadge`, `PnlCell`, `RCell`, …) | `PnlCell` / `RCell` animate through `MotionNumber gate` (shared observer, no state – cheap). |

## Motion (Plan 6.2)

- Table rows are in `AnimatePresence` in sync mode – never `popLayout` inside a `<table>`.
  - An exiting row gets `data-exiting`, `tabIndex -1`, `inert` and `pointer-events: none`, so `tbody tr[tabindex='0']` counts present
    rows only; unit tests read `tbody tr:not([data-exiting])`.
  - After the exits a settle tick feeds the rows' `layoutDependency`, so the remaining rows glide shut.
- `layoutDependency` of table rows and mobile cards is `rowsKey(listKey(filter, sort), rows)`: the filter/sort key plus an FNV-1a hash
  of the ordered ids.
- The card body crossfade (list ↔ `Keine Treffer` ↔ empty journal) is `AnimatePresence mode="popLayout" initial={false}`: opacity +
  scale .98, origin top.
- `content-visibility: auto` is intentionally NOT used on table rows: it is a no-op on `<tr>`, and on cell content it breaks auto column sizing.

layoutIds (contracts in `src/motion/README.md`):
- `hover-trades-{useId}` – `RowHighlight` between hovered/focused rows; `spring.hover`, opacity `tween.hoverPill` (exit delay .15 s);
  one per table, `borderRadius radius.hover`, inside the table's `layoutScroll` wrapper, measured with transform-free offsets.
- `sort-indicator-{useId}` – the active sort-column chip in `SortHeader`; `spring.layout`, chevron rotate `spring.plus`; one per table,
  `borderRadius radius.pill`, `aria-hidden` (the direction stays as sr-only ` ↑` / ` ↓` text).

Tests: `tests/unit/views.trades.{view,model,geometry}.test.*`.
