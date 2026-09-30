# `src/store` – persistence, state and routing

Three zustand stores plus the persistence layer of the BTC Trade Journal (Plan 1.4, 1.5, 8.2–8.6).
Write access to journal data goes only through `StoreApi`; UI state lives in `uiStore`; the hash router
keeps `uiStore.page`/`tradeFilter` and `location.hash` in sync.

## Boot (app shell)

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

## `journalStore.ts`

```ts
const { trades, settings, hyblock, mode, loaded, api, quarantined } = useJournal();   // zustand hook
useJournal((s) => s.mode);                                   // selector form
const enriched = useEnriched();                              // EnrichedTrade[], memoised (WeakMap on trades+settings)
const view = useAccountView("all" | "makro" | "scalp");      // AccountView from @/domain/account, memoised
const readings = useReadings();                              // HyblockReading[] sorted by `at`
getEnriched(trades, settings); getAccountView(enriched, settings, acc); // non-hook variants

// actions (bound to the active StoreApi; reject with StorageWriteError("Speichern fehlgeschlagen") on quota)
await useJournal.getState().saveTrade(t);        // upsert, id assigned when missing (t_… local / doc id cloud)
await useJournal.getState().deleteTrade(id);
await useJournal.getState().saveSettings(s);     // whole object replaced, written verbatim
await useJournal.getState().saveHyblock(r);      // upsert, h_… ids
await useJournal.getState().deleteHyblock(id);
await useJournal.getState().replaceAll({ trades, settings, hyblock }); // bulk (import/restore)

MODE_LABELS[mode]   // { text: "Synchronisiert" | "Nur dieser Browser" | "Offline" | "Verbinde …", tone }
resetJournal()      // tests / HMR
```

## `uiStore.ts`

```ts
const page = useUi((s) => s.page);                    // "overview" | "trades" | "setups" | "settings"
acc: "all"|"makro"|"scalp"; setAcc(acc)
tradeFilter: TradeFilter (default DEFAULT_TRADE_FILTER = y0); setTradeFilter(patch); resetTradeFilter()
tradeSort: { k: "date"|"pnl"|"r"|"setup", dir: -1|1 }; setTradeSort(sort); toggleSort(k)
detail: { id, source: "recent"|"table"|"marker"|null }; openDetail(id, source) (no-op while transitioning); closeDetail()
editor: { open, tradeId?, fromFab }; openEditor({ tradeId?, fromFab? }); closeEditor()
setupEditor: { open, setupId?, fromTrade }; openSetupEditor(...); closeSetupEditor()
transitioning: boolean; setTransitioning(v)
toasts: Toast[]; pushToast({ kind: "success"|"error"|"signal"|"info", title, value?, valueTone?, detail?, duration? }) → id
dismissToast(id)            // auto-dismiss 2800 ms, `signal` 5200 ms (TOAST_MS)

// persisted prefs (localStorage `tj2-ui`, never in a backup):
theme, hideLocalBanner, sparkline ("readings"|"live"), topTraderBase ("accounts"|"positions"), useProxy,
chart { interval: "1m"|"1h"|"4h", rangeDays, pane: "ratio"|"oi"|"cvd", open }, flags: Record<string, boolean>
setPref("hideLocalBanner", true); setChart({ pane: "oi" }); setFlag("trLayout", true)
```

`pushToast(...)` is also exported as a plain function for non-React code. `persistSlice(subscribe, key, pick)`
is the tiny persist helper (writes when any picked key changes).

## `router.ts` – hash grammar `#{page}[?{query}]`

