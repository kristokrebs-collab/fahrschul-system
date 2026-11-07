/**
 * The deep-link seam of the Handelsplan (`#plan?symbol=…&side=…`), loaded by the router on first use (`SEAM_LOADERS`): the
 * router hands the query to `apply`, which fills market and direction in memory (see `linkStore.ts`); the address then shows the
 * link only as long as the form still matches it, so a reload or a shared address never brings back a choice the person has since
 * changed. Not part of the first load.
 */
import type { QuerySeam } from "@/store/router";
import { applyPlanLink, currentLinkQuery } from "./linkStore";
import { usePlanForm } from "./planStore";

export const planSeam: QuerySeam = {
  apply: (query) => void applyPlanLink(query),
  query: currentLinkQuery,
  subscribe: (onChange) => usePlanForm.subscribe((s, p) => (s.form.symbol !== p.form.symbol || s.form.sides !== p.form.sides) && onChange()),
};
