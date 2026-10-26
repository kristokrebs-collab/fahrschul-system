# `netlify/functions` – server functions (v2, `.mts`)

Netlify bundles every `*.mts` here with esbuild (`[functions] directory = "netlify/functions"` in the root
`netlify.toml`, P14). Each file: `export default handler(async (req, ctx) => …)` + `export const config: Config = { path,
method }` (or `{ schedule }`). Typecheck: `tsc -p tsconfig.functions.json` (part of `npm run typecheck`); lint: `npm run
lint` covers `netlify/`. Functions import `src/` modules only by RELATIVE path and only alias-free ones
(`src/billing/types.ts`, `plans.ts`, `contract.ts`, `src/cloud/scrub.ts`, `src/cloud/sync/docs.ts`,
`src/exchanges/syncFields.ts`; F21: `src/domain/keylevels/{types,config,evaluate,alerts,timeframes,watch,serverAlerts}.ts`,
`src/market/keylevels/bars.ts`, `src/market/sources/{binance,http}.ts`, `src/chart/resample.ts` – their `@/` imports are relative on purpose). Server env: `.env.example` (Netlify secrets, scope
Functions, never `VITE_`).

## `_lib` (shared, P09)

| file | exports |
|---|---|
| `http.ts` | `handler`, `json`, `error`, `errorFrom`, `HttpError`, `requireMethod`, `readJson(req, zod)`, `clientIp`, `BASE_HEADERS` – one error envelope `{ error: { code, message, details? } }`, German messages |
| `auth.ts` | `requireUser(req, { aal2?: true \| "ifEnrolled" })` (JWT via `auth.getClaims`), `assertAal2(user, mode)`, `mfaSatisfied(user)`, `optionalUser`, `bearerToken`. Rule (review SEC-01): every endpoint that returns or changes account data uses `aal2: "ifEnrolled"` – the same rule as `public.mfa_satisfied()` in the database (0001 / 0005) |
| `supabase.ts` | `supabaseAdmin()` / `admin()` (service role, bypasses RLS – always filter by the verified user), `setSupabaseAdminForTests` |
| `env.ts` | `env`, `envOptional`, `envInt`, `envNumber`, `envBool`, `SERVER_ENV` |
| `crypto.ts` | AES-256-GCM `encrypt` / `decrypt` (`v<n>:iv:tag:ct`, AAD `<user>:<connection>:<field>`), key rotation |
| `rateLimit.ts` | `rateLimit(key, max, windowSec)`, `enforceRateLimit` (429 + `Retry-After`), `rateKey` – backed by `rate_hit()` |
| `audit.ts` | `audit(userId, action, meta, ip)` (scrubbed meta, IP as HMAC with the server secret `IP_HASH_PEPPER`, never throws), `scrubMeta`, `hashIp`, `ipRateId` (daily rotating IP pseudonym for rate-limit keys) |
| `plan.ts` | `planOf(userId)`, `requirePlan`, `effectivePlan`; P10: `paymentsConfigured()`, `requireFeature(userId, feature)` (402 `plan_required`, details `{ feature, required, plan }`), `requireLimit(userId, key, used)` – both pass while payments are not set up, so a cloud build without Stripe never locks anyone out |
| `account.ts` | `collectExport`, `EXPORT_TABLES` (later packages append their per-user tables; missing tables are skipped), `fetchAllDocs`, `journalBackup`, `listUserFiles` / `removeUserFiles` (buckets `screenshots`, `backups`), `listBackups`, `expiredBackups`, `ensureBackupBucket`, `runNightlyBackup`, `DELETE_CONFIRM_WORD`, `redactSecrets` |
| `billingCleanup.ts` | `cancelBillingForUser(userId)` – P09 ↔ P10 contract: cancels open Stripe subscriptions BEFORE an account is deleted; throws (409 `subscription_active` without Stripe config, 502 on Stripe errors) → nothing is deleted. P10 may delegate the body to its `_lib/stripe.ts`; keep the signature and the throw-means-abort rule |
| `stripe.ts` (P10) | everything Stripe: `stripeApi()` (503 `billing_unavailable` "Zahlungen sind noch nicht eingerichtet." without `STRIPE_SECRET_KEY`), price ids per plan × interval from env, `billingStatus`, `billingConfig` (real Stripe prices, 10-min cache), `ensureCustomer` (metadata `supabase_user_id`), `createCheckout` (trial 14 / 30 via invitation / 0 after a used trial, promotion code or Stripe's own code field, optional cardless trial + automatic tax, seats for Team), `createPortal(flow)`, `changeSubscription` (cancel with reason / resume / pause 1–3 months), `cancelSubscription(userId)` (P09 may delegate `billingCleanup` to it), `lookupCode`, referrals (`referralCodeOf`, `recordReferral`, `rewardReferral` – one credit per referred customer or affiliate commission for 12 months, idempotency keys; the referral is booked from the subscription's `metadata.ref` on whichever event arrives first, so an `invoice.paid` before `checkout.session.completed` still pays), team seats (`assignSeat` / `releaseSeat`, P12), `verifyWebhook` + `processEvent` (`stripe_events` idempotency, out-of-order guard via `last_event_at`), `recomputePlan` (the only writer of `profiles.plan`); `setStripeApiForTests` |
| `exchanges/*` (P11) | exchange sync: Bitunix signer + read-only client (`bitunix.ts`), venue → trade mapping with the fee / funding convention (`mapping.ts`), resumable incremental `runSync` (`sync.ts`), connections / cursor / runs / `upsertSyncedTrades` (`store.ts`), personal tokens (`tokens.ts`), TradingView + REST formats (`inbound.ts`) – see `_lib/exchanges/README.md` |

