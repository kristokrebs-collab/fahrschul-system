/**
 * The search space of the optimiser: small, explainable steps over a rule set of the lab ("Eigene Idee"). Every step changes
 * ONE thing and comes with one plain-language sentence ("Was wurde geändert"); the result is always a valid rule set
 * (sanitised, no error of `validateCustom`) or the step is refused (`null`) – never a broken idea.
 *
 *   rules       move a threshold (RSI level, band width …) · change a length / count (EMA length, look-back …)
 *   exits       stop distance · target R · break-even · trailing stop · partial take-profit · time stop · swap an exit variant
 *   filters     add a session / trend / volatility / volume filter · drop a filter
 *   direction   restrict to one side – or add the mirrored other side
 *
 * `freedomOf` counts the knobs of a rule set (the "Freiheitsgrade"): the more knobs, the easier it is to fit the past.
 *
 * Rules with an expensive block (the MCB ladder, the RSI trendline) are only varied in their exits: every rule change would
 * re-run that block for the whole history (`lightOnly`).
 */
import { BLOCKS, defaultParams, sanitizeParams } from "../lab/rules/blocks";
import { activeLeaves, customKey, editNode, leafText, leavesOf, mirrorGroup, nextNum, sanitizeCustom, sidesOf, stopText, validateCustom, warmupMsOf } from "../lab/rules/tree";
import { TF_IDS, TF_SEC, type BlockId, type CustomConfig, type ExitsCfg, type Group, type Leaf, type LeafParams, type ParamDef, type StopCfg, type TfId } from "../lab/rules/types";
import { MUTATION_KINDS, type Mutated, type MutationKind, type Step } from "./types";

export interface MutationCtx {
  rng: () => number;
  /** do the bars carry volume (a volume filter is pointless otherwise) */
  hasVolume: boolean;
  /** timeframes the loaded data covers (a trend filter only uses these) */
  tfs: ReadonlySet<TfId>;
  /** the run has the real funding history */
  funding: boolean;
}

/** Kinds that never re-evaluate a rule (the exits and the side restriction). */
export const LIGHT_KINDS: readonly MutationKind[] = ["stopSize", "targetR", "breakEven", "trail", "partial", "timeStop", "exitSwap"];

const de = (v: number): string => String(Math.round(v * 100) / 100).replace(".", ",");
const round = (v: number, step: number): number => Math.round(Math.round(v / step) * step * 10_000) / 10_000;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))]!;
const sign = (rng: () => number): 1 | -1 => (rng() < 0.5 ? -1 : 1);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Does the rule set use a block that is expensive to evaluate (then only its exits are varied)? */
export function lightOnly(cfg: CustomConfig): boolean {
  return activeLeaves(cfg).some((l) => !!BLOCKS[l.block].heavy);
}

const sideWord = (cfg: CustomConfig, side: "long" | "short"): string => (cfg.sides === "both" ? `${side === "long" ? "Long" : "Short"}: ` : "");

// ── counting the knobs ───────────────────────────────────────────────────────────────────────────────────────

export interface Freedom {
  total: number;
  /** conditions and their numbers */
  rules: number;
  /** stop, target and management numbers */
  exits: number;
}

const numericApplies = (l: Leaf, d: ParamDef): boolean => (d.kind === "int" || d.kind === "float") && (!d.when || d.when(l.params)) && !(l.block === "keyLevel" && d.key === "level");

/**
 * Degrees of freedom: every condition counts one (it could be left out) plus each of its numbers that applies; the stop counts
 * its distance (swing with a buffer: two), a fixed target one, each management rule that is on its numbers, a time stop one,
 * the exit on a counter signal one. A choice between named options is not counted – only numbers and conditions.
 */
