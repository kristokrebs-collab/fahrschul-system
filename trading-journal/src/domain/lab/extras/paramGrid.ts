/**
 * Parameter grid of an idea (F11 / F16): "Wie stabil ist diese Idee gegen die Parameter?" – the SAME run (data, window, costs,
 * stop, target, management) repeated on a small grid around the chosen values of two rule parameters, e.g. RSI length ×
 * RSI level at ±25 %. A robust idea changes smoothly between neighbours; one that only works in a single cell is a sign of
 * fitting to the past. The table shows what happened – it recommends no setting.
 *
 * Only parameters of the rule blocks are varied (stop and target have their own heat map in "Robustheit"). Every cell
 * prepares the rules again (the indicator changes), so a block that is expensive (`heavy`: the MCB ladder, the RSI
 * trendline on small candles) makes the grid unavailable, with the reason.
 */
import { runBacktest } from "../../backtest/engine";
import type { Window } from "../../backtest/optimize";
import { customStrategy, type CustomCfgIn } from "../../backtest/strategies/custom";
import type { LabStrategy, Params, Prepared } from "../../backtest/strategies/types";
import { HIST_MS, type BarsBy, type EngineCfg } from "../../backtest/types";
import { BLOCKS } from "../rules/blocks";
import { activeLeaves, sanitizeCustom } from "../rules/tree";
import type { CustomConfig, Leaf, ParamDef } from "../rules/types";
import { statsOf } from "../stress/run";
import type { ScenarioStats } from "../stress/types";

export const GRID_VERSION = 1 as const;
/** The grid edge: three values per axis. */
export const GRID_SPAN = 0.25;

/** One parameter of one rule that can be varied. */
export interface GridAxisChoice {
  /** `n3.len` */
  id: string;
  leaf: string;
  key: string;
  /** "Long · RSI Niveau · Länge" */
  label: string;
  /** the chosen value and the values the grid tries (ascending, contains the chosen one) */
  base: number;
  values: number[];
  unit?: string;
}