## Functions (P09)

| file | route | notes |
|---|---|---|
| `account-export.mts` | GET `/api/v1/account/export` | DSGVO Art. 15/20: journal (backup format), profile, audit, connection metadata (no secrets), API tokens (no hash), leaderboard ranks, own invites, file list + 24-h signed links (review DSGVO-01); above 4 MB staged in `backups/<uid>/exports/` and answered as `{ download: { url } }` (review DSGVO-02); aal2 if 2FA; 5/h |
| `account-delete.mts` | POST `/api/v1/account/delete` `{ confirm: "LÖSCHEN" }` | aal2 if 2FA; 3/h fail-closed; Stripe first, audit, a team owner's seats released one by one (members' plans recomputed), bucket files, `auth.admin.deleteUser` (cascades); the webhook events that follow for the deleted user are acknowledged as `ignored` (FK 23503 → no retry loop) |
| `account-backups.mts` | GET `/api/v1/account/backups[?day=YYYY-MM-DD]` | list / download the nightly backups (client restores through `importBackup`); a backup above 4 MB comes as a signed link `{ download: { url } }` (review DSGVO-02); listing removes staged exports older than 1 h |
| `log.mts` | POST `/api/v1/log` | error reports (telemetry opt-in on the client), scrubbed again, `LOG_SAMPLE_RATE`, per-IP-hash and per-fingerprint limits → `app_errors` |
| `audit.mts` | GET/POST `/api/v1/audit` | the user's trail (paged, aal2 if 2FA) / client-side security events from an allowlist (aal2 if 2FA, except sign-in / sign-out / password reset, which happen before the code step) |
| `backup-nightly.mts` | `@daily` (published deploys) | `backups/<user>/<day>.json` for every journal changed in the last 50 h, 14 days kept (newest always), `app_errors` purged after 30 days, 22-s budget |

## Functions (P10 billing)

| file | route | notes |
|---|---|---|
| `billing-status.mts` | GET `/api/v1/billing/status[?invoices=1]` | public config (`enabled`, trial days, real prices, available plans); signed in: plan, subscription, invoices (Stripe-hosted links), team, `trialUsed` – a 2FA account before its code step gets the signed-out answer; 120/10 min |
| `billing-checkout.mts` | POST `/api/v1/billing/checkout` `{ plan, interval, seats?, code?, ref?, returnTo? }` | Stripe Checkout URL (subscription mode, `locale: de`); 409 `already_subscribed` → portal; `returnTo` only same-origin paths; aal2 if 2FA; 10/10 min |
| `billing-portal.mts` | POST `/api/v1/billing/portal` `{ flow?, returnTo? }` or `{ action: "cancel" \| "resume" \| "pause", reason?, comment?, months? }` | Customer Portal (deep links: cancel, plan change, payment method) or the in-app change (§ 312k BGB "Vertrag hier kündigen"), audited; aal2 if 2FA; 20/10 min |
| `billing-code.mts` | POST `/api/v1/billing/code` `{ code }` | promotion-code preview ("−20 % für 3 Monate"); 10/min per IP-hash fail-closed (+30/h per user) against brute force |
| `billing-referral.mts` | GET `/api/v1/billing/referral[?code=]` | public `?code=` check (valid / trial days) or the user's own code, stats and credit ledger (aal2 if 2FA) |
| `stripe-webhook.mts` | POST `/api/v1/stripe/webhook` | raw body (≤ 1 MB) + `Stripe-Signature` → `constructEventAsync`; events: `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed/trial_will_end`, `invoice.paid`, `invoice.payment_failed`; duplicates → 200, concurrent delivery → 409, failures → 500 (Stripe retries) |

## Functions (P11 exchange sync, API & webhooks)

All exchange routes: signed-in user (aal2 when 2FA is on), plan feature `exchangeSync` (Pro+, not gated while payments
are not set up), 503 `exchange_unavailable` "Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet." without
`EXCHANGE_ENC_KEY_V1`. Keys are encrypted with `_lib/crypto.ts` (AAD `<user>:<connection>:<field>`) and never
returned, logged or audited – only `key_last4`.

