-- 0003_exchange.sql – exchange sync, REST API tokens (owner P11).
--
-- Run after 0001_core (exchange_connections, journal_docs) and 0002_billing. The API secrets stay in
-- exchange_connections (0001, AES-256-GCM blobs, no client privilege on the *_enc columns). Everything here is written
-- only by the Netlify functions (service role); clients read their own sync history and token list.
--
-- Field ownership of a synced trade (mirrors src/exchanges/syncFields.ts – keep both in step):
--   SET  (exchange-owned, overwritten on every sync): exchange, exchangeAccount, externalId, syncSource, syncedAt,
--        origin, market, side, status, date, exitDate, pair, entry, exit, qty, size, leverage, marginMode, fees,
--        fundingFees, pnlManual, pnl, fills
--   FILL (only while the record has no value): stop, target, stopHistory, targets, liqPrice
--   everything else (setups, checks, notes, reason, emotion, tags, rating, psych, screenshots, annotations, mistakes,
--   account, timeframe, …) belongs to the trader and is never written by a sync once the record exists.
-- The function receives ready-made `set` / `fill` / `new` objects; the split happens in the function code.

-- ── exchange_connections: sync settings (additive) ──────────────────────────────────────────────────────────────

alter table public.exchange_connections
  add column if not exists journal_account text not null default 'scalp' check (journal_account in ('makro', 'scalp')),
  add column if not exists sync_enabled boolean not null default true,
  -- server bookkeeping (detected P&L convention, position mode, fills still to fetch, …) – not client readable
  add column if not exists meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object');

grant select (journal_account, sync_enabled) on public.exchange_connections to authenticated;

-- ── sync_runs ───────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per sync (manual, scheduled, first import, dry run). Users read their own history (Konto → Börse).

create table public.sync_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.exchange_connections (id) on delete set null,
  exchange      text not null check (char_length(exchange) <= 16),
  kind          text not null check (kind in ('manual', 'cron', 'backfill', 'dry_run')),
  status        text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  window_from   timestamptz,
  window_to     timestamptz,
  fetched       integer not null default 0 check (fetched >= 0),
  inserted      integer not null default 0 check (inserted >= 0),
  updated       integer not null default 0 check (updated >= 0),
  unchanged     integer not null default 0 check (unchanged >= 0),
  skipped       integer not null default 0 check (skipped >= 0),
  error         text check (error is null or char_length(error) <= 300),
  meta          jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object')
);
create index sync_runs_user_started on public.sync_runs (user_id, started_at desc);
create index sync_runs_connection on public.sync_runs (connection_id, started_at desc);

alter table public.sync_runs enable row level security;
create policy "sync_runs: read own" on public.sync_runs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "sync_runs: mfa" on public.sync_runs as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.sync_runs from anon, authenticated;
grant select on public.sync_runs to authenticated;

-- ── sync_cursor ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Where the incremental sync of one connection continues (per stream: 'positions', 'tpsl', …). cursor_ms = exchange
-- time in epoch ms; meta = resume state of an interrupted window ({ from, to, skip }) and the oldest open position.
-- Service role only.

create table public.sync_cursor (
  connection_id uuid not null references public.exchange_connections (id) on delete cascade,
  stream        text not null check (stream ~ '^[a-z_]{1,32}$'),
  user_id       uuid not null references auth.users (id) on delete cascade,
  cursor_ms     bigint check (cursor_ms is null or cursor_ms >= 0),
  meta          jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  updated_at    timestamptz not null default now(),
  primary key (connection_id, stream)
);
create index sync_cursor_user on public.sync_cursor (user_id);

create trigger sync_cursor_touch before update on public.sync_cursor
  for each row execute function public.touch_updated_at();

alter table public.sync_cursor enable row level security;
revoke all on public.sync_cursor from anon, authenticated;

-- ── api_tokens ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Personal tokens for the REST API (/api/v1/trades) and the TradingView webhook (/api/v1/hooks/tradingview/<token>).
-- Only the SHA-256 of a token is stored; the plain token is shown once when it is created. Users see the prefix,
-- name, scopes and usage of their own tokens, never the hash.

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 40),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix       text not null check (char_length(prefix) between 4 and 12),
  scopes       text[] not null default '{trades:read}'
               check (scopes <@ array['trades:read', 'trades:write', 'webhook:tradingview']::text[] and cardinality(scopes) >= 1),
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create index api_tokens_user on public.api_tokens (user_id, created_at desc);

