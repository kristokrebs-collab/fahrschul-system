-- 0019_trial_tombstones.sql – Sicherheits-Fixpaket Runde 11, Paket A (Geld, Zugriff, Funktionen).
--
-- Run after 0017 (and 0018 when it is there). Conventions as in 0001/0002: RLS on, `anon` and `authenticated` hold NO right, the table is
-- reached only by the Netlify functions with the service role.
--
-- ── trial_tombstones ────────────────────────────────────────────────────────────────────────────────────────────
-- One free trial per ADDRESS, also across a deleted account (review Linse 1 #6): until now `trialUsed` read the subscriptions of the
-- account, and the deletion cascades them away – delete the account, register again with the same address, get the trial again, and
-- with the card-less trial that repeated for free. When an account that HAD a trial is deleted, `account-delete` writes the keyed
-- hash of its address here (HMAC-SHA-256 with the server pepper, `IP_HASH_PEPPER`, over the lower-cased address without a `+tag` and,
-- for Gmail, without dots). The checkout looks the hash up; a hit means "trial already used". No address, no name, no user id is stored.
--
-- Retention: the nightly job removes rows older than 24 months (`TRIAL_TOMBSTONE_KEEP_DAYS` in `_lib/account.ts`; a PROPOSAL, the
-- operator confirms it with the privacy text – docs/RECHT/datenschutz.md names it as "{{TODO}}").

create table public.trial_tombstones (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index trial_tombstones_created on public.trial_tombstones (created_at);

alter table public.trial_tombstones enable row level security;
revoke all on public.trial_tombstones from anon, authenticated;

-- ── retention indexes ───────────────────────────────────────────────────────────────────────────────────────────
-- The nightly purge removes `audit_log` rows older than the retention period (365 days, `AUDIT_KEEP_DAYS` in `_lib/account.ts`) and
-- the public contract requests that never found a contract (`status` unknown / none / expired, 30 days, `REQUEST_KEEP_DAYS`): both
-- by time, without a user column – the existing indexes start with `user_id`.
create index if not exists audit_log_at on public.audit_log (at);
create index if not exists contract_requests_received on public.contract_requests (received_at);
