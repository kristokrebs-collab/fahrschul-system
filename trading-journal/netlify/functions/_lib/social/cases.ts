/**
 * Chartfälle mit Hypothese vorab (F47) – the logic behind the case routes of `social-groups.mts`. Every function takes the
 * VERIFIED user id; the admin client bypasses RLS, so the visibility rules of migration 0010 are repeated here.
 *
 * A case is public market data (symbol, candle size, the last candle everybody sees, the horizon in candles) and a
 * question. Everybody writes ONE hypothesis; it is stamped by the database, cannot be changed, and stays hidden from the
 * others until the case is closed (`closed_at` set by the author / a mentor, or `closes_at` passed). Mentor groups: only
 * owners and mentors post cases; a student sees the mentors' hypotheses and their own, never another student's. The
 * outcome is never stored – readers work it out from the public candles.
 */
import {
  CASE_INTERVAL_MS,
  type CaseInfo,
  type CaseInterval,
  type CreateCaseBody,
  type HypothesisInfo,
  type HypothesisRequest,
} from "../../../../src/social/contract";
import { isMissingTable } from "../account";
import { HttpError } from "../http";
import {
  dbFail,
  ensurePseudonym,
  FALLBACK_NAME,
  isManager,
  membersOf,
  pseudonymsOf,
  requireManager,
  requireMember,
  sb,
  type GroupRow,
  type MemberRow,
} from "./store";

/** Cases shown per group (newest first). */
export const MAX_CASES = 20;
/** Open (not yet closed) cases one person may have at a time. */
export const MAX_OPEN_CASES = 10;

interface CaseRow {
  id: string;
  group_id: string;
  author_id: string;
  pair: string;
  interval: CaseInterval;
  anchor_ms: number | string;
  horizon: number;
  question: string;
  closes_at: string;
  closed_at: string | null;
  created_at: string;
}
interface HypRow {
  case_id: string;
  user_id: string;
  direction: HypothesisInfo["direction"];
  confidence: number;
  reason: string;
  created_at: string;
}

const COLUMNS = "id,group_id,author_id,pair,interval,anchor_ms,horizon,question,closes_at,closed_at,created_at";
const NOT_FOUND = () => new HttpError(404, "case_not_found", "Diesen Chartfall gibt es nicht (mehr).");
const name = (m: Map<string, string>, id: string) => m.get(id) ?? FALLBACK_NAME;
const NOT_READY = () => new HttpError(503, "cases_not_ready", "Chartfälle sind auf diesem Server noch nicht eingerichtet.");

export const isClosed = (c: Pick<CaseRow, "closed_at" | "closes_at">, now: number): boolean => c.closed_at != null || Date.parse(c.closes_at) <= now;

/** The cases of a group as `userId` may see them (hypotheses of others only once the case is closed). */
export async function casesOf(userId: string, group: Pick<GroupRow, "id" | "kind">, myRole: MemberRow["role"], now = Date.now()): Promise<CaseInfo[]> {
  const { data, error } = await sb().from("group_cases").select(COLUMNS).eq("group_id", group.id).order("created_at", { ascending: false }).limit(MAX_CASES);
  if (error) {
    if (isMissingTable(error)) return []; // migration 0010 not run yet: the group works, the cases are simply not there
    dbFail("group_cases read", error);
  }
  const cases = (data ?? []) as CaseRow[];
  if (!cases.length) return [];
  const { data: hData, error: hErr } = await sb()
    .from("case_hypotheses")
    .select("case_id,user_id,direction,confidence,reason,created_at")
    .in(
      "case_id",
      cases.map((c) => c.id),
    )
    .order("created_at", { ascending: true })
    .limit(MAX_CASES * 200);
  if (hErr) dbFail("case_hypotheses read", hErr);
  const hyps = (hData ?? []) as HypRow[];
  const members = await membersOf(group.id);
  const roleOf = new Map(members.map((m) => [m.user_id, m.role]));
  const names = await pseudonymsOf([...cases.map((c) => c.author_id), ...hyps.map((h) => h.user_id)]);
  const info = (h: HypRow): HypothesisInfo => ({ author: name(names, h.user_id), authorId: h.user_id, me: h.user_id === userId, direction: h.direction, confidence: h.confidence, reason: h.reason, createdAt: h.created_at });
  return cases.map((c): CaseInfo => {
    const closed = isClosed(c, now);
    const mine = hyps.find((h) => h.case_id === c.id && h.user_id === userId);
    const others = hyps.filter((h) => {
      if (h.case_id !== c.id || h.user_id === userId || !closed) return false;
      // mentor groups: a student reads the mentors' hypotheses and their own – never another student's
      return group.kind !== "mentor" || isManager(myRole) || isManager(roleOf.get(h.user_id) ?? "member");
    });
    return {
      id: c.id,
      groupId: c.group_id,
      author: name(names, c.author_id),
      authorId: c.author_id,
      me: c.author_id === userId,
      pair: c.pair,
      interval: c.interval,
      anchorMs: Number(c.anchor_ms),
      horizon: c.horizon,
      question: c.question,
      closesAt: c.closes_at,
      closed,
      createdAt: c.created_at,
      hypotheses: hyps.filter((h) => h.case_id === c.id).length,
      mine: mine ? info(mine) : null,
      revealed: others.map(info),
    };
  });
}

