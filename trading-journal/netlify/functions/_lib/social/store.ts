/**
 * Community data access (P12) for the functions – always called AFTER `requireUser`, with the verified user id (the
 * admin client bypasses RLS, so every query here filters by membership itself). Schema: supabase/migrations/0004.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOriginClass, socialStats, WINDOW_DAYS, type MetricTrade, type SocialStats } from "../../../../src/social/metrics";
import { pseudonymFrom } from "../../../../src/social/pseudonym";
import type { GroupKind, GroupRole, MemberFigures, ShareLevel, SocialMe } from "../../../../src/social/contract";
import { HttpError } from "../http";
import { supabaseAdmin } from "../supabase";

export const sb = (): SupabaseClient => supabaseAdmin();

export function dbFail(what: string, error: { code?: string } | null | undefined): never {
  console.error(`[fn] social ${what} failed`, error?.code ?? "");
  throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
}

/** Shown for a member whose pseudonym row is missing (never their e-mail). */
export const FALLBACK_NAME = "Mitglied";

/* ------------------------------------------------------------------ pseudonyms */

/** Random source of the pseudonyms (tests pin it). */
let bytes: (n: number) => ArrayLike<number> = (n) => randomBytes(n);
export function setPseudonymBytesForTests(fn: ((n: number) => ArrayLike<number>) | null): void {
  bytes = fn ?? ((n) => randomBytes(n));
}

/** The user's pseudonym, created on first use (unique; retried on a collision). */
export async function ensurePseudonym(userId: string): Promise<string> {
  const { data, error } = await sb().from("social_profiles").select("pseudonym").eq("user_id", userId).maybeSingle();
  if (error) dbFail("social_profiles read", error);
  const cur = (data as { pseudonym?: string } | null)?.pseudonym;
  if (cur) return cur;
  for (let i = 0; i < 6; i++) {
    const pseudonym = pseudonymFrom(bytes(4));
    const { error: e } = await sb().from("social_profiles").insert({ user_id: userId, pseudonym });
    if (!e) return pseudonym;
    if (e.code !== "23505") dbFail("social_profiles insert", e);
    // a concurrent first call of the same user won: take theirs
    const again = await sb().from("social_profiles").select("pseudonym").eq("user_id", userId).maybeSingle();
    const won = (again.data as { pseudonym?: string } | null)?.pseudonym;
    if (won) return won;
  }
  throw new HttpError(503, "pseudonym_busy", "Gerade ist kein Pseudonym frei – bitte gleich noch einmal.");
}

/** A new random pseudonym for the user. */
export async function rerollPseudonym(userId: string): Promise<string> {
  await ensurePseudonym(userId);
  for (let i = 0; i < 6; i++) {
    const pseudonym = pseudonymFrom(bytes(4));
    const { error } = await sb().from("social_profiles").update({ pseudonym }).eq("user_id", userId);
    if (!error) return pseudonym;
    if (error.code !== "23505") dbFail("social_profiles update", error);
  }
  throw new HttpError(503, "pseudonym_busy", "Gerade ist kein Pseudonym frei – bitte gleich noch einmal.");
}

/** Pseudonyms of several users (missing ones are absent from the map). */
export async function pseudonymsOf(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return out;
  const { data, error } = await sb().from("social_profiles").select("user_id,pseudonym").in("user_id", uniq);
  if (error) dbFail("social_profiles read", error);
  for (const r of (data ?? []) as { user_id: string; pseudonym: string }[]) out.set(r.user_id, r.pseudonym);
  return out;
}

/* ------------------------------------------------------------------ privacy opt-in (profiles.privacy.leaderboard) */

export async function optInOf(userId: string): Promise<boolean> {
  const { data, error } = await sb().from("profiles").select("privacy").eq("id", userId).maybeSingle();
  if (error) dbFail("profiles read", error);
  const p = (data as { privacy?: Record<string, unknown> } | null)?.privacy;
  return p?.leaderboard === true;
}

/** Sets the ranking opt-in (keeps the other privacy keys). Off also removes the user's snapshot rows at once. */
export async function setOptIn(userId: string, on: boolean): Promise<void> {
  const { data, error } = await sb().from("profiles").select("privacy").eq("id", userId).maybeSingle();
  if (error) dbFail("profiles read", error);
  const cur = ((data as { privacy?: Record<string, unknown> } | null)?.privacy ?? {}) as Record<string, unknown>;
  const { error: e } = await sb().from("profiles").update({ privacy: { ...cur, leaderboard: on } }).eq("id", userId);
  if (e) dbFail("profiles update", e);
  if (!on) {
    const { error: d } = await sb().from("leaderboard_snapshots").delete().eq("user_id", userId);
    if (d) dbFail("leaderboard_snapshots delete", d);
  }
}

/** Users among `ids` whose ranking opt-in is on right now. */
export async function optedIn(ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const { data, error } = await sb().from("profiles").select("id,privacy").in("id", uniq);
  if (error) dbFail("profiles read", error);
  for (const r of (data ?? []) as { id: string; privacy?: Record<string, unknown> | null }[]) if (r.privacy?.leaderboard === true) out.add(r.id);
  return out;
}

/* ------------------------------------------------------------------ figures (member_stats) */

export interface MemberStatsRow {
  user_id: string;
  computed_at: string;
  window_days: number;
  trades: number;
  r_trades: number;
  expectancy_r: number | string | null;
  win_rate: number | string | null;
  discipline: number | string | null;
  consistency: number | string | null;
  eligible: boolean;
  max_dd_r: number | string | null;
  origin: string | null;
}