/** The axes of a configuration, with the reason when there are none. */
export interface GridAvailability {
  axes: GridAxisChoice[];
  /** why no grid is possible (null when there are axes) */
  blocked: string | null;
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Three values around `base`: base ± 25 %, snapped to the parameter's grid, clamped to its limits, without duplicates. */
export function gridValues(def: ParamDef, base: number): number[] {
  const step = def.kind === "int" ? 1 : (def.step ?? 0.01);
  const snap = (v: number): number => (def.kind === "int" ? Math.round(v) : round4(Math.round(v / step) * step));
  const d = Math.max(step, Math.abs(base) * GRID_SPAN);
  const raw = [base - d, base, base + d].map((v) => {
    let x = snap(v);
    if (def.min != null) x = Math.max(def.min, x);
    if (def.max != null) x = Math.min(def.max, x);
    return x;
  });
  const set = new Set<number>([base, ...raw]);
  return [...set].sort((a, b) => a - b).filter((v) => v === base || Math.abs(v - base) > 1e-9);
}

const sideOf = (cfg: CustomConfig, leaf: Leaf): "Long" | "Short" => (activeLeaves({ ...cfg, sides: "long" }).some((l) => l.id === leaf.id) ? "Long" : "Short");

export function gridAxes(cfg: CustomConfig): GridAvailability {
  const leaves = activeLeaves(cfg);
  const heavy = leaves.find((l) => BLOCKS[l.block].heavy);
  if (heavy) return { axes: [], blocked: `„${BLOCKS[heavy.block].label}“ ist rechenintensiv – das Raster müsste ihn für jede Zelle neu rechnen. Teste die Parameter einzeln im Labor.` };
  const axes: GridAxisChoice[] = [];
  for (const l of leaves) {
    const def = BLOCKS[l.block];
    for (const p of def.params) {
      if (p.kind === "select" || (p.when && !p.when(l.params))) continue;
      if (l.block === "keyLevel" && p.key === "level") continue; // a price level is a decision, not a setting to scatter
      const base = Number(l.params[p.key]);
      const values = gridValues(p, base);
      if (values.length < 2) continue;
      axes.push({ id: `${l.id}.${p.key}`, leaf: l.id, key: p.key, label: `${cfg.sides === "both" ? `${sideOf(cfg, l)} · ` : ""}${def.label} · ${p.label}`, base, values, unit: p.unit });
    }
  }
  return { axes, blocked: axes.length ? null : "Die Regeln haben keine Zahl, die sich sinnvoll streuen lässt (nur Auswahlfelder oder Grenzwerte)." };
}

/** What the user picked: one or two axes by id. */
export interface GridSpec {
  x: string;
  y: string | null;
}

export interface GridCell {
  /** index into the x / y values */
  xi: number;
  yi: number;
  stats: ScenarioStats | null;
}

export interface GridAxisInfo {
  id: string;
  label: string;
  unit?: string;
  base: number;
  values: number[];
}

export interface GridResult {
  v: typeof GRID_VERSION;
  x: GridAxisInfo;
  y: GridAxisInfo | null;
  /** row-major over y then x */
  cells: GridCell[];
  /** the cell of the chosen values */
  baseXi: number;
  baseYi: number;
}

const info = (a: GridAxisChoice): GridAxisInfo => ({ id: a.id, label: a.label, unit: a.unit, base: a.base, values: a.values });

/** The configuration with one rule parameter set (sanitised again, so dependent parameters stay valid). */
export function withParam(cfg: CustomConfig, leafId: string, key: string, value: number): CustomConfig {
  const edit = (n: CustomConfig["long"]): CustomConfig["long"] => {
    const walk = (x: CustomConfig["long"]["children"][number]): CustomConfig["long"]["children"][number] => (x.type === "leaf" ? (x.id === leafId ? { ...x, params: { ...x.params, [key]: value } } : x) : { ...x, children: x.children.map(walk) });
    return { ...n, children: n.children.map(walk) };
  };
  return sanitizeCustom({ ...cfg, long: edit(cfg.long), short: edit(cfg.short) });
}

/** One unit of work per cell. The centre cell reuses the already prepared base run. */
export function gridUnits(
  cfgIn: CustomCfgIn,
  data: BarsBy,
  fromMs: number,
  basePrep: Prepared<unknown>,
  params: Params,
  engine: EngineCfg,
  win: Window,
  windowOk: boolean,
  spec: GridSpec,
): { count: number; run(i: number): void; result(): GridResult | null; note: string | null } {
  const cfg = sanitizeCustom(cfgIn.config);
  const av = gridAxes(cfg);
  const x = av.axes.find((a) => a.id === spec.x);
  const y = spec.y ? (av.axes.find((a) => a.id === spec.y) ?? null) : null;
  if (!x || (spec.y && !y) || av.blocked) return { count: 0, run: () => undefined, result: () => null, note: av.blocked ?? "Die gewählte Zahl gibt es in dieser Idee nicht mehr." };
  const ys = y ? y.values : [0];
  const cells: GridCell[] = [];
  const baseXi = x.values.indexOf(x.base);
  const baseYi = y ? y.values.indexOf(y.base) : 0;
  for (let yi = 0; yi < ys.length; yi++) for (let xi = 0; xi < x.values.length; xi++) cells.push({ xi, yi, stats: null });
  const secLen = HIST_MS[basePrep.interval] / 1000;
  const strategy = customStrategy as unknown as LabStrategy<unknown, CustomCfgIn>;

  const run = (i: number): void => {
    if (!windowOk) return;
    const c = cells[i]!;
    let prep: Prepared<unknown> = basePrep;
    if (!(c.xi === baseXi && c.yi === baseYi)) {
      let next = withParam(cfg, x.leaf, x.key, x.values[c.xi]!);
      if (y) next = withParam(next, y.leaf, y.key, y.values[c.yi]!);
      prep = strategy.prepare(data, { ...cfgIn, config: next }, fromMs).result();
    }
    const s = strategy.build(prep, params);
    c.stats = statsOf(runBacktest(prep.bars, s, engine, { from: win.from, to: win.to, equity: true, atr: prep.atr, secLen }));
  };
  return { count: cells.length, run, result: () => ({ v: GRID_VERSION, x: info(x), y: y ? info(y) : null, cells, baseXi, baseYi }), note: null };
}
