# `supabase/` – database schema for login, sync, billing and exchange sync

Local-first stays the default: without `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (and always in the
single-file builds) the app never talks to Supabase (`isCloudAvailable()` in `src/cloud`).

## Migrations (run in this order)

| File | Owner | Content |
|---|---|---|
| `migrations/0001_core.sql` | P09 | `profiles`, `journal_docs` (+ Realtime), `rate_hits` + `rate_hit()`, `audit_log`, `app_errors`, `exchange_connections`, `mfa_satisfied()` |
| `migrations/0002_billing.sql` | P10 | `subscriptions`, `referrals`, `affiliate_ledger`, `stripe_events` |
| `migrations/0003_exchange.sql` | P11 | `sync_runs`, `sync_cursor`, `api_tokens`, `upsert_synced_trade()` – secrets live in `exchange_connections` (0001) |
| `migrations/0004_social.sql` | P12 | groups, members, shares, comments, feedback, leaderboards |

Apply with the Supabase CLI (`supabase db push`) or paste each file into the SQL editor. Every migration runs once;
never edit an applied migration – add a new one.

## Rules the schema enforces (0001)

- **RLS on every table.** Client policies compare with `(select auth.uid())`.
- **`profiles`**: one row per auth user (trigger `on_auth_user_created`). Clients read their row and may update only
  `display_name`, `tz`, `privacy` (column grants). `plan`, `plan_status`, `trial_end` are written only by the Stripe
  webhook with the service role – the functions read the plan via `_lib/plan.ts` `planOf()`, never from the client.
- **`journal_docs`** `(user_id, kind, id)` → `data jsonb`: the synced journal (`kind` = `trade` | `hyblock` | `settings`
  | `day` | …, `id` = client id). `updated_at` and `rev` are stamped by a trigger; `rev` is the optimistic lock for
  settings (`update … where rev = $seen`). **No hard delete for clients** – deletes are tombstones (`deleted = true`),
  because offline devices must not resurrect records and Realtime does not apply RLS to DELETE events.
- **MFA**: as soon as a user has a verified TOTP factor, `journal_docs` and `exchange_connections` require an aal2
  session (restrictive policies via `mfa_satisfied()`).
- **`exchange_connections`**: API key / secret / passphrase as AES-256-GCM blobs (`netlify/functions/_lib/crypto.ts`,
  AAD `<user_id>:<connection id>:<field>`). Clients may read only the metadata columns of their own rows
  (`id, user_id, exchange, label, key_version, key_last4, permissions, status, last_sync_at, last_error, created_at,
  updated_at`) – `select *` is refused. Connect / disconnect / sync run in functions.
- **`rate_hits` / `rate_hit(key, window_sec)`**, **`app_errors`**: service role only. **`audit_log`**: users read their
  own trail, only functions write; rows survive account deletion without the user id.
- Account deletion: `auth.admin.deleteUser()` (function, service role) cascades `profiles`, `journal_docs`,
  `exchange_connections`.

The migration was checked against Postgres 16 (PGlite) with a minimal `auth` shim: own-row visibility, column grants,
tombstone-only deletes, the aal2 rule, `rate_hit` counting and privileges, and the delete cascades.

## External setup (dashboard)

1. Project in the **EU (Frankfurt)** region; sign the DPA (AVV).
2. **Auth**: Site URL = the Netlify site; redirect URLs for `/` and `/teilen/`; enable TOTP MFA; German e-mail
   templates. Keys: publishable key → `VITE_SUPABASE_PUBLISHABLE_KEY`, secret key → `SUPABASE_SECRET_KEY` (functions only).
3. **Realtime**: 0001 adds `journal_docs` to the `supabase_realtime` publication when it exists; otherwise enable it
   under Database → Publications.
4. **Storage** (P06 / P09): bucket `screenshots` (private, object path `<auth.uid()>/<file>`, policies select/insert/
   delete own folder) and bucket `backups` (private, service role only, 14-day retention by `backup-nightly`).
5. Env vars: see `.env.example` (server values as Netlify secrets, scope Functions, never `VITE_`-prefixed).