export function freedomOf(cfg: CustomConfig): Freedom {
  let rules = 0;
  for (const l of activeLeaves(cfg)) {
    rules += 1;
    for (const d of BLOCKS[l.block].params) if (numericApplies(l, d)) rules += 1;
  }
  const e = cfg.exits;
  let exits = cfg.stop.kind === "swing" && cfg.stop.buffer > 0 ? 2 : 1;
  if (cfg.target.kind === "r") exits += 1;
  if (e.breakEven.on) exits += 1;
  if (e.trail.on) exits += 2;
  if (e.partial.on) exits += 2;
  if (e.maxBars > 0) exits += 1;
  if (e.exitOnOpposite) exits += 1;
  return { total: rules + exits, rules, exits };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Sanitise, refuse a no-op and anything the check calls an error. */
function done(before: CustomConfig, draft: CustomConfig, steps: Step[], ctx: MutationCtx): Mutated | null {
  const config = sanitizeCustom(draft);
  if (customKey(config) === customKey(before)) return null;
  if (validateCustom(config, { funding: ctx.funding }).some((i) => i.level === "error")) return null;
  return { config, steps };
}

const findLeaf = (cfg: CustomConfig, id: string): Leaf | null => leavesOf(cfg.long).concat(leavesOf(cfg.short)).find((l) => l.id === id) ?? null;

function setLeafParams(cfg: CustomConfig, id: string, params: LeafParams): CustomConfig {
  const edit = (g: Group): Group => editNode(g, id, (n) => (n.type === "leaf" ? { ...n, params } : n));
  return { ...cfg, long: edit(cfg.long), short: edit(cfg.short) };
}

/** A new value for a numeric parameter: 8–25 % away, on the parameter's grid, inside its limits; null if nothing moves. */
function nudged(def: ParamDef, v: number, rng: () => number): number | null {
  const step = def.kind === "int" ? 1 : (def.step ?? 0.01);
  const rel = 0.08 + rng() * 0.17;
  const delta = Math.max(step, round(Math.abs(v) * rel, step));
  const dir = sign(rng);
  for (const d of [dir, -dir]) {
    let x = v + d * delta;
    if (def.min != null) x = Math.max(def.min, x);
    if (def.max != null) x = Math.min(def.max, x);
    x = def.kind === "int" ? Math.round(x) : round(x, step);
    if (x !== v) return x;
  }
  return null;
}

interface Knob {
  side: "long" | "short";
  leaf: Leaf;
  def: ParamDef;
}

function knobs(cfg: CustomConfig, kind: "int" | "float"): Knob[] {
  const out: Knob[] = [];
  for (const side of sidesOf(cfg)) {
    for (const leaf of leavesOf(cfg[side])) {
      if (BLOCKS[leaf.block].heavy) continue;
      for (const def of BLOCKS[leaf.block].params) if (def.kind === kind && numericApplies(leaf, def) && def.min !== def.max) out.push({ side, leaf, def });
    }
  }
  return out;
}

function ruleNumber(cfg: CustomConfig, kind: "int" | "float", ctx: MutationCtx): Mutated | null {
  const all = knobs(cfg, kind);
  if (!all.length) return null;
  const k = pick(ctx.rng, all);
  const v = nudged(k.def, Number(k.leaf.params[k.def.key]), ctx.rng);
  if (v == null) return null;
  const draft = setLeafParams(cfg, k.leaf.id, { ...k.leaf.params, [k.def.key]: v });
  const res = done(cfg, draft, [], ctx);
  if (!res) return null;
  const after = findLeaf(res.config, k.leaf.id);
  if (!after) return null;
  return { config: res.config, steps: [{ kind: kind === "float" ? "ruleLevel" : "ruleLength", text: `${sideWord(cfg, k.side)}„${leafText(k.leaf)}“ wurde zu „${leafText(after)}“.` }] };
}

// ── exits ────────────────────────────────────────────────────────────────────────────────────────────────────

function withExits(cfg: CustomConfig, f: (e: ExitsCfg) => void): CustomConfig {
  const exits = clone(cfg.exits);
  f(exits);
  return { ...cfg, exits };
}

function stopSize(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const s = { ...cfg.stop };
  const dir = sign(ctx.rng);
  if (s.kind === "atr") s.atr = clamp(round(s.atr + dir * pick(ctx.rng, [0.25, 0.5]), 0.25), 0.75, 5);
  else if (s.kind === "percent") s.pct = clamp(round(s.pct * (dir > 0 ? 1.25 : 0.8), 0.05), 0.5, 10);
  else s.swing = clamp(s.swing + dir * pick(ctx.rng, [2, 3, 5]), 5, 60);
  return done(cfg, { ...cfg, stop: s }, [{ kind: "stopSize", text: `Der Stop wurde von ${stopText(cfg.stop)} auf ${stopText(s)} geändert.` }], ctx);
}

function targetR(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  if (cfg.target.kind === "r") {
    const r = clamp(round(cfg.target.r + sign(ctx.rng) * pick(ctx.rng, [0.25, 0.5]), 0.25), 0.75, 6);
    return done(cfg, { ...cfg, target: { kind: "r", r } }, [{ kind: "targetR", text: `Das Ziel wurde von ${de(cfg.target.r)} R auf ${de(r)} R geändert.` }], ctx);
  }
  const r = pick(ctx.rng, [2, 2.5, 3]);
  return done(cfg, { ...cfg, target: { kind: "r", r } }, [{ kind: "targetR", text: `Ein festes Ziel bei ${de(r)} R wurde eingeführt (vorher gab es keins).` }], ctx);
}

const nearerThanTarget = (cfg: CustomConfig, r: number): boolean => cfg.target.kind !== "r" || r < cfg.target.r - 0.2;

function breakEven(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const be = cfg.exits.breakEven;
  if (!be.on) {
    const opts = [0.75, 1, 1.5].filter((v) => nearerThanTarget(cfg, v));
    if (!opts.length) return null;
    const value = pick(ctx.rng, opts);
    const to = pick(ctx.rng, ["entry", "net"] as const);
    const draft = withExits(cfg, (e) => (e.breakEven = { on: true, trigger: "r", value, to }));
    return done(cfg, draft, [{ kind: "breakEven", text: `Break-even wurde eingeführt: nach +${de(value)} R rutscht der Stop auf ${to === "net" ? "den Netto-Break-even" : "den Einstieg"}.` }], ctx);
  }
  if (ctx.rng() < 0.3) return done(cfg, withExits(cfg, (e) => (e.breakEven.on = false)), [{ kind: "breakEven", text: "Break-even wurde entfernt." }], ctx);
  const step = be.trigger === "r" ? 0.25 : 0.5;
  const value = clamp(round(be.value + sign(ctx.rng) * step, step), be.trigger === "r" ? 0.3 : 0.3, be.trigger === "r" ? 3 : 10);
  const unit = be.trigger === "r" ? "R" : "%";
  return done(cfg, withExits(cfg, (e) => (e.breakEven.value = value)), [{ kind: "breakEven", text: `Der Break-even-Punkt wurde von +${de(be.value)} ${unit} auf +${de(value)} ${unit} verschoben.` }], ctx);
}

function trail(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const t = cfg.exits.trail;
  if (!t.on) {
    const value = pick(ctx.rng, [2, 2.5, 3]);
    const activateR = pick(ctx.rng, [0.5, 1, 1.5]);
    const draft = withExits(cfg, (e) => (e.trail = { on: true, kind: "atr", value, activateR }));
    return done(cfg, draft, [{ kind: "trail", text: `Ein Trailing-Stop wurde eingeführt: ${de(value)} × ATR hinter dem besten Kurs, ab +${de(activateR)} R.` }], ctx);
  }
  const r = ctx.rng();
  if (r < 0.25) return done(cfg, withExits(cfg, (e) => (e.trail.on = false)), [{ kind: "trail", text: "Der Trailing-Stop wurde entfernt." }], ctx);
  if (r < 0.7) {
    const step = t.kind === "atr" ? 0.5 : 0.5;
    const value = clamp(round(t.value + sign(ctx.rng) * step, step), t.kind === "atr" ? 0.8 : 0.4, t.kind === "atr" ? 6 : 10);
    const unit = t.kind === "atr" ? "× ATR" : "%";
    return done(cfg, withExits(cfg, (e) => (e.trail.value = value)), [{ kind: "trail", text: `Der Trailing-Abstand wurde von ${de(t.value)} ${unit} auf ${de(value)} ${unit} geändert.` }], ctx);
  }
  const activateR = clamp(round(t.activateR + sign(ctx.rng) * 0.5, 0.5), 0, 4);
  return done(cfg, withExits(cfg, (e) => (e.trail.activateR = activateR)), [{ kind: "trail", text: `Der Trailing-Stop greift jetzt ab +${de(activateR)} R statt ab +${de(t.activateR)} R.` }], ctx);
}

function partial(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const p = cfg.exits.partial;
  if (cfg.target.kind !== "r") return null; // a partial take-profit must lie before a final target
  if (!p.on) {
    const opts = [0.75, 1, 1.5].filter((v) => nearerThanTarget(cfg, v));
    if (!opts.length) return null;
    const atR = pick(ctx.rng, opts);
    const fracPct = pick(ctx.rng, [30, 50, 60]);
    const draft = withExits(cfg, (e) => (e.partial = { on: true, atR, fracPct, thenBreakEven: true }));
    return done(cfg, draft, [{ kind: "partial", text: `Ein Teilgewinn wurde eingeführt: ${fracPct} % der Position werden bei +${de(atR)} R verkauft, danach rutscht der Stop auf Break-even.` }], ctx);
  }
  const r = ctx.rng();
  if (r < 0.25) return done(cfg, withExits(cfg, (e) => (e.partial.on = false)), [{ kind: "partial", text: "Der Teilgewinn wurde entfernt." }], ctx);
  if (r < 0.65) {
    const atR = clamp(round(p.atR + sign(ctx.rng) * 0.25, 0.25), 0.25, 5);
    if (!nearerThanTarget(cfg, atR)) return null;
    return done(cfg, withExits(cfg, (e) => (e.partial.atR = atR)), [{ kind: "partial", text: `Der Teilgewinn liegt jetzt bei +${de(atR)} R statt bei +${de(p.atR)} R.` }], ctx);
  }
  const fracPct = clamp(p.fracPct + sign(ctx.rng) * 10, 20, 80);
  return done(cfg, withExits(cfg, (e) => (e.partial.fracPct = fracPct)), [{ kind: "partial", text: `Beim Teilgewinn werden ${fracPct} % statt ${p.fracPct} % verkauft.` }], ctx);
}

function timeStop(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const hoursPerBar = TF_SEC[cfg.interval] / 3600;
  const bars = (h: number): number => Math.max(3, Math.round(h / hoursPerBar));
  const cur = cfg.exits.maxBars;
  if (cur === 0) {
    const n = bars(pick(ctx.rng, [24, 48, 96, 168]));
    return done(cfg, withExits(cfg, (e) => (e.maxBars = n)), [{ kind: "timeStop", text: `Ein Zeit-Stop wurde eingeführt: nach ${n} Kerzen wird geschlossen.` }], ctx);
  }
  if (ctx.rng() < 0.25) return done(cfg, withExits(cfg, (e) => (e.maxBars = 0)), [{ kind: "timeStop", text: "Der Zeit-Stop wurde entfernt." }], ctx);
  const n = Math.max(3, Math.round(cur * pick(ctx.rng, [0.67, 1.5])));
  return done(cfg, withExits(cfg, (e) => (e.maxBars = n)), [{ kind: "timeStop", text: `Der Zeit-Stop wurde von ${cur} auf ${n} Kerzen geändert.` }], ctx);
}

type SwapFn = (cfg: CustomConfig, ctx: MutationCtx) => Mutated | null;

const SWAPS: readonly SwapFn[] = [
  // stop kind
  (cfg, ctx) => {
    const was = cfg.stop;
    const to = was.kind === "atr" ? pick(ctx.rng, ["swing", "percent"] as const) : "atr";
    const stop: StopCfg = { ...was, kind: to, ...(to === "swing" ? { swing: 10, buffer: 0.1 } : to === "percent" ? { pct: 2 } : { atr: 1.5 }) };
    return done(cfg, { ...cfg, stop }, [{ kind: "exitSwap", text: `Die Stop-Art wurde getauscht: vorher ${stopText(was)}, jetzt ${stopText(stop)}.` }], ctx);
  },
  // fixed target → trailing stop
  (cfg, ctx) => {
    if (cfg.target.kind !== "r" || cfg.exits.trail.on) return null;
    const value = pick(ctx.rng, [2, 2.5, 3]);
    const draft = withExits({ ...cfg, target: { kind: "none", r: cfg.target.r } }, (e) => (e.trail = { on: true, kind: "atr", value, activateR: 1 }));
    return done(cfg, draft, [{ kind: "exitSwap", text: `Das feste Ziel (${de(cfg.target.r)} R) wurde durch einen Trailing-Stop ersetzt: ${de(value)} × ATR, ab +1 R.` }], ctx);
  },
  // trailing stop → fixed target
  (cfg, ctx) => {
    if (!cfg.exits.trail.on) return null;
    const r = pick(ctx.rng, [2, 2.5, 3]);
    const draft = withExits({ ...cfg, target: { kind: "r", r } }, (e) => (e.trail.on = false));
    return done(cfg, draft, [{ kind: "exitSwap", text: `Der Trailing-Stop wurde durch ein festes Ziel bei ${de(r)} R ersetzt.` }], ctx);
  },
  // break-even ↔ partial take-profit
  (cfg, ctx) => {
    const e = cfg.exits;
    if (e.breakEven.on && !e.partial.on && cfg.target.kind === "r" && nearerThanTarget(cfg, e.breakEven.value)) {
      const atR = e.breakEven.value;
      return done(cfg, withExits(cfg, (x) => ((x.breakEven.on = false), (x.partial = { on: true, atR, fracPct: 50, thenBreakEven: true }))), [{ kind: "exitSwap", text: `Der Break-even wurde durch einen Teilgewinn ersetzt: 50 % bei +${de(atR)} R, danach Break-even.` }], ctx);
    }
    if (e.partial.on && !e.breakEven.on) {
      const value = e.partial.atR;
      return done(cfg, withExits(cfg, (x) => ((x.partial.on = false), (x.breakEven = { on: true, trigger: "r", value, to: "entry" }))), [{ kind: "exitSwap", text: `Der Teilgewinn wurde durch einen Break-even nach +${de(value)} R ersetzt.` }], ctx);
    }
    return null;
  },
  // exit on the counter signal
  (cfg, ctx) => {
    if (cfg.sides !== "both") return null;
    const on = !cfg.exits.exitOnOpposite;
    return done(cfg, withExits(cfg, (e) => (e.exitOnOpposite = on)), [{ kind: "exitSwap", text: on ? "Ein Gegensignal schließt die Position jetzt zur nächsten Eröffnung." : "Ein Gegensignal schließt die Position nicht mehr." }], ctx);
  },
];

function exitSwap(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const order = SWAPS.map((_, i) => i);
  // a deterministic shuffle: the first swap that applies wins
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const i of order) {
    const m = SWAPS[i]!(cfg, ctx);
    if (m) return m;
  }
  return null;
}

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The caps keep a mutated idea readable: a filter pile is not an idea. */
const MAX_LEAVES = 8;

