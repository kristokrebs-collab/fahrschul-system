/**
 * The scenarios of the Kosten- und Belastungstest (F20), built from the engine set-up of the run. Each is the SAME run with
 * one thing made worse (or removed): fees ×2, slippage ×2, funding off / on / doubled, one candle later, a tighter / wider
 * stop, and a combination. Where the run lacks the data a scenario needs (no funding history in a run without funding, no
 * slippage to double) the scenario is NOT blocked: it runs with a stated substitute (`approx`) or says why it cannot
 * (`unavailable`) – the note names the reason.
 */
import { DEFAULT_FUNDING_RATE } from "../../backtest/fees";
import type { EngineCfg, FundingModel, SlippageModel } from "../../backtest/types";
import type { ScenarioGroup, ScenarioId, ScenarioStatus } from "./types";

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  group: ScenarioGroup;
  status: ScenarioStatus;
  note: string | null;
  /** the engine set-up of the scenario (null for `unavailable`) */
  engine: EngineCfg | null;
  /** execute every order one candle later */
  delay: boolean;
  /** scale of the stop distance (1 = as the strategy gave it) */
  stopFactor: number;
}

/** Stop distance of the tighter / wider scenarios. */
export const STOP_TIGHT = 0.75;
export const STOP_WIDE = 1.5;
/** The flat slippage a run without slippage is stressed with (bp per market fill). */
export const SLIPPAGE_SUBSTITUTE_BPS = 2;

const de = (v: number): string => String(Math.round(v * 100) / 100).replace(".", ",");

function doubleSlippage(m: SlippageModel): { model: SlippageModel; approx: boolean } {
  switch (m.kind) {
    case "fixed":
      return { model: { kind: "fixed", bps: m.bps * 2 }, approx: false };
    case "spread":
      return { model: { kind: "spread", bps: m.bps * 2 }, approx: false };
    case "atr":
      return { model: { kind: "atr", frac: m.frac * 2 }, approx: false };
    case "none":
      return { model: { kind: "fixed", bps: SLIPPAGE_SUBSTITUTE_BPS }, approx: true };
  }
}

function doubleFunding(f: FundingModel): { model: FundingModel; approx: boolean } {
  switch (f.kind) {
    case "history":
      return { model: { kind: "history", points: f.points.map((p) => ({ t: p.t, rate: p.rate * 2 })), fallbackRate: f.fallbackRate * 2 }, approx: false };
    case "flat":
      return { model: { kind: "flat", ratePer8h: f.ratePer8h * 2 }, approx: false };
    case "none":
      return { model: { kind: "flat", ratePer8h: DEFAULT_FUNDING_RATE * 2 }, approx: true };
  }
}

const NO_FUNDING_DATA = `Der Lauf hatte kein Funding und damit keine Historie dafür; gerechnet mit pauschal ${de(DEFAULT_FUNDING_RATE * 100)} % je 8 h (Annahme, nicht gemessen).`;

/** The scenario table for an engine set-up (the base first). */
export function scenarioDefs(base: EngineCfg): ScenarioDef[] {
  const withCosts = (costs: Partial<EngineCfg["costs"]>): EngineCfg => ({ ...base, costs: { ...base.costs, ...costs } });
  const out: ScenarioDef[] = [];
  const add = (d: Partial<ScenarioDef> & Pick<ScenarioDef, "id" | "label" | "group">): void => {
    out.push({ status: "ok", note: null, engine: base, delay: false, stopFactor: 1, ...d });
  };

  add({ id: "base", label: "Basislauf", group: "base", note: "Derselbe Lauf noch einmal gerechnet, so wie er oben steht." });

  const f = base.costs.fees;
  const fees2 = withCosts({ fees: { ...f, makerBps: f.makerBps * 2, takerBps: f.takerBps * 2 } });
  if (f.makerBps <= 0 && f.takerBps <= 0) add({ id: "fees2", label: "Gebühren ×2", group: "costs", status: "unavailable", engine: null, note: "Der Lauf rechnet ohne Gebühren; das Doppelte davon bliebe null." });
  else add({ id: "fees2", label: "Gebühren ×2", group: "costs", engine: fees2, note: `Maker ${de(f.makerBps * 2)} bp, Taker ${de(f.takerBps * 2)} bp.` });

  const s2 = doubleSlippage(base.costs.slippage);
  add({
    id: "slip2",
    label: s2.approx ? `Slippage ${de(SLIPPAGE_SUBSTITUTE_BPS)} bp` : "Slippage ×2",
    group: "costs",
    status: s2.approx ? "approx" : "ok",
    engine: withCosts({ slippage: s2.model }),
    note: s2.approx ? `Der Lauf rechnete ohne Slippage, es gibt nichts zu verdoppeln. Stattdessen ${de(SLIPPAGE_SUBSTITUTE_BPS)} bp je Market-Fill (Annahme).` : null,
  });

  const fund = base.costs.funding;
  add({ id: "fundOff", label: "Ohne Funding", group: "funding", engine: withCosts({ funding: { kind: "none" } }), note: fund.kind === "none" ? "Der Lauf hatte schon kein Funding; gleiches Ergebnis wie der Basislauf." : null });
  if (fund.kind === "none") add({ id: "fundOn", label: "Mit Funding", group: "funding", status: "approx", engine: withCosts({ funding: { kind: "flat", ratePer8h: DEFAULT_FUNDING_RATE } }), note: NO_FUNDING_DATA });
  else add({ id: "fundOn", label: "Mit Funding", group: "funding", engine: base, note: fund.kind === "history" ? "Der Lauf rechnet schon mit der echten Funding-Historie; gleiches Ergebnis wie der Basislauf." : "Der Lauf rechnet schon mit pauschalem Funding; gleiches Ergebnis wie der Basislauf." });
  const f2 = doubleFunding(fund);
  add({ id: "fund2", label: "Funding ×2", group: "funding", status: f2.approx ? "approx" : "ok", engine: withCosts({ funding: f2.model }), note: f2.approx ? NO_FUNDING_DATA.replace("pauschal", "doppelt, pauschal") : null });

  add({ id: "delay1", label: "1 Kerze später", group: "timing", delay: true, note: "Jede Order wird erst eine Kerze nach dem Signal gestellt; Stop und Ziel behalten ihre Preise." });
  add({ id: "stopTight", label: `Engerer Stopp (×${de(STOP_TIGHT)})`, group: "stop", stopFactor: STOP_TIGHT, note: "Stopp-Abstand verkleinert, Ziel bleibt auf demselben Preis. Positionsgröße passt sich dem Risiko an." });
  add({ id: "stopWide", label: `Weiterer Stopp (×${de(STOP_WIDE)})`, group: "stop", stopFactor: STOP_WIDE, note: "Stopp-Abstand vergrößert, Ziel bleibt auf demselben Preis. Positionsgröße passt sich dem Risiko an." });

  const combinedNote = ["Gebühren ×2", s2.approx ? `Slippage ${de(SLIPPAGE_SUBSTITUTE_BPS)} bp` : "Slippage ×2", "1 Kerze später"].join(" + ") + ".";
  add({ id: "combined", label: "Alles zusammen", group: "combined", status: s2.approx ? "approx" : "ok", delay: true, engine: { ...fees2, costs: { ...fees2.costs, slippage: s2.model } }, note: combinedNote });
  return out;
}
