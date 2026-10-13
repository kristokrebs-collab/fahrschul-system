/**
 * Server-written trades → this device's journal, for signed-in devices whose cloud sync is NOT running (P11).
 * With the cloud sync live the trades arrive through Realtime anyway (journal_docs), so nothing happens here.
 *
 * The merge keeps the trader's work: a trade that exists locally only takes the exchange fields
 * (`mergeSyncedTrade`, SET / FILL rule of `syncFields.ts`); a new trade is added as the server wrote it. Small batches
 * are saved record by record; ≥ `SNAPSHOT_FROM` changes go through `importBackup(…, { mode: "merge" })`, which writes a
 * safety snapshot first. Deterministic ids (`t_bx_<positionId>`) make a repeated pull a no-op.
 */
import { normalizeTrade } from "@/domain/normalize";
import type { Trade } from "@/domain/types";
import { useSyncStatus } from "@/cloud/sync/status";
import { importBackup } from "@/store/backup";
import { freshSnapshot, useJournal } from "@/store/journalStore";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { pullServerTrades } from "./api";
import { mergeSyncedTrade } from "./syncFields";
import type { PulledTrade } from "./types";

/** From this many changes the merge runs as an import with a safety snapshot. */
export const SNAPSHOT_FROM = 10;
const PULL_KEY = storageKey("exchange-pull");
const MAX_PAGES = 20;

interface PullMark {
  userId: string;
  /** Server cursor after the newest trade merged (`next`; older marks: its `updated_at`), or the server time of an empty pull. */
  since: string | null;
}

export function readPullMark(userId: string): string | null {
  const m = readJson<PullMark | null>(PULL_KEY, null);
  return m && m.userId === userId && typeof m.since === "string" ? m.since : null;
}

export function writePullMark(userId: string, since: string | null): void {
  writeJson(PULL_KEY, { userId, since } satisfies PullMark);
}

/** True while the cloud sync of this device carries journal_docs changes itself. */
export function cloudSyncCarries(): boolean {
  const p = useSyncStatus.getState().phase;
  return p === "live" || p === "syncing" || p === "connecting";
}

export interface MergePlan {
  added: Trade[];
  updated: Trade[];
}

/** Pure: what the pulled records change in `current` (new trades, trades whose exchange fields changed). */
export function planMerge(current: readonly Trade[], pulled: readonly PulledTrade[], nowIso: string): MergePlan {
  const byId = new Map(current.map((t) => [t.id, t] as const));
  const added: Trade[] = [];
  const updated: Trade[] = [];
  const seen = new Set<string>();
  for (const p of pulled) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const incoming = { ...p.data, id: p.id };
    const local = byId.get(p.id);
    if (!local) {
      added.push(normalizeTrade(incoming));
      continue;
    }
    const merged = mergeSyncedTrade(local as unknown as Record<string, unknown>, incoming, nowIso);
    if (merged) updated.push(normalizeTrade(merged));
  }
  return { added, updated };
}

/** Writes a merge plan into the local journal; returns the number of records written. */
export async function applyMergePlan(plan: MergePlan, now = new Date()): Promise<number> {
  const all = [...plan.added, ...plan.updated];
  if (!all.length) return 0;
  if (all.length >= SNAPSHOT_FROM) {
    const res = await importBackup(JSON.stringify({ trades: all }), { mode: "merge", silent: true, now });
    return res.ok ? all.length : 0;
  }
  const save = useJournal.getState().saveTrade;
  for (const t of all) await save(t);
  return all.length;
}

export interface PullOutcome {
  added: number;
  updated: number;
  /** Skipped because the cloud sync carries the trades. */
  viaCloud: boolean;
}

/**
 * Pulls everything the server wrote since the last pull and merges it locally (unless the cloud sync carries it).
 * Never throws for an empty result; API errors propagate (the caller shows them).
 */
export async function pullAndMerge(userId: string, now = new Date()): Promise<PullOutcome> {
  let since = readPullMark(userId);
  const viaCloud = cloudSyncCarries();
  let added = 0;
  let updated = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await pullServerTrades(since);
    const last = res.trades.length ? res.trades[res.trades.length - 1]!.updatedAt : null;
    if (!viaCloud && res.trades.length) {
      const plan = planMerge(freshSnapshot().trades, res.trades, now.toISOString());
      const wanted = plan.added.length + plan.updated.length;
      const written = await applyMergePlan(plan, now);
      // nothing written although something was due (storage full, snapshot failed): keep the mark, try again later
      if (wanted > 0 && written === 0) throw new Error("Die importierten Trades konnten lokal nicht gespeichert werden.");
      added += plan.added.length;
      updated += plan.updated.length;
    }
    // `next` is a keyset cursor (updated_at, id): one sync chunk shares one updated_at, a bare timestamp would skip or repeat
    since = res.next ?? last ?? (since === null ? res.serverAt : since);
    writePullMark(userId, since);
    if (!res.more) break;
  }
  return { added, updated, viaCloud };
}