function addedLeaf(side: "long" | "short", block: BlockId, longParams: LeafParams, tf: Leaf["tf"], not: boolean, k: number): Leaf {
  const params = side === "long" ? longParams : BLOCKS[block].mirror(longParams);
  return { type: "leaf", id: `n${k}`, block, tf, params: sanitizeParams(block, { ...defaultParams(block), ...params }), ...(not ? { not: true as const } : {}) };
}

function appendLeaf(cfg: CustomConfig, side: "long" | "short", leaf: Leaf, k: number): CustomConfig | null {
  const root = cfg[side];
  if (leavesOf(root).length >= MAX_LEAVES || root.children.length >= 11) return null;
  const next: Group = root.op === "and" ? { ...root, children: [...root.children, leaf] } : { type: "group", id: root.id, op: "and", children: [{ ...root, id: `g${k + 1}` }, leaf] };
  return { ...cfg, [side]: next };
}

interface FilterSpec {
  block: BlockId;
  longParams: LeafParams;
  tf: (cfg: CustomConfig, ctx: MutationCtx) => Leaf["tf"] | null;
  not?: boolean;
}

const HIGHER: Readonly<Record<TfId, TfId | null>> = { "15m": "1h", "30m": "2h", "1h": "4h", "2h": "4h", "4h": "1d", "1d": null };
const execTf = (): Leaf["tf"] => "exec";

