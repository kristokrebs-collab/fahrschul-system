# `_lib/exchanges` – server side of the exchange sync (P11)

Read-only venue access, mapping venue positions to journal trades, the idempotent upsert into `journal_docs`, personal
API tokens and the inbound formats (TradingView alerts, REST). Used by `exchange-*.mts`, `hooks-tradingview.mts` and
`trades-api.mts`. Secrets are decrypted only inside `runSync` / the connect check and never logged, returned or put
into an error message.

## Bitunix (`bitunix.ts`) – implemented from the official docs (openapidoc.bitunix.com, "Sign" + futures endpoints)

```
digest = SHA256_hex(nonce + timestamp + apiKey + queryParams + body)
sign   = SHA256_hex(digest + secretKey)
```

- `nonce`: 32 random hex characters; `timestamp`: epoch **milliseconds**; headers `api-key`, `nonce`, `timestamp`, `sign`,
  `language: en-US`, `Content-Type: application/json`.
- `queryParams`: keys sorted ascending, concatenated as `key1value1key2value2` (no `=`/`&`, unencoded); empty values
  are dropped from the signature AND the URL (`cleanQuery`), so both always agree. GET bodies are `""`.
- Base `https://fapi.bitunix.com`. Only GET paths of `READ_PATHS` can be called – the client refuses anything else, so
  even a wrongly scoped key cannot place an order through this code.
- Pagination `skip` / `limit` (100), ≤ 9 requests per second (`MIN_SPACING_MS` 110), one retry after 1 s on the venue's
  rate / busy codes. Errors → `ExchangeError` with German messages (`BITUNIX_ERRORS`: 10001–10008, 20014, 403, …).
- The signature is unit-tested against the docs' example inputs (expected outputs computed with the doc's own Python
  snippet) and an independent copy of the official Node demo (`Demo/Node/openApiHttpSign.js`) –
  `tests/unit/functions.bitunix.test.ts`.

Endpoints used: `futures/account` (connect check + balance), `position/get_history_positions` (closed positions,
filtered by open time), `position/get_pending_positions` (live positions + the oldest open time),
`trade/get_history_trades` (fills per position, budgeted), `tpsl/get_history_orders` (stop / target),
`market/tickers` (mark prices for the live positions).

## Binance (`binance.ts`, `binanceTrades.ts`) – API-key route, read only, spot and USDⓈ-M futures kept apart

Written from the official docs (developers.binance.com, 2026-11-06); **never run against the live exchange** (the sandbox gets HTTP 451) – tests use a fake
venue in the documented payload shapes (`tests/unit/helpers/binanceVenue.ts`) that verifies every signature.