/** numeric columns arrive as strings from PostgREST */
export const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function figuresOf(r: MemberStatsRow): MemberFigures {
  return {
    trades: r.trades,
    expectancyR: numOrNull(r.expectancy_r),
    winRate: numOrNull(r.win_rate),
    discipline: numOrNull(r.discipline),
    consistency: numOrNull(r.consistency),
    drawdownR: numOrNull(r.max_dd_r),
    origin: isOriginClass(r.origin) ? r.origin : null,
    computedAt: r.computed_at,
  };
}

const STATS_COLUMNS = "user_id,computed_at,window_days,trades,r_trades,expectancy_r,win_rate,discipline,consistency,eligible,max_dd_r,origin";

export async function statsOf(ids: readonly string[]): Promise<Map<string, MemberStatsRow>> {
  const out = new Map<string, MemberStatsRow>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const { data, error } = await sb().from("member_stats").select(STATS_COLUMNS).in("user_id", uniq);
  if (error) dbFail("member_stats read", error);
  for (const r of (data ?? []) as MemberStatsRow[]) out.set(r.user_id, r);
  return out;
}

/** The journal fields the figures read – nothing else of a trade is ever loaded (data minimisation). */
const TRADE_FIELDS = "r:data->r,status:data->>status,date:data->>date,followedPlan:data->followedPlan,mistakes:data->mistakes,origin:data->origin";
const PAGE = 1000;

/** The user's closed-or-open trades of the window from the synced journal (tombstones excluded). */
export async function windowTrades(userId: string, now: number, windowDays = WINDOW_DAYS): Promise<MetricTrade[]> {
  const fromDay = new Date(now - (windowDays + 1) * 86_400_000).toISOString().slice(0, 10);
  const out: MetricTrade[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb()
      .from("journal_docs")
      .select(TRADE_FIELDS)
      .eq("user_id", userId)
      .eq("kind", "trade")
      .eq("deleted", false)
      .gte("data->>date", fromDay)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) dbFail("journal_docs read", error);
    const rows = (data ?? []) as MetricTrade[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Computes and stores the user's figures (`member_stats`). */
export async function computeStats(userId: string, now: number = Date.now()): Promise<SocialStats> {
  const s = socialStats(await windowTrades(userId, now), now);
  const { error } = await sb()
    .from("member_stats")
    .upsert(
      {
        user_id: userId,
        computed_at: new Date(now).toISOString(),
        window_days: s.windowDays,
        trades: s.trades,
        r_trades: s.rTrades,
        expectancy_r: s.expectancyR,
        win_rate: s.winRate,
        discipline: s.discipline,
        consistency: s.consistency,
        eligible: s.eligible,
        max_dd_r: s.drawdownR,
        origin: s.origin,
      },
      { onConflict: "user_id" },
    );
  if (error) dbFail("member_stats write", error);
  return s;
}

/** What the community knows about the caller (pseudonym, opt-in, last figures). */
export async function socialMe(userId: string): Promise<SocialMe> {
  const [pseudonym, optIn, stats] = await Promise.all([ensurePseudonym(userId), optInOf(userId), statsOf([userId])]);
  const row = stats.get(userId);
  return { pseudonym, optIn, figures: row ? { ...figuresOf(row), eligible: row.eligible, rTrades: row.r_trades } : null };
}

/* ------------------------------------------------------------------ groups + membership */

export interface GroupRow {
  id: string;
  kind: GroupKind;
  name: string;
  description: string;
  owner_id: string;
  created_at: string;
}

export interface MemberRow {
  group_id: string;
  user_id: string;
  role: GroupRole;
  share_level: ShareLevel;
  joined_at: string;
}

export const GROUP_COLUMNS = "id,kind,name,description,owner_id,created_at";
export const MEMBER_COLUMNS = "group_id,user_id,role,share_level,joined_at";

const NOT_FOUND = () => new HttpError(404, "group_not_found", "Diese Gruppe gibt es nicht (mehr) – oder du bist kein Mitglied.");

export async function groupOf(id: string): Promise<GroupRow | null> {
  const { data, error } = await sb().from("groups").select(GROUP_COLUMNS).eq("id", id).maybeSingle();
  if (error) dbFail("groups read", error);
  return (data as GroupRow | null) ?? null;
}

export async function membershipOf(groupId: string, userId: string): Promise<MemberRow | null> {
  const { data, error } = await sb().from("group_members").select(MEMBER_COLUMNS).eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  if (error) dbFail("group_members read", error);
  return (data as MemberRow | null) ?? null;
}

/** The group and the caller's membership; 404 when the group is unknown OR the caller is not a member (no probing). */
export async function requireMember(groupId: string, userId: string): Promise<{ group: GroupRow; me: MemberRow }> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) throw NOT_FOUND();
  const [group, me] = await Promise.all([groupOf(groupId), membershipOf(groupId, userId)]);
  if (!group || !me) throw NOT_FOUND();
  return { group, me };
}

export const isManager = (role: GroupRole): boolean => role === "owner" || role === "mentor";

/** 403 unless the caller owns or mentors the group. */
export function requireManager(me: MemberRow): void {
  if (!isManager(me.role)) throw new HttpError(403, "not_manager", "Das dürfen nur Gruppen-Owner und Mentoren.");
}

export async function membersOf(groupId: string): Promise<MemberRow[]> {
  const { data, error } = await sb().from("group_members").select(MEMBER_COLUMNS).eq("group_id", groupId).order("joined_at", { ascending: true }).limit(1000);
  if (error) dbFail("group_members read", error);
  return (data ?? []) as MemberRow[];
}

/** Can `me` see reviews of `author` in `group` (mentor groups: only author + owner / mentors)? */
export function canSeeReview(group: Pick<GroupRow, "kind">, me: Pick<MemberRow, "user_id" | "role">, authorId: string): boolean {
  return group.kind !== "mentor" || authorId === me.user_id || isManager(me.role);
}
