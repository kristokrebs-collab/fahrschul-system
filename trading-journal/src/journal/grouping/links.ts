/**
 * Manual trade links (Review F04): the trader groups records of one idea (`groupId`) or marks a trade as the hedge of
 * another (`hedgeOf`) – `domain/grouping.ts` already folds both, but nothing wrote them. Pure helpers; the UI is
 * `GroupLinksSection` in the trade detail.
 */
import { pairKey, type GroupableTrade } from "@/domain/grouping";
import { newId } from "@/lib/ids";

/** How far apart (entry time) a candidate may lie. */
export const LINK_WINDOW_MS = 14 * 86_400_000;
/** Candidates offered at most. */
export const LINK_MAX = 6;

const entry = (t: Pick<GroupableTrade, "date">) => {
  const ms = Date.parse(t.date);
  return Number.isFinite(ms) ? ms : NaN;
};

/** Trades of the same pair around this one (nearest first) that could be grouped with it or hedge it. */
export function linkCandidates<T extends GroupableTrade>(trade: T, all: readonly T[], max = LINK_MAX): T[] {
  const key = pairKey(trade.pair);
  const at = entry(trade);
  if (!key || !Number.isFinite(at)) return [];
  return all
    .filter((o) => o.id !== trade.id && pairKey(o.pair) === key && Math.abs(entry(o) - at) <= LINK_WINDOW_MS)
    .sort((a, b) => Math.abs(entry(a) - at) - Math.abs(entry(b) - at))
    .slice(0, max);
}

export interface LinkPatch {
  id: string;
  set: Partial<Pick<GroupableTrade, "groupId" | "hedgeOf">>;
  unset?: ("groupId" | "hedgeOf")[];
}

/** Group `a` and `b`: both get the group id one of them already has, else a new `grp_…`. */
export function groupPatches(a: Pick<GroupableTrade, "id" | "groupId">, b: Pick<GroupableTrade, "id" | "groupId">): LinkPatch[] {
  const gid = a.groupId || b.groupId || newId("grp_");
  const out: LinkPatch[] = [];
  if (a.groupId !== gid) out.push({ id: a.id, set: { groupId: gid } });
  if (b.groupId !== gid) out.push({ id: b.id, set: { groupId: gid } });
  return out;
}

/** `trade` hedges `other` (opposite sides only). */
export function hedgePatch(trade: Pick<GroupableTrade, "id" | "side">, other: Pick<GroupableTrade, "id" | "side">): LinkPatch | null {
  if (trade.side === other.side || trade.id === other.id) return null;
  return { id: trade.id, set: { hedgeOf: other.id } };
}

/** Leave the group / hedge: removes this trade's own links (others pointing at it as their hedge stay theirs). */
export function unlinkPatch(trade: Pick<GroupableTrade, "id" | "groupId" | "hedgeOf">): LinkPatch | null {
  const unset = (["groupId", "hedgeOf"] as const).filter((k) => !!trade[k]);
  return unset.length ? { id: trade.id, set: {}, unset: [...unset] } : null;
}

/** Applies a patch to a stored record (a copy). */
export function applyLinkPatch<T extends object>(t: T, p: LinkPatch, nowIso: string): T {
  const next: Record<string, unknown> = { ...(t as Record<string, unknown>), ...p.set, updatedAt: nowIso };
  for (const k of p.unset ?? []) delete next[k];
  return next as T;
}
