/**
 * "Neu seit deinem letzten Besuch": a report is new when its document number was not in the index at the last visit. The last
 * visit is a local record (document numbers + a time stamp on this device, the view keeps it) – no server knows it. At the first
 * visit nothing is marked (there is nothing to compare with, and the app says so). Pure.
 */

export interface SeenRecord {
  /** ms epoch of the last visit */
  at: number;
  /** every document number the index listed then */
  docIds: string[];
}

/** The reports of `docIds` that were not listed at the last visit; none at all without a record. */
export function freshDocIds(docIds: readonly string[], seen: SeenRecord | null): Set<string> {
  if (!seen) return new Set();
  const known = new Set(seen.docIds);
  return new Set(docIds.filter((d) => !known.has(d)));
}

/** A record of what the index lists now (merged with the earlier one, so a report that fell out of a window stays known). */
export function nextSeen(docIds: readonly string[], at: number, earlier: SeenRecord | null, max = 2400): SeenRecord {
  const all = [...new Set([...(earlier?.docIds ?? []), ...docIds])];
  // the newest numbers are the largest; keep the tail when the record grows past the bound
  return { at, docIds: all.length > max ? all.sort().slice(-max) : all };
}

/** Reads a stored record leniently (anything else is "no record"). */
export function seenOf(raw: unknown): SeenRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { at, docIds } = raw as { at?: unknown; docIds?: unknown };
  if (typeof at !== "number" || !Number.isFinite(at) || !Array.isArray(docIds)) return null;
  return { at, docIds: docIds.filter((d): d is string => typeof d === "string").slice(0, 5000) };
}
