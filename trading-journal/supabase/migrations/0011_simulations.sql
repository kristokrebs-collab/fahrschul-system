-- 0011_simulations.sql – Zeitmaschine: gespeicherte Simulationen (A3).
--
-- Run after 0001_core (touch_updated_at, mfa_satisfied) and 0005_mfa_everywhere. One row = ONE simulation of the Zeitmaschine with
-- everything needed to tell it again and to check it is the same one: the id (content-addressed on the client: same inputs, same id),
-- the seed, the model version, the hash and the stand of the candles it was computed from, the cost assumptions, the plan, the size
-- (runs, time stop) and the key figures. The heavy parts (the 10 000 paths, the list of earlier occasions) are NOT stored: the seed
-- and the candles reproduce them, and the figures in `metrics` + `result_hash` show whether a recomputation came out the same.
--
-- - Own rows only: select / insert / update / delete compare `user_id` with `auth.uid()`; anon has nothing; a session with a verified
--   2FA factor needs aal2 (restrictive policy, like every other client-readable table since 0005).
-- - The client syncs only while signed in (and the Zeitmaschine works without this table: IndexedDB stays the first copy).
-- - Size limits are checked by the database (a client cannot park large documents here).
-- - Account deletion removes the rows (cascade); the account export lists them (`netlify/functions/_lib/account.ts`).

create table public.simulations (
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- `sim_` + 20…64 hex characters (the client's content hash of the inputs)
  id                text not null check (id ~ '^sim_[0-9a-f]{20,64}$'),
  -- the journal trade (or paper position) this simulation belongs to; absent = a free simulation of the Labor
  trade_id          text check (trade_id is null or char_length(trade_id) between 1 and 80),
  symbol            text not null check (char_length(symbol) between 1 and 40),
  interval          text not null check (interval in ('1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d')),
  seed              bigint not null check (seed between 0 and 4294967295),
  model_version     text not null check (char_length(model_version) between 1 and 40),
  -- SHA-256 (hex) of the closed candles the simulation was computed from, and the stand of that data
  data_hash         text not null check (data_hash ~ '^[0-9a-f]{64}$'),
  data_bars         integer not null check (data_bars between 0 and 1000000),
  data_from         timestamptz,
  data_to           timestamptz,
  source            text check (source is null or char_length(source) <= 120),
  -- size of the simulation
  runs              integer not null check (runs between 1 and 100000),
  horizon           integer not null check (horizon between 1 and 400),
  -- plan (side, entry, stop, target), cost assumptions (fees, slippage, funding) and the key figures
  plan              jsonb not null check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 2048),
  costs             jsonb not null check (jsonb_typeof(costs) = 'object' and pg_column_size(costs) <= 4096),
  metrics           jsonb not null check (jsonb_typeof(metrics) = 'object' and pg_column_size(metrics) <= 16384),
  -- SHA-256 (hex) of the figures: a recomputation with the same seed and data must give the same hash
  result_hash       text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  client_created_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, id)
);

create index simulations_user_trade on public.simulations (user_id, trade_id) where trade_id is not null;
create index simulations_user_created on public.simulations (user_id, created_at desc);

-- `created_at` never moves, `updated_at` is the database clock (client clocks do not matter)
create function public.simulations_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  return new;
end $$;

create trigger simulations_stamp before insert or update on public.simulations
  for each row execute function public.simulations_stamp();

alter table public.simulations enable row level security;
create policy "simulations: read own" on public.simulations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "simulations: insert own" on public.simulations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "simulations: update own" on public.simulations
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "simulations: delete own" on public.simulations
  for delete to authenticated using ((select auth.uid()) = user_id);
-- 2FA accounts: aal2 for every command (the rule of 0001 / 0005)
create policy "simulations: mfa" on public.simulations as restrictive
  for all to authenticated using (public.mfa_satisfied()) with check (public.mfa_satisfied());

revoke all on public.simulations from anon, authenticated;
grant select, insert, update, delete on public.simulations to authenticated;