alter table public.api_tokens enable row level security;
create policy "api_tokens: read own" on public.api_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.api_tokens from anon, authenticated;
grant select (id, user_id, name, prefix, scopes, last_used_at, created_at, revoked_at) on public.api_tokens to authenticated;

-- ── upsert_synced_trade(s) ──────────────────────────────────────────────────────────────────────────────────────
-- Writes one synced position into the trader's journal (journal_docs, kind 'trade'):
--   no row      → insert new || fill || set (+ id, createdAt, updatedAt)                           → 'inserted'
--   tombstone   → nothing (a trade the trader deleted stays deleted)                               → 'deleted'
--   row         → data || set, then each FILL key only where the record is empty (null / "" / []);
--                 equal apart from syncedAt / updatedAt → 'unchanged' (no write, no Realtime event), else 'updated'
-- The journal_docs trigger stamps updated_at / rev; Realtime delivers the change to the trader's devices.

create function public.upsert_synced_trade(p_user uuid, p_id text, p_set jsonb, p_fill jsonb, p_new jsonb)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  cur_data    jsonb;
  cur_deleted boolean;
  merged      jsonb;
  k           text;
  v           jsonb;
  now_iso     text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_user is null or p_id is null or char_length(p_id) not between 1 and 128 then
    raise exception 'upsert_synced_trade: invalid arguments';
  end if;
  p_set  := coalesce(p_set, '{}'::jsonb);
  p_fill := coalesce(p_fill, '{}'::jsonb);
  p_new  := coalesce(p_new, '{}'::jsonb);
  if jsonb_typeof(p_set) <> 'object' or jsonb_typeof(p_fill) <> 'object' or jsonb_typeof(p_new) <> 'object' then
    raise exception 'upsert_synced_trade: objects expected';
  end if;

  select d.data, d.deleted into cur_data, cur_deleted
  from public.journal_docs d
  where d.user_id = p_user and d.kind = 'trade' and d.id = p_id
  for update;

  if not found then
    merged := p_new || p_fill || p_set
      || jsonb_build_object('id', p_id, 'createdAt', coalesce(p_new ->> 'createdAt', now_iso), 'updatedAt', now_iso);
    insert into public.journal_docs (user_id, kind, id, data, client_updated_at)
    values (p_user, 'trade', p_id, merged, now());
    return 'inserted';
  end if;

  if cur_deleted then
    return 'deleted';
  end if;

  merged := cur_data || p_set;
  for k, v in select e.key, e.value from jsonb_each(p_fill) e loop
    if merged -> k is null or merged -> k in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then
      merged := merged || jsonb_build_object(k, v);
    end if;
  end loop;

  if (merged - 'syncedAt' - 'updatedAt') = (cur_data - 'syncedAt' - 'updatedAt') then
    return 'unchanged';
  end if;

  update public.journal_docs
  set data = merged || jsonb_build_object('updatedAt', now_iso), client_updated_at = now()
  where user_id = p_user and kind = 'trade' and id = p_id;
  return 'updated';
end $$;
revoke execute on function public.upsert_synced_trade(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_synced_trade(uuid, text, jsonb, jsonb, jsonb) to service_role;

-- Batch form (one round trip per page): p_items = [{ id, set, fill, new }, …] (≤ 200) → { "<id>": "<result>", … }.
create function public.upsert_synced_trades(p_user uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  res  jsonb := '{}'::jsonb;
begin
  if p_user is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'upsert_synced_trades: invalid arguments';
  end if;
  for item in select e.value from jsonb_array_elements(p_items) e loop
    res := res || jsonb_build_object(
      item ->> 'id',
      public.upsert_synced_trade(p_user, item ->> 'id', item -> 'set', item -> 'fill', item -> 'new')
    );
  end loop;
  return res;
end $$;
revoke execute on function public.upsert_synced_trades(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_synced_trades(uuid, jsonb) to service_role;
