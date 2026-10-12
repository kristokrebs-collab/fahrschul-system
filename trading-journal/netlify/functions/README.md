# `netlify/functions` – server functions (v2, `.mts`)

Netlify bundles every `*.mts` here with esbuild (`[functions] directory = "netlify/functions"` in the root
`netlify.toml`, P14). Each file: `export default handler(async (req, ctx) => …)` + `export const config: Config = { path,
method }` (or `{ schedule }`). Typecheck: `tsc -p tsconfig.functions.json` (part of `npm run typecheck`); lint: `npm run
lint` covers `netlify/`. Functions import `src/` modules only by RELATIVE path and only alias-free ones
(`src/billing/types.ts`, `src/cloud/scrub.ts`, `src/cloud/sync/docs.ts`). Server env: `.env.example` (Netlify secrets, scope
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
| `plan.ts` | `planOf(userId)`, `requirePlan`, `effectivePlan` |
| `account.ts` | `collectExport`, `EXPORT_TABLES` (later packages append their per-user tables; missing tables are skipped), `fetchAllDocs`, `journalBackup`, `listUserFiles` / `removeUserFiles` (buckets `screenshots`, `backups`), `listBackups`, `expiredBackups`, `ensureBackupBucket`, `runNightlyBackup`, `DELETE_CONFIRM_WORD`, `redactSecrets` |
| `billingCleanup.ts` | `cancelBillingForUser(userId)` – P09 ↔ P10 contract: cancels open Stripe subscriptions BEFORE an account is deleted; throws (409 `subscription_active` without Stripe config, 502 on Stripe errors) → nothing is deleted. P10 may delegate the body to its `_lib/stripe.ts`; keep the signature and the throw-means-abort rule |

## Functions (P09)

| file | route | notes |
|---|---|---|
| `account-export.mts` | GET `/api/v1/account/export` | DSGVO Art. 15/20: journal (backup format), profile, audit, connection metadata (no secrets), file list; aal2 if 2FA; 5/h |
| `account-delete.mts` | POST `/api/v1/account/delete` `{ confirm: "LÖSCHEN" }` | aal2 if 2FA; 3/h fail-closed; Stripe first, audit, bucket files, `auth.admin.deleteUser` (cascades) |
| `account-backups.mts` | GET `/api/v1/account/backups[?day=YYYY-MM-DD]` | list / download the nightly backups (client restores through `importBackup`) |
| `log.mts` | POST `/api/v1/log` | error reports (telemetry opt-in on the client), scrubbed again, `LOG_SAMPLE_RATE`, per-IP-hash and per-fingerprint limits → `app_errors` |
| `audit.mts` | GET/POST `/api/v1/audit` | the user's trail (paged) / client-side security events from an allowlist |
| `backup-nightly.mts` | `@daily` (published deploys) | `backups/<user>/<day>.json` for every journal changed in the last 50 h, 14 days kept (newest always), `app_errors` purged after 30 days, 22-s budget |

Tests: `tests/unit/functions.lib.test.ts`, `tests/unit/functions.account.test.ts` (in-memory admin fake: tables, RPCs,
storage, auth admin; fake Stripe). `functions-disabled/binance.mts` stays out of the build.
