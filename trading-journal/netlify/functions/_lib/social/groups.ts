/**
 * Groups, mentoring and teams (P12) – the logic behind `social-groups.mts`. Every function takes the VERIFIED user id.
 *
 * Roles: `owner` (created the group; one per group) · `mentor` (may invite, review, propose goals) · `member` ·
 * `student` (mentor groups: sees only their own reviews and the mentors' answers). Team groups put every member on one
 * of the owner's Team-plan seats (`assignSeat` / `releaseSeat`, P10) – no free seat, no join.
 * Leaving (or being removed) deletes the leaver's reviews, comments and goals in that group.
 */
import { randomBytes } from "node:crypto";
import { K_ANON } from "../../../../src/social/metrics";
import type {
  CommentInfo,
  FeedResponse,
  GoalInfo,
  GroupAverages,
  GroupDetail,
  GroupKind,
  GroupSummary,
  InviteInfo,
  InvitePreview,
  MemberInfo,
  MentorGoalDraft,
  ReviewInfo,
  ShareLevel,
  SharedTrade,
} from "../../../../src/social/contract";
import { HttpError } from "../http";
import { requireFeature, requireLimit } from "../plan";
import { assignSeat, releaseSeat, seatUsage } from "../stripe";
import {
  canSeeReview,
  dbFail,
  ensurePseudonym,
  figuresOf,
  GROUP_COLUMNS,
  groupOf,
  isManager,
  membersOf,
  MEMBER_COLUMNS,
  pseudonymsOf,
  requireManager,
  requireMember,
  sb,
  socialMe,
  statsOf,
  FALLBACK_NAME,
  type GroupRow,
  type MemberRow,
} from "./store";

export const MAX_REVIEWS = 30;
export const MAX_COMMENTS = 50;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const name = (m: Map<string, string>, id: string) => m.get(id) ?? FALLBACK_NAME;

/* ------------------------------------------------------------------ list */

async function openReviewCounts(groups: GroupRow[], meRows: Map<string, MemberRow>, userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!groups.length) return out;
  const { data, error } = await sb()
    .from("group_reviews")
    .select("group_id,author_id")
    .in(
      "group_id",
      groups.map((g) => g.id),
    )
    .eq("status", "open")
    .limit(2000);
  if (error) dbFail("group_reviews read", error);
  for (const r of (data ?? []) as { group_id: string; author_id: string }[]) {
    const g = groups.find((x) => x.id === r.group_id);
    const me = meRows.get(r.group_id);
    if (g && me && canSeeReview(g, { user_id: userId, role: me.role }, r.author_id)) out.set(r.group_id, (out.get(r.group_id) ?? 0) + 1);
  }
  return out;
}

function summaryOf(g: GroupRow, me: MemberRow, members: number, open: number): GroupSummary {
  return { id: g.id, kind: g.kind, name: g.name, description: g.description, role: me.role, members, openReviews: open, createdAt: g.created_at };
}

export async function listGroups(userId: string): Promise<{ groups: GroupSummary[]; goals: GoalInfo[] }> {
  const { data: mine, error } = await sb().from("group_members").select(MEMBER_COLUMNS).eq("user_id", userId).limit(200);
  if (error) dbFail("group_members read", error);
  const meRows = new Map(((mine ?? []) as MemberRow[]).map((m) => [m.group_id, m]));
  if (!meRows.size) return { groups: [], goals: [] };
  const ids = [...meRows.keys()];
  const { data: gData, error: gErr } = await sb().from("groups").select(GROUP_COLUMNS).in("id", ids);
  if (gErr) dbFail("groups read", gErr);
  const groups = ((gData ?? []) as GroupRow[]).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const { data: all, error: mErr } = await sb().from("group_members").select("group_id").in("group_id", ids).limit(5000);
  if (mErr) dbFail("group_members read", mErr);
  const counts = new Map<string, number>();
  for (const r of (all ?? []) as { group_id: string }[]) counts.set(r.group_id, (counts.get(r.group_id) ?? 0) + 1);
  const open = await openReviewCounts(groups, meRows, userId);
  return {
    groups: groups.map((g) => summaryOf(g, meRows.get(g.id)!, counts.get(g.id) ?? 1, open.get(g.id) ?? 0)),
    goals: await goalsFor(userId, groups),
  };
}

