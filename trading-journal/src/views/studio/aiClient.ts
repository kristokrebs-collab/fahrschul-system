/**
 * Optional server help of the Strategie-Studio (client of `netlify/functions/strategy-compile.mts`). The button "Mit KI
 * genauer verstehen" exists only when ALL of these hold – otherwise the studio is the local one and nothing hints at a
 * missing feature: this build has the cloud, a user is signed in, the plan includes `coachAi`, and the server reports a key.
 * Only the text goes out. What comes back is checked against the SAME strict schema as the local parser's rules and against
 * the text (every quoted phrase must stand in it); anything that fails is dropped and the local reading stays.
 */
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { apiFetch, ApiError, cloudEnabled, useCloudUser } from "@/cloud";
import { AI_TEXT_MAX, aiToParse, parseAiOutput, type StrategyParse } from "@/domain/strategytext";
import { recordAi } from "@/store/aiLog";
import { STUDIO } from "./strings";

export interface CompileReply {
  result: unknown;
  model: string;
  reason?: "refusal" | "invalid" | "empty";
  detail?: string;
}

let statusPromise: Promise<boolean> | null = null;

/** Whether the server can read a strategy text (once per session; any failure = false). */
export function compileServerEnabled(): Promise<boolean> {
  statusPromise ??= apiFetch<{ enabled?: boolean }>("/strategy/compile", { auth: false })
    .then((r) => r?.enabled === true)
    .catch(() => false);
  return statusPromise;
}

/** Tests: forget the cached status. */
export function resetCompileStatusForTests(): void {
  statusPromise = null;
}

/** True when the AI reading may be offered (see the module comment). */
export function useCompileAvailable(): boolean {
  const user = useCloudUser();
  const entitled = useEntitlement("coachAi");
  const cloud = cloudEnabled();
  const [server, setServer] = useState(false);
  useEffect(() => {
    if (!cloud || !user || !entitled) return;
    let alive = true;
    void compileServerEnabled().then((v) => {
      if (alive) setServer(v);
    });
    return () => {
      alive = false;
    };
  }, [cloud, user, entitled]);
  return cloud && !!user && entitled && server;
}

export const tooLongForAi = (text: string): boolean => text.length > AI_TEXT_MAX;

export type CompileOutcome = { ok: true; parse: StrategyParse; model: string } | { ok: false; message: string };

/** Asks the server and validates the answer; never throws. */
export async function compileViaServer(text: string): Promise<CompileOutcome> {
  const A = STUDIO.ai;
  let reply: CompileReply;
  try {
    reply = await apiFetch<CompileReply>("/strategy/compile", { method: "POST", body: { text: text.slice(0, AI_TEXT_MAX) } });
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : A.unavailable };
  }
  // KI-Protokoll (F24): helper, model, passed the strict checks or not – never the strategy text or the rules
  if (!reply || reply.result == null) {
    if (reply?.model) void recordAi({ helper: "studio", model: reply.model, adopted: false });
    return { ok: false, message: A.failed(A.reasons[reply?.reason ?? "empty"]) };
  }
  const checked = parseAiOutput(reply.result, text);
  if (!checked.ok) {
    void recordAi({ helper: "studio", model: reply.model, adopted: false });
    return { ok: false, message: A.failed(checked.reason) };
  }
  void recordAi({ helper: "studio", model: reply.model, adopted: true });
  return { ok: true, parse: aiToParse(text, checked.out), model: reply.model };
}