| file | route | notes |
|---|---|---|
| `exchange-connect.mts` | POST `/api/v1/exchange/connect` `{ exchange, apiKey, secret, label?, journalAccount, readOnlyConfirmed: true }` · PATCH `{ connectionId, journalAccount?, syncEnabled?, label? }` | verifies the key with a signed read call before storing; German venue errors (wrong key / signature / IP binding / missing permission → 422); `exchangeConnections` limit (free 0, pro 1, premium 5); 10 attempts / 10 min fail-closed; audited |
| `exchange-disconnect.mts` | POST `/api/v1/exchange/disconnect` `{ connectionId }` | deletes the encrypted key and the cursor; the trades stay in the journal; audited |
| `exchange-sync.mts` | GET `/api/v1/exchange/sync` (status: `configured`, plan, cron, connections, runs) · GET `?since=` / `?pull=1` (server-written trades for devices without cloud sync) · POST `[?dryRun=1]` `{ connectionId?, tz, from? }` | one budgeted sync (8 s, `more: true` → the client continues); dry run writes nothing; 30 POST / 10 min |
| `exchange-backfill-background.mts` | POST `/api/v1/exchange/backfill` `{ connectionId, from, runId, tz }` → 202 | background function (15 min): first import up to 366 days, 13-min budget, progress as the run `runId`; 3 / h fail-closed |
| `exchange-positions.mts` | GET `/api/v1/exchange/positions` | live positions of all active connections + mark prices (P05 `useExchangePositions`); per-venue errors listed, not thrown; 120 / 10 min |
| `exchange-sync-cron.mts` | schedule `*/30 * * * *` (in code) | due connections first (`next_sync_at`, 0006 – every attempt sets the next turn: synced → next run, failing → back-off 20 min · 2^(n−1) ≤ 12 h, plan without auto-sync → 6 h; without 0006 the old order by `last_sync_at`), ≥ 20 min gap, 8 s each, ≤ 24 s total; `SYNC_CRON_ENABLED=false` stops it |
| `hooks-tradingview.mts` | POST `/api/v1/hooks/tradingview/:token` | TradingView alert JSON (`open` / `close`); token in the path (TradingView sends no headers), scope `webhook:tradingview`, plan `apiAccess`; idempotent per alert id; 60 / min per token; never echoes the token. No signature exists (TradingView cannot sign): the secret is the token. It creates real trades, not signal-only records (F14: "nur Forwardtest über Alert", see `src/domain/tvimport/README.md`) |
| `trades-api.mts` | GET/POST `/api/v1/trades[/<id>]` (Bearer `tj_…`, scopes `trades:read` / `trades:write`) · GET/POST/DELETE `/api/v1/trades/tokens[/<id>]` (app session) | personal REST API, insert-only writes (`externalId` → idempotent `t_api_<id>`); GET pages with `since` = the previous `next` (opaque keyset cursor over `(updated_at, id)`, a plain ISO time works too); tokens stored as SHA-256, plain token shown once, max 10; 120 / 10 min |

P14 (`netlify.toml`): the functions declare their own `path`; nothing to redirect. The background function needs the
`-background` file suffix (kept). No CSP change – the browser never talks to an exchange.

Tests: `tests/unit/functions.lib.test.ts`, `tests/unit/functions.account.test.ts` (in-memory admin fake: tables, RPCs,
storage, auth admin; fake Stripe), `tests/unit/functions.stripe.test.ts` (P10: fake Stripe API + admin fake – checkout,
portal, codes, referrals, seats, webhook signature / idempotency / ordering), `tests/unit/functions.bitunix.test.ts` (P11: signer vs. the doc vector and the official demo, request building,
pagination, rate spacing, read-only allowlist), `tests/unit/exchange.mapping.test.ts` (positions → trades on the documented
payloads), `tests/unit/exchange.cron.test.ts` (cron fairness: lapsed plans, back-off, manual syncs, missing 0006),
`tests/unit/exchange.functions.test.ts` (P11: connect / sync / dry run / pull / positions / backfill / cron /
webhook / REST against an admin fake with a JS twin of `upsert_synced_trades` and a fake Bitunix that verifies every
signature). `functions-disabled/binance.mts` stays out of the build.

## Functions (F21 e-mail alarm with the app closed – optional)

