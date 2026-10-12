# `supabase/` – database schema for login, sync, billing and exchange sync

Local-first stays the default: without `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (and always in the
single-file builds) the app never talks to Supabase (`isCloudAvailable()` in `src/cloud`).

## Migrations (run in this order)

| File | Owner | Content |
|---|---|---|
| `migrations/0001_core.sql` | P09 | `profiles`, `journal_docs` (+ Realtime), `rate_hits` + `rate_hit()`, `audit_log`, `app_errors`, `exchange_connections`, `mfa_satisfied()`, `my_sessions()`, `backup_candidates()`, buckets `backups` / `screenshots` (+ own-folder policies) |
| `migrations/0002_billing.sql` | P10 | `billing_customers`, `subscriptions`, `team_seats`, `referral_codes`, `referrals`, `affiliate_ledger`, `stripe_events` |
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
  `exchange_connections`; the function cancels Stripe first and removes the user's bucket files.
- **`my_sessions()`** (authenticated): the caller's own `auth.sessions` – id, created / updated / refreshed, user agent, IP
  coarsened to /24 (/48 for IPv6), aal, `is_current` (from the JWT `session_id`), this device first. Signing the other
  devices out runs through Supabase Auth (`signOut({ scope: "others" })`).
- **`backup_candidates(since, after?, limit?)`** (service role): users whose journal changed since `since`, keyset-paged –
  the nightly backup (`netlify/functions/backup-nightly.mts`).
- **Storage**: `backups` (private, no client policy – service role only) and `screenshots` (private; select / insert /
  update / delete only below `<auth.uid()>/…`). Created by the migration where the `storage` schema exists.

The migration was checked against Postgres 16 (PGlite) with a minimal `auth` shim: own-row visibility, column grants,
tombstone-only deletes, the aal2 rule, `rate_hit` counting and privileges, and the delete cascades. P09 re-checked it on
PGlite 0.3 (Postgres 17) with an `auth` + `storage` shim: `my_sessions()` (own rows only, current first, coarsened IPs,
anon refused), `backup_candidates()` (distinct, keyset paging, service role only), bucket creation and the screenshot
folder policies, the `rev` bump on a tombstone update and a stale optimistic `rev` update matching nothing.

## Rules the schema enforces (0002, billing)

- **Only the service role writes** (Stripe webhook / billing functions). Clients get `select` on their own rows and
  nothing else; `profiles.plan` / `plan_status` / `trial_end` stay webhook-only (0001 column grants).
- **`billing_customers`** (user ↔ Stripe customer): no client grant at all.
- **`subscriptions`** (`id` = Stripe `sub_…`): one row per Stripe subscription with plan, price, interval, seats, amount,
  period end, cancel / pause state, trial end, `has_payment_method`, `ref_code`; `last_event_at` lets the webhook drop
  events that arrive out of order. Users read their own rows.
- **`team_seats`** (`owner_id`, `member_id` unique): a member holds at most one seat; owner and member read the row. The
  plan of a member is recomputed by `_lib/stripe.ts` `recomputePlan` (own subscription or seat, the better one wins).
- **`referral_codes`** (`code` = `^[A-Z0-9]{6,12}$`, optional `commission_pct` for affiliates – set by the owner in SQL),
  **`referrals`** (one per referred user, `referred_id` is not readable by the referrer – column grants), **`affiliate_ledger`**
  (credits / commissions, unique per `(stripe_invoice_id, kind)` so a retried webhook never pays twice; the invoice id is
  not client-readable).
- **`stripe_events`** (`id` = `evt_…`): webhook idempotency – processed, attempts, last error; service role only.
- Account deletion: the referrer keeps the history (`referred_id` → `null`), everything else of the user cascades.

0002 was checked on PGlite (Postgres 17) with the 0001 shims (`scratchpad` script, not committed): own-row visibility
for every table, refused client writes, hidden columns (`referred_id`, `stripe_invoice_id`), the code / id checks, the
ledger uniqueness and the `on delete set null` of `referrals`.

## External setup (dashboard)

1. Project in the **EU (Frankfurt)** region; sign the DPA (AVV).
2. **Auth**: Site URL = the Netlify site; redirect URLs for `/` and `/teilen/`; enable TOTP MFA; German e-mail
   templates. Keys: publishable key → `VITE_SUPABASE_PUBLISHABLE_KEY`, secret key → `SUPABASE_SECRET_KEY` (functions only).
3. **Realtime**: 0001 adds `journal_docs` to the `supabase_realtime` publication when it exists; otherwise enable it
   under Database → Publications.
4. **Storage** (P06 / P09): bucket `screenshots` (private, object path `<auth.uid()>/<file>`, policies select/insert/
   delete own folder) and bucket `backups` (private, service role only, 14-day retention by `backup-nightly`).
5. Env vars: see `.env.example` (server values as Netlify secrets, scope Functions, never `VITE_`-prefixed).
6. **Stripe** (P10, test mode first): products **Pro**, **Premium**, **Team** (per seat) with a monthly and a yearly
   recurring price each → `STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>`; webhook endpoint `/api/v1/stripe/webhook` with the events
   `checkout.session.completed`, `customer.subscription.created/updated/deleted/paused/resumed/trial_will_end`,
   `invoice.paid`, `invoice.payment_failed` → `STRIPE_WEBHOOK_SECRET`; **Customer Portal**: allow cancellation (at period
   end, with reasons), payment-method update, invoice history and **switching between the six prices** (the "Wechseln"
   button deep-links there); promotion codes for coupons (the pricing page checks them live); tax / invoice settings
   (German invoices, optional `STRIPE_AUTOMATIC_TAX=true`). A comp plan for the owner: `update profiles set plan = 'premium'
   where id = '<uuid>'` (stays until a webhook for that user rewrites it).
