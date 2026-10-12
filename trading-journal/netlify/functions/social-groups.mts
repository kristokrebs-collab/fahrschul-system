/**
 * Groups, mentoring, teams, joint reviews (P12). Signed in (aal2 when 2FA is on); every route checks the membership
 * (404 for strangers – no probing of group ids). Logic: `_lib/social/groups.ts`.
 *
 *   GET    /api/v1/social/groups                                   → `{ me, groups, goals }`
 *   POST   /api/v1/social/groups `{ kind, name, description }`      → 201 `{ group }` (mentor: plan feature `mentor`;
 *          team: needs the Team plan's seats; plan limit `groups`)
 *   GET    /api/v1/social/groups/:id                               → `{ group, reviews }` (detail + feed)
 *   DELETE /api/v1/social/groups/:id                               → owner deletes (team seats released)
 *   POST   /api/v1/social/groups/:id/invites `{ role, maxUses, days }` → 201 `{ invite }` (owner / mentor)
 *   DELETE /api/v1/social/groups/:id/invites/:code
 *   PATCH  /api/v1/social/groups/:id/members/:uid `{ role? , shareLevel? }` (share level: only yourself; role: owner)
 *   DELETE /api/v1/social/groups/:id/members/:uid                  → leave (yourself) or remove (owner / mentor)
 *   POST   /api/v1/social/groups/:id/reviews `{ payload, question }` → 201 `{ id }` (redacted trade, strict schema)
 *   PATCH  /api/v1/social/groups/:id/reviews/:rid `{ status }` · DELETE …/reviews/:rid
 *   POST   /api/v1/social/groups/:id/reviews/:rid/comments `{ body }` → 201 `{ comment }` (@Pseudonym mentions)
 *   DELETE /api/v1/social/groups/:id/reviews/:rid/comments/:cid
 *   POST   /api/v1/social/groups/:id/goals `{ studentId, draft }`  → 201 `{ id }` (mentor → student)
 *   PATCH  /api/v1/social/groups/:id/goals/:gid `{ status }`       (the student adopts / declines)
 *   GET    /api/v1/social/invite/:code                             → `InvitePreview`
 *   POST   /api/v1/social/invite/:code `{ shareLevel }`            → 201 `{ group }` (team: takes a seat)
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { CommentSchema, CreateGroupSchema, GoalPatchSchema, GoalSchema, InviteSchema, MemberPatchSchema, ReviewPatchSchema, ReviewSchema, SHARE_LEVELS } from "../../src/social/contract";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import {
  answerGoal,
  createGroup,
  createInvite,
  deleteComment,
  deleteGroup,
  deleteReview,
  feed,
  groupsResponse,
  joinGroup,
  patchMember,
  postComment,
  postReview,
  previewInvite,
  proposeGoal,
  removeMember,
  revokeInvite,
  setReviewStatus,
} from "./_lib/social/groups";

const PREFIX = "/api/v1/social/";
const JoinBody = z.object({ shareLevel: z.enum(SHARE_LEVELS).default("none") }).strict();
const SMALL = { maxBytes: 4 * 1024 };

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST", "PATCH", "DELETE");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const ip = clientIp(req, ctx);
  const method = req.method.toUpperCase();
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const seg = path.startsWith(PREFIX) ? path.slice(PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent) : [];
  const route = `${method} ${seg.map((s, i) => (i === 0 ? s : i % 2 === 1 ? ":" : s)).join("/")}`;
  if (method === "GET") await enforceRateLimit(rateKey("social-read", user.id), 300, 600);

  switch (route) {
    case "GET groups":
      return json(await groupsResponse(user.id));
    case "POST groups": {
      await enforceRateLimit(rateKey("social-group-create", user.id), 5, 86_400);
      const body = await readJson(req, CreateGroupSchema, SMALL);
      const group = await createGroup(user.id, body);
      await audit(user.id, "social.group.create", { kind: body.kind }, ip);
      return json({ group }, { status: 201 });
    }
    case "GET groups/:":
      return json(await feed(user.id, seg[1]!));
    case "DELETE groups/:":
      await deleteGroup(user.id, seg[1]!);
      await audit(user.id, "social.group.delete", {}, ip);
      return json({ ok: true });
    case "POST groups/:/invites": {
      await enforceRateLimit(rateKey("social-invite", user.id), 20, 3600);
      const invite = await createInvite(user.id, seg[1]!, await readJson(req, InviteSchema, SMALL));
      return json({ invite }, { status: 201 });
    }
    case "DELETE groups/:/invites/:":
      await revokeInvite(user.id, seg[1]!, seg[3]!);
      return json({ ok: true });
    case "PATCH groups/:/members/:":
      await patchMember(user.id, seg[1]!, seg[3]!, await readJson(req, MemberPatchSchema, SMALL));
      return json({ ok: true });
    case "DELETE groups/:/members/:": {
      const r = await removeMember(user.id, seg[1]!, seg[3]!);
      await audit(user.id, r.left ? "social.leave" : "social.member.remove", {}, ip);
      return json({ ok: true, ...r });
    }
    case "POST groups/:/reviews": {
      await enforceRateLimit(rateKey("social-review", user.id), 10, 600);
      const body = await readJson(req, ReviewSchema, { maxBytes: 24 * 1024 });
      return json(await postReview(user.id, seg[1]!, body.payload, body.question), { status: 201 });
    }
    case "PATCH groups/:/reviews/:":
      await setReviewStatus(user.id, seg[1]!, seg[3]!, (await readJson(req, ReviewPatchSchema, SMALL)).status);
      return json({ ok: true });
    case "DELETE groups/:/reviews/:":
      await deleteReview(user.id, seg[1]!, seg[3]!);
      return json({ ok: true });
    case "POST groups/:/reviews/:/comments": {
      await enforceRateLimit(rateKey("social-comment", user.id), 30, 600);
      const body = await readJson(req, CommentSchema, SMALL);
      return json({ comment: await postComment(user.id, seg[1]!, seg[3]!, body.body) }, { status: 201 });
    }
    case "DELETE groups/:/reviews/:/comments/:":
      await deleteComment(user.id, seg[1]!, seg[3]!, seg[5]!);
      return json({ ok: true });
    case "POST groups/:/goals": {
      await enforceRateLimit(rateKey("social-goal", user.id), 20, 3600);
      const body = await readJson(req, GoalSchema, SMALL);
      return json(await proposeGoal(user.id, seg[1]!, body.studentId, body.draft), { status: 201 });
    }
    case "PATCH groups/:/goals/:":
      await answerGoal(user.id, seg[1]!, seg[3]!, (await readJson(req, GoalPatchSchema, SMALL)).status);
      return json({ ok: true });
    case "GET invite/:":
      await enforceRateLimit(rateKey("social-invite-check", user.id), 30, 3600, { failClosed: true });
      return json(await previewInvite(user.id, seg[1]!.toUpperCase()));
    case "POST invite/:": {
      await enforceRateLimit(rateKey("social-join", user.id), 20, 3600, { failClosed: true });
      const body = await readJson(req, JoinBody, SMALL);
      const group = await joinGroup(user.id, seg[1]!.toUpperCase(), body.shareLevel);
      await audit(user.id, "social.join", { kind: group.kind, role: group.role }, ip);
      return json({ group }, { status: 201 });
    }
  }
  throw new HttpError(404, "not_found");
});

export const config: Config = {
  path: ["/api/v1/social/groups", "/api/v1/social/groups/*", "/api/v1/social/invite/*"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