Watches the key-level alerts of accounts that switched „E-Mail-Alarm bei geschlossener App“ on (Markt → Alarme) and mails ONE
summary when something fired. Same pure watch core as the browser (`src/domain/keylevels/watch.ts`, alias-free, bundled into the
function; a parity test keeps both equal). Logic in `_lib/alertWatch/`: `run.ts` (the run), `market.ts` (Binance), `mail.ts` (texts +
Resend), `store.ts` (migration 0008 RPCs + the heartbeat), `recipient.ts`, `clock.ts` (account time zone). **Env** (Netlify, scope
Functions, see `.env.example` / SETUP.md 6.1): `RESEND_API_KEY` (secret), `ALERT_FROM` (`Name <a@domain>` or `a@domain`, domain
verified at Resend), `SITE_ORIGIN` (link in the mail, base of the proxy fallback). **Without `RESEND_API_KEY` or `ALERT_FROM` the cron does
nothing** (no query, no request) and the app shows „Einrichtung nötig“; without migration 0008 it reports `migration`.

| file | route | notes |
|---|---|---|
| `alert-watch-cron.mts` | schedule `*/5 * * * *` (in code, published deploys only) | accounts with `settings.serverAlerts.email = true` via `alert_watch_candidates` (≤ 200, order rotates per run; no account → one query, nothing else). Plan gate = feature `boxScanner` (not gated while payments are not set up). ONE request for the prices of all symbols (`/fapi/v1/ticker/price`), one candle request per symbol and source feed (≤ 30 symbols, ≤ 60 requests, ≤ 4 at a time, 24-s budget; ≤ 20 watched levels per account); Binance is tried direct, on 451 / 403 / 429 / a network failure through `SITE_ORIGIN/api/binance` (`netlify.toml`); both blocked → nothing is evaluated, the heartbeat says `binance_451`. A symbol Binance does not know is named (`problems`), never requested. Per account: `stepWatch` → outbox → `planMail`. **Exactly once:** the state (stage memory + outbox) is written FIRST through `set_server_alerts` (only `data.serverAlerts`, guarded by the row's `rev`; a lost race re-reads once and starts over with the same candles, a second loss skips the account until the next run – nothing was mailed or marked), then the mail goes out with an `Idempotency-Key` (hash of the outbox ids), then the mailed items leave the outbox. If that last write is lost, the next run sends the same items again under the same key and Resend answers the first result (`409 invalid_idempotent_request` is read as „was accepted“ – not verified against the live API). One mail per account and run for everything that waits; held back outside the active hours (account time zone, `profiles.tz`), above `maxPerDay` (3 / 6 / 12 / 24, default 6), within 10 minutes of the last mail and in the back-off after a failed send (30 min · 2 h · 6 h); fires older than 24 h are dropped and counted in the next mail. Recipient: the account's own address from Supabase Auth (`auth.admin.getUserById`), confirmed addresses only; never stored, never logged. The log line carries counts and codes only (`accounts`, `watched`, `deferred`, `gated`, `symbols`, `requests`, `fires`, `mails`, `waiting`, `failed`, `code`, `source`). Heartbeat (`app_config` key `alert-watch`: `at`, `ok`, `code`, counts) is written once per run that had accounts |
| `alert-test.mts` | GET / POST `/api/v1/alerts/test` | GET: `{ configured, entitled, hasEmail, emailConfirmed, lastRun, intervalMin }` (the address itself is never sent). POST: ONE test mail to the account's own confirmed address → `{ sent: true }`; signed in (aal2 if 2FA), plan feature `boxScanner`, 3 / 10 min and 10 / day per account (fail-closed), 503 `alerts_unavailable` without the env, 409 `email_unconfirmed`, 422 `no_email`, 502 `alerts_send_failed` with the reason (`details.reason`: `resend_auth` …) |

**Check the cron:** Netlify → Logs → Functions → `alert-watch-cron` (a line every 5 minutes once an account has the switch on); the
card in the app shows „zuletzt geprüft“ from the heartbeat; `GET /api/v1/alerts/test` (signed in) answers `lastRun`. Not live-verified here:
a real Resend key and domain, a real Supabase (the SQL ran on PGlite), the schedule on a published deploy, Binance from the function's
region.

Tests: `tests/unit/alerts.watch.server.test.ts` (in-memory settings table + the two RPCs with their rev guard, fake Binance, fake Resend:
silent first look, exactly once, lost races, back-off, hours, limits, caps, plan gate, 451 fallback, no address in logs),
`alerts.watch.parity.test.ts`, `alerts.watch.mail.test.ts`, `alerts.watch.test-fn.test.ts`, `supabase.alertwatch.test.ts` (PGlite).

## Functions (P04 coach – optional)

The coach is fully deterministic in the app (`src/domain/coach`). This function is OPTIONAL: it only rewrites an answer
the app already computed into natural German. Without `ANTHROPIC_API_KEY` it reports `enabled: false` and the app never
shows the button – nothing breaks.

| file | route | notes |
|---|---|---|
| `coach-ask.mts` | GET `/api/v1/coach/ask` → `{ enabled }` · POST `{ question?, title, text, facts[≤ 12], confidence, notes?[≤ 3, opt-in] }` → `{ text \| null, model, reason? }` | official SDK `@anthropic-ai/sdk` (server only, never in the client bundle); model `COACH_MODEL` (default `claude-opus-5-5`), effort `low`, server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); signed in (aal2 if 2FA), plan feature `coachAi` (Premium, not gated while payments are not set up), 10 / 10 min + `coachAiPerDay` per day (50 without payments); body ≤ 8 KiB, only computed facts; every number of the answer must occur in the input, else `text: null, reason: "unverified"` (refusal → `"refusal"`); German errors 503 `coach_ai_unavailable`, 429 `coach_ai_busy`, 502 `coach_ai_failed`; nothing stored, only error codes logged |

