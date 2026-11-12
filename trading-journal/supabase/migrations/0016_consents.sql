-- 0016_consents.sql – evidence of the order consents and the cancel / withdraw declarations (package B4, Kaufstrecke).
--
-- Run after 0012 (and the other numbered migrations). ENTWURF – Prüfung durch Anwalt nötig: what is stored and for how long is
-- a lawyer's decision (docs/RECHT/anwaltsfragen.md). Conventions as in 0001/0002: RLS on every table, client policies compare
-- with `(select auth.uid())`, EVERYTHING is written only by the service role (the Netlify functions `billing-checkout`,
-- `billing-contract`); a signed-in user may READ only their own rows and can never write, change or delete one.

-- ── consents ────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per consent per order, written BEFORE the Stripe Checkout Session is created (no row → no checkout):
--   terms            AGB / Widerrufsbelehrung / Datenschutz taken note of (§ 305 BGB)
--   immediate_start  express request to start before the withdrawal period ends + knowledge of Wertersatz / Erlöschen
--                    (§ 356 Abs. 5, § 357a BGB)
-- `consent_text` is the exact wording that was shown, `text_hash` its SHA-256 and `text_version` the label of that wording
-- (src/legal/consentRecord.ts) – the proof says WHAT was ticked, not only that something was. (user, order, kind) is unique:
-- a double click or a retry writes nothing twice.

create table public.consents (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  order_id            uuid not null,
  kind                text not null check (kind in ('terms', 'immediate_start')),
  text_hash           text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  text_version        text not null check (char_length(text_version) between 1 and 60),
  consent_text        text not null check (char_length(consent_text) between 1 and 4000),
  plan                text check (plan is null or plan in ('pro', 'premium', 'team')),
  interval            text check (interval is null or interval in ('month', 'year')),
  seats               integer check (seats is null or seats between 1 and 1000),
  checkout_session_id text check (checkout_session_id is null or checkout_session_id like 'cs_%'),
  given_at            timestamptz not null default now(),
  unique (user_id, order_id, kind)
);
create index consents_user on public.consents (user_id, given_at desc);

alter table public.consents enable row level security;
create policy "consents: read own" on public.consents
  for select to authenticated using ((select auth.uid()) = user_id);
-- a password-only session (aal1) of an account WITH a verified 2FA factor reads nothing (restrictive, like every table since 0005)
create policy "consents: mfa" on public.consents as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;

-- ── contract_requests ───────────────────────────────────────────────────────────────────────────────────────────
-- Cancel (§ 312k BGB) and withdrawal (§ 356a BGB) declarations made through the public pages (no login). The address is NOT
-- stored in clear: `email_hash` is a salted SHA-256 (rate limits, duplicates); the confirmation link carries a random token
-- of which only the SHA-256 is kept. `user_id` is set when the address belongs to an account with a contract, else null
-- (`status = 'unknown'`; the page and the mail say the same either way). Written by the service role only.

create table public.contract_requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('cancel', 'withdraw')),
  user_id       uuid references auth.users (id) on delete set null,
  email_hash    text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  token_hash    text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  declared_name text check (declared_name is null or char_length(declared_name) <= 120),
  contract_hint text check (contract_hint is null or char_length(contract_hint) <= 300),
  status        text not null default 'received'
                check (status in ('received', 'executed', 'none', 'expired', 'late', 'unknown')),
  received_at   timestamptz not null default now(),
  executed_at   timestamptz,
  ends_at       timestamptz
);
create index contract_requests_user on public.contract_requests (user_id, received_at desc);
create index contract_requests_hash on public.contract_requests (email_hash, received_at desc);

alter table public.contract_requests enable row level security;
create policy "contract_requests: read own" on public.contract_requests
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "contract_requests: mfa" on public.contract_requests as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.contract_requests from anon, authenticated;
grant select on public.contract_requests to authenticated;
