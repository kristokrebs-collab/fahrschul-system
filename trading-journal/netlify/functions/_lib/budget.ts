/**
 * Server-wide DAILY budgets for the functions that cost money per use (Runde 11, Linse 1 #3 / Linse 3 #1): one counter over ALL accounts
 * per day (UTC day window of `rate_hit`), failing CLOSED when the counter cannot be read. A per-account limit alone cannot stop many
 * accounts at once (free trials, a leaked plan gate): this is the operator's ceiling – the bill of the day can never exceed it.
 *
 *  - `ai`  – every Anthropic call (coach wording, screenshot import, strategy translator, assistant router): `AI_DAILY_MAX` (default 2000)
 *  - `sms` – every verification SMS (Twilio Verify): `ALERT_SMS_DAILY_MAX` (default 100)
 *
 * The phone CALLS have their own brake (`ALERT_PHONE_DAILY_MAX`, `_lib/alerts/limits.ts`). `0` shuts the area for the day.
 */
import { envInt } from "./env";
import { HttpError } from "./http";
import { rateKey, rateLimit, windowReset } from "./rateLimit";

export const AI_DAILY_DEFAULT = 2000;
export const SMS_DAILY_DEFAULT = 100;

export type BudgetKind = "ai" | "sms";

export function budgetMax(kind: BudgetKind): number {
  return kind === "ai" ? Math.max(0, envInt("AI_DAILY_MAX", AI_DAILY_DEFAULT)) : Math.max(0, envInt("ALERT_SMS_DAILY_MAX", SMS_DAILY_DEFAULT));
}

const TEXT: Readonly<Record<BudgetKind, string>> = {
  ai: "Die KI hat heute ihr Tageskontingent erreicht. Morgen geht es wieder.",
  sms: "Für heute sind keine weiteren Bestätigungs-SMS mehr möglich. Bitte versuche es morgen noch einmal.",
};

/** Counts one use against the day's server-wide budget; 503 `budget_exhausted` (with `Retry-After` until the next UTC day) once it is spent. */
export async function enforceBudget(kind: BudgetKind, now = Date.now()): Promise<void> {
  const max = budgetMax(kind);
  const r = await rateLimit(rateKey(`budget-${kind}-day`), max, 86_400, { failClosed: true, now });
  if (r.ok) return;
  const retry = Math.max(1, Math.ceil((windowReset(now, 86_400) - now) / 1000));
  throw new HttpError(503, "budget_exhausted", TEXT[kind], { budget: kind }, { "retry-after": String(retry) });
}