```ts
parseHash("#trades?setup=s_bo&result=win", knownSetupIds) // → { page: "trades", filter: {...y0, setup: "s_bo", result: "win"} }
parseHash("#nope?x=1")                                     // → { page: "overview" } (query dropped)
buildHash("trades", { setup: "s_bo" })                     // → "#trades?setup=s_bo" (non-defaults only, no sort)
navigate("trades", { setup: id })   // tab switch = pushState (back button switches tabs); filter set AND in the URL
navigate("settings")                // leaving trades keeps the filter in the store; target URL has no query
installRouter()                     // initial parse (URL wins), hashchange listener, replaceState mirror of
                                    // filter changes on the trades page (`q` debounced 150 ms) → returns uninstall
restoreScroll(page, forceTop?)      // scroll memory per tab (rAF), top 0 on first visit / deep link
getScroll(page); currentRoute(); PAGES; PAGE_KEYS ({ overview:"o", trades:"t", setups:"s", settings:"e" })
```

## Persistence

- `adapters/StoreApi.ts`: `StoreApi`, `StorageSnapshot { trades, settings, hyblock }`, `StorageAdapter { mode, load(), api, subscribe(ev), replaceAll(), dispose() }`, `AdapterEvent` (`patch` | `error` | `quarantine`).
- `adapters/localAdapter.ts`: `createLocalAdapter()`, `readLocalSnapshot()`. Keys `tj2-trades`, `tj2-settings`, `tj2-hyblock`; upsert `filter(id≠).concat`; normalisation on read only; readings sorted by `at.localeCompare`.
- `adapters/claudeDbAdapter.ts`: `probeClaudeDb()` (`null` outside claude.ai), `createClaudeDbAdapter(db)` – collections `trades`/`hyblock`, doc `config/settings`, `onSnapshot`; `saveTrade` strips `id` → `set`/`add`. `ClaudeDb` interface is deliberately loose.
- `storage.ts`: `KEYS`, `readJson`/`writeJson` (bundle `g`/`h`), `writeJsonStrict`, `listKeys(prefix)`, `removeKey`, `isQuotaError`, `StorageWriteError`.
- `capability.ts`: `requestCapability<T>(name)` (bundle `oa`), `hasClaudeRuntime()`.

## `migrate.ts`

`migrate(now?)` → `{ from, to, changed, quarantined, snapshotTag }`. Meta key `tj2-meta` `{ schemaVersion: 1, migratedAt, appVersion }`.
v0→v1: snapshot `tj2-backup-v0-{ISO}` (max 3 kept), `TradeSchema.passthrough()` / `HyblockReadingSchema.passthrough()`,
unknown fields kept, invalid records → `tj2-quarantine` (never deleted), `pnl`/`r` recomputed via `computePnlR`,
settings written through `normalizeSettings`. Helpers: `validateTrades(raw)`, `validateReadings(raw)` (pure; the cloud
adapter uses them on read), `readMeta()`, `readQuarantine()`, `quarantineToastTitle(n)`.

## `backup.ts`

```ts
await exportJson();                    // trade-journal-YYYY-MM-DD.json  ({ exportedAt, settings, trades, hyblock, schemaVersion })
await exportCsv();                     // trade-journal-YYYY-MM-DD.csv   (via @/domain/csv)
parseBackup(text)                      // { ok, backup, preview } | { ok:false, error, path }
previewText(preview)                   // "{n} Trades, {m} Grundlagen, {k} Ablesungen · exportiert am dd.MM.yy"
applyBackup(current, backup, "merge"|"replace")   // pure merge rules (newer updatedAt wins, setups by id)
await importBackup(fileOrText, { mode })          // snapshot tj2-backup-import-{ISO}, write, toasts
listBackups()                          // [{ tag, key, kind: "auto"|"import"|"v0", at, trades }] newest first
lastAutoBackup()                       // "Letztes Backup {date}"
await restoreBackup(tag)               // = import flow with replace
autoBackup(now?)                       // daily tj2-backup-YYYY-MM-DD, keeps 14, QuotaExceededError → drop oldest
```

## `download.ts`

`download(filename, data, mime)` → claude.ai `downloads.save` when present, else Blob + `<a download>`;
`declined` is silent, other errors toast `Export fehlgeschlagen`. `canDownload()`, `DOWNLOAD_UNAVAILABLE`
(`Export gibt es nur, wenn das Journal auf claude.ai geöffnet ist.`).
