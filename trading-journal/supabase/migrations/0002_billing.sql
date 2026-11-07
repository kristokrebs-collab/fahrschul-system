-- 0002_billing.sql – Stripe subscriptions, referrals / affiliates, webhook idempotency, team seats (owner P10).
--
-- Run after 0001_core.sql. Conventions as in 0001: RLS on every table, client policies compare with
-- `(select auth.uid())`, and EVERYTHING here is written only by the service role (the Netlify functions in
-- netlify/functions, mainly the Stripe webhook `stripe-webhook.mts` via `_lib/stripe.ts`). Clients may read their own
-- subscription / referral rows; they can never write them (no insert / update / delete grants).
--
-- The effective plan lives in `profiles.plan / plan_status / trial_end` (0001). The webhook recomputes it from the
-- rows below after every relevant Stripe event (`recomputePlan`): the best subscription whose status grants access
-- (trialing / active / past_due), or a team seat of an owner whose team subscription grants access; else 'free'.

-- ── billing_customers ───────────────────────────────────────────────────────────────────────────────────────────
-- One Stripe customer per user, created at the first checkout (metadata supabase_user_id). Server-side only: the
-- client never sees the customer id (the portal is opened through a function).

create table public.billing_customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id like 'cus_%'),
  created_at         timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;

-- ── subscriptions ───────────────────────────────────────────────────────────────────────────────────────────────
-- Mirror of the user's Stripe subscriptions (one row per Stripe subscription). current_period_end comes from the
-- SubscriptionItem (API 2025+). last_event_at guards against out-of-order webhook deliveries: a snapshot older than
-- the stored one is never written back (the webhook re-reads the subscription from Stripe first anyway).

create table public.subscriptions (
  id                   text primary key check (id like 'sub_%'),
  user_id              uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id   text not null check (stripe_customer_id like 'cus_%'),
  status               text not null
                       check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired',
                                         'unpaid', 'paused')),
  plan                 text not null check (plan in ('free', 'pro', 'premium', 'team')),
  price_id             text,
  interval             text check (interval is null or interval in ('month', 'year')),
  seats                integer not null default 1 check (seats between 1 and 1000),
  amount               integer check (amount is null or amount >= 0),
  currency             text check (currency is null or char_length(currency) = 3),
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at            timestamptz,
  canceled_at          timestamptz,
  trial_end            timestamptz,
  pause_resumes_at     timestamptz,
  has_payment_method   boolean,
  ref_code             text check (ref_code is null or ref_code ~ '^[A-Z0-9]{6,12}$'),
  last_event_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index subscriptions_user on public.subscriptions (user_id, updated_at desc);
create index subscriptions_customer on public.subscriptions (stripe_customer_id);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- ── team_seats ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Members of a team owner's subscription (seats = the team subscription's quantity, the owner takes one). A user holds
-- at most one seat. P12 assigns / releases seats when members join / leave the team group (`assignSeat`,
-- `releaseSeat` in netlify/functions/_lib/stripe.ts); the member's profiles.plan follows the owner's subscription.

create table public.team_seats (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  member_id  uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);

alter table public.team_seats enable row level security;
create policy "team_seats: read own" on public.team_seats
  for select to authenticated using ((select auth.uid()) in (owner_id, member_id));
revoke all on public.team_seats from anon, authenticated;
grant select on public.team_seats to authenticated;

-- ── referral_codes / referrals / affiliate_ledger ───────────────────────────────────────────────────────────────
-- Every user can get one referral code (`/?ref=CODE`). A referred trader gets a longer first trial; once they pay
-- the first invoice the referrer earns a credit on their Stripe balance (`REFERRAL_REWARD_CENTS`). Affiliates are
-- codes with a commission_pct (set by the owner in SQL): they earn that share of every paid invoice for 12 months,
-- booked as `pending` and paid out by hand. The ledger is unique per (invoice, kind) – a webhook retry never books twice.

create table public.referral_codes (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  code           text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  commission_pct numeric(5, 2) check (commission_pct is null or (commission_pct > 0 and commission_pct <= 50)),
  created_at     timestamptz not null default now()
);

alter table public.referral_codes enable row level security;
create policy "referral_codes: read own" on public.referral_codes
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.referral_codes from anon, authenticated;
grant select on public.referral_codes to authenticated;

create table public.referrals (
  id                     bigint generated always as identity primary key,
  referrer_id            uuid not null references auth.users (id) on delete cascade,
  -- set null when the referred account is deleted: the referrer keeps the (anonymous) count
  referred_id            uuid unique references auth.users (id) on delete set null,
  code                   text not null check (code ~ '^[A-Z0-9]{6,12}$'),
  status                 text not null default 'trialing' check (status in ('trialing', 'paying', 'canceled')),
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  converted_at           timestamptz,
  check (referred_id is null or referred_id <> referrer_id)
);
create index referrals_referrer on public.referrals (referrer_id, created_at desc);

alter table public.referrals enable row level security;
create policy "referrals: read own" on public.referrals
  for select to authenticated using ((select auth.uid()) = referrer_id);
revoke all on public.referrals from anon, authenticated;
-- the referrer sees counts and states, never who signed up
grant select (id, referrer_id, code, status, created_at, converted_at) on public.referrals to authenticated;

create table public.affiliate_ledger (
  id                     bigint generated always as identity primary key,
  referrer_id            uuid not null references auth.users (id) on delete cascade,
  referral_id            bigint references public.referrals (id) on delete set null,
  kind                   text not null check (kind in ('credit', 'commission', 'reversal')),
  amount                 integer not null,
  currency               text not null default 'eur' check (char_length(currency) = 3),
  status                 text not null default 'pending' check (status in ('pending', 'applied', 'paid', 'void')),
  stripe_invoice_id      text,
  stripe_balance_txn_id  text,
  created_at             timestamptz not null default now(),
  unique (stripe_invoice_id, kind)
);
create index affiliate_ledger_referrer on public.affiliate_ledger (referrer_id, created_at desc);

alter table public.affiliate_ledger enable row level security;
create policy "affiliate_ledger: read own" on public.affiliate_ledger
  for select to authenticated using ((select auth.uid()) = referrer_id);
revoke all on public.affiliate_ledger from anon, authenticated;
grant select (id, referrer_id, kind, amount, currency, status, created_at) on public.affiliate_ledger to authenticated;

-- ── stripe_events ───────────────────────────────────────────────────────────────────────────────────────────────
-- Webhook idempotency: one row per Stripe event id. processed_at is set after the handler succeeded; a retry of a
-- processed event is acknowledged without work, a failed one (error set, processed_at null) runs again. Service role
-- only. Rows older than 90 days may be purged.

create table public.stripe_events (
  id           text primary key check (id like 'evt_%'),
  type         text not null check (char_length(type) <= 100),
  created_at   timestamptz not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 1,
  error        text check (error is null or char_length(error) <= 300)
);
create index stripe_events_received on public.stripe_events (received_at desc);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