export async function groupsResponse(userId: string) {
  const [me, list] = await Promise.all([socialMe(userId), listGroups(userId)]);
  return { me, ...list };
}

/* ------------------------------------------------------------------ create / delete */

export async function createGroup(userId: string, body: { kind: GroupKind; name: string; description: string }): Promise<GroupSummary> {
  await requireFeature(userId, body.kind === "mentor" ? "mentor" : "community");
  const { count, error: cErr } = await sb().from("groups").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if (cErr) dbFail("groups count", cErr);
  await requireLimit(userId, "groups", count ?? 0);
  if (body.kind === "team") {
    const usage = await seatUsage(userId);
    if (usage.seats === 0) throw new HttpError(402, "plan_required", "Ein Team braucht den Team-Tarif mit Sitzplätzen.");
    const { count: teams } = await sb().from("groups").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("kind", "team");
    if ((teams ?? 0) > 0) throw new HttpError(409, "team_exists", "Du hast schon ein Team – die Sitzplätze gehören zu genau einem Team.");
  }
  await ensurePseudonym(userId);
  const { data, error } = await sb().from("groups").insert({ kind: body.kind, name: body.name, description: body.description, owner_id: userId }).select(GROUP_COLUMNS).single();
  if (error || !data) dbFail("groups insert", error);
  const g = data as GroupRow;
  const { error: mErr } = await sb().from("group_members").insert({ group_id: g.id, user_id: userId, role: "owner", share_level: "none" });
  if (mErr) {
    await sb().from("groups").delete().eq("id", g.id);
    dbFail("group_members insert", mErr);
  }
  return summaryOf(g, { group_id: g.id, user_id: userId, role: "owner", share_level: "none", joined_at: g.created_at }, 1, 0);
}

export async function deleteGroup(userId: string, groupId: string): Promise<void> {
  const { group, me } = await requireMember(groupId, userId);
  if (me.role !== "owner") throw new HttpError(403, "not_owner", "Nur der Owner kann die Gruppe löschen.");
  if (group.kind === "team") for (const m of await membersOf(groupId)) if (m.user_id !== userId) await releaseSeat(userId, m.user_id);
  const { error } = await sb().from("groups").delete().eq("id", groupId);
  if (error) dbFail("groups delete", error);
}

/* ------------------------------------------------------------------ detail + feed */

function averagesOf(rows: { expectancyR: number | null; discipline: number | null; consistency: number | null }[]): GroupAverages | null {
  if (rows.length < K_ANON) return null;
  const avg = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null);
    return v.length >= K_ANON ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  };
  return { n: rows.length, expectancyR: avg(rows.map((r) => r.expectancyR)), discipline: avg(rows.map((r) => r.discipline)), consistency: avg(rows.map((r) => r.consistency)) };
}

async function invitesOf(groupId: string, now: number): Promise<InviteInfo[]> {
  const { data, error } = await sb().from("group_invites").select("code,role,uses,max_uses,expires_at").eq("group_id", groupId).order("created_at", { ascending: false }).limit(20);
  if (error) dbFail("group_invites read", error);
  return ((data ?? []) as { code: string; role: InviteInfo["role"]; uses: number; max_uses: number; expires_at: string }[])
    .filter((i) => Date.parse(i.expires_at) > now && i.uses < i.max_uses)
    .map((i) => ({ code: i.code, role: i.role, uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at }));
}

