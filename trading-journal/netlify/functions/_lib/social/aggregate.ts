/**
 * Nightly community aggregate (P12, `social-aggregate.mts`, `@daily`). ONLY opted-in users take part:
 * `social_candidates()` = ranking opt-in (`profiles.privacy.leaderboard`) or `share_level = 'stats'` in a group.
 *
 * 1. Figures per candidate from the synced journal (`member_stats`, R-based, last 90 days) – within a time budget;
 *    whoever is not reached keeps yesterday's figures (≤ 3 days old still count).
 * 2. Ranks per metric among eligible ranking opt-ins (≥ MIN_TRADES R trades) → `leaderboard_snapshots` of today
 *    (replaced, so a re-run is idempotent).
 * 3. Distributions per metric (`community_stats`) – only from K_ANON traders on (k-anonymity), rounded coarser.
 * 4. Snapshots older than `KEEP_DAYS` are purged.
 */
import { AGG_DECIMALS, metricValue, quantiles, rankRows, SOCIAL_METRICS, STAT_METRICS, type StatMetric } from "../../../../src/social/metrics";
import { computeStats, dbFail, numOrNull, sb, statsOf } from "./store";

export const KEEP_DAYS = 35;
/** Figures older than this do not rank (a user the job could not reach for days). */
export const STALE_DAYS = 3;
const PAGE = 500;

export interface AggregateResult {
  candidates: number;
  computed: number;
  failed: number;
  ranked: Record<string, number>;
  stats: StatMetric[];
  budgetHit: boolean;
}

export interface AggregateOptions {
  now?: number;
  /** ms for step 1 (default 20 s – the scheduled function has 30 s). */
  budgetMs?: number;
  /** clock for the budget (tests) */
  clock?: () => number;
}

interface Candidate {
  user_id: string;
  leaderboard: boolean;
}

async function candidates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await sb().rpc("social_candidates", { p_after: after, p_limit: PAGE });
    if (error) dbFail("social_candidates", error);
    const rows = (data ?? []) as Candidate[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1]!.user_id;
  }
}

export async function runSocialAggregate(opts: AggregateOptions = {}): Promise<AggregateResult> {
  const now = opts.now ?? Date.now();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? 20_000;
  const day = new Date(now).toISOString().slice(0, 10);
  const all = await candidates();
  const result: AggregateResult = { candidates: all.length, computed: 0, failed: 0, ranked: {}, stats: [], budgetHit: false };

  // 1. figures (one user failing never stops the others)
  for (const c of all) {
    if (clock() - started > budget) {
      result.budgetHit = true;
      break;
    }
    try {
      await computeStats(c.user_id, now);
      result.computed++;
    } catch (e) {
      result.failed++;
      console.error("[fn] social-aggregate user failed", e instanceof Error ? e.name : typeof e);
    }
  }

  // 2. ranks among eligible, fresh, opted-in users
  const ranking = all.filter((c) => c.leaderboard).map((c) => c.user_id);
  const stats = await statsOf(ranking);
  const freshFrom = now - STALE_DAYS * 86_400_000;
  const eligible = [...stats.values()].filter((r) => r.eligible && Date.parse(r.computed_at) >= freshFrom);
  const { error: delErr } = await sb().from("leaderboard_snapshots").delete().eq("day", day);
  if (delErr) dbFail("leaderboard_snapshots delete", delErr);
  for (const metric of SOCIAL_METRICS) {
    const rows = rankRows(
      eligible
        .map((r) => ({ userId: r.user_id, trades: r.r_trades, value: metricValue({ expectancyR: numOrNull(r.expectancy_r), discipline: numOrNull(r.discipline), consistency: numOrNull(r.consistency), winRate: numOrNull(r.win_rate) }, metric) }))
        .filter((r): r is { userId: string; trades: number; value: number } => r.value != null),
    );
    result.ranked[metric] = rows.length;
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE).map((r) => ({ day, metric, user_id: r.userId, rank: r.rank, value: r.value, trades: r.trades }));
      const { error } = await sb().from("leaderboard_snapshots").insert(chunk);
      if (error) dbFail("leaderboard_snapshots insert", error);
    }
  }

  // 3. k-anonymous distributions (ranking opt-ins only – they agreed to be compared)
  const { error: csDel } = await sb().from("community_stats").delete().eq("day", day);
  if (csDel) dbFail("community_stats delete", csDel);
  for (const metric of STAT_METRICS) {
    const values = eligible.map((r) => metricValue({ expectancyR: numOrNull(r.expectancy_r), discipline: numOrNull(r.discipline), consistency: numOrNull(r.consistency), winRate: numOrNull(r.win_rate) }, metric)).filter((v): v is number => v != null);
    const q = quantiles(values, AGG_DECIMALS[metric]);
    if (!q) continue;
    const { error } = await sb().from("community_stats").insert({ day, metric, ...q });
    if (error) dbFail("community_stats insert", error);
    result.stats.push(metric);
  }

  // 4. retention
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { error: purge } = await sb().from("leaderboard_snapshots").delete().lt("day", cutoff);
  if (purge) dbFail("leaderboard_snapshots purge", purge);
  const { error: purge2 } = await sb().from("community_stats").delete().lt("day", cutoff);
  if (purge2) dbFail("community_stats purge", purge2);
  return result;
}
