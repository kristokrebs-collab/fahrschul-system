-- 0006_sync_schedule.sql – fair queue for the scheduled exchange sync (review SYNC-01).
--
-- Run after 0005. The 30-minute cron (netlify/functions/exchange-sync-cron.mts) used to take the 40 active connections
-- with the OLDEST last_sync_at. A connection that is skipped (plan without auto-sync after the trial) or whose sync
-- fails (only last_error is written) never gets a newer last_sync_at – 40 of them blocked auto-sync for every paying
-- trader. Now every attempt of the cron sets `next_sync_at`, and the cron orders by it:
--   synced            → now + 20 min (due in the next run), sync_failures = 0
--   synced recently   → last_sync_at + 20 min (a manual sync in between)
--   failed            → sync_failures + 1, back-off 20 min · 2^(n−1), at most 12 h
--   plan without sync → now + 6 h (checked again a few times a day; a manual sync works at once after an upgrade)
-- Server bookkeeping only: no client grant (the column grants of 0001 / 0003 stay as they are).

alter table public.exchange_connections
  add column if not exists next_sync_at  timestamptz,
  add column if not exists sync_failures smallint not null default 0 check (sync_failures >= 0);

create index if not exists exchange_connections_due on public.exchange_connections (next_sync_at nulls first, last_sync_at nulls first)
  where status = 'active' and sync_enabled;
