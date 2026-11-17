-- 0015 – recovery codes of the second factor (B1/C4) + one grant correction of 0014 (second section below)
--
-- Until now the hashes lived in `app_config` under `mfa-recovery:<user id>`. They get their own table: cascade to
-- `auth.users` (an account deletion removes them with the user, no extra step), one row per user, and a column that says
-- what it is. Service role only – NO client access at all: RLS on, no policy, every right revoked from anon / authenticated.
--
-- `codes` = [{ "h": <HMAC-SHA-256 hex of "<user id>:<code>">, "usedAt": <ISO | null> }, …] – only hashes, never a code.
-- Migration path (netlify/functions/_lib/mfaRecovery.ts): a row in this table wins; a user who still has the old
-- `app_config` row keeps working with it (a code from it is accepted and consumed there); a NEW set is always written here
-- and removes the old row. Without this migration the functions keep using `app_config` (nothing breaks while it is pending).

create table public.mfa_recovery_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  codes      jsonb not null check (jsonb_typeof(codes) = 'array' and jsonb_array_length(codes) between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;

-- ── correction to 0014: `jobs` is not for the browser ───────────────────────────────────────────────────────────────
--
-- Found by the isolation audit (tests/unit/supabase.audit.test.ts, R2b): 0014 granted `select` on the whole `public.jobs`
-- (delivery queue of the alert pipeline) to `authenticated`, including `lease_token` / `lease_until`. The lease token is the
-- proof a worker holds a job; `jobs_complete` / `jobs_retry` are service-only, so it could not be used from a client – but
-- no client code reads `jobs` at all (the delivery outcome is `alert_deliveries`, read through the functions), so the right
-- is simply taken back (least privilege). The policies stay (harmless without the right; a later grant must not forget them).
revoke select on public.jobs from authenticated;
