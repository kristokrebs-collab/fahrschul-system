/**
 * The multi-timeframe signal setup `s_mtf`, shared by both editions – texts and checklist ids 1:1 from the other
 * journal version (branch `claude/dreamy-dirac-uwi1be`, `lib.ts` `MTF_SETUP`) so trades and settings flow between
 * both apps losslessly (`checks["s_mtf:mtf_base"]` …). PURE LITERAL.
 */
import type { Setup } from "../types";

export const MTF_SETUP: Setup = {
  id: "s_mtf",
  name: "Multi-TF Signal (MCB + RSI + Discount)",
  account: "both",
  color: "#9aa9bb",
  desc: "Ab 30m: MCB zeigt Bottom/Einstieg (Short: Top), die nächst höhere Timeframe bestätigt, die dritte macht den Einstieg stärker. RSI nahe überverkauft/überkauft, Discount (Short: Premium) ist Bonus. Wird live geprüft.",
  checklist: [
    { id: "mtf_base", text: "MCB-Signal auf der Basis-Timeframe (mind. 30m)" },
    { id: "mtf_next", text: "Nächst höhere Timeframe bestätigt" },
    { id: "mtf_third", text: "Dritte Timeframe bestätigt (stärker)" },
    { id: "mtf_rsi", text: "RSI nahe überverkauft (Short: überkauft)" },
    { id: "mtf_zone", text: "Preis im Discount (Short: Premium)" },
  ],
};
