/**
 * Sync controller (P09, lazy chunk): switches the journal between the local adapter and the Supabase sync adapter.
 * Sync runs while ALL hold: signed in, 2FA satisfied (aal2 when enrolled – the database refuses the journal before),
 * `privacy.sync` on for this device, the plan includes `cloudSync` (P10 gate), not on claude.ai. Anything else →
 * the local adapter (the local journal stays as it is – signing out never deletes it).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import { writeSnapshot } from "@/store/backup";
import { hasClaudeRuntime } from "@/store/capability";
import { getAdapter, switchAdapter, useJournal } from "@/store/journalStore";
import { KEY_PREFIX } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { usePrivacy } from "../privacy";
import { useSyncGate } from "../runtime";
import { useCloudSession } from "../session";
import { localBaseStore } from "./base";
import { createOutbox, idbOutboxStorage } from "./outbox";
import { createSupabaseRemote } from "./remote";
import { patchSyncStatus, resetSyncStatus, type SyncPhase } from "./status";
import { createSupabaseAdapter, type SupabaseAdapter } from "./supabaseAdapter";

let active: { userId: string; adapter: SupabaseAdapter } | null = null;

/** The running sync adapter (SyncStatusCard → `syncNow`). */
export function activeSync(): SupabaseAdapter | null {
  return active?.adapter ?? null;
}

function idlePhase(): SyncPhase {
  const s = useCloudSession.getState();
  if (s.phase !== "signedIn") return "off";
  if (s.needsMfa) return "locked";
  if (!usePrivacy.getState().sync) return "paused";
  return "off";
}

export function startSyncController(sb: SupabaseClient): () => void {
  let disposed = false;
  const evaluate = () => {
    if (disposed) return;
    const s = useCloudSession.getState();
    const want = s.phase === "signedIn" && !!s.user && !s.needsMfa && usePrivacy.getState().sync && useSyncGate.getState().entitled && !hasClaudeRuntime();
    const uid = want ? s.user!.id : null;
    if (uid && active?.userId === uid) return;
    if (active) {
      // the switch disposes the sync adapter (engine stopped, realtime closed; the outbox stays in IndexedDB)
      active = null;
      void switchAdapter(createLocalAdapter(), { mode: "local" });
    }
    if (uid) {
      const adapter = createSupabaseAdapter({
        userId: uid,
        remote: createSupabaseRemote(sb, uid),
        outbox: createOutbox(idbOutboxStorage(`${KEY_PREFIX}cloud`, uid)),
        base: localBaseStore,
        snapshot: (tag, snap) => writeSnapshot(tag, snap),
        notify: (t) => pushToast(t),
      });
      active = { userId: uid, adapter };
      void switchAdapter(adapter).then((ok) => {
        if (!ok && active?.adapter === adapter) active = null;
      });
      return;
    }
    resetSyncStatus();
    patchSyncStatus({ phase: idlePhase() });
    // the boot kept "Verbinde …" for a stored login that will not sync (expired, 2FA pending, paused): settle local
    if (s.phase !== "loading" && s.phase !== "idle" && useJournal.getState().mode === "connecting" && getAdapter()?.mode === "local") useJournal.getState().setMode("local");
  };
  const offs = [useCloudSession.subscribe(evaluate), usePrivacy.subscribe(evaluate), useSyncGate.subscribe(evaluate)];
  evaluate();
  return () => {
    disposed = true;
    for (const off of offs) off();
    if (active) {
      active = null;
      void switchAdapter(createLocalAdapter(), { mode: "local" });
    }
  };
}