function addFilter(cfg: CustomConfig, spec: FilterSpec, ctx: MutationCtx, kind: MutationKind): Mutated | null {
  const tf = spec.tf(cfg, ctx);
  if (tf == null) return null;
  let next = cfg;
  const shown: string[] = [];
  for (const side of sidesOf(cfg)) {
    const k = nextNum(next);
    const leaf = addedLeaf(side, spec.block, spec.longParams, tf, !!spec.not, k);
    const grown = appendLeaf(next, side, leaf, k);
    if (!grown) return null;
    next = grown;
    shown.push(`${sideWord(cfg, side)}„${leafText(leaf)}“`);
  }
  return done(cfg, next, [{ kind, text: `Filter hinzugefügt – ${shown.join(", ")}.` }], ctx);
}

function hasLeaf(cfg: CustomConfig, test: (l: Leaf) => boolean): boolean {
  return activeLeaves(cfg).some(test);
}

function addSession(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const specs: { session: string; not: boolean }[] = [
    { session: "weekend", not: true },
    { session: "asia", not: true },
    { session: "late", not: true },
    { session: "london", not: false },
    { session: "ny", not: false },
  ];
  const spec = pick(ctx.rng, specs);
  const existing = activeLeaves(cfg).filter((l) => l.block === "timeWindow");
  if (existing.length) {
    // already filtered by time: swap the session instead of stacking another filter
    const first = existing[0]!;
    if (first.params.session === spec.session && !!first.not === spec.not) return null;
    const edit = (g: Group): Group => editNode(g, first.id, (n) => (n.type === "leaf" ? { ...n, params: { ...n.params, session: spec.session }, ...(spec.not ? { not: true as const } : { not: undefined }) } : n));
    const draft = { ...cfg, long: edit(cfg.long), short: edit(cfg.short) };
    const res = done(cfg, draft, [], ctx);
    const after = res ? findLeaf(res.config, first.id) : null;
    return res && after ? { config: res.config, steps: [{ kind: "addSession", text: `Der Zeitfilter wurde geändert: aus „${leafText(first)}“ wurde „${leafText(after)}“.` }] } : null;
  }
  return addFilter(cfg, { block: "timeWindow", longParams: { session: spec.session }, tf: execTf, not: spec.not }, ctx, "addSession");
}

