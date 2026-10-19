/**
 * Rankings + the caller's community status (P12). Signed in (aal2 when 2FA is on).
 *   GET  /api/v1/social/leaderboard?metric=expectancy|discipline|consistency[&group=<id>] → `LeaderboardResponse`
 *   POST /api/v1/social/leaderboard `{ action: "optIn", on }` – ranking opt-in (writes `profiles.privacy.leaderboard`;
 *        off removes the user's snapshot rows at once) · `{ action: "refresh" }` – recompute my figures now (6 / h) ·
 *        `{ action: "reroll" }` – a new pseudonym (3 / day) → `{ me }`
 * Pseudonyms, R and % only; the distributions are k-anonymous (`community_stats`).
 */
import type { Config } from "@netlify/functions";
import { LeaderboardActionSchema } from "../../src/social/contract";
import { isSocialMetric } from "../../src/social/metrics";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { globalLeaderboard, groupLeaderboard } from "./_lib/social/leaderboard";
import { computeStats, rerollPseudonym, setOptIn, socialMe } from "./_lib/social/store";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  if (req.method.toUpperCase() === "GET") {
    await enforceRateLimit(rateKey("social-board", user.id), 240, 600);
    const url = new URL(req.url);
    const metric = url.searchParams.get("metric") ?? "expectancy";
    if (!isSocialMetric(metric)) throw new HttpError(400, "invalid_metric", "Unbekannte Kennzahl.");
    const group = url.searchParams.get("group");
    return json(group ? await groupLeaderboard(user.id, group, metric) : await globalLeaderboard(user.id, metric));
  }
  const body = await readJson(req, LeaderboardActionSchema, { maxBytes: 1024 });
  const ip = clientIp(req, ctx);
  switch (body.action) {
    case "optIn":
      await enforceRateLimit(rateKey("social-optin", user.id), 20, 3600);
      if (body.on) await requireFeature(user.id, "community");
      await setOptIn(user.id, body.on);
      if (body.on) await computeStats(user.id);
      await audit(user.id, "social.optin", { on: body.on }, ip);
      break;
    case "refresh":
      await enforceRateLimit(rateKey("social-refresh", user.id), 6, 3600);
      await computeStats(user.id);
      break;
    case "reroll":
      await enforceRateLimit(rateKey("social-reroll", user.id), 3, 86_400);
      await rerollPseudonym(user.id);
      break;
  }
  return json({ me: await socialMe(user.id) });
});

export const config: Config = { path: "/api/v1/social/leaderboard", method: ["GET", "POST"] };
