/**
 * Feedback and abuse reports (P12, `feedback.mts`). Feedback works signed out too (stored without a user); a report
 * needs an account and a target the reporter can actually see (no blind reporting of guessed ids). One report per
 * reporter and target; a comment reported by `HIDE_AFTER` different people is hidden for everyone but its author and
 * the group's owner / mentors until somebody looks at it.
 */
import type { z } from "zod";
import type { FeedbackSchema } from "../../../../src/social/contract";
import { HttpError } from "../http";
import { canSeeReview, dbFail, requireMember, sb } from "./store";

export const HIDE_AFTER = 3;

type FeedbackBody = z.infer<typeof FeedbackSchema>;

const NOT_FOUND = () => new HttpError(404, "target_not_found", "Das gemeldete Element gibt es nicht (mehr).");

async function reviewVisible(userId: string, reviewId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(reviewId)) return false;
  const { data, error } = await sb().from("group_reviews").select("id,group_id,author_id").eq("id", reviewId).maybeSingle();
  if (error) dbFail("group_reviews read", error);
  const r = data as { group_id: string; author_id: string } | null;
  if (!r) return false;
  try {
    const { group, me } = await requireMember(r.group_id, userId);
    return canSeeReview(group, me, r.author_id);
  } catch {
    return false;
  }
}

async function checkTarget(userId: string, t: { type: "comment" | "review" | "share" | "group" | "case"; id: string }): Promise<void> {
  if (t.type === "review") {
    if (!(await reviewVisible(userId, t.id))) throw NOT_FOUND();
    return;
  }
  if (t.type === "comment") {
    if (!/^[0-9a-f-]{36}$/i.test(t.id)) throw NOT_FOUND();
    const { data, error } = await sb().from("comments").select("id,review_id").eq("id", t.id).maybeSingle();
    if (error) dbFail("comments read", error);
    const c = data as { review_id: string } | null;
    if (!c || !(await reviewVisible(userId, c.review_id))) throw NOT_FOUND();
    return;
  }
  if (t.type === "case") {
    // a case can be reported by the members of its group
    if (!/^[0-9a-f-]{36}$/i.test(t.id)) throw NOT_FOUND();
    const { data, error } = await sb().from("group_cases").select("id,group_id").eq("id", t.id).maybeSingle();
    if (error) dbFail("group_cases read", error);
    const c = data as { group_id: string } | null;
    if (!c) throw NOT_FOUND();
    await requireMember(c.group_id, userId).catch(() => {
      throw NOT_FOUND();
    });
    return;
  }
  if (t.type === "group") {
    await requireMember(t.id, userId).catch(() => {
      throw NOT_FOUND();
    });
    return;
  }
  // share: the reporter opened the public link – the token must exist
  if (!/^[A-Za-z0-9_-]{22}$/.test(t.id)) throw NOT_FOUND();
  const { data, error } = await sb().from("shares").select("id").eq("token", t.id).maybeSingle();
  if (error) dbFail("shares read", error);
  if (!data) throw NOT_FOUND();
}

export interface FeedbackResult {
  ok: true;
  /** The same reporter reported this target before (nothing new stored). */
  duplicate?: boolean;
  /** The comment is hidden now. */
  hidden?: boolean;
}

export async function submitFeedback(userId: string | null, body: FeedbackBody): Promise<FeedbackResult> {
  if (body.kind === "report") {
    if (!userId) throw new HttpError(401, "unauthenticated", "Zum Melden bitte anmelden.");
    await checkTarget(userId, body.target!);
  }
  const row = {
    user_id: userId,
    kind: body.kind,
    message: body.message,
    page: body.page ?? null,
    target_type: body.target?.type ?? null,
    target_id: body.target?.id ?? null,
    meta: body.meta ?? {},
  };
  const { error } = await sb().from("feedback").insert(row);
  if (error) {
    if (error.code === "23505" && body.kind === "report") return { ok: true, duplicate: true };
    dbFail("feedback insert", error);
  }
  if (body.kind === "report" && body.target!.type === "comment") {
    const { count, error: cErr } = await sb().from("feedback").select("id", { count: "exact", head: true }).eq("kind", "report").eq("target_type", "comment").eq("target_id", body.target!.id);
    if (cErr) dbFail("feedback count", cErr);
    if ((count ?? 0) >= HIDE_AFTER) {
      const { error: hErr } = await sb().from("comments").update({ hidden: true }).eq("id", body.target!.id);
      if (hErr) dbFail("comments hide", hErr);
      return { ok: true, hidden: true };
    }
  }
  return { ok: true };
}
