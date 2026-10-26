-- 0009_proofs_boards.sql – Ergebnisbeleg (F57) and the ranking's data class + drawdown (F50 / F71).
--
-- Run after 0004_social. Nothing here opens a new door: the same opt-in (`profiles.privacy.leaderboard`), the same
-- pseudonyms, the same service-role-only writes, the same RLS as before – the tables only learn three more things.
--
-- 1. `shares.kind` gets a fourth value, 'proof': the COMPLETE list of the closed trades of a period, in R (no money, no
--    account size, no pair, no times – the function validates the strict schema `SharedProofSchema`). A proof is longer
--    than the other payloads, so the size limit is 64 KB for that kind and stays 16 KB for the others.
-- 2. `member_stats` / `leaderboard_snapshots` carry the deepest drop of the running R sum (`max_dd_r` / `dd`) and where
--    the trader's records came from (`origin`: 'api' exchange interface · 'csv' file import · 'manual' by hand ·
--    'auto' bot / webhook · 'mixed' when no way reaches 80 % of the R trades). The app cannot know whether an account is
--    real money or a demo account – only where the records came from; the ranking says exactly that and no more.
-- 3. The metric 'drawdown' (smaller is better) in the daily ranks and in the k-anonymous distributions.

-- ── 1. shares: kind 'proof' ──────────────────────────────────────────────────────────────────────────────────────

alter table public.shares drop constraint if exists shares_kind_check;
alter table public.shares add constraint shares_kind_check check (kind in ('trade', 'setup', 'stats', 'proof'));

alter table public.shares drop constraint if exists shares_payload_check;
alter table public.shares add constraint shares_payload_check
  check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= case when kind = 'proof' then 65536 else 16384 end);

-- ── 2. member_stats: drawdown + data class ───────────────────────────────────────────────────────────────────────

alter table public.member_stats
  add column if not exists max_dd_r numeric(7, 2) check (max_dd_r is null or max_dd_r >= 0),
  add column if not exists origin text check (origin is null or origin in ('api', 'csv', 'manual', 'auto', 'mixed'));

alter table public.leaderboard_snapshots
  add column if not exists dd numeric(7, 2) check (dd is null or dd >= 0),
  add column if not exists origin text check (origin is null or origin in ('api', 'csv', 'manual', 'auto', 'mixed'));

-- ── 3. the metric 'drawdown' ─────────────────────────────────────────────────────────────────────────────────────

alter table public.leaderboard_snapshots drop constraint if exists leaderboard_snapshots_metric_check;
alter table public.leaderboard_snapshots add constraint leaderboard_snapshots_metric_check
  check (metric in ('expectancy', 'discipline', 'consistency', 'drawdown'));

alter table public.community_stats drop constraint if exists community_stats_metric_check;
alter table public.community_stats add constraint community_stats_metric_check
  check (metric in ('expectancy', 'discipline', 'consistency', 'winrate', 'drawdown'));
