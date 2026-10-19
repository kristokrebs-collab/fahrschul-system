/**
 * Whether "Aus Screenshot übernehmen" may be offered (F29) – deliberately tiny: this file is part of the editor's
 * chunk, everything that reads pictures (`client.ts`, the preview sheet) is loaded on demand.
 *
 * The button exists only when ALL hold – otherwise nothing hints at a missing feature in the editor (the settings card
 * `Screenshot-Import` explains what is needed, with the current state):
 *   - this build has the cloud (`cloudEnabled()`: web build with Supabase env, not `file://`),
 *   - a user is signed in (the function needs a login and a plan check),
 *   - the plan includes `shotExtract` (always true while payments are not set up),
 *   - the server reports `enabled` (an `ANTHROPIC_API_KEY` is set) – asked once per session. A server that does not
 *     answer is NOT "off": it is its own state (`server-error`, asked again next time), so the settings card never claims
 *     a missing key it did not see. `enabled` only says a key is set, not that Anthropic accepts it – that shows on use.
 * Without any of it the journal is unchanged: pictures are stored as before and the values are typed by hand.
 */
import { useEffect, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { apiFetch, cloudEnabled, useCloudUser } from "@/cloud";

export type ShotExtractState = "checking" | "ready" | "no-cloud" | "signed-out" | "plan" | "server-off" | "server-error";

let statusPromise: Promise<boolean | null> | null = null;

/** Whether the server has a key to read screenshots with (once per session); `null` = the server did not answer (asked again later). */
export function shotExtractServerEnabled(): Promise<boolean | null> {
  statusPromise ??= apiFetch<{ enabled?: boolean }>("/shot-extract", { auth: false })
    .then((r): boolean | null => (r && typeof r === "object" ? r.enabled === true : null))
    .catch((): null => null);
  const p = statusPromise;
  void p.then((v) => {
    if (v === null && statusPromise === p) statusPromise = null;
  });
  return p;
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
  const [server, setServer] = useState<boolean | "error" | null>(null);
  const ask = cloud && !!user && entitled;
  useEffect(() => {
    if (!ask) return;
    let alive = true;
    void shotExtractServerEnabled().then((v) => {
      if (alive) setServer(v === null ? "error" : v);
    });
    return () => {
      alive = false;
    };
  }, [ask]);
  if (!cloud) return "no-cloud";
  if (!user) return "signed-out";
  if (!entitled) return "plan";
  if (server == null) return "checking";
  return server === "error" ? "server-error" : server ? "ready" : "server-off";
}

/** True when the screenshot import may be offered. */
export const useShotExtractAvailable = (): boolean => useShotExtractState() === "ready";

/** German explanation of a state for the settings card. */
export const SHOT_EXTRACT_STATE_TEXT: Record<ShotExtractState, string> = {
  checking: "Wird geprüft …",
  ready: "Verfügbar: Auf dem Server ist ein KI-Schlüssel hinterlegt, im Trade-Formular unter „Screenshots“ erscheint „Aus Screenshot übernehmen“. Ob Anthropic den Schlüssel annimmt, zeigt sich erst beim Auslesen.",
  "no-cloud": "Nicht verfügbar in dieser Ausgabe: Der Import braucht die Web-App mit Konto.",
  "signed-out": "Melde dich an, dann steht der Import zur Verfügung.",
  plan: "Gehört nicht zu deinem Tarif (Premium).",
  "server-off": "Auf diesem Server nicht eingerichtet: Es ist kein KI-Schlüssel hinterlegt. Der Betreiber muss ANTHROPIC_API_KEY in den Netlify-Umgebungsvariablen (Functions) setzen.",
  "server-error": "Der Server hat nicht geantwortet – ob ein KI-Schlüssel hinterlegt ist, konnte nicht geprüft werden. Öffne die Einstellungen später noch einmal.",
};
