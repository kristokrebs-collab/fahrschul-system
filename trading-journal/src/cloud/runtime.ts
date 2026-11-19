/**
 * Light entry to the lazy cloud chunk (P09). Nothing here imports `@supabase/supabase-js`:
 * - `ensureCloud()` loads `client.ts` (Supabase client + auth listener + sync controller) once and resolves with it;
 * - `bootCloud()` (the host, on mount) loads it only when a session is stored or an auth callback is in the URL –
 *   a visitor who never signed in never downloads the Supabase chunk; otherwise the phase becomes `signedOut` at once;
 * - `setSyncEntitled()` passes the plan gate (`useEntitlement("cloudSync")`, P10) to the sync controller.
 */
import { create } from "zustand";
import { cloudEnabled } from "./env";
import { hasAuthCallback, hasStoredSession } from "./hint";
import { useCloudSession } from "./session";

type ClientModule = typeof import("./client");

let loading: Promise<ClientModule> | null = null;

/** Loads and initialises the Supabase client chunk (once). Rejects when the cloud is not configured. */
export function ensureCloud(): Promise<ClientModule> {
  if (!cloudEnabled()) return Promise.reject(new Error("Cloud nicht eingerichtet"));
  loading ??= import("./client")
    .then(async (m) => {
      await m.initClient();
      return m;
    })
    .catch((e: unknown) => {
      loading = null;
      if (useCloudSession.getState().phase === "loading") useCloudSession.setState({ phase: "signedOut" });
      throw e;
    });
  return loading;
}

/** True once the client chunk was requested (sign-out etc. only talk to Supabase then). */
export function cloudLoaded(): boolean {
  return loading !== null;
}

/** Host boot: restore a stored login (lazy chunk) or settle as signed out without loading anything. */
export function bootCloud(): void {
  if (!cloudEnabled()) return;
  // a login with sync paused is restored as well (account panel, security)
  if (hasStoredSession() || hasAuthCallback()) {
    void ensureCloud().catch(() => undefined);
    return;
  }
  const s = useCloudSession.getState();
  if (s.phase === "idle") useCloudSession.setState({ phase: "signedOut" });
}

/** Signs out (`local` = this device only, `global` = every device). No-op when the client never loaded. */
export async function signOut(scope: "local" | "global" | "others" = "local"): Promise<void> {
  if (!cloudLoaded()) return;
  const m = await ensureCloud();
  await m.signOutScope(scope);
}

/** Plan gate of the sync (`useEntitlement("cloudSync")` → host → here). */
export const useSyncGate = create<{ entitled: boolean }>()(() => ({ entitled: true }));

export function setSyncEntitled(entitled: boolean): void {
  if (useSyncGate.getState().entitled !== entitled) useSyncGate.setState({ entitled });
}
