/**
 * „In Handelsplan übernehmen“: opens the Handelsplan with the candidate's numbers in the form – direction, entry price, stop and
 * target as own prices. Nothing is ordered, nothing is saved (the plan form is only prefilled in memory, like a link into the
 * plan), no paper or journal entry is made; those are the plan's own buttons the trader presses himself. Loaded on demand.
 */
import type { CandidateSignal } from "@/domain/lab/search";

const round = (x: number): number => Number(x.toPrecision(8));

export async function openCandidateInPlan(symbol: string, sig: CandidateSignal): Promise<void> {
  const [{ usePlanForm }, { usePlanLink }, { formPatchFor, symbolMarket }, { openFeature }, { price, n2 }] = await Promise.all([
    import("@/views/plan/planStore"),
    import("@/views/plan/linkStore"),
    import("@/domain/plan"),
    import("@/app/featureOpen"),
    import("@/lib/format"),
  ]);
  const store = usePlanForm.getState();
  const market = symbolMarket(symbol) ?? "crypto";
  const switched = formPatchFor(store.form, { symbol, market });
  store.prefill({
    ...switched,
    sides: sig.side,
    manualSide: sig.side,
    manualEntry: round(sig.entry),
    stop: { kind: "price", price: round(sig.stop) },
    ...(sig.target != null ? { target: { kind: "price", price: round(sig.target) } } : {}),
  });
  const applied = [`${symbol}`, sig.side === "long" ? "Long" : "Short", `Einstieg ${price(sig.entry)}`, `Stop ${price(sig.stop)}`, ...(sig.target != null ? [`Ziel ${price(sig.target)} (${n2(sig.targetR)} R)`] : [])];
  usePlanLink.setState({ notice: { id: Date.now(), applied, ignored: [], source: "Aus deiner Strategiesuche übernommen:" }, active: null });
  openFeature("page:plan");
}