async function caseIn(groupId: string, caseId: string): Promise<CaseRow> {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) throw NOT_FOUND();
  const { data, error } = await sb().from("group_cases").select(COLUMNS).eq("id", caseId).eq("group_id", groupId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw NOT_READY();
    dbFail("group_cases read", error);
  }
  if (!data) throw NOT_FOUND();
  return data as CaseRow;
}

export async function postCase(userId: string, groupId: string, body: CreateCaseBody, now = Date.now()): Promise<{ id: string }> {
  const { group, me } = await requireMember(groupId, userId);
  if (group.kind === "mentor") requireManager(me);
  const iv = CASE_INTERVAL_MS[body.interval];
  if (body.anchorMs % iv !== 0) throw new HttpError(422, "anchor_off_grid", "Die Kerze liegt nicht auf dem Raster der Börse.");
  if (body.anchorMs + iv > now) throw new HttpError(422, "anchor_not_closed", "Die letzte sichtbare Kerze muss schon geschlossen sein.");
  const { count, error: cErr } = await sb().from("group_cases").select("id", { count: "exact", head: true }).eq("author_id", userId).eq("group_id", groupId).is("closed_at", null).gt("closes_at", new Date(now).toISOString());
  if (cErr) {
    if (isMissingTable(cErr)) throw NOT_READY();
    dbFail("group_cases count", cErr);
  }
  if ((count ?? 0) >= MAX_OPEN_CASES) throw new HttpError(409, "too_many_cases", `Du hast schon ${MAX_OPEN_CASES} offene Chartfälle – schließe einen, dann geht es weiter.`);
  await ensurePseudonym(userId);
  const row = {
    group_id: groupId,
    author_id: userId,
    pair: body.pair,
    interval: body.interval,
    anchor_ms: body.anchorMs,
    horizon: body.horizon,
    question: body.question,
    closes_at: new Date(now + body.openHours * 3_600_000).toISOString(),
  };
  const { data, error } = await sb().from("group_cases").insert(row).select("id").single();
  if (error || !data) dbFail("group_cases insert", error);
  return { id: (data as { id: string }).id };
}

export async function postHypothesis(userId: string, groupId: string, caseId: string, body: HypothesisRequest, now = Date.now()): Promise<HypothesisInfo> {
  await requireMember(groupId, userId);
  const c = await caseIn(groupId, caseId);
  if (isClosed(c, now)) throw new HttpError(409, "case_closed", "Dieser Chartfall ist geschlossen – Hypothesen gehen nur vorher.");
  const pseudonym = await ensurePseudonym(userId);
  const { data, error } = await sb().from("case_hypotheses").insert({ case_id: caseId, user_id: userId, direction: body.direction, confidence: body.confidence, reason: body.reason }).select("created_at").single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "already_hypothesis", "Du hast schon eine Hypothese – sie lässt sich nicht ändern.");
    if (error.code === "23514") throw new HttpError(409, "case_closed", "Dieser Chartfall ist geschlossen – Hypothesen gehen nur vorher.");
    dbFail("case_hypotheses insert", error);
  }
  return { author: pseudonym, authorId: userId, me: true, direction: body.direction, confidence: body.confidence, reason: body.reason, createdAt: (data as { created_at: string }).created_at };
}

/** Author or owner / mentor closes the case now: the hypotheses open for the group. */
export async function closeCase(userId: string, groupId: string, caseId: string, now = Date.now()): Promise<void> {
  const { me } = await requireMember(groupId, userId);
  const c = await caseIn(groupId, caseId);
  if (c.author_id !== userId && !isManager(me.role)) throw new HttpError(403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
  if (isClosed(c, now)) return;
  const { error } = await sb().from("group_cases").update({ closed_at: new Date(now).toISOString() }).eq("id", caseId);
  if (error) dbFail("group_cases update", error);
}

export async function deleteCase(userId: string, groupId: string, caseId: string): Promise<void> {
  const { me } = await requireMember(groupId, userId);
  const c = await caseIn(groupId, caseId);
  if (c.author_id !== userId && !isManager(me.role)) throw new HttpError(403, "not_allowed", "Das dürfen nur Autor:in und Mentoren.");
  const { error } = await sb().from("group_cases").delete().eq("id", caseId);
  if (error) dbFail("group_cases delete", error);
}

/** Leaving (or being removed from) a group takes the person's hypotheses and cases in it away. */
export async function dropMemberCases(groupId: string, memberId: string): Promise<void> {
  const { data, error } = await sb().from("group_cases").select("id").eq("group_id", groupId).limit(5000);
  if (error) {
    if (isMissingTable(error)) return;
    dbFail("group_cases read", error);
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    const { error: hErr } = await sb().from("case_hypotheses").delete().in("case_id", ids).eq("user_id", memberId);
    if (hErr) dbFail("case_hypotheses delete", hErr);
  }
  const { error: cErr } = await sb().from("group_cases").delete().eq("group_id", groupId).eq("author_id", memberId);
  if (cErr) dbFail("group_cases delete", cErr);
}
