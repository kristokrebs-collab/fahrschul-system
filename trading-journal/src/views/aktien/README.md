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

`AnalystSlot` (Quartalszahlen · DCF · Kaufthese, F68/F69) and `CongressSlot` (the Congress tracker, below) are lazy components that load `./slotsImpl`, which hosts the real
sections (`data-testid="aktien-analyse"` / `"aktien-kongress"`; a slot without a body would say **"Kommt gleich"**). Props: `AktienSlotProps` (`types.ts`):

```ts
{ watchlist: readonly WatchItem[];   // the stocks of the watchlist (no crypto pairs)
  symbol: string | null;             // the ticker picked on this page (a watchlist row or a hit)
  data: StockDataContract;           // the app's stock data – same cache, throttle and typed failures as the scanner
  onWatch?: (symbol, name?) => Promise<boolean>; }  // puts a ticker on the watchlist (the same write as the button)
```

Whoever builds a section replaces the function body in `slotsImpl.tsx` (or the import in `Slots.tsx`); nothing else on the page changes.
A slot only reads and shows; what it saves goes under its own settings key, never into `settings.watchlist`.

## Kongress-Tracker (`kongress/`, section Kongress)

The stock trades members of the US **House** report under the STOCK Act, read from the House Clerk's public Periodic Transaction Reports (skill `trader-pelosi`; not a point of the 74-point plan, so `fids: []` in the register and no row in `docs/COVERAGE.md`). `CongressSlotImpl` lazy-loads `kongress/CongressCard`.

| module | what |
|---|---|
| `CongressCard.tsx` | the card: lead, the four caveats (**always on screen**: up to 45 days late, ranges, member is not intent, no signal – plus "Keine professionelle Finanzberatung."), filters (Mitglied, Ticker oder Name, Kauf/Verkauf, "Gemeldet in den letzten" 7 / 30 / 90 Tage / Dieses Jahr, chips Auf meiner Watchlist · Neu seit dem letzten Besuch · Nur mit Kürzel), the state of the sources in words (progress "Meldungen gelesen: n von m", failures with reason, copies from the cache), the rows, the Senate route (link + sentence, nothing automatic), source + index stand + fetch time. Nothing is asked before the section has been on screen once (`observeInView`; without an observer it loads at once). |
| `TradeCard.tsx` | one row as the filing states it: member · district · owner, security, ticker (a button: selects it on the page – `useAktien.select`, the Analyse sections read it), buy / sell, option strike and expiry (only what the description states, else "nicht erkannt"), trade date, filing date, delay in days (over 45 = flagged), the amount as the printed RANGE, the description, link to the PDF; or a dashed "Nicht lesbar" card with the reason and the same link. |
| `store.ts` | `useCongress` (memory): the index per year, the reports read (typed results with stamps), progress; decides which reports to read (`selectFilings`: window + member, newest first, at most 80 per load, "Weitere Meldungen lesen"); a new load cancels the old, a late answer never overwrites a newer one. |
| `strings.ts` | the German copy. |

Logic: `src/domain/congress` (delay, labels, windows, member match, list + filters, new-since-visit, watchlist key), data: `src/market/congress` (client, wire, index parser, PTR table parser), server: `netlify/functions/congress-*.mts` (README there). "Neu seit deinem letzten Besuch" = the document numbers the index listed at the last visit (`tj2-aktien-kongress-seen`, this device only, written when the card is left; first visit marks nothing and says so); the window choice is kept in `tj2-aktien-kongress`.
**Not done on purpose:** no "folge Pelosi" signal, no orders, no Senate scraping, no alert on a new filing (only the mark at the next visit).

Tests: `tests/unit/views.aktien.kongress.test.tsx` (the card on the whole chain: real Clerk files → real functions → client → UI), `congress.{parse,domain,client}.test.ts`, `functions.congress.test.ts`, e2e `tests/e2e/aktien-kongress.spec.ts` (mobile + desktop, axe dark + light; `tests/e2e/mocks/congress.ts` answers the two functions with the real rows of the fixture PDFs, dates moved relative to today; set `AKTIEN_SHOTS_DIR` for screenshots).

## Plan link (Handelsplan)

A hit and a watchlist row offer **"Plan erstellen →"** only when the page `plan` exists (`planPageExists()`: `PAGES.includes("plan")`); without
it the link is not drawn. It sets `location.hash` to `#plan?symbol=<ticker>&side=<long|short>` (`planHash`). The page `plan` reads that query
(ticker and side, nothing else) when it opens – **the Handelsplan agent registers that query seam**; until then the hash only opens the page.

## Assistant, search, function register

- Assistant: "Aktien scannen" and the neighbouring words open the scanner (`openFeature("aktien-scanner")`), "News zu meiner Watchlist" the news
  (`aktien-news`) – it only opens, it starts nothing (`tests/unit/assistant.stocks.test.ts`).
- Funktionen (`src/app/features.ts`): `aktien-scanner` (F67, teilweise), `aktien-watchlist` (F67, fertig), `aktien-news` (F68, teilweise); `docs/COVERAGE.md` says
  what is missing (F67: only the chart part – no sector or peer screener, no fundamentals, no historical universe, at most 400 charts a run; F68: only the
  news part – no earnings dates, no consensus or surprise, no rule drafts on numbers; the SEC 8-K feed plugs in through `registerNewsSource`).

Tests: `tests/unit/views.aktien.test.tsx` (scan counts and sentences, rank switch, preview, thresholds, watchlist writes, news merge / new / read,
slots, the plan link rule, the reasons shown), `tests/unit/assistant.stocks.test.ts`, e2e `tests/e2e/aktien.spec.ts` (mobile + desktop, network
mocked with `page.route`; set `AKTIEN_SHOTS_DIR` for screenshots).
