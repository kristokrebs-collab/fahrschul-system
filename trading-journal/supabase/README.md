# `supabase/` – database schema for login, sync, billing, exchange sync and community

Local-first stays the default: without `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (and always in the
single-file builds) the app never talks to Supabase (`isCloudAvailable()` in `src/cloud`).

## Migrations (run in this order)

| File | Owner | Content |
|---|---|---|
| `migrations/0001_core.sql` | P09 | `profiles`, `journal_docs` (+ Realtime), `rate_hits` + `rate_hit()`, `audit_log`, `app_errors`, `exchange_connections`, `mfa_satisfied()`, `my_sessions()`, `backup_candidates()`, buckets `backups` / `screenshots` (+ own-folder policies) |
| `migrations/0002_billing.sql` | P10 | `billing_customers`, `subscriptions`, `team_seats`, `referral_codes`, `referrals`, `affiliate_ledger`, `stripe_events` |
| `migrations/0003_exchange.sql` | P11 | `exchange_connections` + `journal_account`, `sync_enabled`, `meta`; `sync_runs`, `sync_cursor`, `api_tokens`, `upsert_synced_trade()` / `upsert_synced_trades()` – secrets stay in `exchange_connections` (0001) |
| `migrations/0004_social.sql` | P12 | `groups`, `group_members` (role, `share_level`), `social_profiles` (pseudonyms), `group_invites`, `group_reviews`, `comments`, `group_goals`, `shares`, `feedback`, `member_stats`, `leaderboard_snapshots`, `community_stats`; helpers `is_group_member()`, `group_role()`, `shares_group_with()`, `can_see_review()`, `shared_payload()`, `social_candidates()` |

| `migrations/0005_mfa_everywhere.sql` | review SEC-01 | the aal2 rule (`mfa_satisfied()`) on every remaining client-readable table – `audit_log`, `subscriptions`, `team_seats`, `referral_codes`, `referrals`, `affiliate_ledger`, `api_tokens`, `social_profiles`, `group_invites`, `group_goals`, `shares`, `feedback`, `member_stats` – and on the four `screenshots` storage policies |

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
  session (restrictive policies via `mfa_satisfied()`). Since 0005 the same holds for every other client-readable table
  except `profiles` (privacy opt-ins are read before the code step) and the k-anonymous `community_stats`, and for the
  `screenshots` bucket (read, signed URLs, upload, overwrite, delete). The functions mirror it with
  `requireUser(req, { aal2: "ifEnrolled" })`; `billing/status` answers such a session like a signed-out visitor.
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

**Committed check (0001 – latest):** `tests/unit/supabase.rls.test.ts` applies every migration in order on PGlite with
the Supabase shim (roles, default grants, `auth`, `storage`) and checks the aal2 rule table by table: a user with a
verified factor and a password-only (aal1) JWT sees nothing and cannot write screenshots, the same user with aal2 sees
the own rows, a user without 2FA keeps working with aal1, and `anon` is refused everywhere.

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
- Account deletion: the referrer keeps the history (`referred_id` → `null`), everything else of the user cascades. The
  cascade of `team_seats` alone would leave the members on the Team plan, so `account-delete` releases a team owner's
  seats through `releaseSeat` first (each member's plan is recomputed); a webhook for the deleted user fails the FK
  (23503) and is acknowledged as `ignored`.

0002 was checked on PGlite (Postgres 17) with the 0001 shims (`scratchpad` script, not committed): own-row visibility
for every table, refused client writes, hidden columns (`referred_id`, `stripe_invoice_id`), the code / id checks, the
ledger uniqueness and the `on delete set null` of `referrals`.

## Rules the schema enforces (0003, exchange sync)

- **`exchange_connections`** (0001) gains `journal_account` (`makro` | `scalp`, the account synced trades land in),
  `sync_enabled` (Auto-Sync) – both client-readable via column grants – and `meta` (service only: fee convention,
  venue details). The encrypted key columns stay unreadable for clients.
- **`sync_runs`**: one row per sync / dry run / backfill / cron run with counts (`fetched`, `inserted`, `updated`,
  `unchanged`, `skipped`), status and a German error (≤ 300 chars, never a secret). Users read their own rows (aal2 when
  2FA is on, restrictive policy); only functions write. `connection_id` → `null` when a connection is removed, so the
  history stays.
- **`sync_cursor`** `(connection_id, stream)`: the incremental position (`cursor_ms`) and the resume point of an
  unfinished window (`meta`); service role only, deleted with the connection.
- **`api_tokens`**: personal tokens for the REST API / TradingView webhook – only the SHA-256 (`^[0-9a-f]{64}$`,
  unique) is stored plus a display prefix; scopes limited to `trades:read`, `trades:write`, `webhook:tradingview`.
  Clients read their own rows without `token_hash` (column grants); create / revoke run in `trades-api.mts`.
- **`upsert_synced_trade(user, id, set, fill, new)`** / **`upsert_synced_trades(user, items ≤ 200)`** (service role
  only, `security definer`, empty `search_path`): the one write path of server-side imports into `journal_docs`.
  New → inserted; tombstone → `deleted` (a trade the trader deleted is never resurrected); existing → `set` keys
  overwrite, `fill` keys only fill empty values (`null`, `""`, `[]`), everything else of the trader stays; equal apart
  from `syncedAt` / `updatedAt` → `unchanged` without a write (no Realtime event). The key lists mirror
  `src/exchanges/syncFields.ts`.

0003 was checked on PGlite (Postgres 17) on top of 0001 / 0002 and their shims (`scratchpad` script, not committed):
own-row visibility and refused client writes for the three tables, hidden `token_hash` / `meta` / secrets, the hash /
scope / `journal_account` checks, insert → unchanged → updated → tombstone results of `upsert_synced_trade` (FILL never replaces a value),
the 200-item limit, `execute` refused for `authenticated`, and the cascades on connection and user deletion.

## Rules the schema enforces (0004, community)

- **Opt-in only.** Nobody is ranked unless `profiles.privacy.leaderboard = true`; nobody's figures reach a group unless
  their membership says `share_level = 'stats'`; a trade leaves the journal only when its owner posts or shares it.
  People appear under a generated pseudonym (`social_profiles`, "Stiller Falke 27", checked by a pattern), never under
  an e-mail or display name.
- **RLS via membership** on every table, through `security definer` helpers with an empty `search_path`
  (`is_group_member`, `group_role`, `shares_group_with`, `can_see_review` – no policy recursion) plus the restrictive
  `mfa_satisfied()` policy. Members read their groups, co-members and co-members' pseudonyms; in a **mentor** group a
  student sees only their own reviews and the mentors; invites are readable by owners / mentors only; shares,
  feedback, goals and `member_stats` only by their owner(s). **All writes run through the functions** (service role) so
  rate limits, redaction, mentions and seat rules hold – clients have no insert / update / delete grant.
- **Redacted content only.** `group_reviews.payload` / `shares.payload` are JSON objects ≤ 16 KiB that the functions
  validated against the strict schemas of `src/social/contract.ts` (no money, size, fees, notes, account); share tokens
  are 22-char base64url (`^[A-Za-z0-9_-]{22}$`), readable publicly only through `shared_payload(token)` (service role:
  not revoked, not expired, counts a view).
- **k-anonymity.** `community_stats` refuses rows with `n < 10` (check constraint) and requires ordered quantiles;
  `leaderboard_snapshots` has no client grant at all (served by the function after the live opt-in filter).
  `social_candidates()` (service role) lists only opt-ins and members sharing stats – the nightly aggregate never
  reads anybody else.
- **Abuse.** Comments ≤ 1000 chars with ≤ 10 mentions, `hidden` after reports; one report per reporter and target
  (unique), a report needs a user and a target.
- **Cascades (DSGVO).** Deleting a user removes their groups (with all content), memberships, pseudonym, reviews,
  comments, goals, shares, stats, snapshots and feedback; a deleted group takes its members, invites, reviews,
  comments and goals with it.

0004 was checked on PGlite (Postgres 17) on top of 0001 – 0003 and their shims (`scratchpad` script, not committed):
co-member visibility vs. strangers, mentor-group visibility, refused client writes on every table, hidden snapshots,
the token / pseudonym / invite / report checks, `n >= 10`, `shared_payload()` (expired / revoked / views),
`social_candidates()` (opt-ins only), `execute` refused for `authenticated`, and the cascades on group and user deletion.

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
7. **Exchange sync** (P11): Netlify secret `EXCHANGE_ENC_KEY_V1` (`openssl rand -base64 32`, scope Functions) – without
   it the app says honestly that the sync is not set up and offers the CSV import. Optional `SYNC_CRON_ENABLED=false`
   stops the 30-minute sync. Rotation: add `EXCHANGE_ENC_KEY_V2`; old keys keep decrypting and are re-encrypted on use.
