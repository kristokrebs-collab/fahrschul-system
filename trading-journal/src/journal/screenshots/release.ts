/**
 * Cloud screenshots leave Supabase Storage with the trade (Review PRIV-01, DSGVO): a picture removed from a trade, a
 * deleted trade and an upload of an editor that was closed without saving free their object in `screenshots/<uid>/…`.
 *
 * Only targeted deletes, never a sweep over the folder: a device whose cloud sync is off (or another device) may hold
 * trades this journal does not know, so "not referenced here" alone never deletes anything. Every candidate is checked
 * against the loaded journal first – a path still referenced by any trade (a merged duplicate took the pictures) stays.
 */
import type { ScreenshotRef } from "@/domain/types";
import { useJournal } from "@/store/journalStore";
import { deleteCloudShot } from "./cloud";

/** Object paths of the cloud screenshots of a trade. */
export function cloudPathsOf(t: { screenshots?: readonly ScreenshotRef[] } | null | undefined): string[] {
  const out: string[] = [];
  for (const r of t?.screenshots ?? []) if (r.store === "cloud" && r.key) out.push(r.key);
  return out;
}

/** Paths `before` held that `after` no longer holds (a picture removed in the editor; `after` null = trade deleted). */
export function removedCloudPaths(
  before: { screenshots?: readonly ScreenshotRef[] } | null | undefined,
  after: { screenshots?: readonly ScreenshotRef[] } | null | undefined,
): string[] {
  const keep = new Set(cloudPathsOf(after));
  return cloudPathsOf(before).filter((p) => !keep.has(p));
}

/**
 * Deletes the cloud objects of `paths` that no trade of the loaded journal references any more. Best effort, never
 * throws; resolves the number of objects removed. Nothing happens before the journal is loaded.
 */
export async function releaseCloudShots(paths: Iterable<string>): Promise<number> {
  const want = new Set(paths);
  if (!want.size) return 0;
  const s = useJournal.getState();
  if (!s.loaded) return 0;
  for (const t of s.trades) for (const p of cloudPathsOf(t)) want.delete(p);
  let n = 0;
  for (const p of want) {
    try {
      if (await deleteCloudShot(p)) n += 1;
    } catch {
      /* best effort */
    }
  }
  return n;
}

/** Deletes a trade and then frees its cloud screenshots (`remove` = the store's `deleteTrade`). */
export async function deleteTradeWithShots(
  remove: (id: string) => Promise<void>,
  trade: { id: string; screenshots?: readonly ScreenshotRef[] },
): Promise<void> {
  const paths = cloudPathsOf(trade);
  await remove(trade.id);
  if (paths.length) void releaseCloudShots(paths);
}
