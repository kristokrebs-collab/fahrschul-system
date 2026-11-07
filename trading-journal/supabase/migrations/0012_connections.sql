-- 0012_connections.sql – Verbindungen (Paket B2/B3): Empfangsprotokoll des TradingView-Webhooks.
--
-- Run after 0011 (or 0010 when 0011 is not part of this deployment: the file is independent of it).
--
-- Binance needs NO schema change: `exchange_connections` already allows `exchange = 'binance'` (0001); the market
-- (`spot` | `futures`) and the extra spot pairs live in the server-only `meta` column (0003), the key rights as short tags
-- in `permissions`. Spot and futures are two rows side by side (`unique (user_id, exchange, label)`, the default labels
-- are "Spot" and "Futures").
--
-- `webhook_receipts` – what arrived at /api/v1/hooks/tradingview/<token> (the assistant "Testsignal → Empfang anzeigen"
-- and the receipt list of the connection card). Written only by the function (service role); a user reads the rows of
-- their own account. No alert text, no token and no IP is stored – only what the card shows: when, what kind, which
-- symbol, whether it was accepted. At most 30 rows per user are kept (the function prunes).

create table if not exists public.webhook_receipts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null default 'tradingview' check (source in ('tradingview')),
  -- 'test' = the test signal of the assistant, 'open' / 'close' = a trade alert, 'rejected' = refused (see detail)
  kind        text not null check (kind in ('test', 'open', 'close', 'rejected')),
  -- who sent it: the assistant's button in this app ('app') or anything else, normally TradingView ('extern')
  via         text not null default 'extern' check (via in ('app', 'extern')),
  symbol      text check (symbol is null or char_length(symbol) <= 40),
  detail      text check (detail is null or char_length(detail) <= 200),
  received_at timestamptz not null default now()
);
create index if not exists webhook_receipts_user on public.webhook_receipts (user_id, received_at desc);

alter table public.webhook_receipts enable row level security;
create policy "webhook_receipts: read own" on public.webhook_receipts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "webhook_receipts: mfa" on public.webhook_receipts as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.webhook_receipts from anon, authenticated;
grant select (id, user_id, source, kind, via, symbol, detail, received_at) on public.webhook_receipts to authenticated;
