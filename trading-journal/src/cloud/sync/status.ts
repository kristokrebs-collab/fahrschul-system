/**
 * Sync status (P09) – light zustand store the sync engine writes and the UI reads (header pill, SyncStatusCard).
 * `pings` counts realtime patches and successful uploads; `StatusPill pingKey={pings}` turns it into ≤ 4 pings/s.
 */
import { create } from "zustand";

export type SyncPhase =
  | "off" // not signed in / no cloud
  | "paused" // signed in, sync switched off on this device (PrivacyCard)
  | "locked" // signed in, waiting for the 2FA code (aal2)
  | "connecting"
  | "syncing" // initial reconcile / upload in progress
  | "live"
  | "offline" // network gone – changes queue up locally
  | "error"; // something the user has to look at (`error`)

export interface SyncStatus {
  phase: SyncPhase;
  /** Local changes waiting for upload (outbox). */
  pending: number;
  /** Last completed sync (ISO). */
  lastSyncAt: string | null;
  /** +1 per realtime patch / successful upload. */
  pings: number;
  /** Upload progress of the current reconcile (records). */
  progress: { done: number; total: number } | null;
  /** Realtime channel subscribed. */
  realtime: boolean;
  /** Conflicts resolved by the last reconcile. */
  conflicts: number;
  /** Records known to be in sync (size of the sync base). */
  records: number;
  /** German message for `error` / `offline`. */
  error: string | null;
}

export const SYNC_IDLE: SyncStatus = { phase: "off", pending: 0, lastSyncAt: null, pings: 0, progress: null, realtime: false, conflicts: 0, records: 0, error: null };

export const useSyncStatus = create<SyncStatus>()(() => ({ ...SYNC_IDLE }));

export function patchSyncStatus(p: Partial<SyncStatus>): void {
  useSyncStatus.setState(p);
}

export function pingSync(): void {
  useSyncStatus.setState((s) => ({ pings: s.pings + 1 }));
}

export function resetSyncStatus(): void {
  useSyncStatus.setState({ ...SYNC_IDLE });
}