Tests: `tests/unit/coach.ask.test.ts` (fake admin + fake Anthropic client: availability, auth, plan gate, rate limits,
request shape, number guard, refusal, error mapping).

## Functions (F29 / F30 screenshot import – optional)

**Optional.** The app reads screenshots WITHOUT this function: the default path is the local text recognition in the browser
(`src/journal/ocr/`, no server, no key, nothing is sent). `shot-extract` is only the second, model-based engine; the sheet
offers it ("KI") when `GET /api/v1/shot-extract` reports `enabled: true`. Without `ANTHROPIC_API_KEY` nothing is lost.

Reads trade values from up to four screenshots (position view, order history, planned order …) and returns a PROPOSAL the
app shows in a preview; nothing is saved by the server or the app. Without `ANTHROPIC_API_KEY` it reports `enabled: false`
and the editor never shows „Aus Screenshot übernehmen“ (settings → Daten → „Screenshot-Import“ says why).

| file | route | notes |
|---|---|---|
| `shot-extract.mts` | GET `/api/v1/shot-extract` → `{ enabled, maxImages, maxLongEdge, maxImageBytes }` · POST `{ images: [{ mediaType: "image/jpeg" \| "image/png" \| "image/webp", data(base64) }] (1–4), hint?: { market?, timezone?, exchange?, pair? } }` → `{ trades[], timezone, notes[], model, reason? }` | `@anthropic-ai/sdk` with image blocks and a FORCED tool call `report_trades` (`tool_choice`), JSON schema + system prompt + zod in `src/journal/extract/contract.ts` (shared with the client; a test keeps schema and zod in step); model `VISION_MODEL`, else `COACH_MODEL`, else `claude-opus-5-5`, effort `medium`, server-side refusal fallback; the result is validated with zod again (violation → 502 `shot_extract_invalid`), `sanitize` zeroes the confidence of absent fields and drops empty trades; numbers and times stay TEXT as shown (the client parses comma / point, zones). Refusal / no tool call / nothing found → 200 with `trades: []` and `reason` `"refusal" \| "empty"` (manual entry). Signed in (aal2 if 2FA), plan feature `shotExtract` (Premium; not gated while payments are not set up), 6 / 10 min + `shotExtractPerDay` per day (30; free / pro 0) – counted only for a valid body; body ≤ 5.9 MB (platform limit 6 MB), ≤ 1.5 MB per image, ≤ 4.2 MB together, declared type must match the bytes. The model is told that image text is data, never to guess, to separate planned orders from fills and never to invent an original stop. No retry (a second attempt would double the wait), 25 s client timeout. Pictures are only forwarded – never stored, never logged (only error codes; every error NAMES its reason: `shot_extract_unavailable` 503 = no `ANTHROPIC_API_KEY` set, `shot_extract_key_rejected` 503 = key refused by Anthropic, `shot_extract_model` 502 = model unknown, `shot_extract_timeout` 504 = no answer within 25 s, `shot_extract_network` 502, `shot_extract_busy` 429 (also Anthropic 529), `shot_extract_failed` 502 with the status, `shot_extract_invalid` 502 with the offending field). Before the strict zod check `normalizeToolInput` (`src/journal/extract/lenient.ts`) repairs formatting slips (empty text → null, confidence clamped to 0..1, an execution without a price dropped and reported in `notes`); a wrong type for `trades` or an unknown `status` still fails. The system prompt carries the vocabulary of exchange order histories (Bitunix, Binance, Bybit, OKX) and each execution has an optional `label` (the order's own name, e.g. „Long schließen“) the client reads deterministically |
| `strategy-compile.mts` | GET `/api/v1/strategy/compile` → `{ enabled }` · POST `{ text }` (≤ 1500 Zeichen) → `{ result \| null, model, reason?, detail? }` | Optionale KI-Hilfe des Strategie-Studios (`src/domain/strategytext`): `@anthropic-ai/sdk` mit ERZWUNGENEM Werkzeug `compile_strategy`; das Modell übersetzt NUR Text → Regeln des Labors (Schema `RulesSchema` aus `src/domain/strategytext/schema.ts`, dieselbe Prüfung wie beim lokalen Parser). Die Antwort wird auf dem Server geprüft und im Browser noch einmal: passt eine Regel nicht (unbekannter Baustein, Zahl außerhalb des Bereichs, kaputter Baum) oder steht eine als verstanden gemeldete Stelle nicht im Text, wird die ganze Antwort verworfen (`reason: "invalid"`, `detail` nennt die erste Abweichung) – nichts wird repariert. Keine Zahl, kein Ergebnis kommt vom Modell. Gesendet wird nur der Text der Strategie (kein Journal, keine Trades). Angemeldet (aal2 falls eingerichtet), Tarif-Funktion `coachAi`, 10 / 10 min + `coachAiPerDay` (gemeinsam mit Coach-Formulierung und Assistent-Router), Body ≤ 8 KiB. Schlüssel `ANTHROPIC_API_KEY` nur auf dem Server, Modell `ROUTER_MODEL` → `COACH_MODEL` → `claude-opus-5-5`. Ohne Schlüssel bleibt der lokale Parser der Normalweg (der Knopf „Mit KI genauer verstehen“ erscheint nicht). Fehler: `strategy_compile_unavailable` 503, `strategy_compile_busy` 429, `strategy_compile_failed` 502. Test: `tests/unit/strategy.compile.test.ts`. |

Tests: `tests/unit/shot.extract.test.ts` (fake admin + fake Anthropic client: availability, auth / 2FA, plan gate, daily and
burst limit, oversize / malformed bodies, forced tool call and request shape, schema violation, refusal, API errors, no
pictures in logs), `tests/unit/shot.numbers-time.test.ts` + `tests/unit/shot.candidates.test.ts` (client maths),
`tests/e2e/shot-extract.spec.ts` (canned endpoint, preview → draft).

## Functions (P12 community)

Shared logic in `_lib/social/` (`store.ts` pseudonyms, opt-in, figures, membership checks · `groups.ts` groups, invites,
members, reviews, comments, goals, team seats · `leaderboard.ts` · `shares.ts` · `feedback.ts` · `aggregate.ts`). Wire
contract and pure helpers come from `src/social/{contract,metrics,pseudonym,format}.ts` (alias-free, relative imports).
Privacy rules: people appear only as pseudonyms (`social_profiles`); the ranking reads opted-in users only
(`profiles.privacy.leaderboard`) and drops a withdrawn opt-in at once (snapshot rows deleted, read-time filter);
group averages and community distributions need ≥ 10 people (k-anonymity); every payload a user shares is re-validated
against the strict redacted schemas (unknown keys → 422 – no PnL, size, fees, notes, account); strangers get 404 for a
group (never "forbidden"). Plan gates via `requireFeature` / `requireLimit` (`community`, `mentor`, `groups`; open while
payments are not set up). All writes are audited where they matter (`social.*`).

| file | route | notes |
|---|---|---|
| `social-share.mts` | GET/POST `/api/v1/social/share` `{ payload, expiresInDays: 1 \| 7 \| 30 \| 0 }` · DELETE `/api/v1/social/share/<id>` | the owner's links (≤ 200), 22-char base64url token, revoke = immediately unreadable; signed in (aal2 if 2FA); 20 new / h |
| `social-shared.mts` | GET `/api/v1/social/shared/:token` | PUBLIC (no login): redacted payload of a valid link via `shared_payload()` (counts a view), re-validated before it is served, `x-robots-tag: noindex`; 60 / 10 min per IP hash. The app route is `/#share/<token>` – never `/teilen/` |
| `social-groups.mts` | `/api/v1/social/groups[/<id>[/invites\|members\|reviews\|goals…]]`, `/api/v1/social/invite/<code>` | groups (`group` / `mentor` / `team`; team needs Team seats and assigns / releases them via P10 `assignSeat` / `releaseSeat`), invites (10 chars without look-alikes, expiry, max uses), roles + `share_level`, joint reviews with comments and `@mentions`, mentor goals (adopted on the student's device via P08 `addGoalFromDraft`); leaving / removal deletes the member's reviews, comments and goals; per-route limits (5 groups / day, 30 comments / 10 min, invite checks fail-closed) |
| `social-leaderboard.mts` | GET `/api/v1/social/leaderboard[?metric=&group=]` · POST `{ action: "optIn" \| "refresh" \| "reroll" }` | the caller's status (pseudonym, opt-in, own figures), global top 25 + own row from the latest snapshot, group ranking (live, members sharing stats), community distributions (k ≥ 10); refresh 6 / h, new pseudonym 3 / day |
| `social-aggregate.mts` | `@daily` (published deploys) | `social_candidates()` = opt-ins + members sharing stats only; figures over 90 days (Expectancy R, discipline, consistency, min. 20 R trades), today's snapshots, `community_stats` (quantiles only with n ≥ 10), purge after 35 days, time budget |
| `feedback.mts` | POST `/api/v1/feedback` `{ kind: "bug" \| "idea" \| "praise" \| "report" \| "other", message, page?, target? }` | feedback (anonymous allowed: 5 / 10 min per IP hash fail-closed) and reports (login, one per target, only for targets the reporter can see; 3 reports by different people hide a comment for everyone but its author and the group's owner / mentors) |

Tests: `tests/unit/functions.social.test.ts` (in-memory PostgREST fake: shares + public read + revoke / expiry, strict
redaction, groups / invites / roles / mentor visibility, comments + mentions, goals, team seats, opt-in + immediate
withdrawal, k-anonymity, aggregate, feedback + reports, public-read rate limit). `account.ts` `EXPORT_TABLES` lists the P12 tables
(DSGVO export); account deletion cascades through `auth.users`.

## Functions (F68 / F69 SEC EDGAR – Zahlen-Analyst, DCF, Kaufthese)

Server-Zugriff auf **SEC EDGAR** (kostenlos, öffentlich) für `src/views/analyst`. Der Browser spricht nie selbst mit der SEC (Kontakt im `User-Agent` Pflicht, `data.sec.gov` ohne CORS, 10 Anfragen je Sekunde). Gemeinsame Logik in `_lib/sec.ts`; der Antwortvertrag und alles Reine (Verkleinerung der „company facts“, Ticker → CIK, Einreichungsliste) liegt alias-frei in `src/market/sec` und wird relativ importiert.

**Einrichtung (Env, Scope Functions, nicht `VITE_`): `SEC_USER_AGENT`** = Name und Kontakt des Betreibers, z. B. „Firmenname kontakt@deine-domain.de“ (siehe `.env.example`). Fehlt er – oder ist er ein Platzhalter / ohne `@` –, antwortet jede SEC-Funktion mit dem typisierten **503 `sec_setup_required`** („Einrichtung nötig: …“) und macht **keinen einzigen Aufruf** an die SEC; die App zeigt „Einrichtung nötig“. Der Wert wird nie geloggt und nie an den Client geschickt. Die E-Mail-Adresse einer Person steht nirgends im Code.

| file | route | notes |
|---|---|---|
| `sec-facts.mts` | GET `/api/v1/sec/facts?ticker=AAPL` (oder `?cik=320193`) | `company_tickers.json` → CIK → `data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, **verkleinert** auf die gelesenen Konzepte (`src/market/sec/concepts.ts`), nur Berichte (10-Q/10-K u. Ä.), ~6 Jahre, eine Einheit je Konzept; Werte unverändert, Wiederholungen/Restatements bleiben (der Analyst entscheidet und sagt es). Antwort `{ source: "sec-edgar", ticker, cik, entity, sourceUrl, fetchedAt, asOf, cached, stale?, facts }`. Angemeldet (kein 2FA-Schritt nötig: öffentliche Daten), Tarif-Funktion `stockAnalysis` (Pro; offen, solange Zahlungen nicht eingerichtet sind), 30 / 10 min je Nutzer. Fehler: `sec_unknown_ticker` 404, `sec_no_facts` 404 (Fonds/ETFs, keine US-GAAP-Zahlen), `sec_busy` 429 (SEC 429/403), `sec_timeout` 504 (9 s), `sec_upstream` 502, `sec_invalid` 502, `invalid_query` 422. `Cache-Control: private, max-age=300`. |
| `sec-filings.mts` | GET `/api/v1/sec/filings?ticker=AAPL` | `data.sec.gov/submissions/CIK##########.json` → die letzten zehn 10-Q/10-K/8-K (auch /A) mit Zeitraum, 8-K-Punkten und Links (Dokument + Ordner-Seite), die neueste Meldung, die jüngste **Ergebnismeldung (8-K Punkt 2.02)** mit dem Link zur **Pressemitteilung** (Exhibit 99 aus dem `index.json` des Ordners – eine weitere SEC-Anfrage, ein Fehler dabei lässt nur den Link weg) und die letzten acht Ergebnismeldungen (zum Zuordnen der Quartale). 60 / 10 min je Nutzer, sonst wie oben. |

**SEC-Grenzen.** Jede Anfrage an die SEC nimmt zuerst einen Platz im **kontoweiten Fenster** (`rate_hit`, Schlüssel `sec-upstream`, 8 je Sekunde, also unter den erlaubten 10; ist es voll, wird einmal bis zum nächsten Fenster gewartet, dann `sec_busy`) und hält ≥ 125 ms Abstand zur vorigen Anfrage derselben Instanz. **Zwischenspeicher** im Speicher der Instanz: Ticker-Liste 12 h, Fakten und Einreichungen 20 min, Ordner-Index 24 h; gleiche Anfragen gleichzeitig teilen sich einen Aufruf. Ist die SEC nicht erreichbar (5xx, Zeitüberschreitung, Bremse) und gibt es eine ältere Kopie (≤ 24 h), kommt **diese** mit `stale: true` und ihrer ursprünglichen `fetchedAt` – nie eine erfundene Zahl. CSP: unverändert (nur same-origin).

Tests: `tests/unit/functions.sec.test.ts` (Fake-Admin + gemocktes `fetch` mit den SEC-Fixtures: Einrichtungs-Gate ohne einen Aufruf, Kontakt-Header, Login, Tarif, Limits, Abstand, Zwischenspeicher, veraltete Kopie, typisierte Fehler, Verkleinerung, 8-K mit Pressemitteilung). **Nicht live gegen die SEC geprüft**: in der Entwicklungsumgebung gab es keinen `SEC_USER_AGENT` des Betreibers, und ohne echten Kontakt ruft diese Umgebung die SEC nicht ab; die Formate sind aus den dokumentierten SEC-Antworten nachgebaut (Fixtures) und die Zahlen von AAPL mit TradingView und einem echten Lauf des Skills abgeglichen.

## Functions (F67 / F68 Aktien – public data)

Four read-only functions for US stocks. **Public data, no key, nothing personal in or out**: the only things that travel are
tickers, an interval and a range (nothing of the journal, the settings or the account). The sources are Yahoo Finance's
**unofficial** chart endpoint and RSS feed and the Nasdaq Trader symbol files (`nasdaqlisted.txt`, `otherlisted.txt`); Yahoo may
rate-limit or block the server at any time. That is answered honestly: per ticker `{ ok: false, reason, message }`, and when every
ticker failed for the same upstream reason HTTP 429 / 502 with `stock_upstream_rate_limited | stock_upstream_blocked |
stock_upstream_unavailable` (a Nasdaq file in a changed format: `stock_upstream_format`) – never invented values. The client turns
these into typed results `ok | stale | unavailable(reason)` (`src/market/stocks`, README there).

Shared in `_lib/stocks/`: `guard.ts` (`stockGuard` = plan gate + rate limit, `stockJson`, `createMemo` – a time-boxed memory cache
that shares one in-flight request between callers) · `yahoo.ts` (chart fetch and parse: no half-empty candles, intraday only inside
the regular session, one candle per New York day for 1d, `prevClose` from the daily candles, `BRK.B` ↔ `BRK-B`; after a Yahoo limit
the instance pauses 30 s instead of asking again) · `nasdaq.ts` (directory: common stocks, ADRs / ADS and partnership or trust units;
no ETFs, test issues, warrants, SPAC units and rights, notes / ETNs, preferred) · `rss.ts` (headline RSS: entities decoded, tracking
parameters stripped from links, no HTML) · `params.ts` (`parseSymbols`). The New York calendar and the wire format are shared with the
client by relative import (`src/market/stocks/{session,types,wire}.ts`).

Gate (`stockGuard`): while payments are **not** set up nothing is gated and anyone may read (an expired session is ignored); once
Stripe is set up the caller must be signed in (401) and the plan must include the feature `boxScanner` (402). Rate limit per user or
pseudonymised IP through `rate_hit`, with a per-instance counter as the fallback (a public proxy never runs open). Answers carry
`cache-control: private, max-age=<ttl>` and `vary: authorization`.

| file | route | notes |
|---|---|---|
| `stock-bars.mts` | GET `/api/v1/stocks/bars?symbols=AAPL,MSFT&interval=1m\|5m\|15m\|1h\|1d[&range=]` | ≤ 8 tickers, range from a fixed list per interval (defaults in `DEFAULT_RANGE`), 240 / 10 min, TTL 20 s (1m) · 45 s (5m) · 90 s (15m) · 5 min (1h) · 10 min (1d), 9-s budget per request (tickers not started in time answer `timeout`), 4 upstream calls in parallel |
| `stock-quote.mts` | GET `/api/v1/stocks/quote?symbols=` | ≤ 20 tickers, price / previous close / change / day and 52-week range / volume / market time (from the daily chart), 240 / 10 min, TTL 15 s |
| `stock-symbols.mts` | GET `/api/v1/stocks/symbols` | the directory as `[symbol, name, exchange, financial status]` rows plus `counts` (rows read, kept, dropped per kind) and the file time; memo 12 h, browser 6 h, 20 / 10 min |
| `stock-news.mts` | GET `/api/v1/stocks/news?symbols=` | ≤ 8 tickers, headlines with publisher, link and time (`yahoo-rss`), 120 / 10 min, TTL 5 min. Further sources plug in on the client (`registerNewsSource`, `src/market/stocks/newsSources.ts`) – the SEC 8-K feed of another part of the project goes there |

Tests: `tests/unit/stocks.server.test.ts` (fixtures of real Yahoo / Nasdaq / RSS answers from 2026-10-25 in `tests/fixtures/stocks/`,
`fetch` mocked: parsing and cleaning, the directory filter, gate and rate limit, error mapping, cache headers, in-flight sharing, budget).
The deployed functions were **not run live** (no deploy from the sandbox); the formats were checked against real upstream answers.
