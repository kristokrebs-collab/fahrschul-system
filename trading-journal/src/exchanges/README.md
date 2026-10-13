# `src/exchanges` – Börsen-Sync, CSV-Import, API & Webhooks (P11)

Trades come into the journal by themselves: a **read-only** Bitunix API key (server-side sync, every 30 min or on
demand), CSV exports of nine platforms plus a mapping assistant, TradingView alerts and a small REST API. The trader
only adds what the exchange cannot know – setup, stop, feeling. The browser **never** holds a stored key: key and
secret are sent once to `POST /api/v1/exchange/connect`, encrypted there (AES-256-GCM, `_lib/crypto.ts`) and only the
last four characters ever come back.

## Honest states

| state | what the card shows |
|---|---|
| no cloud (file builds, `file://`, claude.ai, no `VITE_SUPABASE_*`) | nothing (`exchangeEnabled()` false) – the CSV import still works through `ExchangeHost` |
| signed out | Bridge animation, "Anmelden" + "CSV importieren" |
| functions missing / unreachable | the German `ApiError` + "Erneut versuchen" + CSV |
| server without `EXCHANGE_ENC_KEY_V1` (`configured: false`) | "Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet …" + CSV |
| plan without `exchangeSync` (payments set up, Free) | hero with "Pro freischalten" (`openUpgrade("exchangeSync", "pro")`) + CSV |
| hero | "Bitunix verbinden" with three facts (nur Lesen · verschlüsselt · automatisch) |
| connected | venue tile, masked key, live sync status (radar band, rolling counters, border beam + celebration on new trades), Auto-Sync switch, journal account, run history, hold-to-disconnect |
| key rejected (`status: invalid`) | the German reason + "Neu verbinden" (replaces the connection, trades stay) |

"Trade the best": the inbox appears only when imported trades miss something (biggest |P&L| first, three cards on
phones, six from `sm`), the Broker-Abgleich only while it has open items, the API card only when signed in.

## Data flow

1. **Connect** (`ConnectSheet`): 5-step German guide for a read-only key (no trading, no withdrawal, no IP binding) →
   key (masked to `••••7e2d` + TextScramble) and secret → mandatory read-only confirmation → the server signs a test
   call (`/api/v1/futures/account`), stores the encrypted key and answers the balance. The typed secret leaves the
   component state before the check runs (flushSync, so even the exiting form holds no copy) and returns only on error.
   Honest limit (review EX-01): Bitunix cannot tell anyone whether a key may also trade or withdraw – the test call only
   proves it can read. `permissions` stays `[]`, the connection row says "als Read-only bestätigt" (the user's
   confirmation), and the guide asks for read rights only.
2. **First import**: 30 / 90 / 180 / 365 days, as a background function (`exchange-backfill-background`, 202) with a
   client run id; the card polls the run every 3 s. "Erst Probelauf" shows the dry run instead.
3. **Sync** (`syncNow`): `POST /api/v1/exchange/sync` repeats while the server says `more` (≤ 6 calls), then pulls.
   The server writes `journal_docs` directly (deterministic id `t_bx_<positionId>`, upsert by `externalId`).
4. **Into this device**: with the cloud sync live the trades arrive through Realtime. Without it (`localMerge.ts`)
   `ExchangeHost` pulls `GET /api/v1/exchange/sync?since=` on start, every 10 min and when the tab returns, and merges
   with the field rule below (≥ 10 changes through `importBackup(…, merge)` with a safety snapshot).
5. **Dry run** (`DryRunSheet`): what would land, nothing stored – net / gross / fee / funding per position and the
   fee-convention check ("Bitunix meldet den Gewinn ohne Gebühren …, n Positionen nachgerechnet").

### Field ownership (`syncFields.ts` – the one rule, mirrored in SQL `upsert_synced_trade`)

- **SET** (exchange, overwritten every sync): exchange, exchangeAccount, externalId, syncSource, syncedAt, origin,
  market, side, status, date, exitDate, pair, entry, exit, qty, size, leverage, marginMode, fees, fundingFees,
  pnlManual, pnl, fills.
- **FILL** (only while empty): stop, target, stopHistory, targets, liqPrice – a stop the trader typed is never replaced.
- Everything else (setups, checklist, notes, reason, emotion, tags, rating, psych, screenshots, account, timeframe …)
  belongs to the trader and is never touched once the record exists. A deleted trade (tombstone) is never resurrected.

## Files

