/**
 * Optional AI wording of a coach answer (P04 client of `netlify/functions/coach-ask.mts`). The button "Mit KI
 * formulieren" exists only when ALL of these hold – otherwise the coach is the deterministic one and nothing hints at a
 * missing feature:
 *   - this build has the cloud (`cloudEnabled()`: web build with Supabase env, not file://),
 *   - a user is signed in,
 *   - the plan includes `coachAi` (always true while payments are not set up),
 *   - the server reports `enabled` (an `ANTHROPIC_API_KEY` is set) – asked once per session, failures read as "off".
 * Only the computed facts go out; note excerpts only with the opt-in `settings.coach.ai.notes`.
 */
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { apiFetch, ApiError, cloudEnabled, useCloudUser } from "@/cloud";
import type { Answer } from "@/domain/coach/nlq";

export interface AiReply {
  text: string | null;
  model: string;
  reason?: "refusal" | "unverified" | "empty";
}

let statusPromise: Promise<boolean> | null = null;

/** Whether the server can rephrase (once per session; any failure = false). */
export function aiServerEnabled(): Promise<boolean> {
  statusPromise ??= apiFetch<{ enabled?: boolean }>("/coach/ask", { auth: false })
    .then((r) => r?.enabled === true)
    .catch(() => false);
  return statusPromise;
}

/** Tests: forget the cached status. */
export function resetAiStatusForTests(): void {
  statusPromise = null;
}

/** True when the AI wording may be offered (see the module comment). */
export function useAiAvailable(): boolean {
  const user = useCloudUser();
  const entitled = useEntitlement("coachAi");
  const cloud = cloudEnabled();
  const [server, setServer] = useState(false);
  useEffect(() => {
    if (!cloud || !user || !entitled) return;
    let alive = true;
    void aiServerEnabled().then((v) => {
      if (alive) setServer(v);
    });
    return () => {
      alive = false;
    };
  }, [cloud, user, entitled]);
  return cloud && !!user && entitled && server;
}

/** The request body: the computed answer and its facts (≤ 12), plus opt-in note excerpts. */
export function askBody(question: string, a: Answer, notes?: readonly string[]) {
  return {
    question: question.slice(0, 300),
    title: a.title.slice(0, 200) || "Antwort",
    text: a.text.slice(0, 1500),
    facts: a.facts.slice(0, 12).map((f) => ({ label: f.label.slice(0, 80), value: f.value.slice(0, 80) })),
    confidence: { label: a.confidence.label, n: a.confidence.n },
    ...(notes?.length ? { notes: notes.slice(0, 3).map((n) => n.slice(0, 280)) } : {}),
  };
}

/** Asks the server to rephrase; throws `ApiError` with a German message on failure. */
export async function rephraseAnswer(question: string, a: Answer, notes?: readonly string[]): Promise<AiReply> {
  return apiFetch<AiReply>("/coach/ask", { method: "POST", body: askBody(question, a, notes) });
}

/** German line for a kept deterministic answer. */
export function keptReason(reason: AiReply["reason"]): string {
  return reason === "unverified" ? "Die KI-Fassung enthielt Zahlen, die nicht berechnet wurden – die berechnete Antwort bleibt." : reason === "refusal" ? "Die KI hat abgelehnt – die berechnete Antwort bleibt." : "Keine KI-Fassung erhalten – die berechnete Antwort bleibt.";
}

export const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : "Die KI ist gerade nicht erreichbar – die berechnete Antwort bleibt.");