function addTrend(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  if (hasLeaf(cfg, (l) => l.block === "maPrice" && l.tf !== "exec")) return null;
  const up = HIGHER[cfg.interval];
  const higher = up && ctx.tfs.has(up) ? up : null;
  // on the largest timeframe there is nothing above: the trend filter then reads the execution bars
  if (!higher && cfg.interval !== "1d") return null;
  if (!higher && hasLeaf(cfg, (l) => l.block === "maPrice")) return null;
  const len = pick(ctx.rng, [50, 100, 200]);
  return addFilter(cfg, { block: "maPrice", longParams: { type: "ema", len, mode: "above" }, tf: () => higher ?? "exec" }, ctx, "addTrend");
}

function addVolatility(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  if (hasLeaf(cfg, (l) => l.block === "atrPct")) return null;
  const active = ctx.rng() < 0.65;
  const params: LeafParams = active ? { mode: "above", pct: pick(ctx.rng, [30, 40, 50, 60]) } : { mode: "below", pct: pick(ctx.rng, [70, 80]) };
  return addFilter(cfg, { block: "atrPct", longParams: params, tf: execTf }, ctx, "addVolatility");
}

function addVolume(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  if (!ctx.hasVolume || hasLeaf(cfg, (l) => l.block === "volume")) return null;
  return addFilter(cfg, { block: "volume", longParams: { len: 20, mult: pick(ctx.rng, [1.2, 1.5, 2]), candle: "any", within: 3 }, tf: execTf }, ctx, "addVolume");
}