export async function groupDetail(userId: string, groupId: string, now = Date.now()): Promise<GroupDetail> {
  const { group, me } = await requireMember(groupId, userId);
  const members = await membersOf(groupId);
  // in mentor groups students see the mentors and themselves – not the other students
  const visible = group.kind === "mentor" && !isManager(me.role) ? members.filter((m) => m.user_id === userId || isManager(m.role)) : members;
  const names = await pseudonymsOf(visible.map((m) => m.user_id));
  const sharing = visible.filter((m) => m.share_level === "stats").map((m) => m.user_id);
  const stats = await statsOf(sharing);
  let seatIds = new Set<string>();
  let seats: GroupDetail["seats"] = null;
  if (group.kind === "team") {
    const { data, error } = await sb().from("team_seats").select("member_id").eq("owner_id", group.owner_id).limit(1000);
    if (error) dbFail("team_seats read", error);
    seatIds = new Set(((data ?? []) as { member_id: string }[]).map((r) => r.member_id));
    if (me.role === "owner") seats = await seatUsage(userId);
  }
  const memberList: MemberInfo[] = visible.map((m) => {
    const st = m.share_level === "stats" ? stats.get(m.user_id) : undefined;
    return {
      id: m.user_id,
      pseudonym: name(names, m.user_id),
      role: m.role,
      shareLevel: m.share_level,
      joinedAt: m.joined_at,
      me: m.user_id === userId,
      figures: st ? figuresOf(st) : null,
      ...(group.kind === "team" ? { seat: m.role === "owner" || seatIds.has(m.user_id) } : {}),
    };
  });
  const sharedFigures = memberList.filter((m) => m.figures).map((m) => m.figures!);
  const counts = await openReviewCounts([group], new Map([[groupId, me]]), userId);
  return {
    ...summaryOf(group, me, members.length, counts.get(groupId) ?? 0),
    ownerId: group.owner_id,
    shareLevel: me.share_level,
    memberList,
    invites: isManager(me.role) ? await invitesOf(groupId, now) : [],
    averages: averagesOf(sharedFigures),
    seats,
  };
}

interface ReviewRow {
  id: string;
  group_id: string;
  author_id: string;
  payload: SharedTrade;
  question: string;
  status: "open" | "done";
  reviewed_by: string | null;
  created_at: string;
}
interface CommentRow {
  id: string;
  review_id: string;
  author_id: string;
  body: string;
  mentions: string[] | null;
  hidden: boolean;
  created_at: string;
}