- Signing: `signature = HMAC_SHA256(secret, queryString)` as the LAST parameter, header `X-MBX-APIKEY`, `timestamp` + `recvWindow` signed (the doc's example vector is a test).
- Read-only by construction: `BinanceClient.get` issues GET only and only to `BINANCE_READ_PATHS`; weight-based spacing (≈ 80 % of the venue limit); 429 → one retry after
  `Retry-After`; 418 / 451 / -2015 / -1022 / -1003 … → German `ExchangeError`s (451 blames the server region, not the key).
- **Rights first** (`checkRights` → `/sapi/v1/account/apiRestrictions`, `evaluateRights`): withdrawal, internal / universal transfer, spot & margin trading, options, FIX trading, portfolio margin and a
  missing read right are **refused** (`422 rights_refused`, nothing stored). Binance has no read-only flag for the futures API – "Futures" must be on – so that is a **warning**
  the user must confirm (`409 rights_confirm`, then `acceptWarnings: true`); a spot connection with Futures on is a warning too. `permissions` stores `read`, `futures_enabled`, `ip_restricted`.
- One connection = one market (`meta.market`, default labels "Spot" / "Futures", so both can exist; `unique (user_id, exchange, label)`). Spot extra pairs in `meta.symbols`.
- No position history exists at Binance: trades are rebuilt from fills. Futures: symbols from the income history (`REALIZED_PNL`, 3 months), fills per symbol in 7-day slices
  (`/fapi/v1/userTrades`, paged by moving the start), funding from `FUNDING_FEE`, allocated to the position that was open (hedge legs split evenly). Spot: pairs of the coins held now
  (+ configured extras) found with one public price list, `/api/v3/myTrades` from the start then `fromId`. Reads go 30 days before the window (a position may start earlier).
- **No duplicates**: the position id is `f-<symbol>[-leg]-<first fill id>` / `s-<symbol>-<first fill id>` → `t_bn_…`; the first fill never changes, so overlapping windows, repeated syncs, a resumed
  import and the incremental cursor all hit the same record (`upsert_synced_trades` writes nothing for an unchanged one). A closing fill whose opening lies before the history is an
  *orphan* (counted in `notes.orphanFills`, never made into a trade); an unfinished position is not returned; a fee in BNB is not converted (`notes.unknownFees`, 0 in the trade).
- Resume: the adapter pages by symbol (`ListResult.resumeSkip`); a symbol is always read to the end, the deadline is checked between symbols.
- Disconnect: `exchange-disconnect` marks running imports as stopped and deletes the row (key and cursor with it); `runSync` checks the connection before every write (`connection_gone`).
- Plan: connecting needs the `exchangeSync` feature OR an `exchangeConnections` limit above 0 (`requireExchangeAccess`, read from `plans.ts`); the background cron stays behind `exchangeSync`.
- Env: `BINANCE_EGRESS_IP`, `BINANCE_SPOT_BASE`, `BINANCE_FUTURES_BASE` (`docs/ENV.md`).

## Mapping (`mapping.ts`)

- `symbolToPair` (`BTCUSDT` → `BTC/USDT`), `localWallClock(ms, tz)` (journal times are wall clock in the trader's zone).
- P&L: Bitunix reports `realizedPNL` **without** fee and funding; `fee` is a positive cost, `funding` is signed
  (negative = paid). `net = realizedPNL − |fee| + funding`, journal `fees = |fee|`, `fundingFees = −funding`
  (positive = paid). `detectPnlConvention` re-computes the gross from entry / exit / qty on every batch and votes; when
  the venue turns out to include fees already they are not subtracted twice (stored per connection in `meta`).
- `mapClosedPosition` → `{ trade, item, check }` (deterministic id `t_bx_<positionId>`, SET / FILL split of
  `src/exchanges/syncFields.ts`, a dry-run check row); `mapOpenPosition` → the live position of the P05 contract.

## Sync (`sync.ts`)

`runSync({ userId, connection, kind, dryRun, tz, from?, deadline, runId?, fillBudget? })`:

- Window: from `min(cursor, oldest still-open position) − 1 h` (positions are filtered by OPEN time, so a long hold
  closed after the last sync is not missed), first sync 30 days, backfill up to 366 days; 30-day slices.
- Budget: interactive / cron 8 s (`SYNC_BUDGET_MS`), backfill 13 min; at the deadline the slice and offset are stored as
  `resume` in `sync_cursor.meta` and `more: true` is returned.
- Writes via `upsert_synced_trades` in batches of ≤ 200 (`inserted | updated | unchanged | deleted` per item; a
  tombstone is never resurrected). Dry run writes nothing and does not move the cursor.
- Auth errors mark the connection `invalid` (HTTP 422 with the German reason) – the card offers "Neu verbinden".

## Other modules

| file | what |
|---|---|
| `types.ts` | `ExchangeAdapter`, `Venue*` types, `ExchangeError`, `AdapterRuntime` (fetch / clock / sleep, injectable) |
| `registry.ts` | `adapterFor(exchange, creds, { market, symbols })` – Bitunix and Binance live; Bybit / OKX answer 501 with the CSV hint; `keyRights` reads a key's rights (Binance) |
| `binance.ts`, `binanceTrades.ts` | the Binance adapter and the pure fills → positions step (above) |
| `store.ts` | connections (`insertConnection` encrypts with the pre-generated id as AAD, `credentialsOf` decrypts, `rotateIfNeeded` re-encrypts with the newest key version after a sync or positions read, `rotateStaleConnections` is the cron's sweep over the rest), cursor, runs, `upsertSyncedTrades`, `pullSyncedTrades` (server-written trades only), `profileTz` |
| `api.ts` | `requireExchangeSetup` (503 without `EXCHANGE_ENC_KEY_V1`), `exchangeHttpError`, `exchangePlanState`, `cronEnabled` (`SYNC_CRON_ENABLED`, default on), `nextCronAt`, `clientTz` |
| `tokens.ts` | `tj_<43 base64url>` tokens, SHA-256 at rest, max 10 per user, `resolveToken`, `personalToken(req)` |
| `inbound.ts` | TradingView alert schema (`open` / `close`, `{{ticker}}` → pair, timeframe), `tvOpenItem` / `tvCloseSet`, REST trade schema → upsert item |

## Env

`EXCHANGE_ENC_KEY_V1` (32 bytes base64, `openssl rand -base64 32`; rotation: add `_V2`, old blobs keep decrypting and
are re-encrypted on use), `SYNC_CRON_ENABLED` (`false` stops the 30-min cron), `SUPABASE_URL` / `SUPABASE_SECRET_KEY`.
