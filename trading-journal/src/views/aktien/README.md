# `src/views/aktien` – Aktien (`#aktien`, `h1 Aktien`)

The stock module next to the crypto core (F67 scanner, part of F68 news). Registered as the lazy page `aktien` (`pages.ts`, page key `i`,
Dock label "Aktien", icon `stocks`); the shell never imports the barrel `index.ts` statically. Sections (each a `SectionTitle` with
`SectionNav` chips): **Scanner · Watchlist · News · Analyse · Kongress**.

Every number on this page has a source and a time next to it (`StampLine`: "Quelle: Yahoo Finance (inoffiziell) · Abruf … · letzte Kerze …").
A source that cannot be reached is an empty state **with its reason** ("Das Symbolverzeichnis konnte nicht geladen werden: …"), never a
gap and never an invented list. The page never sends an order; every result card ends with "Keine professionelle Finanzberatung."

| module | what |
|---|---|
| `AktienView.tsx` | `{ className? }` – the sections, the slots in `Suspense`, the closing `AnalysisNote`. `data-testid="aktien-view"`. Opening the page asks the network for nothing; the scan starts only on the button. |
| `aktienStore.ts` | `useAktien` (zustand): the scanner's choices and thresholds per market and mode (`localStorage` `tj2-aktien-scan`, a convenience only), the run (`idle · running · done · aborted · error`), the ticker picked for the analysis slots (`selected`). `start`, `abort`, `select`. |
| `scanRunner.ts` | `prepareAndRun`: the universe (directory block / watchlist / typed tickers / crypto top-N, each with its honest failure) → source → `runScan` of the kernel → the outcome plus `RunMeta` ("Block 3 von 41", the session an opening range belongs to, the directory's stand). No React. |
| `ScannerCard.tsx` | market (Aktien / Krypto), mode (Tagesbalken · Eröffnungsspanne), the universe and the cap (10–400 charts, default 100), the rules with every threshold (`RulesPanel.tsx`, reset to the defaults), start / cancel, progress bar, and the run summary: asked / scanned / skipped / failed / hits, the error rate, skipped and failed **by reason**, the sample sentence, the directory's stand. |
| `ResultsCard.tsx` | the hits: rank, ticker, side, setup, the number the setup is about, **the sentence why the chart is on the list**, the data stand of the row (source, fetch time, newest candle, a stale mark), chart preview (`MiniChart.tsx`, an SVG of the candles the rule read with its levels), the checked conditions, "zur Watchlist", "Plan erstellen →" (below). Sorting: Handelsumsatz · Kennzahl des Setups · Kürzel A–Z; a rank is a position in that sorting, said next to the list. |
| `WatchlistCard.tsx` | stocks and crypto pairs (≤ 50), add by ticker (validated; duplicates and the limit are refused with a sentence), quotes with source and time, "News", pick for the analysis, remove. Saved at once into `settings.watchlist` (`watchlistWrites.ts`, always from the latest settings; unknown keys survive). |
| `NewsCard.tsx` | headlines of the watchlist's stocks (Yahoo Finance and every registered source): merged duplicates (one story, all tickers and sources), keyword importance as a **hint** with the matched words shown, filters (Alle · Wichtige · Neue), "Neu" since the last visit (kept on this device, `tj2-aktien-news-seen`), "Als gelesen markieren", the state of each source. |
| `feedStores.ts` | `useQuotes`, `useNewsFeed`: the network-backed lists as small stores (a late answer never overwrites a newer one). |
| `Slots.tsx` / `slotsImpl.tsx` / `types.ts` | the two sections other parts build (below). |
| `strings.ts` · `ui.tsx` | the German copy (`AKTIEN`, reason hints, skip / fail labels) · small blocks (`StampLine`, `NumField`, `CheckChip`, `Figure`, `CardNote`). |

## Slot contract (Analyse, Kongress)

`AnalystSlot` (Quartalszahlen · DCF · Kaufthese, F68/F69) and `CongressSlot` (later) are lazy components that load `./slotsImpl`. Until a real
section exists they say **"Kommt gleich"** (`data-testid="aktien-analyse"` / `"aktien-kongress"`). Props: `AktienSlotProps` (`types.ts`):

```ts
{ watchlist: readonly WatchItem[];   // the stocks of the watchlist (no crypto pairs)
  symbol: string | null;             // the ticker picked on this page (a watchlist row or a hit)
  data: StockDataContract;           // the app's stock data – same cache, throttle and typed failures as the scanner
  onWatch?: (symbol, name?) => Promise<boolean>; }  // puts a ticker on the watchlist (the same write as the button)
```

Whoever builds a section replaces the function body in `slotsImpl.tsx` (or the import in `Slots.tsx`); nothing else on the page changes.
A slot only reads and shows; what it saves goes under its own settings key, never into `settings.watchlist`.

## Plan link (Handelsplan)

A hit and a watchlist row offer **"Plan erstellen →"** only when the page `plan` exists (`planPageExists()`: `PAGES.includes("plan")`); without
it the link is not drawn. It sets `location.hash` to `#plan?symbol=<ticker>&side=<long|short>` (`planHash` = `planLinkHash` of `@/domain/plan/link`). The page `plan` reads that query
(ticker and side, nothing else) through the router's seam for `#plan` and prefills market and direction – in memory only, nothing is saved or sent; a value it does not understand is ignored and said.
Works for stocks and for crypto pairs (a hit of the crypto scan links `symbol=BTCUSDT`). The analyst section (`AnalystPanel`) offers the same link next to "These anlegen" ("Plan erstellen →", Long) through the optional `onCreatePlan`.

## Assistant, search, function register

- Assistant: "Aktien scannen" and the neighbouring words open the scanner (`openFeature("aktien-scanner")`), "News zu meiner Watchlist" the news
  (`aktien-news`) – it only opens, it starts nothing (`tests/unit/assistant.stocks.test.ts`).
- Funktionen (`src/app/features.ts`): `aktien-scanner` (F67, teilweise), `aktien-watchlist` (F67, fertig), `aktien-news` (F68, teilweise); `docs/COVERAGE.md` says
  what is missing (F67: only the chart part – no sector or peer screener, no fundamentals, no historical universe, at most 400 charts a run; F68: only the
  news part – no earnings dates, no consensus or surprise, no rule drafts on numbers; the SEC 8-K feed plugs in through `registerNewsSource`).

Tests: `tests/unit/views.aktien.test.tsx` (scan counts and sentences, rank switch, preview, thresholds, watchlist writes, news merge / new / read,
slots, the plan link rule, the reasons shown), `tests/unit/views.aktien.analystPlan.test.tsx` (the analyst's plan link), `tests/unit/assistant.stocks.test.ts`, e2e `tests/e2e/aktien.spec.ts` (mobile + desktop, network
mocked with `page.route`; "Plan erstellen →" end to end into the Handelsplan; set `AKTIEN_SHOTS_DIR` for screenshots).
