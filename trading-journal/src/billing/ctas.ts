/**
 * What the bottom of a plan card says and does (Paket B, Auftrag Abschnitt 3 "Konkrete CTAs") – one pure function, so the
 * price page, the tariff detail and the upgrade sheet can never disagree about it:
 *
 *   Free                                  → `Kostenlos starten` (signed out) · `Dein aktueller Tarif` (own plan, no click) · `Gilt nach einer Kündigung`
 *   signed out, a paid plan               → `<Plan> auswählen`            (`Pro auswählen`, `Premium auswählen`, `Team auswählen`; registration with the choice kept)
 *   signed in, no subscription            → `Weiter zur Zahlung`          (opens the order SUMMARY – not the order button)
 *   own plan with a subscription          → `Dein aktueller Tarif`        (a status, NOT clickable; managing lives in Konto: `Abo und Rechnungen verwalten`)
 *   another plan, subscription running    → `Zu <Plan> wechseln` (up) · `Tarif ändern` (down)
 *   purchase flow closed / plan missing   → an honest line instead of a button
 *
 * `Weiter zur Zahlung` is the way to the summary; the legally binding order button of the summary stays "Zahlungspflichtig
 * bestellen" (`BUTTON_LABELS.order`, § 312j Abs. 3 BGB – Entwurf, Anwalt prüft). Nothing here decides a right: the plan
 * comes from the server (`profiles.plan`, written only by the Stripe webhook).
 */
import { PLAN_CATALOG, type PaidPlanId } from "./plans";
import type { PlanId } from "./types";

export const CTA = {
  free: "Kostenlos starten",
  current: "Dein aktueller Tarif",
  toPayment: "Weiter zur Zahlung",
  select: (name: string) => `${name} auswählen`,
  switchUp: (name: string) => `Zu ${name} wechseln`,
  change: "Tarif ändern",
  manage: "Abo und Rechnungen verwalten",
  afterCancel: "Gilt nach einer Kündigung",
  locked: "Noch nicht bestellbar",
  soon: "Noch nicht buchbar",
  closed: "Alles freigeschaltet",
} as const;

/** Order of the paid plans for "up" / "down" (Team is the widest plan). */
const RANK: Record<PlanId, number> = { free: 0, pro: 1, premium: 2, team: 3 };

export type CtaKind = "free-start" | "select" | "to-payment" | "switch" | "current" | "after-cancel" | "locked" | "soon" | "closed";

export interface PlanCtaInput {
  plan: PlanId;
  signedIn: boolean;
  /** The plan the server reports for this person (`free` signed out). */
  currentPlan: PlanId;
  /** A Stripe subscription of the person's own is running. */
  hasSubscription: boolean;
  /** `open` = payments are set up; `closed` / `off` = they are not (nothing can be ordered). */
  mode: "open" | "closed" | "off";
  /** The purchase flow is complete (Stripe and the operator's legal texts). */
  purchaseOpen: boolean;
  /** The server lists this plan as bookable (a price exists for it). */
  available: boolean;
}

export interface PlanCta {
  kind: CtaKind;
  label: string;
  /** `true`: a button that does something; `false`: plain status text (never a button that looks clickable and is not). */
  clickable: boolean;
}

export function planCta(i: PlanCtaInput): PlanCta {
  const paid = i.plan !== "free";
  const name = PLAN_CATALOG[i.plan].name;
  const isCurrent = i.mode === "open" && i.signedIn && i.currentPlan === i.plan;
  if (i.mode !== "open") return paid ? { kind: "soon", label: CTA.soon, clickable: false } : { kind: "closed", label: CTA.closed, clickable: false };
  if (!paid) {
    if (!i.signedIn) return { kind: "free-start", label: CTA.free, clickable: true };
    return isCurrent ? { kind: "current", label: CTA.current, clickable: false } : { kind: "after-cancel", label: CTA.afterCancel, clickable: false };
  }
  if (isCurrent) return { kind: "current", label: CTA.current, clickable: false };
  const switching = i.hasSubscription && i.currentPlan !== "free";
  if (!switching && !i.purchaseOpen) return { kind: "locked", label: CTA.locked, clickable: false };
  if (switching) return { kind: "switch", label: RANK[i.plan] > RANK[i.currentPlan] ? CTA.switchUp(name) : CTA.change, clickable: true };
  if (!i.available) return { kind: "soon", label: CTA.soon, clickable: false };
  return i.signedIn ? { kind: "to-payment", label: CTA.toPayment, clickable: true } : { kind: "select", label: CTA.select(name), clickable: true };
}

/** The way to the order summary from a place that is not a card (detail sheet, upgrade sheet): the same two words as the cards. */
export const orderStepLabel = (signedIn: boolean, plan: PaidPlanId): string => (signedIn ? CTA.toPayment : CTA.select(PLAN_CATALOG[plan].name));
