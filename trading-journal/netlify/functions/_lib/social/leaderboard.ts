/**
 * Rankings (P12, `social-leaderboard.mts`). Global: the newest nightly snapshot per metric, filtered by the opt-in AS IT
 * IS NOW (a withdrawal works at once) and re-ranked; the caller's own row is added when it is outside the top rows.
 * Group: live ranks of the members who share stats with the group (students of a mentor group see only the mentors and
 * themselves). Pseudonyms only, R and % only.
 */
import { metricValue, rankRows, type SocialMetric } from "../../../../src/social/metrics";
import type { CommunityDistribution, LeaderboardResponse, LeaderboardRow } from "../../../../src/social/contract";
import { dbFail, FALLBACK_NAME, isManager, membersOf, numOrNull, optedIn, pseudonymsOf, requireMember, sb, socialMe, statsOf } from "./store";

/** Rows shown at the top. */
export const TOP = 25;
/** Snapshot rows read per request. */
const READ = 1000;

interface SnapRow {
  user_id: string;
  rank: number;
  value: number | string;
  trades: number;
}

async function latestDay(metric: SocialMetric, before?: string): Promise<string | null> {
  let q = sb().from("leaderboard_snapshots").select("day").eq("metric", metric);
  if (before) q = q.lt("day", before);
  const { data, error } = await q.order("day", { ascending: false }).limit(1);
  if (error) dbFail("leaderboard_snapshots read", error);
  return ((data ?? []) as { day: string }[])[0]?.day ?? null;
}

async function snapshot(metric: SocialMetric, day: string): Promise<SnapRow[]> {
  const { data, error } = await sb().from("leaderboard_snapshots").select("user_id,rank,value,trades").eq("metric", metric).eq("day", day).order("rank", { ascending: true }).limit(READ);
  if (error) dbFail("leaderboard_snapshots read", error);
  return (data ?? []) as SnapRow[];
}

export async function communityDistributions(): Promise<CommunityDistribution[]> {
  const { data, error } = await sb().from("community_stats").select("day,metric,n,p10,p25,p50,p75,p90,mean").order("day", { ascending: false }).limit(16);
  if (error) dbFail("community_stats read", error);
  const out: CommunityDistribution[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const metric = r.metric as CommunityDistribution["metric"];
    if (out.some((d) => d.metric === metric)) continue;
    const n = (k: string) => numOrNull(r[k]) ?? 0;
    out.push({ metric, n: n("n"), p10: n("p10"), p25: n("p25"), p50: n("p50"), p75: n("p75"), p90: n("p90"), mean: n("mean") });
  }
  return out;
}

export async function globalLeaderboard(userId: string, metric: SocialMetric): Promise<LeaderboardResponse> {
  const [me, community, day] = await Promise.all([socialMe(userId), communityDistributions(), latestDay(metric)]);
  if (!day) return { metric, day: null, total: 0, rows: [], mine: null, community, me, group: null };
  const [snap, prevDay] = await Promise.all([snapshot(metric, day), latestDay(metric, day)]);
  const live = await optedIn(snap.map((r) => r.user_id));
  const kept = snap.filter((r) => live.has(r.user_id));
  const ranked = rankRows(kept.map((r) => ({ userId: r.user_id, value: numOrNull(r.value) ?? 0, trades: r.trades })));
  const prev = new Map<string, number>();
  if (prevDay) for (const r of await snapshot(metric, prevDay)) prev.set(r.user_id, r.rank);
  const mineIdx = ranked.findIndex((r) => r.userId === userId);
  const shown = ranked.slice(0, TOP);
  const names = await pseudonymsOf([...shown.map((r) => r.userId), ...(mineIdx >= TOP ? [userId] : [])]);
  const row = (r: (typeof ranked)[number]): LeaderboardRow => ({
    rank: r.rank,
    prevRank: prev.get(r.userId) ?? null,
    pseudonym: names.get(r.userId) ?? FALLBACK_NAME,
    value: r.value,
    trades: r.trades,
    me: r.userId === userId,
  });
  return {
    metric,
    day,
    total: ranked.length,
    rows: shown.map(row),
    mine: mineIdx >= TOP ? row(ranked[mineIdx]!) : null,
    community,
    me,
    group: null,
  };
}

export async function groupLeaderboard(userId: string, groupId: string, metric: SocialMetric): Promise<LeaderboardResponse> {
  const { group, me: membership } = await requireMember(groupId, userId);
  const members = await membersOf(groupId);
  const visible = group.kind === "mentor" && !isManager(membership.role) ? members.filter((m) => m.user_id === userId || isManager(m.role)) : members;
  const sharing = visible.filter((m) => m.share_level === "stats").map((m) => m.user_id);
  const [stats, me, community] = await Promise.all([statsOf(sharing), socialMe(userId), communityDistributions()]);
  const ranked = rankRows(
    [...stats.values()]
      .map((r) => ({ userId: r.user_id, trades: r.r_trades, value: metricValue({ expectancyR: numOrNull(r.expectancy_r), discipline: numOrNull(r.discipline), consistency: numOrNull(r.consistency), winRate: numOrNull(r.win_rate) }, metric) }))
      .filter((r): r is { userId: string; trades: number; value: number } => r.value != null),
  );
  const names = await pseudonymsOf(ranked.map((r) => r.userId));
  const newest = [...stats.values()].map((r) => r.computed_at).sort().pop() ?? null;
  return {
    metric,
    day: newest ? newest.slice(0, 10) : null,
    total: ranked.length,
    rows: ranked.slice(0, 100).map((r) => ({ rank: r.rank, prevRank: null, pseudonym: names.get(r.userId) ?? FALLBACK_NAME, value: r.value, trades: r.trades, me: r.userId === userId })),
    mine: null,
    community,
    me,
    group: { id: group.id, name: group.name },
  };
}