function pruneEmpty(g: Group): Group {
  const kids = g.children.map((c) => (c.type === "group" ? pruneEmpty(c) : c)).filter((c) => c.type === "leaf" || c.children.length > 0);
  return { ...g, children: kids };
}

function dropFilter(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  const sides = sidesOf(cfg).filter((s) => leavesOf(cfg[s]).length >= 2);
  if (!sides.length) return null;
  const side = pick(ctx.rng, sides);
  const leaf = pick(ctx.rng, leavesOf(cfg[side]));
  const next = pruneEmpty(editNode(cfg[side], leaf.id, () => null));
  if (!leavesOf(next).length) return null;
  return done(cfg, { ...cfg, [side]: next }, [{ kind: "dropFilter", text: `${sideWord(cfg, side)}Die Bedingung „${leafText(leaf)}“ wurde entfernt.` }], ctx);
}

// ── direction ────────────────────────────────────────────────────────────────────────────────────────────────

function sides(cfg: CustomConfig, ctx: MutationCtx): Mutated | null {
  if (cfg.sides === "both") {
    const keep = pick(ctx.rng, ["long", "short"] as const);
    const draft = withExits({ ...cfg, sides: keep }, (e) => (e.exitOnOpposite = false));
    return done(cfg, draft, [{ kind: "sides", text: `Es wird nur noch ${keep === "long" ? "Long" : "Short"} gehandelt (vorher Long und Short).` }], ctx);
  }
  const have = cfg.sides;
  const other = have === "long" ? "short" : "long";
  if (!leavesOf(cfg[have]).length) return null;
  const mirrored = mirrorGroup(cfg[have], other === "long" ? "g1" : "g2", nextNum(cfg));
  return done(cfg, { ...cfg, sides: "both", [other]: mirrored }, [{ kind: "sides", text: `Zusätzlich wird auch ${other === "long" ? "Long" : "Short"} gehandelt, mit den gespiegelten Regeln (vorher nur ${have === "long" ? "Long" : "Short"}).` }], ctx);
}

