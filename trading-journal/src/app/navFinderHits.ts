/**
 * The answers of the navigation's finder (lazy chunk with the function register and its scorer): what the person typed →
 * functions AND pages, best first, as the `SearchField` options (name, task in plain words, where it lives). Nothing is stored.
 * Fetched with the first typed letter (`NavFinder.tsx`); the first load knows only the field.
 */
import { groupOf, placeText, searchTargets, type TargetHit } from "@/app/featureQuery";
import { isPageTargetId } from "@/app/pageTargets";
import type { SearchOption } from "@/primitives/SearchField";

/** How many answers the finder shows. */
export const SHOWN = 6;

export type HitKind = "page" | "feature";
export const kindOf = (h: TargetHit): HitKind => (isPageTargetId(h.entry.id) ? "page" : "feature");

/** All answers for `query` (not cut): the caller filters by chip and cuts. */
export function findHits(query: string): TargetHit[] {
  return searchTargets(query);
}

/** An answer as a field option: `data-feature` carries the id (a page: `page:<page>`), `data-kind` its kind. */
export function toOption(h: TargetHit): SearchOption {
  const page = kindOf(h) === "page";
  return {
    id: h.entry.id,
    label: h.entry.name,
    description: h.entry.task ?? (page ? "" : groupOf(h.entry).name),
    meta: page ? "Seite" : `${groupOf(h.entry).name} · ${placeText(h.entry)}`,
    attrs: { "data-feature": h.entry.id, "data-kind": page ? "page" : "feature" },
  };
}
