/**
 * Whether "Aus Screenshot übernehmen" may be offered (F29) – deliberately tiny: this file is part of the editor's
 * chunk, everything that reads pictures (`client.ts`, the preview sheet) is loaded on demand.
 *
 * The button exists only when ALL hold – otherwise nothing hints at a missing feature in the editor (the settings card
 * `Screenshot-Import` explains what is needed, with the current state):
 *   - this build has the cloud (`cloudEnabled()`: web build with Supabase env, not `file://`),
 *   - a user is signed in (the function needs a login and a plan check),
 *   - the plan includes `shotExtract` (always true while payments are not set up),
 *   - the server reports `enabled` (an `ANTHROPIC_API_KEY` is set) – asked once per session, failures read as "off".
 * Without any of it the journal is unchanged: pictures are stored as before and the values are typed by hand.
 */
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { apiFetch, cloudEnabled, useCloudUser } from "@/cloud";

export type ShotExtractState = "checking" | "ready" | "no-cloud" | "signed-out" | "plan" | "server-off";

let statusPromise: Promise<boolean> | null = null;

/** Whether the server can read screenshots (once per session; any failure = false). */
export function shotExtractServerEnabled(): Promise<boolean> {
  statusPromise ??= apiFetch<{ enabled?: boolean }>("/shot-extract", { auth: false })
    .then((r) => r?.enabled === true)
    .catch(() => false);
  return statusPromise;
}

/** Tests: forget the cached status. */
export function resetShotExtractStatusForTests(): void {
  statusPromise = null;
}

/** The state behind the button, in the order the trader can fix it (cloud → login → plan → server). */
export function useShotExtractState(): ShotExtractState {
  const user = useCloudUser();
  const entitled = useEntitlement("shotExtract");
  const cloud = cloudEnabled();
  const [server, setServer] = useState<boolean | null>(null);
  const ask = cloud && !!user && entitled;
  useEffect(() => {
    if (!ask) return;
    let alive = true;
    void shotExtractServerEnabled().then((v) => {
      if (alive) setServer(v);
    });
    return () => {
      alive = false;
    };
  }, [ask]);
  if (!cloud) return "no-cloud";
  if (!user) return "signed-out";
  if (!entitled) return "plan";
  return server == null ? "checking" : server ? "ready" : "server-off";
}

/** True when the screenshot import may be offered. */
export const useShotExtractAvailable = (): boolean => useShotExtractState() === "ready";

/** German explanation of a state for the settings card. */
export const SHOT_EXTRACT_STATE_TEXT: Record<ShotExtractState, string> = {
  checking: "Wird geprüft …",
  ready: "Verfügbar – im Trade-Formular unter „Screenshots“ erscheint „Aus Screenshot übernehmen“.",
  "no-cloud": "Nicht verfügbar in dieser Ausgabe: Der Import braucht die Web-App mit Konto.",
  "signed-out": "Melde dich an, dann steht der Import zur Verfügung.",
  plan: "Gehört nicht zu deinem Tarif (Premium).",
  "server-off": "Auf diesem Server nicht eingerichtet (kein KI-Schlüssel hinterlegt).",
};
