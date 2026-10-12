/**
 * Broker reconciliation (P11, pure): the journal next to what the exchange reported.
 * - duplicates: a hand-typed trade that is the same position as a synced one (same pair and side, entries ≤ 15 min and
 *   ≤ 0.5 % apart) → merge suggestion (keep the exchange numbers, carry the trader's part over). NEVER automatic: the
 *   trader confirms each merge, the hand-typed record is only removed after that.
 * - P&L deviation: such a pair whose P&L differs by more than max(1, 1 %) – usually fees or funding missing by hand.
 * - missing: positions of the last dry run that are not in the journal yet.
 */
import { deriveTrade } from "@/domain/derive";
import type { Trade } from "@/domain/types";
import { isImported } from "./inbox";
import type { PositionCheck } from "./types";

export const MATCH_MINUTES = 15;
export const MATCH_PRICE = 0.005;

export interface DuplicatePair {
  key: string;
  synced: Trade;
  manual: Trade;
  /** 0–1, higher = surer. */
  score: number;
  syncedPnl: number | null;
  manualPnl: number | null;
  /** manual − synced, null when one side has no P&L. */
  pnlDiff: number | null;
}

export interface ReconcileReport {
  duplicates: DuplicatePair[];
  pnlDiffs: DuplicatePair[];
  missing: PositionCheck[];
  /** Synced trades seen (for the "alles stimmt" line). */
  synced: number;
}

const pairKey = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, "");
const minutes = (s: string): number => {
  const t = Date.parse(s.length === 16 ? `${s}:00` : s);
  return Number.isFinite(t) ? t / 60_000 : NaN;
};
const relDiff = (a: number | null, b: number | null): number => (a && b ? Math.abs(a - b) / Math.abs(b) : NaN);
const pnlOf = (t: Trade): number | null => deriveTrade(t).pnl;

/** Exchange-synced (has an external position id). */
const isSynced = (t: Trade): boolean => isImported(t) && !!t.externalId;

export function pnlDeviates(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.01);
}

export function reconcile(trades: readonly Trade[], dryRun: readonly PositionCheck[] = [], ignored: ReadonlySet<string> = new Set()): ReconcileReport {
  const synced = trades.filter(isSynced);
  const manual = trades.filter((t) => !isImported(t) && t.status === "closed");
  const used = new Set<string>();
  const duplicates: DuplicatePair[] = [];
  for (const s of synced) {
    const sm = minutes(s.date);
    let best: { m: Trade; score: number } | null = null;
    for (const m of manual) {
      if (used.has(m.id) || pairKey(m.pair) !== pairKey(s.pair) || m.side !== s.side) continue;
      const dt = Math.abs(minutes(m.date) - sm);
      if (!(dt <= MATCH_MINUTES)) continue;
      const dEntry = relDiff(m.entry, s.entry);
      if (Number.isFinite(dEntry) && dEntry > MATCH_PRICE) continue;
      const dExit = relDiff(m.exit, s.exit);
      if (Number.isFinite(dExit) && dExit > MATCH_PRICE * 2) continue;
      const score = 1 - 0.5 * (dt / MATCH_MINUTES) - 0.5 * (Number.isFinite(dEntry) ? dEntry / MATCH_PRICE : 0.5);
      if (!best || score > best.score) best = { m, score };
    }
    if (!best) continue;
    const key = `${s.id}|${best.m.id}`;
    if (ignored.has(key)) continue;
    used.add(best.m.id);
    const syncedPnl = pnlOf(s);
    const manualPnl = pnlOf(best.m);
    duplicates.push({
      key,
      synced: s,
      manual: best.m,
      score: Math.max(0, Math.min(1, best.score)),
      syncedPnl,
      manualPnl,
      pnlDiff: syncedPnl !== null && manualPnl !== null ? Math.round((manualPnl - syncedPnl) * 100) / 100 : null,
    });
  }
  duplicates.sort((a, b) => Math.abs(b.pnlDiff ?? 0) - Math.abs(a.pnlDiff ?? 0) || b.score - a.score);
  const ids = new Set(trades.map((t) => t.id));
  return {
    duplicates,
    pnlDiffs: duplicates.filter((d) => pnlDeviates(d.manualPnl, d.syncedPnl)),
    missing: dryRun.filter((c) => c.state === "new" && !ids.has(c.id)),
    synced: synced.length,
  };
}

/** Trader-owned fields carried from the hand-typed record into the synced one on a merge. */
const CARRY = ["setups", "checks", "conviction", "followedPlan", "emotion", "reason", "notes", "chart", "mistakes", "tags", "rating", "psych", "screenshots", "annotations", "timeframe", "account", "signal", "boxSnap"] as const;
const FILL_IF_EMPTY = ["stop", "target", "stopHistory", "targets"] as const;

const empty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

const TEXT_JOIN = new Set(["notes", "reason"]);

/**
 * The synced record with the trader's part of the hand-typed one (exchange numbers stay). Pure.
 * A field only the hand-typed record has is taken; lists (setups, tags, mistakes, screenshots, …) are united; two
 * different notes / reasons are both kept; everything else of the synced record wins.
 */
export function mergeDuplicate(synced: Trade, manual: Trade, nowIso: string): Trade {
  const out: Record<string, unknown> = { ...synced };
  const m = manual as unknown as Record<string, unknown>;
  for (const k of CARRY) {
    const mv = m[k];
    const sv = out[k];
    if (empty(mv)) continue;
    if (empty(sv)) out[k] = mv;
    else if (Array.isArray(sv) && Array.isArray(mv)) {
      const seen = new Set(sv.map((x) => JSON.stringify(x)));
      out[k] = [...sv, ...mv.filter((x) => !seen.has(JSON.stringify(x)))];
    } else if (TEXT_JOIN.has(k) && typeof sv === "string" && typeof mv === "string" && sv.trim() !== mv.trim()) out[k] = `${sv}\n\n${mv}`;
    else if (typeof sv === "object" && sv !== null && typeof mv === "object" && mv !== null && !Array.isArray(sv)) out[k] = { ...(mv as object), ...(sv as object) };
  }
  // the synced record only carries the connection's default account / an empty timeframe – the trader's choice wins
  if (!empty(m.account)) out.account = m.account;
  if (!empty(m.timeframe)) out.timeframe = m.timeframe;
  for (const k of FILL_IF_EMPTY) if (empty(out[k]) && !empty(m[k])) out[k] = m[k];
  out.updatedAt = nowIso;
  return out as unknown as Trade;
}
