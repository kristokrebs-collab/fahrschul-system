/**
 * The assistant's view of the last finished Labor run (F73 → F74): the findings of `diagnoseRun` and the headline
 * numbers, as text. Nothing is computed here – the diagnosis already holds every number; this only phrases it.
 */
import type { Diagnosis } from "@/domain/lab";
import { moneyText, pctText, rText } from "@/views/labor/ui";
import type { LabSummary } from "./tools";

const NAMES: Readonly<Record<string, string>> = { custom: "Eigene Idee", box: "Box", mcb: "MCB", rules: "Regeln" };

export function summarizeLab(d: Diagnosis | null): LabSummary | null {
  if (!d) return null;
  const net = d.costs.net;
  return {
    name: NAMES[d.strategy] ?? d.strategy,
    trades: d.n,
    net: `${moneyText(net)} (${rText(d.costs.netR)})`,
    findings: d.findings.slice(0, 6).map((f) => `${f.title}: ${f.text}`),
    facts: [
      { label: "Trades", value: String(d.n), raw: d.n, tone: "fg" },
      { label: "Ergebnis", value: moneyText(net), raw: net, tone: net > 0 ? "win" : net < 0 ? "loss" : "fg" },
      { label: "Trefferquote", value: pctText(d.payoff.winRate, 0, false), raw: d.payoff.winRate, tone: "fg" },
      { label: "Kosten", value: moneyText(-(d.costs.fees + d.costs.slippage + d.costs.funding), "USDT", false), raw: d.costs.fees + d.costs.slippage + d.costs.funding, tone: "mute" },
    ],
  };
}
