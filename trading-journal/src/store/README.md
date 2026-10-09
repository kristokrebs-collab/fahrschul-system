# `src/store` – persistence, state and routing

Three zustand stores plus the persistence layer of the BTC Trade Journal (Plan 1.4, 1.5, 8.2–8.6).
Write access to journal data goes only through `StoreApi`; UI state lives in `uiStore`; the hash router
keeps `uiStore.page`/`tradeFilter` and `location.hash` in sync.

## Boot (app shell)

`bootJournal({ probeCloud?, autoBackup?, now?, probeTimeoutMs? })` – the `use("db")` probe is raced against
`PROBE_TIMEOUT_MS` (8 s); when it does not settle the store goes local.

```ts
import { bootJournal } from "@/store/journalStore";
import { installRouter } from "@/store/router";

bootJournal();                 // sync hydrate + migrate, then probes claude.ai (Fall A / Fall B)
const uninstall = installRouter(); // after bootJournal (needs the setup ids for `#trades?setup=…`)
```

Start sequence: `migrate()` → hydrate from localStorage (synchronous, state usable in the first render) →
probe `window.claude?.use("db")`.
- **Fall A** (no `window.claude.use`, e.g. Netlify): `mode:"local"`, `loaded:true` in the first microtask.
- **Fall B** (claude.ai): `mode:"connecting"`, `loaded:false` until `use("db")` resolves. `null` → local;
  handle → `cloud`, the cloud snapshots **replace** the local state (never merged, never uploaded), `loaded`
  after the trades **and** settings snapshot. Snapshot errors → `mode:"error"`.
- Local mode runs the daily auto-backup (`tj2-backup-YYYY-MM-DD`, keeps 14).
- Quarantined records from the migration toast `{n} Einträge konnten nicht gelesen werden`.

## Editions and storage namespaces

The build edition (`src/edition.ts`, Vite `define`) picks the key prefix: personal (web root, "persönlich" file)
`tj2-*` – the same keys as the other journal version; share (`/teilen/`, "zum Teilen" file) `tj2share-*`, so the
share edition never reads or writes the personal journal on the same origin / browser. Build every key of your own
module with `storageKey("name")` (`@/store/storage`) instead of a `"tj2-…"` literal, or use `KEYS.*` for the shared ones
(`KEYS.triggerLast`, `KEYS.quarantine`, …). UI flags follow the same rule, so the two editions on one origin never share
them: `tj2-ui`, `tj2-ui-market-tiles`, `tj2-ui-intro`, the session flags `tj2-intro` / `tj2-dock-intro` and the lead-fill
flags `tj2-fill-{setups|trades|settings}` are `tj2share-…` in the share edition. The personal keys stay byte-identical
(`tests/unit/store.namespace.test.ts`).

## Data safety (two tabs, the other journal version)

- **Read-modify-write**: every local write re-reads its key first and upserts into the fresh list (a trade, reading or
  day note another tab – or the other journal file – saved meanwhile is never overwritten).
- **Settings** are three-way merged (`merge3(lastKnown, mine, stored)`, `merge3.ts`): keys/setups another tab changed
  survive; a key only one side has is always kept; id lists (setups, rules) merge per id (an edit beats a delete).
- **`storage` events** reload the changed key (`tj2-trades|settings|hyblock|days`, `null` = all) and patch the store.
- **No usable storage** (Android `content://` file opens, sandboxed frames): `storageStatus()` → `"unavailable"`, the
  journal runs on a session-only in-memory store, `useJournal.storage === "unavailable"`, `LocalModeBanner` shows the
  red `Speichern nicht möglich.` banner with `Backup importieren` / `Backup exportieren`, `modeLabelFor()` gives the
  header pill `Nicht gespeichert`.

## `journalStore.ts`

