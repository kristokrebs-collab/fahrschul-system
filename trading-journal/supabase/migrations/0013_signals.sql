-- 0013_signals.sql – TradingView-Signal-Empfänger (Paket B3): Signale, OAuth-Zustand und -Verbindung zum offiziellen TradingView-MCP.
--
-- Run after 0012 (the file is independent of it). Numbers: 0014 = Alarme, 0015 / 0016 are taken by other packages.
--
-- `signals` – what arrived at POST /api/v1/signals/<token> (and, for the same address, at /api/v1/hooks/tradingview/<token>):
--   one row per DELIVERY, with its fate: 'processed' (new signal, stored), 'duplicate' (same user + source + signal id as a processed one,
--   changes nothing) or 'rejected' (valid token, unusable body: the reason is shown to the owner). The normalised signal has NO order size by
--   design (schema signal/1): the app never sizes or sends an order from it. Written only by the function (service role); the owner reads
--   their own rows (RLS), nothing else is granted. No raw body, no token and no IP is stored.
--   Dedup: the partial unique index on (user_id, source, signal_id) where status = 'processed' – two parallel deliveries of the same
--   signal end in a unique violation for the second one, which the function reports as 'duplicate'. Retention: the function keeps the
--   newest 1000 processed signals of a user for at most 90 days (the dedup window is that long) and the newest 50 other rows.
--
-- `tv_mcp_states` – the pending OAuth authorisation (PKCE): the SHA-256 of `state` is the key, the code verifier is encrypted (AES-256-GCM, the
--   exchange key ring), single use, expires after 10 minutes. `tv_mcp_connections` – the user's own connection to the official TradingView MCP
--   server: access / refresh token ENCRYPTED (AAD binds them to the user and the field), never readable by a client (no grant at all).
-- Account deletion removes all rows (cascade); the account export lists `signals` (see `_lib/account.ts`), never the token tables.

create table public.signals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null check (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  -- the sender's id of the signal (or one derived from its content for senders without ids); null for a refused body
  signal_id   text check (signal_id is null or char_length(signal_id) between 1 and 80),
  -- 'test' = the connection assistant's test signal (no dedup, no direction), 'signal' = a real one
  kind        text not null default 'signal' check (kind in ('signal', 'test')),
  status      text not null check (status in ('processed', 'duplicate', 'rejected')),
  reason      text check (reason is null or char_length(reason) <= 200),
  -- which format arrived: signal/1, branchen-trend/1 (the Branchen-Trend alert) or the older {"action":"open"|"close"} message
  schema_id   text check (schema_id is null or schema_id in ('signal/1', 'branchen-trend/1', 'legacy-action')),
  strategy    text check (strategy is null or char_length(strategy) <= 60),
  market      text check (market is null or char_length(market) <= 20),
  symbol      text check (symbol is null or char_length(symbol) <= 40),
  direction   text check (direction is null or direction in ('long', 'flat')),
  -- the time the signal itself names (TradingView {{time}}); the age check of the paper bridge uses it
  signal_time timestamptz,
  data        jsonb check (data is null or (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 2048)),
  -- who sent it: the assistant's button in this app ('app') or anything else, normally TradingView ('extern')
  via         text not null default 'extern' check (via in ('app', 'extern')),
  received_at timestamptz not null default now(),
  -- a processed real signal is complete: id, direction and time are there
  constraint signals_processed_complete check (status <> 'processed' or kind = 'test' or (signal_id is not null and direction is not null and signal_time is not null))
);

-- the dedup key: ONE processed signal per (user, source, signal id)
create unique index signals_dedup on public.signals (user_id, source, signal_id) where status = 'processed' and kind = 'signal';
create index signals_user_received on public.signals (user_id, received_at desc);

alter table public.signals enable row level security;
create policy "signals: read own" on public.signals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "signals: mfa" on public.signals as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.signals from anon, authenticated;
grant select (id, user_id, source, signal_id, kind, status, reason, schema_id, strategy, market, symbol, direction, signal_time, data, via, received_at)
  on public.signals to authenticated;

-- ── OAuth towards the official TradingView MCP server (per user) ─────────────────────────────────────────────────────────
create table public.tv_mcp_states (
  state_hash   text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- AES-256-GCM blob `v<n>:iv:tag:ct` of the PKCE code verifier
  verifier_enc text not null check (char_length(verifier_enc) <= 400),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index tv_mcp_states_user on public.tv_mcp_states (user_id);
create index tv_mcp_states_expiry on public.tv_mcp_states (expires_at);

create table public.tv_mcp_connections (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  client_id    text not null check (char_length(client_id) between 1 and 200),
  scope        text check (scope is null or char_length(scope) <= 200),
  resource     text not null check (char_length(resource) <= 300),
  -- AES-256-GCM blobs; the AAD binds each to the user and the field (`<user>:tv-mcp:access|refresh`)
  access_enc   text not null check (char_length(access_enc) <= 8000),
  refresh_enc  text check (refresh_enc is null or char_length(refresh_enc) <= 8000),
  expires_at   timestamptz,
  status       text not null default 'active' check (status in ('active', 'invalid')),
  last_error   text check (last_error is null or char_length(last_error) <= 200),
  last_test_at timestamptz,
  last_test_ok boolean,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.tv_mcp_states enable row level security;
alter table public.tv_mcp_connections enable row level security;
-- no policy and no grant: only the service role (the functions) reads or writes these tables
revoke all on public.tv_mcp_states from anon, authenticated;
revoke all on public.tv_mcp_connections from anon, authenticated;