// ── the catalogue ────────────────────────────────────────────────────────────────────────────────────────────

const APPLY: Readonly<Record<MutationKind, (cfg: CustomConfig, ctx: MutationCtx) => Mutated | null>> = {
  ruleLevel: (c, x) => ruleNumber(c, "float", x),
  ruleLength: (c, x) => ruleNumber(c, "int", x),
  stopSize,
  targetR,
  breakEven,
  trail,
  partial,
  timeStop,
  exitSwap,
  addSession,
  addTrend,
  addVolatility,
  addVolume,
  dropFilter,
  sides,
};

/** One step of this kind, or `null` when it does not apply to this rule set. */
export function mutate(cfg: CustomConfig, kind: MutationKind, ctx: MutationCtx): Mutated | null {
  return APPLY[kind](cfg, ctx);
}

/** Kinds that may be tried on this rule set (heavy rules: exits only). */
export function allowedKinds(cfg: CustomConfig): readonly MutationKind[] {
  return lightOnly(cfg) ? LIGHT_KINDS : MUTATION_KINDS;
}

/** A weighted draw; kinds that do not apply are dropped from the pool until one works. `null` = nothing applies. */
export function mutateWeighted(cfg: CustomConfig, ctx: MutationCtx, weights: Partial<Record<MutationKind, number>> = {}): Mutated | null {
  const pool = [...allowedKinds(cfg)];
  while (pool.length) {
    const w = pool.map((k) => Math.max(0.01, weights[k] ?? 1));
    let t = ctx.rng() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < pool.length - 1 && (t -= w[i]!) > 0) i++;
    const m = mutate(cfg, pool[i]!, ctx);
    if (m) return m;
    pool.splice(i, 1);
  }
  return null;
}

/** Several steps in a row (a random restart); stops early when a step does not apply. */
export function mutateChain(cfg: CustomConfig, steps: number, ctx: MutationCtx, weights?: Partial<Record<MutationKind, number>>): Mutated | null {
  let cur = cfg;
  const all: Step[] = [];
  for (let i = 0; i < steps; i++) {
    const m = mutateWeighted(cur, ctx, weights);
    if (!m) break;
    cur = m.config;
    all.push(...m.steps);
  }
  return all.length ? { config: cur, steps: all } : null;
}

/** The timeframes a search over this rule set may load: the execution interval, the next larger one (trend filter), the rules' own. */
export function searchIntervals(cfg: CustomConfig, higherOfRules: readonly TfId[]): TfId[] {
  const out: TfId[] = [cfg.interval];
  const up = HIGHER[cfg.interval];
  if (up) out.push(up);
  for (const t of higherOfRules) if (!out.includes(t)) out.push(t);
  return TF_IDS.filter((t) => out.includes(t));
}


/**
 * History the search needs before the first tradable candle: the rules' own warm-up, and enough of the next larger timeframe for
 * a trend filter the search may add (an EMA 200 needs ~600 candles of its own timeframe to be defined) – capped at 450 candles.
 */
export function searchWarmupMs(cfg: CustomConfig): number {
  const up = HIGHER[cfg.interval] ?? cfg.interval;
  return Math.max(warmupMsOf(cfg), 450 * TF_SEC[up] * 1000);
}
