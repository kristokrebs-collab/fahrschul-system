/**
 * "Eigene Idee" (F73): the lab strategy whose entry is the user's own rule tree (`@/domain/lab/rules`). Registered like
 * the three templates. Preparation (once per data set): the optional MCB-ladder verdicts, then every leaf of the active
 * sides evaluated onto the execution bars (a higher timeframe only through its CLOSED bars) and the AND / OR trees
 * combined. `build(params)` is a cheap loop: a NEW signal is the rising edge of a side's tree (true now, not true at the
 * previous close), filled at the next open by the engine. Stop = ATR × k / percent / swing, target = R multiples, plus the
 * position management of F65 (break-even, trailing, partial take-profit, time stop) and an optional exit on a NEW
 * counter signal. When both sides fire on the same close nothing is traded (counted as a conflict).
 */
import { DEFAULT_SIGNAL_CFG, type SignalCfg } from "../../signals/config";
import {
  activeLeaves,
  combineTree,
  defaultCustom,
  evaluateLeaves,
  higherTfsOf,
  leafText,
  leavesOf,
  needsLadder,
  nodeText,
  sanitizeCustom,
  sidesOf,
  warmupMsOf,
  type Combined,
} from "../../lab/rules/tree";
import { TRUE, UNKNOWN, type CustomConfig, type Group, type Node, type StopCfg, type TfId } from "../../lab/rules/types";
import { atrSeries } from "../bars";
import type { Bar, BarsBy, BtSide, BtStrategy, EntrySignal, FundingPoint, HistInterval, PositionMgmt } from "../types";
import { mcbLadder, type McbFacts, type McbStep } from "./mcbLadder";
import type { FunnelNode, LabStrategy, ParamSpec, Params, Prepared, Stepper, StrategyFunnel, StrategyVariant } from "./types";

export interface CustomCfgIn {
  config: CustomConfig;
  /** the app's MCB / signal setting: WaveTrend parameters, swing size, ladder */
  signal: SignalCfg;
  /** the funding history of the run (only when it has one) – the block "Funding-Extrem" reads it */
  funding?: readonly FundingPoint[] | null;
}

export interface CustomFacts {
  config: CustomConfig;
  /** raw leaf series (no `not`) over the execution bars, by leaf id */
  leaves: Map<string, Uint8Array>;
  long: Combined | null;
  short: Combined | null;
}

export const defaultCustomIn = (signal: SignalCfg = DEFAULT_SIGNAL_CFG): CustomCfgIn => ({ config: defaultCustom(), signal });

const cfgOf = (c: CustomCfgIn): CustomConfig => sanitizeCustom(c.config);

const de = (v: number): string => String(Math.round(v * 100) / 100).replace(".", ",");

