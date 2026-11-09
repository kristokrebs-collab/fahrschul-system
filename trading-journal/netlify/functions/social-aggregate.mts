/**
 * Scheduled (@daily, published deploys only): the nightly community aggregate (P12) – figures of the opted-in users,
 * today's ranking snapshots and the k-anonymous distributions. Logic in `_lib/social/aggregate.ts`. Nobody who did not
 * opt in is ever read: `social_candidates()` returns ranking opt-ins and members sharing stats with a group only.
 */
import type { Config } from "@netlify/functions";
import { errorFrom, json } from "./_lib/http";
import { runSocialAggregate } from "./_lib/social/aggregate";

export default async (): Promise<Response> => {
  try {
    const result = await runSocialAggregate();
    console.log("[fn] social-aggregate", JSON.stringify(result));
    return json(result);
  } catch (e) {
    return errorFrom(e);
  }
};

export const config: Config = { schedule: "@daily" };