```ts
const { trades, settings, hyblock, days, mode, loaded, storage, api, quarantined } = useJournal();   // zustand hook
useJournal((s) => s.mode);                                   // selector form
const enriched = useEnriched();                              // EnrichedTrade[], memoised (WeakMap on trades+settings)
const view = useAccountView("all" | "makro" | "scalp");      // AccountView from @/domain/account, memoised
const shown = useShownTrades();                               // the trades the views render (both hooks above use it):
// `useJournal().trades` / getState() change synchronously with every write (persisted first); the views follow in a
// React transition, and a write made while the trade editor is open is shown PUBLISH_AFTER_CLOSE_MS (450 ms) after the
// editor closed – the close + toast commit alone, the sheet leaves undisturbed, then the Übersicht re-renders
const readings = useReadings();                              // HyblockReading[] sorted by `at`
getEnriched(trades, settings); getAccountView(enriched, settings, acc); // non-hook variants

// actions (bound to the active StoreApi; reject with StorageWriteError("Speichern fehlgeschlagen") on quota)
await useJournal.getState().saveTrade(t);        // upsert, id assigned when missing (t_… local / doc id cloud)
const { persisted, done } = saveTradeNow(t);     // same write; `persisted` = stored AND shown when the call returns (the
// local store persists + publishes synchronously; a remote store → false, await `done`). The trade editor closes and
// toasts in the same tick on `persisted`, so React commits the new journal, the close and the toast together (one commit)
await useJournal.getState().deleteTrade(id);
await useJournal.getState().saveSettings(s);     // whole object replaced, written verbatim
await useJournal.getState().saveHyblock(r);      // upsert, h_… ids
await useJournal.getState().deleteHyblock(id);
await useJournal.getState().saveDay("2026-10-07", { note, plan?, review?, mood? }); // day journal (tj2-days), merged
                                                 // over the stored entry; an entry left empty is removed
await useJournal.getState().deleteDay("2026-10-07");
useDayNote("2026-10-07")                          // DayNote | undefined (hook)
await useJournal.getState().replaceAll({ trades, settings, hyblock, days? }); // bulk (import/restore)
freshSnapshot()                                   // the journal as stored right now (local: re-read; cloud: snapshots)

MODE_LABELS[mode]   // { text: "Synchronisiert" | "Nur dieser Browser" | "Offline" | "Verbinde …", tone }
modeLabelFor(mode, storage)  // UNSAVED_LABEL ("Nicht gespeichert", loss) in local mode without storage, else MODE_LABELS
resetJournal()      // tests / HMR
```

## `uiStore.ts`

```ts
const page = useUi((s) => s.page);                    // "overview" | "trades" | "setups" | "settings"
acc: "all"|"makro"|"scalp"; setAcc(acc)
tradeFilter: TradeFilter (default DEFAULT_TRADE_FILTER = y0); setTradeFilter(patch); resetTradeFilter()
tradeSort: { k: "date"|"pnl"|"r"|"setup", dir: -1|1 }; setTradeSort(sort); toggleSort(k)
detail: { id, source: "recent"|"table"|"marker"|"insights"|null }; openDetail(id, source) (no-op while transitioning); closeDetail()
DETACHED_DETAIL_SOURCES = ["marker", "insights"]   // no list row owns the `trade-{id}` morph target → lists drop their shared ids
detailTempo: number; dismissDetail(tempo)           // swipe-dismissed detail: the source zooms back on contextSpringAt(spring.detail, detailTempo)
editor: { open, tradeId?, fromFab }; openEditor({ tradeId?, fromFab? }); closeEditor()
setupEditor: { open, setupId?, fromTrade }; openSetupEditor(...); closeSetupEditor()
transitioning: boolean; setTransitioning(v)
toasts: Toast[]; pushToast({ kind: "success"|"error"|"signal"|"info", title, value?, valueTone?, detail?, duration? }) → id
dismissToast(id)            // auto-dismiss 2800 ms, `signal` 5200 ms (TOAST_MS)

// persisted prefs (localStorage `tj2-ui`, never in a backup):
theme, hideLocalBanner, sparkline ("readings"|"live"), topTraderBase ("accounts"|"positions"), useProxy,
chart { interval: "1m"|"30m"|"1h"|"4h", rangeDays, pane: "ratio"|"oi"|"cvd", open }, flags: Record<string, boolean>
// (30m is resampled from kline_15m by ChartCard; an unknown stored interval falls back to 4h)
setPref("hideLocalBanner", true); setChart({ pane: "oi" }); setFlag("trLayout", true)
```

`pushToast(...)` is also exported as a plain function for non-React code. `persistSlice(subscribe, key, pick)`
is the tiny persist helper (writes when any picked key changes).

## `router.ts` – hash grammar `#{page}[?{query}]`

```ts
parseHash("#trades?setup=s_bo&result=win", knownSetupIds) // → { page: "trades", filter: {...y0, setup: "s_bo", result: "win"} }
parseHash("#nope?x=1")                                     // → { page: "overview" } (query dropped)
buildHash("trades", { setup: "s_bo" })                     // → "#trades?setup=s_bo" (non-defaults only, no sort)
navigate("trades", { setup: id })   // tab switch = pushState (back button switches tabs once no dialog is open);
                                    // filter set AND in the URL; from inside a dialog the page entry takes the
                                    // dialog entries' place (backStack.pushPageEntry)
navigate("settings")                // leaving trades keeps the filter in the store; target URL has no query
installRouter()                     // initial parse (URL wins), hashchange listener, replaceState mirror of
                                    // filter changes on the trades page (`q` debounced 150 ms; a dialog entry keeps
                                    // its marker) + installBackStack() → returns uninstall
restoreScroll(page, forceTop?)      // scroll memory per tab (rAF), top 0 on first visit / deep link
showPage(page) → px                 // shell (PageHost layout effect): applies a queued restore before paint; skipped –
                                    // no layout read – when the window has not scrolled since the switch and already
                                    // stands at the target (passive scroll listener of installRouter)
getScroll(page); currentRoute(); PAGES; PAGE_KEYS ({ overview:"o", trades:"t", setups:"s", settings:"e" })
```

