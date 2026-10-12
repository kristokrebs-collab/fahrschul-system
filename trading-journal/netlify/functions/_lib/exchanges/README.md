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
| `registry.ts` | `adapterFor(exchange, creds)` – Bitunix live; Binance / Bybit / OKX answer 501 with the CSV hint (phase 2) |
| `store.ts` | connections (`insertConnection` encrypts with the pre-generated id as AAD, `credentialsOf` decrypts, `rotateIfNeeded` re-encrypts with the newest key version), cursor, runs, `upsertSyncedTrades`, `pullSyncedTrades` (server-written trades only), `profileTz` |
| `api.ts` | `requireExchangeSetup` (503 without `EXCHANGE_ENC_KEY_V1`), `exchangeHttpError`, `exchangePlanState`, `cronEnabled` (`SYNC_CRON_ENABLED`, default on), `nextCronAt`, `clientTz` |
| `tokens.ts` | `tj_<43 base64url>` tokens, SHA-256 at rest, max 10 per user, `resolveToken`, `personalToken(req)` |
| `inbound.ts` | TradingView alert schema (`open` / `close`, `{{ticker}}` → pair, timeframe), `tvOpenItem` / `tvCloseSet`, REST trade schema → upsert item |

## Env

`EXCHANGE_ENC_KEY_V1` (32 bytes base64, `openssl rand -base64 32`; rotation: add `_V2`, old blobs keep decrypting and
are re-encrypted on use), `SYNC_CRON_ENABLED` (`false` stops the 30-min cron), `SUPABASE_URL` / `SUPABASE_SECRET_KEY`.
