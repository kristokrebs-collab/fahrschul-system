/**
 * Brings the person back to the task they came for (`src/store/returnTo.ts`): while a return is pending it watches the three
 * things a task can wait for – the login (`useCloudSession`), the plan (`entitledNow`) and an exchange connection
 * (`useExchange`) – and, the moment the awaited one is true, opens the original target (`openFeature`: the page, the card, the
 * sheet) exactly once. It renders nothing. A pending return that is stale (`RETURN_TTL_MS`) is dropped, never acted on.
 */
import { useEffect } from "react";
import { pageTargetId } from "@/app/pageTargets";
import { entitledNow } from "@/billing/entitlements";
import { useBilling, useEffectivePlan } from "@/billing/store";
import { useCloudSession } from "@/cloud/session";
import { primaryConnection, useExchange } from "@/exchanges/store";
import { clearReturnTo, peekReturnTo, useReturnTo, type ReturnWait } from "@/store/returnTo";
import type { Feature } from "@/billing/types";

/** Has the awaited condition come true? Pure over what it is given, so a test can feed it. */
export function waitMet(wait: ReturnWait, s: { signedIn: boolean; entitled: (feature: string) => boolean; connected: boolean }): boolean {
  switch (wait.on) {
    case "signedIn":
      return s.signedIn;
    case "entitled":
      return s.entitled(wait.feature);
    case "connected":
      return s.connected;
  }
}

export function ReturnHost() {
  const pending = useReturnTo((s) => s.pending);
  const signedIn = useCloudSession((s) => s.phase === "signedIn" && !s.needsMfa);
  const connected = useExchange((s) => primaryConnection(s.status) !== null);
  // a plan change (the account arrives from the server, the cache is rewritten) re-renders here; `entitledNow` then reads the new plan
  const plan = useEffectivePlan().plan;
  const account = useBilling((s) => s.account);
  const cached = useBilling((s) => s.cached);

  useEffect(() => {
    if (!pending) return;
    const now = peekReturnTo();
    if (!now) return;
    if (!waitMet(now.wait, { signedIn, connected, entitled: (f) => entitledNow(f as Feature) })) return;
    // once: the note is cleared before the target opens, so nothing can fire it twice
    clearReturnTo();
    const t = now.target;
    const id = t.kind === "feature" ? t.id : pageTargetId(t.page);
    // the register is a lazy chunk of its own: it is fetched only when a return actually happens
    void import("@/app/featureOpen").then((m) => m.openFeature(id, { remember: false }));
  }, [pending, signedIn, connected, plan, account, cached]);

  return null;
}