export async function feed(userId: string, groupId: string, now = Date.now()): Promise<FeedResponse> {
  const detail = await groupDetail(userId, groupId, now);
  const me = { user_id: userId, role: detail.role };
  const { data, error } = await sb()
    .from("group_reviews")
    .select("id,group_id,author_id,payload,question,status,reviewed_by,created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(MAX_REVIEWS * 3);
  if (error) dbFail("group_reviews read", error);
  const reviews = ((data ?? []) as ReviewRow[]).filter((r) => canSeeReview(detail, me, r.author_id)).slice(0, MAX_REVIEWS);
  let comments: CommentRow[] = [];
  if (reviews.length) {
    const { data: c, error: cErr } = await sb()
      .from("comments")
      .select("id,review_id,author_id,body,mentions,hidden,created_at")
      .in(
        "review_id",
        reviews.map((r) => r.id),
      )
      .order("created_at", { ascending: true })
      .limit(MAX_REVIEWS * MAX_COMMENTS);
    if (cErr) dbFail("comments read", cErr);
    comments = (c ?? []) as CommentRow[];
  }
  const names = await pseudonymsOf([...reviews.map((r) => r.author_id), ...reviews.map((r) => r.reviewed_by ?? ""), ...comments.map((c) => c.author_id)]);
  const manager = isManager(detail.role);
  return {
    group: detail,
    reviews: reviews.map(
      (r): ReviewInfo => ({
        id: r.id,
        groupId: r.group_id,
        author: name(names, r.author_id),
        authorId: r.author_id,
        me: r.author_id === userId,
        payload: r.payload,
        question: r.question,
        status: r.status,
        reviewedBy: r.reviewed_by ? name(names, r.reviewed_by) : null,
        createdAt: r.created_at,
        comments: comments
          .filter((c) => c.review_id === r.id && (!c.hidden || c.author_id === userId || manager))
          .map(
            (c): CommentInfo => ({
              id: c.id,
              author: name(names, c.author_id),
              authorId: c.author_id,
              me: c.author_id === userId,
              body: c.body,
              mentionsMe: (c.mentions ?? []).includes(userId),
              hidden: c.hidden,
              createdAt: c.created_at,
            }),
          ),
      }),
    ),
  };
}

/* ------------------------------------------------------------------ invites + join */

export function inviteCode(): string {
  const b = randomBytes(10);
  return Array.from(b, (x) => INVITE_ALPHABET[x % INVITE_ALPHABET.length]).join("");
}

export async function createInvite(userId: string, groupId: string, body: { role: InviteInfo["role"]; maxUses: number; days: number }, now = Date.now()): Promise<InviteInfo> {
  const { group, me } = await requireMember(groupId, userId);
  requireManager(me);
  const allowed: Record<GroupKind, InviteInfo["role"][]> = { group: ["member"], team: ["member"], mentor: me.role === "owner" ? ["student", "mentor"] : ["student"] };
  if (!allowed[group.kind].includes(body.role)) throw new HttpError(422, "invalid_role", "Diese Rolle passt nicht zu dieser Gruppe.");
  const expiresAt = new Date(now + body.days * 86_400_000).toISOString();
  for (let i = 0; i < 4; i++) {
    const code = inviteCode();
    const { error } = await sb().from("group_invites").insert({ code, group_id: groupId, role: body.role, created_by: userId, max_uses: body.maxUses, expires_at: expiresAt });
    if (!error) return { code, role: body.role, uses: 0, maxUses: body.maxUses, expiresAt };
    if (error.code !== "23505") dbFail("group_invites insert", error);
  }
  throw new HttpError(503, "invite_busy", "Bitte noch einmal versuchen.");
}

export async function revokeInvite(userId: string, groupId: string, code: string): Promise<void> {
  const { me } = await requireMember(groupId, userId);
  requireManager(me);
  const { error } = await sb().from("group_invites").delete().eq("group_id", groupId).eq("code", code);
  if (error) dbFail("group_invites delete", error);
}

interface InviteRow {
  code: string;
  group_id: string;
  role: InviteInfo["role"];
  uses: number;
  max_uses: number;
  expires_at: string;
}

const INVALID_INVITE = () => new HttpError(404, "invite_invalid", "Diese Einladung ist abgelaufen oder ungültig.");

async function validInvite(code: string, now: number): Promise<{ inv: InviteRow; group: GroupRow }> {
  if (!/^[A-Z0-9]{10}$/.test(code)) throw INVALID_INVITE();
  const { data, error } = await sb().from("group_invites").select("code,group_id,role,uses,max_uses,expires_at").eq("code", code).maybeSingle();
  if (error) dbFail("group_invites read", error);
  const inv = data as InviteRow | null;
  if (!inv || Date.parse(inv.expires_at) <= now || inv.uses >= inv.max_uses) throw INVALID_INVITE();
  const group = await groupOf(inv.group_id);
  if (!group) throw INVALID_INVITE();
  return { inv, group };
}

export async function previewInvite(userId: string, code: string, now = Date.now()): Promise<InvitePreview> {
  const { inv, group } = await validInvite(code, now);
  const { count } = await sb().from("group_members").select("user_id", { count: "exact", head: true }).eq("group_id", group.id);
  const { data: mine } = await sb().from("group_members").select("user_id").eq("group_id", group.id).eq("user_id", userId).maybeSingle();
  return { code, groupName: group.name, kind: group.kind, role: inv.role, members: count ?? 0, member: !!mine };
}

export async function joinGroup(userId: string, code: string, shareLevel: ShareLevel, now = Date.now()): Promise<GroupSummary> {
  await requireFeature(userId, "community");
  const { inv, group } = await validInvite(code, now);
  const existing = await sb().from("group_members").select(MEMBER_COLUMNS).eq("group_id", group.id).eq("user_id", userId).maybeSingle();
  if (existing.error) dbFail("group_members read", existing.error);
  const already = existing.data as MemberRow | null;
  if (already) return summaryOf(group, already, 0, 0);
  await ensurePseudonym(userId);
  // claim one use first (compare-and-set on `uses`): concurrent joins can never push an invite past `max_uses`
  const claim = await sb().from("group_invites").update({ uses: inv.uses + 1 }).eq("code", inv.code).eq("uses", inv.uses).select("code");
  if (claim.error) dbFail("group_invites claim", claim.error);
  if (!((claim.data ?? []) as unknown[]).length) throw new HttpError(409, "invite_busy", "Die Einladung wurde gerade benutzt – bitte noch einmal versuchen.");
  const unclaim = () =>
    sb()
      .from("group_invites")
      .update({ uses: inv.uses })
      .eq("code", inv.code)
      .eq("uses", inv.uses + 1)
      .then(({ error: e }) => e && console.error("[fn] invite unclaim failed", e.code));
  try {
    if (group.kind === "team") await assignSeat(group.owner_id, userId); // 409 no_seats / 402 without Team plan → no join
  } catch (e) {
    await unclaim();
    throw e;
  }
  const { error } = await sb().from("group_members").insert({ group_id: group.id, user_id: userId, role: inv.role, share_level: shareLevel });
  if (error) {
    if (group.kind === "team") await releaseSeat(group.owner_id, userId).catch(() => undefined);
    await unclaim();
    if (error.code === "23505") throw new HttpError(409, "already_member", "Du bist schon Mitglied.");
    dbFail("group_members insert", error);
  }
  const me: MemberRow = { group_id: group.id, user_id: userId, role: inv.role, share_level: shareLevel, joined_at: new Date(now).toISOString() };
  const { count } = await sb().from("group_members").select("user_id", { count: "exact", head: true }).eq("group_id", group.id);
  return summaryOf(group, me, count ?? 1, 0);
}

/* ------------------------------------------------------------------ members */

/** Removes a member and everything they posted in the group (reviews, comments, goals); team seat released. */
async function dropMember(group: GroupRow, memberId: string): Promise<void> {
  const { data: revs, error: rErr } = await sb().from("group_reviews").select("id").eq("group_id", group.id).limit(5000);
  if (rErr) dbFail("group_reviews read", rErr);
  const reviewIds = ((revs ?? []) as { id: string }[]).map((r) => r.id);
  if (reviewIds.length) {
    const { error } = await sb().from("comments").delete().in("review_id", reviewIds).eq("author_id", memberId);
    if (error) dbFail("comments delete", error);
  }
  for (const [table, col] of [
    ["group_reviews", "author_id"],
    ["group_goals", "student_id"],
    ["group_goals", "mentor_id"],
  ] as const) {
    const { error } = await sb().from(table).delete().eq("group_id", group.id).eq(col, memberId);
    if (error) dbFail(`${table} delete`, error);
  }
  const { error } = await sb().from("group_members").delete().eq("group_id", group.id).eq("user_id", memberId);
  if (error) dbFail("group_members delete", error);
  if (group.kind === "team") await releaseSeat(group.owner_id, memberId);
}

export async function removeMember(userId: string, groupId: string, memberId: string): Promise<{ left: boolean }> {
  const { group, me } = await requireMember(groupId, userId);
  if (memberId === userId) {
    if (me.role === "owner") throw new HttpError(409, "owner_cannot_leave", "Als Owner kannst du nicht austreten – lösche die Gruppe stattdessen.");
    await dropMember(group, userId);
    return { left: true };
  }
  requireManager(me);
  const target = await sb().from("group_members").select(MEMBER_COLUMNS).eq("group_id", groupId).eq("user_id", memberId).maybeSingle();
  if (target.error) dbFail("group_members read", target.error);
  const t = target.data as MemberRow | null;
  if (!t) throw new HttpError(404, "member_not_found", "Dieses Mitglied gibt es in der Gruppe nicht.");
  if (t.role === "owner" || (me.role === "mentor" && t.role !== "student")) throw new HttpError(403, "not_allowed", "Das darfst du nicht.");
  await dropMember(group, memberId);
  return { left: false };
}

export async function patchMember(userId: string, groupId: string, memberId: string, body: { role?: "mentor" | "member" | "student"; shareLevel?: ShareLevel }): Promise<void> {
  const { group, me } = await requireMember(groupId, userId);
  if (body.shareLevel !== undefined) {
    if (memberId !== userId) throw new HttpError(403, "not_allowed", "Was du teilst, entscheidet nur jede:r selbst.");
    const { error } = await sb().from("group_members").update({ share_level: body.shareLevel }).eq("group_id", groupId).eq("user_id", userId);
    if (error) dbFail("group_members update", error);
  }
  if (body.role !== undefined) {
    if (me.role !== "owner" || memberId === userId) throw new HttpError(403, "not_allowed", "Rollen vergibt nur der Owner.");
    const allowed = group.kind === "mentor" ? ["mentor", "student"] : ["member"];
    if (!allowed.includes(body.role)) throw new HttpError(422, "invalid_role", "Diese Rolle passt nicht zu dieser Gruppe.");
    const { data, error } = await sb().from("group_members").update({ role: body.role }).eq("group_id", groupId).eq("user_id", memberId).neq("role", "owner").select("user_id");
    if (error) dbFail("group_members update", error);
    if (!((data ?? []) as unknown[]).length) throw new HttpError(404, "member_not_found", "Dieses Mitglied gibt es in der Gruppe nicht.");
  }
}

/* ------------------------------------------------------------------ reviews + comments */

export async function postReview(userId: string, groupId: string, payload: SharedTrade, question: string): Promise<{ id: string }> {
  await requireMember(groupId, userId);
  const { data, error } = await sb().from("group_reviews").insert({ group_id: groupId, author_id: userId, payload, question }).select("id").single();
  if (error || !data) dbFail("group_reviews insert", error);
  return { id: (data as { id: string }).id };
}

async function reviewIn(groupId: string, reviewId: string): Promise<ReviewRow> {
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new HttpError(404, "review_not_found", "Dieses Review gibt es nicht (mehr).");
  const { data, error } = await sb().from("group_reviews").select("id,group_id,author_id,payload,question,status,reviewed_by,created_at").eq("id", reviewId).eq("group_id", groupId).maybeSingle();
  if (error) dbFail("group_reviews read", error);
  if (!data) throw new HttpError(404, "review_not_found", "Dieses Review gibt es nicht (mehr).");
  return data as ReviewRow;
}

async function visibleReview(userId: string, groupId: string, reviewId: string) {
  const { group, me } = await requireMember(groupId, userId);
  const review = await reviewIn(groupId, reviewId);
  if (!canSeeReview(group, me, review.author_id)) throw new HttpError(404, "review_not_found", "Dieses Review gibt es nicht (mehr).");
  return { group, me, review };
}

export async function setReviewStatus(userId: string, groupId: string, reviewId: string, status: "open" | "done", now = Date.now()): Promise<void> {
  const { me, review } = await visibleReview(userId, groupId, reviewId);
  if (review.author_id !== userId && !isManager(me.role)) throw new HttpError(403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
  const patch = status === "done" ? { status, reviewed_by: userId, reviewed_at: new Date(now).toISOString() } : { status, reviewed_by: null, reviewed_at: null };
  const { error } = await sb().from("group_reviews").update(patch).eq("id", reviewId);
  if (error) dbFail("group_reviews update", error);
}

export async function deleteReview(userId: string, groupId: string, reviewId: string): Promise<void> {
  const { me, review } = await visibleReview(userId, groupId, reviewId);
  if (review.author_id !== userId && !isManager(me.role)) throw new HttpError(403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
  const { error } = await sb().from("group_reviews").delete().eq("id", reviewId);
  if (error) dbFail("group_reviews delete", error);
}

/** Members mentioned as `@Pseudonym` in `body` (visible members only, max 10). */
export function mentionsIn(body: string, members: { id: string; pseudonym: string }[]): string[] {
  const text = body.toLocaleLowerCase("de-DE");
  const out: string[] = [];
  for (const m of [...members].sort((a, b) => b.pseudonym.length - a.pseudonym.length)) {
    if (text.includes(`@${m.pseudonym.toLocaleLowerCase("de-DE")}`) && !out.includes(m.id)) out.push(m.id);
    if (out.length >= 10) break;
  }
  return out;
}

export async function postComment(userId: string, groupId: string, reviewId: string, body: string): Promise<CommentInfo> {
  const { group, review } = await visibleReview(userId, groupId, reviewId);
  const { count } = await sb().from("comments").select("id", { count: "exact", head: true }).eq("review_id", reviewId);
  if ((count ?? 0) >= MAX_COMMENTS) throw new HttpError(409, "thread_full", "Dieser Thread ist voll.");
  const members = await membersOf(groupId);
  // only people who can see the review can be mentioned
  const reachable = members.filter((m) => canSeeReview(group, m, review.author_id));
  const names = await pseudonymsOf(reachable.map((m) => m.user_id));
  const mentions = mentionsIn(
    body,
    reachable.filter((m) => m.user_id !== userId && names.has(m.user_id)).map((m) => ({ id: m.user_id, pseudonym: names.get(m.user_id)! })),
  );
  const { data, error } = await sb().from("comments").insert({ review_id: reviewId, author_id: userId, body, mentions }).select("id,created_at").single();
  if (error || !data) dbFail("comments insert", error);
  const row = data as { id: string; created_at: string };
  return { id: row.id, author: names.get(userId) ?? (await ensurePseudonym(userId)), authorId: userId, me: true, body, mentionsMe: false, hidden: false, createdAt: row.created_at };
}

export async function deleteComment(userId: string, groupId: string, reviewId: string, commentId: string): Promise<void> {
  const { me } = await visibleReview(userId, groupId, reviewId);
  const { data, error } = await sb().from("comments").select("id,author_id").eq("id", commentId).eq("review_id", reviewId).maybeSingle();
  if (error) dbFail("comments read", error);
  const c = data as { id: string; author_id: string } | null;
  if (!c) throw new HttpError(404, "comment_not_found", "Diesen Kommentar gibt es nicht (mehr).");
  if (c.author_id !== userId && !isManager(me.role)) throw new HttpError(403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
  const { error: dErr } = await sb().from("comments").delete().eq("id", commentId);
  if (dErr) dbFail("comments delete", dErr);
}

/* ------------------------------------------------------------------ mentor goals */

interface GoalRow {
  id: string;
  group_id: string;
  mentor_id: string;
  student_id: string;
  draft: MentorGoalDraft;
  status: GoalInfo["status"];
  created_at: string;
}

async function goalsFor(userId: string, groups: GroupRow[]): Promise<GoalInfo[]> {
  const ids = groups.filter((g) => g.kind === "mentor").map((g) => g.id);
  if (!ids.length) return [];
  const { data, error } = await sb().from("group_goals").select("id,group_id,mentor_id,student_id,draft,status,created_at").in("group_id", ids).order("created_at", { ascending: false }).limit(200);
  if (error) dbFail("group_goals read", error);
  const rows = ((data ?? []) as GoalRow[]).filter((g) => g.student_id === userId || g.mentor_id === userId);
  const names = await pseudonymsOf(rows.flatMap((g) => [g.mentor_id, g.student_id]));
  return rows.map((g) => ({
    id: g.id,
    groupId: g.group_id,
    groupName: groups.find((x) => x.id === g.group_id)?.name ?? "",
    mentor: name(names, g.mentor_id),
    student: name(names, g.student_id),
    studentId: g.student_id,
    draft: g.draft,
    status: g.status,
    createdAt: g.created_at,
    mine: g.student_id === userId,
  }));
}

export async function proposeGoal(userId: string, groupId: string, studentId: string, draft: MentorGoalDraft): Promise<{ id: string }> {
  const { group, me } = await requireMember(groupId, userId);
  if (group.kind !== "mentor") throw new HttpError(422, "not_mentor_group", "Ziele vergeben nur Mentoren in Mentor-Gruppen.");
  requireManager(me);
  await requireFeature(userId, "mentor");
  const student = await sb().from("group_members").select("role").eq("group_id", groupId).eq("user_id", studentId).maybeSingle();
  if (student.error) dbFail("group_members read", student.error);
  if ((student.data as { role?: string } | null)?.role !== "student") throw new HttpError(404, "student_not_found", "Diese Person ist hier nicht Schüler:in.");
  const { count } = await sb().from("group_goals").select("id", { count: "exact", head: true }).eq("group_id", groupId).eq("student_id", studentId).eq("status", "open");
  if ((count ?? 0) >= 10) throw new HttpError(409, "too_many_goals", "Es sind schon 10 offene Ziele vorgeschlagen.");
  const { data, error } = await sb().from("group_goals").insert({ group_id: groupId, mentor_id: userId, student_id: studentId, draft }).select("id").single();
  if (error || !data) dbFail("group_goals insert", error);
  return { id: (data as { id: string }).id };
}

export async function answerGoal(userId: string, groupId: string, goalId: string, status: "accepted" | "declined"): Promise<void> {
  await requireMember(groupId, userId);
  const { data, error } = await sb().from("group_goals").update({ status }).eq("id", goalId).eq("group_id", groupId).eq("student_id", userId).eq("status", "open").select("id");
  if (error) dbFail("group_goals update", error);
  if (!((data ?? []) as unknown[]).length) throw new HttpError(404, "goal_not_found", "Dieses Ziel ist schon beantwortet oder nicht für dich.");
}
