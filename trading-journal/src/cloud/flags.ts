/**
 * The operator's emergency switches as the app sees them (C4): a light store fed from the public `/api/v1/flags` (four
 * booleans, `true` = switched OFF by the operator). The sync controller stops the cloud sync while `sync` is on, the sync card
 * says why. Fails open on purpose: an unreachable flags endpoint (offline, no functions) never pauses anything – the server
 * functions enforce their own switches (`netlify/functions/_lib/killswitch.ts`); this only spares the browser a pointless
 * attempt and tells the user the truth.
 */
import { create } from "zustand";
import { apiFetch } from "./api";

export interface OpsFlags {
  sync: boolean;
  calls: boolean;
  ai: boolean;
  checkout: boolean;
  loaded: boolean;
}

export const useOpsFlags = create<OpsFlags>()(() => ({ sync: false, calls: false, ai: false, checkout: false, loaded: false }));

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/** Reads the flags once; keeps the previous state when the answer is missing or malformed. Never throws. */
export async function refreshOpsFlags(): Promise<void> {
  try {
    const r = await apiFetch<{ switches?: Record<string, unknown> }>("/flags", { auth: false });
    const s = r?.switches;
    if (!s || !isBool(s.sync) || !isBool(s.calls) || !isBool(s.ai) || !isBool(s.checkout)) return;
    useOpsFlags.setState({ sync: s.sync, calls: s.calls, ai: s.ai, checkout: s.checkout, loaded: true });
  } catch {
    /* fail open */
  }
}

export const OPS_SYNC_PAUSED = "Der Betreiber hat den Sync vorübergehend abgeschaltet. Dein Journal bleibt in diesem Browser, nichts geht verloren.";
