/**
 * The link into the Handelsplan (`#plan?symbol=AAPL&side=long`): what the page took from it and what it left out, for the line at
 * the top of the page. Applying a link fills the form (market, session, direction) in memory only (`prefill`): no plan is saved, no
 * alarm is made, nothing is sent. What the link asked for that the page does not understand is ignored and said.
 */
import { create } from "zustand";
import { linkPatch, parsePlanLink, sessionDef, type PlanLink } from "@/domain/plan";
import { usePlanForm } from "./planStore";

export interface LinkNotice {
  /** counts up so the line can come back for a new link */
  id: number;
  /** what the page took over (German, short parts) */
  applied: string[];
  /** what it could not use (German sentences) */
  ignored: string[];
}

interface ActiveLink {
  symbol: string | null;
  side: PlanLink["side"];
  query: string;
}

interface LinkState {
  notice: LinkNotice | null;
  /** the link that is in effect: its query stays in the address bar while the form still matches it */
  active: ActiveLink | null;
  dismiss(): void;
}

export const usePlanLink = create<LinkState>((set) => ({
  notice: null,
  active: null,
  dismiss: () => set({ notice: null }),
}));

let counter = 0;

/** Takes the query of `#plan?…` into the form. Returns the notice, `null` when the link asked for nothing. */
export function applyPlanLink(input: string): LinkNotice | null {
  const link = parsePlanLink(input);
  if (!link.present) {
    usePlanLink.setState({ active: null });
    return null;
  }
  const form = usePlanForm.getState();
  const before = form.form;
  const patch = linkPatch(before, link);
  if (Object.keys(patch).length) form.prefill(patch);
  const after = usePlanForm.getState().form;
  const applied: string[] = [];
  if (link.symbol) applied.push(`Markt ${after.symbol} (${link.market === "stocks" ? "US-Aktie" : "Krypto"})`);
  if (link.symbol && after.session !== before.session) applied.push(`Sitzung ${sessionDef(after.session).label}`);
  if (link.side) applied.push(`Richtung ${link.side === "long" ? "Long" : "Short"}`);
  const notice: LinkNotice = { id: ++counter, applied, ignored: link.ignored };
  usePlanLink.setState({ notice, active: link.query ? { symbol: link.symbol, side: link.side, query: link.query } : null });
  return notice;
}

/** The query the address bar shows for the page: the link's, as long as the form still is what the link asked for. */
export function currentLinkQuery(): string {
  const a = usePlanLink.getState().active;
  if (!a) return "";
  const f = usePlanForm.getState().form;
  if (a.symbol && f.symbol !== a.symbol) return "";
  if (a.side && f.sides !== a.side) return "";
  return a.query;
}
