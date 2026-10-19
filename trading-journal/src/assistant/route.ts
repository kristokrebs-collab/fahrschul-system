/**
 * Client of the optional server router (`netlify/functions/assistant-route.mts`). Offered only when the cloud build is
 * on, a user is signed in, the plan includes `coachAi` and the server reports a key (asked once per session – any
 * failure reads as "off"). It returns canonical questions; each is re-checked by the LOCAL understanding layer before
 * it is answered, so a model that returns something the app cannot answer simply gets dropped.
 */
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { apiFetch, cloudEnabled, useCloudUser } from "@/cloud";
import { understand, type UnderstandCtx } from "./understand";

export interface RouteReply {
  questions: string[];
  clarify: string | null;
  model: string;
  reason?: "refusal" | "empty";
}

let statusPromise: Promise<boolean> | null = null;

export function routerServerEnabled(): Promise<boolean> {
  statusPromise ??= apiFetch<{ enabled?: boolean }>("/assistant/route", { auth: false })
    .then((r) => r?.enabled === true)
    .catch(() => false);
  return statusPromise;
}

/** Tests: forget the cached status. */
export function resetRouterStatusForTests(): void {
  statusPromise = null;
}

/** True when the language router may be used (see the module comment). */
export function useRouterAvailable(): boolean {
  const user = useCloudUser();
  const entitled = useEntitlement("coachAi");
  const cloud = cloudEnabled();
  const [server, setServer] = useState(false);
  useEffect(() => {
    if (!cloud || !user || !entitled) return;
    let alive = true;
    void routerServerEnabled().then((v) => {
      if (alive) setServer(v);
    });
    return () => {
      alive = false;
    };
  }, [cloud, user, entitled]);
  return cloud && !!user && entitled && server;
}

export interface RouteContext {
  history: readonly string[];
  page: string;
  setups: readonly string[];
  assets: readonly string[];
}

/** Asks the server; only questions the local layer can answer survive. */
export async function routeViaServer(question: string, rc: RouteContext, uctx: UnderstandCtx): Promise<{ questions: string[]; clarify: string | null }> {
  const r = await apiFetch<RouteReply>("/assistant/route", {
    method: "POST",
    body: { question: question.slice(0, 300), history: rc.history.slice(-3).map((h) => h.slice(0, 200)), page: rc.page.slice(0, 20), setups: rc.setups.slice(0, 30).map((s) => s.slice(0, 60)), assets: rc.assets.slice(0, 20).map((a) => a.slice(0, 12)) },
  });
  const usable = (r.questions ?? []).filter((q) => understand(q, uctx).kind !== "clarify").slice(0, 3);
  return { questions: usable, clarify: r.clarify ?? null };
}