| file | what |
|---|---|
| `syncFields.ts` | SET / FILL keys, `mergeSyncedTrade`, `splitSyncFields`, `syncedTradeId`, `isSyncedRecord` – pure and alias-free (the functions import it) |
| `types.ts` | wire types of the functions (`ExchangeStatus`, `SyncResult`, `PositionCheck`, `PnlConvention`, `ApiToken`, …) – no secret fields exist |
| `api.ts` | `apiFetch` wrappers, `browserTz()` (trade times are written as local wall clock of the trader's zone) |
| `store.ts` | zustand store + flows: `loadExchangeStatus`, `openConnect`, `connectAccount`, `syncNow`, `runDryRun`, `startFirstImport`, `updateConnection` (optimistic), `disconnectAccount`, `pullNow`, `openCsvImport`, `toUiError` |
| `positions.ts` | Wave-0 contract for P05 (final): `useExchangePositions()` (polled every 15 s while mounted and visible, stable frozen arrays), `useHasExchangeConnection()`, `refreshPositions()` |
| `localMerge.ts` | `planMerge` (pure), `applyMergePlan`, `pullAndMerge`, `cloudSyncCarries`, pull mark `<prefix>exchange-pull` |
| `inbox.ts` | `isImported`, `gapsOf`, `syncInbox` (biggest |P&L| first), dismissed ids `<prefix>exchange-inbox-done` |
| `reconcile.ts` | `reconcile` (hand-typed duplicates: same pair / side, ≤ 15 min, ≤ 0.5 % – P&L deviation > max(1, 1 %) – dry-run positions missing in the journal), `mergeDuplicate` (exchange numbers + the trader's part, never automatic) |
| `strings.ts` | German copy (`EX`, `CONNECT` incl. the read-only guide, `DRY`, `INBOX`, `RECON`, `API_CARD`) |
| `ExchangeHost.tsx` | singleton host (portal to `body`): `ConnectSheet`, `DryRunSheet`, `CsvImportSheet`; loads status and pulls |
| `ExchangeSection.tsx` | the cells for `KontoView extraCards` (12-column rows, `Reveal` cascade) |
| `ui/*` | `ExchangeConnectionsCard`, `SyncStatus`, `ConnectSheet`, `DryRunSheet`, `SyncInbox`, `ReconcileCard`, `ApiAccessCard`, `parts` |
| `csv/*` | parser, nine formats, mapping assistant, `CsvImportSheet` (below) |
| `index.ts` | barrel |

## CSV import (`csv/`)

`parse.ts` (delimiter / BOM / quotes / German numbers / many date forms, Kraken legacy codes), `model.ts` (fills →
round trips per pair and side, `csvTradeId` = `t_csv_<format>_<fnv1a>` so a re-import is a no-op), `formats.ts`
(detected by header score ≥ 0.6), `generic.ts` (assistant: guessed mapping, required date / side / entry), `index.ts`
(`loadCsv`, `buildTrades`, `planCsvMerge`, `importCsvTrades` via `importBackup` merge with snapshot).

| format | export it expects |
|---|---|
| Bitunix Futures | Positionshistorie (closed positions) |
| Binance Futures | Trade-Historie (fills → positions) |
| Bybit | Closed P&L |
| OKX | Positionshistorie |
| Kraken | Trades (spot) |
| Coinbase | Fills / Transaktionen (spot) |
| MetaTrader 4/5 | Positionen (lots → units via contract size: FX 100 000, XAU 100, XAG 5 000; others without size) |
| Interactive Brokers | Flex Query Trades |
| TradingView | Strategietester "Liste der Trades" |

The column names follow the exports as documented in 2026; an unknown or changed layout falls back to the assistant.

## REST API & TradingView (`ApiAccessCard`, plan feature `apiAccess`)

Personal tokens `tj_…` (shown once, stored as SHA-256 only) with scopes `webhook:tradingview`, `trades:read`,
`trades:write`. Webhook URL `/api/v1/hooks/tradingview/<token>` (TradingView cannot send headers, so the token is in
the path – revoke it in the card if it leaks); the card offers the alert template `{"action":"open"|"close", …}`.
REST: `GET/POST /api/v1/trades` with `Authorization: Bearer tj_…`.

## Wiring (P14)

- `App`: mount `<ExchangeHost />` once (leaf host, next to `BillingHost`).
- `KontoView extraCards={<ExchangeSection withHost={false} startIndex={…} />}`.
- ImportDialog: a "CSV importieren" button → `openCsvImport()`.
- P05: `useExchangePositions()` / `useHasExchangeConnection()` from `@/exchanges/positions`.

## Tests

`tests/unit/exchange.client.test.ts` (field rule, local merge, inbox, reconcile), `exchange.ui.test.tsx` (card
states, connect flow incl. "no secret in the DOM", inbox, positions), `exchange.contract.test.tsx`,
`csv.import.parse.test.ts`, `csv.import.formats.test.ts`; server: `functions.bitunix.test.ts` (signature vs. the doc
vector), `exchange.mapping.test.ts`, `exchange.functions.test.ts`. E2E: `tests/e2e/exchange.spec.ts` on the dev harness
`dev/boerse.html` (mock Supabase + mock Bitunix with the real mapping), screenshots with `P11_SHOTS_DIR`.
