# `netlify/functions` – server functions (v2, `.mts`)

Netlify bundles every `*.mts` here with esbuild (`[functions] directory = "netlify/functions"` in the root
`netlify.toml`, P14). Each file: `export default handler(async (req, ctx) => …)` + `export const config: Config = { path,
method }` (or `{ schedule }`). Typecheck: `tsc -p tsconfig.functions.json` (part of `npm run typecheck`); lint: `npm run
lint` covers `netlify/`. Functions import `src/` modules only by RELATIVE path and only alias-free ones
(`src/billing/types.ts`, `plans.ts`, `contract.ts`, `src/cloud/scrub.ts`, `src/cloud/sync/docs.ts`). Server env: `.env.example` (Netlify secrets, scope
Functions, never `VITE_`).

## `_lib` (shared, P09)

| file | exports |
|---|---|
| `http.ts` | `handler`, `json`, `error`, `errorFrom`, `HttpError`, `requireMethod`, `readJson(req, zod)`, `clientIp`, `BASE_HEADERS` – one error envelope `{ error: { code, message, details? } }`, German messages |
| `auth.ts` | `requireUser(req, { aal2?: true \| "ifEnrolled" })` (JWT via `auth.getClaims`), `optionalUser`, `bearerToken` |
| `supabase.ts` | `supabaseAdmin()` / `admin()` (service role, bypasses RLS – always filter by the verified user), `setSupabaseAdminForTests` |
| `env.ts` | `env`, `envOptional`, `envInt`, `envNumber`, `envBool`, `SERVER_ENV` |
| `crypto.ts` | AES-256-GCM `encrypt` / `decrypt` (`v<n>:iv:tag:ct`, AAD `<user>:<connection>:<field>`), key rotation |
| `rateLimit.ts` | `rateLimit(key, max, windowSec)`, `enforceRateLimit` (429 + `Retry-After`), `rateKey` – backed by `rate_hit()` |
| `audit.ts` | `audit(userId, action, meta, ip)` (scrubbed meta, hashed IP, never throws), `scrubMeta`, `hashIp` |
| `plan.ts` | `planOf(userId)`, `requirePlan`, `effectivePlan`; P10: `paymentsConfigured()`, `requireFeature(userId, feature)` (402 `plan_required`, details `{ feature, required, plan }`), `requireLimit(userId, key, used)` – both pass while payments are not set up, so a cloud build without Stripe never locks anyone out |
| `account.ts` | `collectExport`, `EXPORT_TABLES` (later packages append their per-user tables; missing tables are skipped), `fetchAllDocs`, `journalBackup`, `listUserFiles` / `removeUserFiles` (buckets `screenshots`, `backups`), `listBackups`, `expiredBackups`, `ensureBackupBucket`, `runNightlyBackup`, `DELETE_CONFIRM_WORD`, `redactSecrets` |
| `billingCleanup.ts` | `cancelBillingForUser(userId)` – P09 ↔ P10 contract: cancels open Stripe subscriptions BEFORE an account is deleted; throws (409 `subscription_active` without Stripe config, 502 on Stripe errors) → nothing is deleted. P10 may delegate the body to its `_lib/stripe.ts`; keep the signature and the throw-means-abort rule |
| `stripe.ts` (P10) | everything Stripe: `stripeApi()` (503 `billing_unavailable` "Zahlungen sind noch nicht eingerichtet." without `STRIPE_SECRET_KEY`), price ids per plan × interval from env, `billingStatus`, `billingConfig` (real Stripe prices, 10-min cache), `ensureCustomer` (metadata `supabase_user_id`), `createCheckout` (trial 14 / 30 via invitation / 0 after a used trial, promotion code or Stripe's own code field, optional cardless trial + automatic tax, seats for Team), `createPortal(flow)`, `changeSubscription` (cancel with reason / resume / pause 1–3 months), `cancelSubscription(userId)` (P09 may delegate `billingCleanup` to it), `lookupCode`, referrals (`referralCodeOf`, `recordReferral`, `rewardReferral` – one credit per referred customer or affiliate commission for 12 months, idempotency keys), team seats (`assignSeat` / `releaseSeat`, P12), `verifyWebhook` + `processEvent` (`stripe_events` idempotency, out-of-order guard via `last_event_at`), `recomputePlan` (the only writer of `profiles.plan`); `setStripeApiForTests` |

## Functions (P09)

| file | route | notes |
|---|---|---|
| `account-export.mts` | GET `/api/v1/account/export` | DSGVO Art. 15/20: journal (backup format), profile, audit, connection metadata (no secrets), file list; aal2 if 2FA; 5/h |
| `account-delete.mts` | POST `/api/v1/account/delete` `{ confirm: "LÖSCHEN" }` | aal2 if 2FA; 3/h fail-closed; Stripe first, audit, bucket files, `auth.admin.deleteUser` (cascades) |
| `account-backups.mts` | GET `/api/v1/account/backups[?day=YYYY-MM-DD]` | list / download the nightly backups (client restores through `importBackup`) |
| `log.mts` | POST `/api/v1/log` | error reports (telemetry opt-in on the client), scrubbed again, `LOG_SAMPLE_RATE`, per-IP-hash and per-fingerprint limits → `app_errors` |
| `audit.mts` | GET/POST `/api/v1/audit` | the user's trail (paged) / client-side security events from an allowlist |
| `backup-nightly.mts` | `@daily` (published deploys) | `backups/<user>/<day>.json` for every journal changed in the last 50 h, 14 days kept (newest always), `app_errors` purged after 30 days, 22-s budget |

## Functions (P10 billing)

| file | route | notes |
|---|---|---|
| `billing-status.mts` | GET `/api/v1/billing/status[?invoices=1]` | public config (`enabled`, trial days, real prices, available plans); signed in: plan, subscription, invoices (Stripe-hosted links), team, `trialUsed`; 120/10 min |
| `billing-checkout.mts` | POST `/api/v1/billing/checkout` `{ plan, interval, seats?, code?, ref?, returnTo? }` | Stripe Checkout URL (subscription mode, `locale: de`); 409 `already_subscribed` → portal; `returnTo` only same-origin paths; 10/10 min |
| `billing-portal.mts` | POST `/api/v1/billing/portal` `{ flow?, returnTo? }` or `{ action: "cancel" \| "resume" \| "pause", reason?, comment?, months? }` | Customer Portal (deep links: cancel, plan change, payment method) or the in-app change (§ 312k BGB "Vertrag hier kündigen"), audited; 20/10 min |
| `billing-code.mts` | POST `/api/v1/billing/code` `{ code }` | promotion-code preview ("−20 % für 3 Monate"); 10/min per IP-hash fail-closed (+30/h per user) against brute force |
| `billing-referral.mts` | GET `/api/v1/billing/referral[?code=]` | public `?code=` check (valid / trial days) or the user's own code, stats and credit ledger |
| `stripe-webhook.mts` | POST `/api/v1/stripe/webhook` | raw body (≤ 1 MB) + `Stripe-Signature` → `constructEventAsync`; events: `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed/trial_will_end`, `invoice.paid`, `invoice.payment_failed`; duplicates → 200, concurrent delivery → 409, failures → 500 (Stripe retries) |

Tests: `tests/unit/functions.lib.test.ts`, `tests/unit/functions.account.test.ts` (in-memory admin fake: tables, RPCs,
storage, auth admin; fake Stripe), `tests/unit/functions.stripe.test.ts` (P10: fake Stripe API + admin fake – checkout,
portal, codes, referrals, seats, webhook signature / idempotency / ordering). `functions-disabled/binance.mts` stays out of the build.
