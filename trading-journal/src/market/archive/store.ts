/**
 * Archive switch and status (F26): the device-local configuration (`tj2-archive-cfg`, default OFF – see
 * `@/domain/archive/config`) and the run status the view shows. Small and free of the collector, so the shell can read the
 * switch without loading it: the collector's chunk is fetched only while the switch is on.
 *
 * Browser storage can be empty or blocked (private window): the configuration then lives in memory for the session.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_ARCHIVE_CFG, parseArchiveCfg, withArchiveCfg, type ArchiveCfg } from "@/domain/archive";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const ARCHIVE_CFG_KEY = storageKey("archive-cfg");

let cfg: ArchiveCfg | null = null;
const cfgListeners = new Set<() => void>();

export function getArchiveCfg(): ArchiveCfg {
  if (!cfg) cfg = parseArchiveCfg(readJson<unknown>(ARCHIVE_CFG_KEY, null));
  return cfg;
}

/** Changes the configuration (the same object comes back when nothing changed). */
export function setArchiveCfg(patch: Partial<Omit<ArchiveCfg, "v">>): ArchiveCfg {
  const cur = getArchiveCfg();
  const next = withArchiveCfg(cur, patch);
  if (next === cur) return cur;
  cfg = next;
  writeJson(ARCHIVE_CFG_KEY, next);
  for (const l of [...cfgListeners]) l();
  return next;
}

export function subscribeArchiveCfg(cb: () => void): () => void {
  cfgListeners.add(cb);
  return () => void cfgListeners.delete(cb);
}

export const useArchiveCfg = (): ArchiveCfg => useSyncExternalStore(subscribeArchiveCfg, getArchiveCfg, () => DEFAULT_ARCHIVE_CFG);

/** `true` while the switch is on (the shell mounts the collector's chunk only then). */
export const useArchiveOn = (): boolean => useSyncExternalStore(subscribeArchiveCfg, () => getArchiveCfg().on, () => false);

/* ------------------------------------------------------------------------------------------------ run status */

export type RunState =
  /** the switch is off */
  | "off"
  | "starting"
  /** waiting for the next tick */
  | "idle"
  | "ticking"
  /** no symbol to archive */
  | "empty"
  /** the browser's storage is (nearly) full */
  | "quota"
  /** no IndexedDB in this browser / window */
  | "unavailable"
  | "error";

export interface ArchiveStatus {
  state: RunState;
  detail: string | null;
  lastTickAt: number | null;
  nextTickAt: number | null;
  /** per symbol of the last tick: `ok`, `partial:<reason>` or the reason */
  lastRes: Readonly<Record<string, string>> | null;
  route: "direct" | "proxy" | null;
  /** ticks of this session */
  ticks: number;
  /** bumps whenever the store's content changed (a tick, a deletion) – the view reloads its overview on it */
  rev: number;
}

export const IDLE_STATUS: ArchiveStatus = { state: "off", detail: null, lastTickAt: null, nextTickAt: null, lastRes: null, route: null, ticks: 0, rev: 0 };

let status: ArchiveStatus = IDLE_STATUS;
const statusListeners = new Set<() => void>();

export const getArchiveStatus = (): ArchiveStatus => status;

export function patchArchiveStatus(patch: Partial<ArchiveStatus>): void {
  status = { ...status, ...patch };
  for (const l of [...statusListeners]) l();
}

/** The view asks for a fresh overview (after a deletion, an import …). */
export function bumpArchiveRev(): void {
  patchArchiveStatus({ rev: status.rev + 1 });
}

export function subscribeArchiveStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => void statusListeners.delete(cb);
}

export const useArchiveStatus = (): ArchiveStatus => useSyncExternalStore(subscribeArchiveStatus, getArchiveStatus, () => IDLE_STATUS);

/** Tests: forget the in-memory copies. */
export function __resetArchiveStore(): void {
  cfg = null;
  status = IDLE_STATUS;
  cfgListeners.clear();
  statusListeners.clear();
}