## `backStack.ts` – Android back closes the topmost dialog (decision 26)

Every open modal session (`useDialogBehaviour` → `useBackClose`, `motion/a11y.ts`) owns one history entry above the page entry:
same URL, `history.state = { tjBack: depth }`. The layer keeps the depth of the current entry (`have`) equal to the open sessions
(`want`), reconciled once per microtask (a hand-off – one closes, one opens in the same commit – and StrictMode's replay cost nothing):

```ts
openBackEntry(onBack) → release      // session opened (push, same URL: no hashchange) / closed by any path (own history.go(-n),
                                     // its popstate counted and ignored – nobody reacts)
// back pressed (popstate to a smaller depth): the topmost session's onBack = its Escape path; still open BACK_CHECK_MS (50)
// later (the guard asked "Änderungen verwerfen?") → its entry is pushed again – one push per back press, never a loop
pushPageEntry(url)                   // router navigate: plain pushState, or – with dialog entries on top – replaces the single
                                     // dialog entry / traverses down to the page entry and pushes after landing (nested)
replaceEntryURL(url)                 // router filter mirror: keeps a dialog entry's marker
consumeHandledHashChange(newURL)     // router: a hashchange of a traversal the layer handled (back that closed a dialog whose
                                     // entry carried a newer filter URL) is no page switch – the router writes the UI's URL back
installBackStack(env?) → uninstall   // installRouter calls it; a reload on a dialog entry steps back to the page entry
```
Safety: an own traversal whose `popstate` never comes is dropped after `BACK_LAND_TIMEOUT_MS` (1 s) and not retried; a traversal that
did not move stops further automatic backs until the sessions change; a refused `pushState` switches the layer off (dialogs work
without entries). Same-URL `pushState` is allowed on `file://` (single-file editions) and `content://`. The history never grows: at
most one forward entry remains after a close. Not installed (component tests), sessions are only counted.

## Persistence

- `adapters/StoreApi.ts`: `StoreApi`, `StorageSnapshot { trades, settings, hyblock }`, `StorageAdapter { mode, load(), api, subscribe(ev), replaceAll(), dispose() }`, `AdapterEvent` (`patch` | `error` | `quarantine`).
- `adapters/localAdapter.ts`: `createLocalAdapter()`, `readLocalSnapshot()`. Keys `tj2-trades`, `tj2-settings`, `tj2-hyblock`, `tj2-days`; upsert `filter(id≠).concat` on a FRESH read; settings via `merge3`; `storage`-event sync (attached on subscribe, removed on dispose); normalisation on read only; readings sorted by `at.localeCompare`; a list key holding a non-array is quarantined before it is replaced.
- `adapters/claudeDbAdapter.ts`: `probeClaudeDb()` (`null` outside claude.ai), `createClaudeDbAdapter(db)` – collections `trades`/`hyblock`, docs `config/settings` and `config/days` (day journal), `onSnapshot`; `saveTrade` strips `id` → `set`/`add`. `ClaudeDb` interface is deliberately loose.
- `StorageAdapter.fresh()`: data as stored right now without touching adapter state (backup import merges onto it).
- `storage.ts`: `KEYS` (incl. `days`), `KEY_PREFIX`, `storageKey(name)`, `DATA_KEYS`, `storageStatus()`, `readJson`/`writeJson` (bundle `g`/`h`), `readJsonDetailed(key)` → `{ status: "missing" | "ok" | "corrupt" }`,
  `writeJsonStrict`, `writeRaw`, `listKeys(prefix)`, `removeKey`, `isQuotaError`, `StorageWriteError`.
  **Corrupt keys**: `readJson` copies an unparseable value to `tj2-quarantine` as `{ kind:"blob", key, raw, error:"invalid JSON", at }`
  (`quarantineRaw`, once per key+raw) before returning the fallback; `assertWritable(key)` (used by every local write) throws
  `StorageWriteError` while the raw string is not quarantined, so the first save can never destroy the only copy.
- `localAdapter.replaceAll` is atomic: all three keys are written, on failure the already written keys are rolled back to their
  previous raw strings and the error rethrown; memory changes only after all three succeeded.
- `claudeDbAdapter.replaceAll` upserts first and deletes leftovers last; a rejected upsert aborts before any delete. Invalid
  cloud documents are recorded in `tj2-quarantine` as `{ kind:"cloud", collection, id, raw }` (`recordCloudQuarantine`, idempotent per doc).
- `capability.ts`: `requestCapability<T>(name)` (bundle `oa`), `hasClaudeRuntime()`.

## `migrate.ts`

`migrate(now?)` → `{ from, to, changed, quarantined, snapshotTag, aborted? }`. Meta key `tj2-meta` `{ schemaVersion: 2, migratedAt, appVersion }`.
v1→v2 (additive, no snapshot): settings persisted as `{ ...raw, ...normalizeSettings(raw) }` – `s_mtf` appended to
settings that predate it, `mistakes` default list, a non-Binance `market.symbol` (`BITSTAMP:BTCUSD`) mapped to
`BINANCE:BTCUSDT` with the original in `market.sourceSymbol`; `signals` and unknown keys verbatim; trades untouched.
v0→v1: snapshot `tj2-backup-v0-{ISO}` (max 3 kept; an unparseable key is stored as its raw string). **If the snapshot cannot be
written the migration aborts** (`aborted: true`, schemaVersion stays 0, nothing touched, toast `Snapshot konnte nicht angelegt werden`).
Records are **normalised first, validated after** (`TradeSchema.safeParse(normalizeTrade(item))`): everything the old app read
(`entry:"100"`, `notes:null`, missing fields) stays valid; only records without `id` / not an object go to `tj2-quarantine`
(never deleted). Unknown fields kept, `pnl`/`r` recomputed via `computePnlR`, settings written through `normalizeSettings`.
Helpers: `validateTrades(raw)`, `validateReadings(raw)` (pure; migration, import/restore and the cloud adapter use them),
`appendQuarantine(entries)`, `recordCloudQuarantine(collection, invalid)`, `readMeta()`, `readQuarantine()`,
`quarantineToastTitle(n)`, `SNAPSHOT_FAILED_TITLE`. `QuarantineEntry.kind`: `trade | hyblock | blob | cloud`.

## `backup.ts`

```ts
await exportJson();                    // trade-journal-YYYY-MM-DD.json  ({ exportedAt, settings, trades, hyblock, schemaVersion, days })
await exportCsv();                     // trade-journal-YYYY-MM-DD.csv   (via @/domain/csv)
parseBackup(text)                      // { ok, backup, preview, invalid, parts } | { ok:false, error, path }
                                       // accepts ours, the other version's { exportedAt, settings, trades }, { trades }
                                       // and a bare [trade…] array; present parts must have the right type; neither
                                       // trades nor settings → NOT_A_BACKUP; trades/readings validated PER RECORD
                                       // (normalise first) – broken ones are counted in preview.invalid, not fatal;
                                       // parts = what the file carries (+ raw settingsKeys / setupIds)
previewText(preview)                   // "{n} Trades, {m} Grundlagen, {k} Ablesungen · exportiert am dd.MM.yy"
skippedText(n)                         // "{n} Einträge übersprungen" (toast detail when preview.invalid > 0)
applyBackup(current, backup, "merge"|"replace", parts?)   // pure; a part the file lacks keeps the current data
  // merge: trades upsert by id (newer updatedAt wins, the winner keeps keys only the loser had); an unknown id
  //        matching ONE current trade by date|entry|side that adds nothing is a pure duplicate (skipped);
  //        settings: own scalars stay, setups by id (file wins), rules add-only, mistakes united, keys only the
  //        file carries (signals, …) adopted (deep); readings by id; days per date (newer wins)
  // replace: everything the file carries
await importBackup(fileOrText, { mode })          // snapshot tj2-backup-import-{ISO} – when it cannot be stored the import
                                                  // FAILS (`Snapshot konnte nicht angelegt werden`) and nothing is written;
                                                  // skipped records go to tj2-quarantine (key "import")
listBackups()                          // [{ tag, key, kind: "auto"|"import"|"v0", at, trades }] newest first
lastAutoBackup()                       // "Letztes Backup {date}"
await restoreBackup(tag)               // = import flow with replace
autoBackup(now?)                       // daily tj2-backup-YYYY-MM-DD, keeps 14, QuotaExceededError → drop oldest
```

## `download.ts`

`download(filename, data, mime)` → claude.ai `downloads.save` when present, else Blob + `<a download>`;
`declined` is silent, other errors toast `Export fehlgeschlagen`. `canDownload()`, `DOWNLOAD_UNAVAILABLE`
(`Export gibt es nur, wenn das Journal auf claude.ai geöffnet ist.`).
