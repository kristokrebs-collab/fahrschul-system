/**
 * The command navigation's deep links into the function register: the functions the user opened last (the search's own
 * recent list, `feature:<id>`), as `{ id, name }`. A module of its own so that the navigation – part of the first load – only
 * knows THIS file name and loads the register (`features.ts`, a lazy chunk) with a dynamic import, and only when there is
 * something recent to show.
 */
import { recentFeatures } from "@/app/featureQuery";

export interface FeatureChip {
  id: string;
  name: string;
}

export function recentChips(recentIds: readonly string[], k = 4): FeatureChip[] {
  return recentFeatures(recentIds, k).map((f) => ({ id: f.id, name: f.name }));
}
