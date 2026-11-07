/**
 * The result page after Stripe (B4) as a state machine – pure. THE RETURN URL CONFIRMS NOTHING: "Abo aktiv" is only ever
 * shown when `billing-status` (the server state derived from the Stripe webhook) says the subscription is live. What the
 * browser brings back (`?billing=success|cancel`) only decides WHICH of the five states we start in:
 *
 *   confirmed  the server says the subscription runs (active / trialing)
 *   pending    came back from Stripe, the server has not heard yet – we ask again with a growing pause; after the timeout the
 *              text stays honest ("Wir warten noch auf die Bestätigung von Stripe") and nothing is claimed
 *   action     the server knows the subscription but it is `incomplete` (a confirmation of the payment – 3-D Secure, bank – is open)
 *   canceled   the person left Stripe's page without ordering (`?billing=cancel`) – nothing was charged
 *   failed     the server says the payment failed / the subscription is not usable (past_due, unpaid, incomplete_expired, canceled)
 */
import type { SubscriptionSummary } from "../contract";
import type { BillingReturn } from "../url";

export type ResultState = "confirmed" | "pending" | "action" | "canceled" | "failed";

/**
 * `staleId`: the subscription that already existed when the order was placed (an older, ended one): its status says nothing
 * about THIS order, so it counts as "the server has not heard yet" – a leftover "canceled" must never read as a failed payment.
 */
export function resultStateOf(ret: BillingReturn["kind"], sub: Pick<SubscriptionSummary, "status" | "id"> | null, staleId: string | null = null): ResultState {
  if (ret === "cancel") return "canceled";
  if (!sub || (staleId !== null && sub.id === staleId)) return "pending";
  switch (sub.status) {
    case "active":
    case "trialing":
      return "confirmed";
    case "incomplete":
      return "action";
    case "past_due":
    case "unpaid":
    case "incomplete_expired":
    case "canceled":
      return "failed";
    default:
      // `paused`, `none` …: nothing the order itself produces – keep asking, claim nothing
      return "pending";
  }
}

/** Pause before poll number `attempt` (0-based), ms: 800, 1200, 1800 … capped at 6 s. */
export function pollDelay(attempt: number): number {
  return Math.min(6000, Math.round(800 * 1.5 ** Math.max(0, attempt)));
}

/** Longest the page keeps asking on its own (after that the button "Status prüfen" asks once more per click). */
export const POLL_BUDGET_MS = 60_000;

/** How many polls fit the budget (the sum of `pollDelay` up to `POLL_BUDGET_MS`). */
export function pollAttempts(budgetMs = POLL_BUDGET_MS): number {
  let n = 0;
  let sum = 0;
  while (sum + pollDelay(n) <= budgetMs) {
    sum += pollDelay(n);
    n++;
  }
  return n;
}

/** `true` once `attempts` polls found nothing and the budget is used up: the page says it is still waiting – honestly. */
export const pollTimedOut = (attempts: number): boolean => attempts >= pollAttempts();

export const RESULT_TEXT = {
  confirmed: { title: "Dein Abo ist aktiv", text: "Stripe hat die Bestellung bestätigt. Dein Tarif ist freigeschaltet." },
  confirmedTrial: (date: string) => ({ title: "Dein Abo ist aktiv", text: `Stripe hat die Bestellung bestätigt. Deine Testphase läuft bis ${date}; danach beginnt die Zahlung automatisch.` }),
  pending: { title: "Wir prüfen deine Bestellung", text: "Du bist von Stripe zurück. Gebucht ist erst, wenn Stripe es uns bestätigt – das dauert meist nur wenige Sekunden." },
  pendingSlow: { title: "Wir warten noch auf die Bestätigung von Stripe", text: "Noch ist nichts bestätigt. Du kannst diese Seite schließen: Sobald Stripe uns Bescheid gibt, erscheint dein Tarif unter Konto. Mit „Status prüfen“ fragen wir sofort noch einmal nach." },
  action: { title: "Noch ein Schritt: Zahlung bestätigen", text: "Deine Bank oder Stripe wartet noch auf deine Bestätigung der Zahlung. Schließe sie ab – dein Tarif wird erst danach freigeschaltet." },
  canceled: { title: "Bestellung abgebrochen", text: "Du hast Stripe verlassen, bevor du bestellt hast. Es wurde nichts berechnet und kein Vertrag geschlossen." },
  failed: { title: "Die Zahlung hat nicht geklappt", text: "Stripe konnte die Zahlung nicht abschließen. Es ist kein aktives Abo entstanden. Du kannst es mit einem anderen Zahlungsmittel noch einmal versuchen." },
} as const;
