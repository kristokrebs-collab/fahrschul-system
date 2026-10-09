# `src/views/trades` – Alle Trades page

Bundle `H$` (Plan 6.2). Import from `@/views/trades`.

| export | notes |
|---|---|
| `TradesView`, `PageHeader`, `TRADES_LEAD` | page: header (`{n} Trades` count rolls), filters, KPI strip, table (desktop) / cards (mobile). `PageHeader { title; lead; count?; action? }`: the signal dot pops (`spring.pop`), title words rise 10 px out of a 4 px blur `stagger.words` apart (y on `spring.enter`, opacity/blur on `tween.reveal`), count and lead follow; the `h1` itself never animates; static under reduced motion. Same page enter as the setups/settings `PageHeader`. |
| `TradeFilters`, `SEARCH_DEBOUNCE_MS` | search = pulse `Autocomplete` (`combobox` "Trades durchsuchen", 150 ms debounce = `tween.debounce`; a hairline under the field fills over exactly the debounce; grouped suggestions from `searchSuggestions`: setups / sides are filter shortcuts, emotions / note words search at once), setup select = pulse `MorphSelect` (`button[aria-haspopup=listbox]` "Entscheidungsgrundlage", `data-value`), Segmented account / result / side, count pill morphing on `spring.island` inside a reserved slot (own line below `sm`). |
| `TradesTable`, `SortHeader` | table with the shared row highlight and the sliding sort indicator (see layoutIds), detail ghost `trade-{id}` measured with transform-free offsets. |
| `TradesCards` | mobile cards (`layoutId="trade-{id}"` source of the detail morph, not while the detail is open). |
| `KpiStrip`, `RowHighlight`, `rowGeometry` (`offsetWithin`, `measureRow`, `insetBox`, `sameBox`) | |
| `tradesModel` (`filterTrades`, `sortTrades`, `listKey`, `rowsKey`, `sortArrow`, `countLabel`, `setupNameOf`, `NO_SETUP`, `searchSuggestions`, `frequentWords`) | pure |
| NEW `tradesModel` (`filterExtra`, `signalOf` (parsed once per trade object), `mistakesOf`, `strengthKey`, `mistakeFilterTags`, `STRENGTH_OPTIONS`, `NO_MISTAKE`, `ANY_MISTAKE`) | additive filters `Fehler-Tag` / `Signal-Stärke` (`uiStore.tradeExtra`, session only, reset with `Filter zurücksetzen`); the selects show once the journal has tags / stored checks (or while set). `listKey(f, sort, extra?)` is unchanged while no extra filter is set. |
| NEW `SignalBadge` (`tradeCells`) | four strength bars of the stored `trade.signal` (`Signal-Stärke n von 4 (…)`, `·` without one) in the table's `Check` cell and on the cards. |
| `AutoHeight` | box that springs to its content's height (ResizeObserver, `spring.layout`, `overflow-y: clip`); declared height exception like `Collapse`. Used by the card body and the editor's setup chips. |
| `tradeCells` (`SideTag`, `ResultBadge`, `PnlCell`, `RCell`, …) | `PnlCell` / `RCell` animate through `MotionNumber gate` (shared observer, no state – cheap). |

## Motion (Plan 6.2)

- Table rows are in `AnimatePresence` in sync mode – never `popLayout` inside a `<table>`.
  - An exiting row gets `data-exiting`, `tabIndex -1`, `inert` and `pointer-events: none`, so `tbody tr[tabindex='0']` counts present
    rows only; unit tests read `tbody tr:not([data-exiting])`.
  - After the exits a settle tick feeds the rows' `layoutDependency`, so the remaining rows glide shut.
- `layoutDependency` of table rows and mobile cards is `rowsKey(listKey(filter, sort), rows)`: the filter/sort key plus an FNV-1a hash
  of the ordered ids.
- The card body switch (list ↔ `Keine Treffer` ↔ empty journal) is sequenced: `AnimatePresence mode="wait" initial={false}` (exit
  `tween.exit`, then opacity + scale .98 in) inside `AutoHeight`, so the two bodies are never drawn over each other (TR-01).
- Mobile cards use the table's choreography (sync presence, settle tick, `INSERT_DELAY` for inserts, re-key per sort) – TR-02.
- Rows inserted into a shown list wait `INSERT_DELAY` (= `spring.layout` settled) – TR-03.
- The subtitle is the shared `LeadFill` recipe (`@/views/setups/LeadFill`): pixel fill once per session (`tj2-fill-trades`), then the
  marker on "Klick".
- `content-visibility: auto` is intentionally NOT used on table rows: it is a no-op on `<tr>`, and on cell content it breaks auto column sizing.

## Tablet / touch

- 768–1023 px (tablet portrait) keeps the table but drops its 900 px minimum (`lg:min-w-[900px]`): 6 px cell padding, setup chips in a
  130 px column (they wrap, never truncate – `SetupChips` is `flex-wrap`, chip names wrap inside the chip), entry / exit stacked
  (`EntryExit stack`). Measured: no sideways scroll at 768 / 820 / 900 (scrollWidth = clientWidth), every column incl. P&L and R visible.
- Sort headers carry `.touch-hit` (≥ 44 px tap area on coarse pointers, no layout change).
- `KpiStrip` tiles are `MorphCard`s (`kpi-net`, `kpi-trades`, `kpi-wr`): a tap opens how the figure of THIS selection comes about.
- `RowHighlight` glides on `contextSpring(spring.hover, pointerSpeed())` sampled in the hover event (the token itself below 400 px/s, 0 for focus).
- Trade cards: the morph surface carries `data-trade-morph="{id}"` (the detail's swipe checks it to zoom back) and runs on
  `contextSpringAt(spring.detail, uiStore.detailTempo)` after a swipe-dismiss; shared ids are dropped for `DETACHED_DETAIL_SOURCES`
  (`marker`, `insights`).

layoutIds (contracts in `src/motion/README.md`):
- `hover-trades-{useId}` – `RowHighlight` between hovered/focused rows; `spring.hover`, opacity `tween.hoverPill` (exit delay .15 s);
  one per table, `borderRadius radius.hover`, inside the table's `layoutScroll` wrapper, measured with transform-free offsets.
- `sort-indicator-{useId}` – the active sort-column chip in `SortHeader`; `spring.layout`, chevron rotate `spring.plus`; one per table,
  `borderRadius radius.pill`, `aria-hidden` (the direction stays as sr-only ` ↑` / ` ↓` text).

Tests: `tests/unit/views.trades.{view,model,geometry,filters}.test.*`.
