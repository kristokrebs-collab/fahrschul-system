/**
 * What can I do with this function RIGHT NOW – three honest answers, read from the register and the tariff table:
 *
 *   verfuegbar   nothing stands in the way (the register's own "Stand" – fertig / teilweise – is a different question)
 *   einrichtung  it needs something the user sets up: an account / the cloud, a server key, a group, a connected venue
 *   tarif        it belongs to a higher plan – `plan` is the cheapest one that has it, `next` says the next step
 *
 * "Voraussetzungen" that only say where a card shows up ("Erscheint nach einem fertigen Lauf.") are NOT a setup – they stay in
 * the details of the row. Whether payments are open decides about `tarif`: while nothing is gated (`open: false`) every function
 * is in everyone's plan, exactly as the gates behave. Pure.
 */
import type { FeatureEntry } from "@/app/features";
import { planIncludes, upgradePlanFor, PLAN_CATALOG, type PaidPlanId } from "@/billing/plans";
import type { PlanId } from "@/billing/types";

export type Availability = "verfuegbar" | "einrichtung" | "tarif";

export interface AvailabilityInfo {
  kind: Availability;
  /** `tarif`: the cheapest paid plan that has the function */
  plan?: PaidPlanId;
  /** the next step in plain words (`einrichtung`: what to set up; `tarif`: which plan to choose) */
  next?: string;
}

export interface AvailabilityContext {
  /** payments are open (`useBillingMode() === "open"`) – only then plans gate anything */
  open: boolean;
  plan: PlanId;
  /** a cloud account is signed in */
  signedIn: boolean;
}

/** An account / the cloud as the precondition: met when the user is signed in. */
const ACCOUNT = /Konto|Cloud-Version|Cloud-Sync/;
/** Other things the user sets up (server key, a group, a connected venue). */
const SETUP = /Server|Gruppe|Börse verbunden|Verbindung|eingerichtet/;

export function availabilityOf(f: FeatureEntry, ctx: AvailabilityContext): AvailabilityInfo {
  if (ctx.open && f.gate && !planIncludes(ctx.plan, f.gate)) {
    const plan = upgradePlanFor(f.gate);
    return { kind: "tarif", plan, next: `Tarif ${PLAN_CATALOG[plan].name} wählen – dann ist es freigeschaltet.` };
  }
  const needs = f.needs;
  if (needs) {
    const setup = SETUP.test(needs) || (ACCOUNT.test(needs) && !ctx.signedIn);
    if (setup) return { kind: "einrichtung", next: needs };
  }
  return { kind: "verfuegbar" };
}
