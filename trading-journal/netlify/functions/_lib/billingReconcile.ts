/**
 * Daily comparison with Stripe (`billing-reconcile.mts`, Runde 11, Linse 1 #13 / #3): the webhook is the fast path, this is the safety
 * net for everything a webhook cannot do or can miss.
 *
 *  1. Every open subscription is read from Stripe again and written (`syncSubscription`, fresh): a missed or failed webhook, a trial that
 *     ended without an event we handled, a subscription that vanished – the profile follows Stripe, not the other way round.
 *  2. Every profile that still shows a paid plan is recomputed from the database facts (`recomputePlan`): a stale `team` of a member whose
 *     seat went away, a plan of a subscription row that ended. Teams are re-checked (`recomputeMembers`: surplus seats are removed).
 *  3. Referral credits that waited out `REFERRAL_HOLD_DAYS` are put on the referrer's Stripe balance (`applyPendingCredits`).
 *
 * Work per run is bounded (`LIMIT` rows each, stalest first), so a big backlog is worked off over several days and never exceeds the
 * function's time. Nothing here sends mail or money; a Stripe error on one row is counted and the run goes on. Never logs ids of people.
 */
import { isMissingTable } from "./account";
import { audit } from "./audit";
import { envOptional } from "./env";
import {
  applyPendingCredits,
  customerIdOf,
  freshSubscription,
  recomputeMembers,
  recomputePlan,
  syncSubscription,
} from "./stripe";
import { supabaseAdmin } from "./supabase";

const LIMIT = 200;
const OPEN = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"]);

export interface ReconcileSummary {
  /** Stripe is configured (steps 1 and 3 ran). */
  stripe: boolean;
  /** Open subscriptions read again from Stripe. */
  subscriptions: number;
  /** …of which Stripe could not be asked. */
  subscriptionsFailed: number;
  /** Profiles with a paid plan that were recomputed. */
  profiles: number;
  /** …whose plan changed. */
  profilesChanged: number;
  /** Team seats removed (more members than paid seats). */
  seatsRemoved: number;
  /** Referral credits put on a Stripe balance. */
  creditsApplied: number;
}

export async function reconcileBilling(now = Date.now()): Promise<ReconcileSummary> {
  const sb = supabaseAdmin();
  const out: ReconcileSummary = { stripe: !!envOptional("STRIPE_SECRET_KEY"), subscriptions: 0, subscriptionsFailed: 0, profiles: 0, profilesChanged: 0, seatsRemoved: 0, creditsApplied: 0 };

  if (out.stripe) {
    const { data, error } = await sb.from("subscriptions").select("id,status,updated_at").neq("status", "canceled").order("updated_at", { ascending: true }).limit(LIMIT * 2);
    if (error) {
      if (!isMissingTable(error)) console.error("[fn] reconcile subscriptions read failed", error.code);
    } else {
      const open = ((data ?? []) as { id: string; status: string }[]).filter((r) => OPEN.has(r.status)).slice(0, LIMIT);
      for (const r of open) {
        const sub = await freshSubscription(r.id);
        if (!sub) {
          out.subscriptionsFailed++;
          continue;
        }
        try {
          await syncSubscription(sub, { fresh: true, eventAt: Math.floor(now / 1000) });
          out.subscriptions++;
        } catch (e) {
          out.subscriptionsFailed++;
          console.error("[fn] reconcile sync failed", e instanceof Error ? e.name : typeof e);
        }
      }
    }
  }

  // profiles that still claim a paid plan
  const paid = await sb.from("profiles").select("id,plan,plan_status,trial_end").neq("plan", "free").limit(LIMIT * 2);
  if (paid.error) {
    if (!isMissingTable(paid.error)) console.error("[fn] reconcile profiles read failed", paid.error.code);
  } else {
    for (const p of ((paid.data ?? []) as { id: string; plan: string; plan_status: string | null; trial_end: string | null }[]).slice(0, LIMIT)) {
      try {
        const info = await recomputePlan(p.id);
        out.profiles++;
        if (info.plan !== p.plan || info.status !== (p.plan_status ?? "none") || (info.trialEnd ?? null) !== (p.trial_end ?? null)) out.profilesChanged++;
        out.seatsRemoved += await recomputeMembers(p.id);
      } catch (e) {
        console.error("[fn] reconcile profile failed", e instanceof Error ? e.name : typeof e);
      }
    }
  }

  // referral credits whose hold has run out
  if (out.stripe) {
    const pending = await sb.from("affiliate_ledger").select("referrer_id").eq("kind", "credit").eq("status", "pending").limit(LIMIT);
    if (!pending.error) {
      for (const referrer of new Set(((pending.data ?? []) as { referrer_id: string }[]).map((r) => r.referrer_id))) {
        try {
          const customer = await customerIdOf(referrer);
          if (customer) out.creditsApplied += await applyPendingCredits(referrer, customer, now);
        } catch (e) {
          console.error("[fn] reconcile credit failed", e instanceof Error ? e.name : typeof e);
        }
      }
    }
  }

  if (out.subscriptionsFailed || out.profilesChanged || out.seatsRemoved) await audit(null, "billing.reconcile", { ...out });
  return out;
}