/** Distinct values: the configured one first, then scaled neighbours on a grid step. */
function neighbours(base: number, factors: readonly number[], step: number, min: number, max: number): number[] {
  const out = [base];
  for (const f of factors) {
    const v = Math.min(max, Math.max(min, Math.round((base * f) / step) * step));
    const r = Math.round(v * 10_000) / 10_000;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

function stopSpec(s: StopCfg): ParamSpec {
  if (s.kind === "atr") return { key: "stopK", label: "Stop", options: neighbours(s.atr, [0.67, 1.5], 0.25, 0.3, 10), format: (v) => `${de(Number(v))} × ATR`, grid: true };
  if (s.kind === "percent") return { key: "stopK", label: "Stop", options: neighbours(s.pct, [0.67, 1.5], s.pct < 1 ? 0.05 : 0.25, 0.05, 30), format: (v) => `${de(Number(v))} %`, grid: true };
  return { key: "stopK", label: "Stop", options: [...new Set(neighbours(s.swing, [0.5, 1.5], 1, 2, 200).map((v) => Math.round(v)))], format: (v) => `${v}-Kerzen-Swing`, grid: true };
}

/** Management handed to the engine with every entry (absent = the plain stop / target). */
export function manageOf(cfg: CustomConfig): PositionMgmt | undefined {
  const e = cfg.exits;
  const m: PositionMgmt = {};
  if (e.breakEven.on) m.breakEven = { after: { kind: e.breakEven.trigger, value: e.breakEven.value }, to: e.breakEven.to };
  if (e.trail.on) m.trail = { kind: e.trail.kind, value: e.trail.value, activateR: e.trail.activateR };
  if (e.partial.on) m.partial = { atR: e.partial.atR, frac: e.partial.fracPct / 100, thenBreakEven: e.partial.thenBreakEven };
  return m.breakEven || m.trail || m.partial ? m : undefined;
}

const edgeAt = (hit: Uint8Array | null | undefined, i: number): boolean => !!hit && hit[i] === TRUE && (i === 0 || hit[i - 1] !== TRUE);

/** The strategy for one parameter set; `exits` false drops the position management (comparison variant). */
function makeStrategy(prep: Prepared<CustomFacts>, params: Params, exits: boolean): BtStrategy {
  const { config: cfg, long, short } = prep.facts;
  const stopK = Number(params.stopK ?? (cfg.stop.kind === "atr" ? cfg.stop.atr : cfg.stop.kind === "percent" ? cfg.stop.pct : cfg.stop.swing));
  const targetR = Number(params.targetR ?? cfg.target.r);
  const manage = exits ? manageOf(cfg) : undefined;
  const maxBars = exits && cfg.exits.maxBars > 0 ? cfg.exits.maxBars : null;
  const bars = prep.bars;
  const longHit = long?.hit ?? null;
  const shortHit = short?.hit ?? null;
  const title = cfg.name;

  const stopFor = (side: BtSide, i: number): number | null => {
    const close = bars[i]!.c;
    const atr = prep.atr[i] ?? 0;
    const dir = side === "long" ? 1 : -1;
    let stop: number;
    if (cfg.stop.kind === "atr") {
      if (!(atr > 0)) return null;
      stop = close - dir * stopK * atr;
    } else if (cfg.stop.kind === "percent") {
      stop = close * (1 - (dir * stopK) / 100);
    } else {
      const n = Math.max(2, Math.round(stopK));
      let ext = side === "long" ? Infinity : -Infinity;
      for (let k = Math.max(0, i - n + 1); k <= i; k++) ext = side === "long" ? Math.min(ext, bars[k]!.l) : Math.max(ext, bars[k]!.h);
      stop = ext - dir * cfg.stop.buffer * (atr > 0 ? atr : 0);
    }
    return Number.isFinite(stop) && (side === "long" ? stop < close : stop > close) ? stop : null;
  };

  return {
    start: prep.start,
    signalAt(i: number): EntrySignal | null {
      const l = edgeAt(longHit, i);
      const s = edgeAt(shortHit, i);
      if (l === s) return null; // nothing, or both sides at once (a conflict is not traded)
      const side: BtSide = l ? "long" : "short";
      const stop = stopFor(side, i);
      if (stop == null) return null;
      const close = bars[i]!.c;
      const dist = Math.abs(close - stop);
      const dir = side === "long" ? 1 : -1;
      const sig: EntrySignal = { side, stop, target: cfg.target.kind === "r" ? close + dir * dist * targetR : null, maxBars, tag: `${title} · ${side === "long" ? "Long" : "Short"}` };
      if (manage) sig.manage = manage;
      return sig;
    },
    exitAt: exits && cfg.exits.exitOnOpposite ? (i, pos) => (edgeAt(pos.side === "long" ? shortHit : longHit, i) ? "Gegensignal" : null) : undefined,
  };
}

const sideLabel: Record<"long" | "short", string> = { long: "Long", short: "Short" };

export const customStrategy: LabStrategy<CustomFacts, CustomCfgIn> = {
  id: "custom",
  intervals(c) {
    const cfg = cfgOf(c);
    const out: HistInterval[] = [cfg.interval, ...higherTfsOf(cfg)];
    if (needsLadder(cfg) && (cfg.interval === "1h" || cfg.interval === "4h")) for (const iv of mcbLadder.intervals({ signal: c.signal, step: cfg.interval as McbStep })) if (!out.includes(iv)) out.push(iv);
    return out;
  },
  warmupMs(c) {
    const cfg = cfgOf(c);
    const ladder = needsLadder(cfg) && (cfg.interval === "1h" || cfg.interval === "4h") ? mcbLadder.warmupMs({ signal: c.signal, step: cfg.interval as McbStep }) : 0;
    return Math.max(warmupMsOf(cfg), ladder);
  },
  prepare(data: BarsBy, c: CustomCfgIn, startMs: number): Stepper<Prepared<CustomFacts>> {
    const cfg = cfgOf(c);
    const bars = (data[cfg.interval] ?? []) as readonly Bar[];
    let start = 0;
    while (start < bars.length && bars[start]!.t * 1000 < startMs) start++;
    const leaves = activeLeaves(cfg);
    const other: Partial<Record<TfId, readonly Bar[]>> = {};
    for (const tf of higherTfsOf(cfg)) other[tf] = data[tf] ?? [];
    const ladderStep = needsLadder(cfg) && (cfg.interval === "1h" || cfg.interval === "4h") ? mcbLadder.prepare(data, { signal: c.signal, step: cfg.interval as McbStep }, startMs) : null;
    let ladder: McbFacts | null = null;
    let leafStep: Stepper<Map<string, Uint8Array>> | null = null;
    let result: Prepared<CustomFacts> | null = null;
    const finish = (leafSeries: Map<string, Uint8Array>): Prepared<CustomFacts> => {
      const n = bars.length;
      const sides = sidesOf(cfg);
      const facts: CustomFacts = {
        config: cfg,
        leaves: leafSeries,
        long: sides.includes("long") ? combineTree(cfg.long, leafSeries, n) : null,
        short: sides.includes("short") ? combineTree(cfg.short, leafSeries, n) : null,
      };
      return { interval: cfg.interval as HistInterval, bars, atr: atrSeries(bars), start, facts };
    };
    return {
      step(deadline: number): boolean {
        if (result) return true;
        if (ladderStep && !ladder) {
          if (!ladderStep.step(deadline)) return false;
          ladder = ladderStep.result().facts;
        }
        if (!leafStep) leafStep = evaluateLeaves(leaves, { exec: { tf: cfg.interval, bars }, other }, c.signal, ladder, c.funding ?? null);
        if (!leafStep.step(deadline)) return false;
        result = finish(leafStep.result());
        return true;
      },
      progress: () => {
        if (result) return 1;
        const share = ladderStep ? 0.7 : 0; // the ladder is the long part when it is used
        if (ladderStep && !ladder) return ladderStep.progress() * share;
        return share + (leafStep ? leafStep.progress() : 0) * (1 - share);
      },
      result() {
        while (!this.step(Number.POSITIVE_INFINITY)) {
          /* run to the end */
        }
        return result!;
      },
    };
  },
  specs(c): ParamSpec[] {
    const cfg = cfgOf(c);
    const out: ParamSpec[] = [stopSpec(cfg.stop)];
    if (cfg.target.kind === "r") out.push({ key: "targetR", label: "Ziel", options: neighbours(cfg.target.r, [0.75, 1.5], 0.25, 0.25, 20), format: (v) => `${de(Number(v))} R`, grid: true });
    return out;
  },
  build: (prep, params) => makeStrategy(prep, params, true),

  funnel(prep, _params, win): StrategyFunnel {
    const { config: cfg, long, short } = prep.facts;
    const nodes: FunnelNode[] = [];
    const lo = Math.max(win.from, 0);
    const count = (s: Uint8Array | undefined): { t: number; f: number; u: number } => {
      const out = { t: 0, f: 0, u: 0 };
      if (!s) return { t: 0, f: 0, u: win.to - lo + 1 };
      for (let i = lo; i <= win.to; i++) {
        const v = s[i];
        if (v === TRUE) out.t++;
        else if (v === UNKNOWN) out.u++;
        else out.f++;
      }
      return out;
    };
    for (const side of sidesOf(cfg)) {
      const comb = side === "long" ? long : short;
      const walk = (node: Node, depth: number): void => {
        if (node.type === "leaf") {
          nodes.push({ id: node.id, label: leafText(node), kind: "leaf", side, depth, ...count(comb?.nodes.get(node.id)) });
          return;
        }
        const root = node.id === cfg[side].id;
        nodes.push({ id: node.id, label: root ? `${sideLabel[side]}: alle Regeln zusammen` : nodeText(node, false), kind: root ? "side" : "group", side, depth, ...count(comb?.nodes.get(node.id)) });
        for (const ch of node.children) walk(ch, depth + 1);
      };
      walk(cfg[side] as Group, 0);
    }
    let edges = 0;
    let conflicts = 0;
    for (let i = lo; i <= win.to; i++) {
      const l = edgeAt(long?.hit, i);
      const s = edgeAt(short?.hit, i);
      if (l || s) edges++;
      if (l && s) conflicts++;
    }
    // valid entries: the same `signalAt` the engine asks while flat (the last bar of the window is never asked)
    const strat = makeStrategy(prep, {}, true);
    const candidates: number[] = [];
    for (let i = Math.max(lo, prep.start); i < win.to; i++) if (strat.signalAt(i)) candidates.push(i);
    return { nodes, edges, conflicts, candidates };
  },

  variants(c): StrategyVariant[] {
    const cfg = cfgOf(c);
    const out: StrategyVariant[] = [];
    for (const side of sidesOf(cfg)) {
      const ls = leavesOf(cfg[side]);
      if (ls.length < 2) continue;
      for (const l of ls) out.push({ id: `leaf:${l.id}`, label: `Ohne „${leafText(l)}“`, kind: "noLeaf" });
    }
    if (manageOf(cfg) || cfg.exits.maxBars > 0 || cfg.exits.exitOnOpposite) out.push({ id: "exits", label: "Ohne Verwaltung (Break-even, Trailing, Teil, Zeit-Stop, Gegensignal)", kind: "noExits" });
    return out;
  },
  buildVariant(prep, params, id): BtStrategy | null {
    if (id === "exits") return makeStrategy(prep, params, false);
    if (!id.startsWith("leaf:")) return null;
    const leafId = id.slice(5);
    const f = prep.facts;
    const drop = new Set([leafId]);
    const n = prep.bars.length;
    const recombine = (g: Group, was: Combined | null): Combined | null => (was ? combineTree(g, f.leaves, n, leavesOf(g).some((l) => l.id === leafId) ? drop : undefined) : null);
    const long = recombine(f.config.long, f.long);
    const short = recombine(f.config.short, f.short);
    // a side that has nothing left of its tree cannot signal: the comparison would not be about the removed filter
    if ((f.long && !long?.hit) || (f.short && !short?.hit)) return null;
    return makeStrategy({ ...prep, facts: { ...f, long, short } }, params, true);
  },
};
