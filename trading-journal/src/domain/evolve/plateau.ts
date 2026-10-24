/**
 * "Plateau statt Spitze" (pure). A variant that only works at exactly RSI 27 and not at 24 or 31 is a fit to noise; one whose
 * neighbours (every number a little smaller and a little larger, one at a time) score about as well sits on a plateau. For a
 * finalist the optimiser evaluates up to `max` such neighbours and counts how many reach at least `NEIGHBOUR_SHARE` of its
 * score. Neighbours without enough trades count as "not similar". A rule set without any number to move has no plateau check
 * (`null`) and says so.
 */
import { gridAxes, withParam } from "../lab/extras/paramGrid";
import { customKey, sanitizeCustom, validateCustom } from "../lab/rules/tree";
import type { CustomConfig, ExitsCfg } from "../lab/rules/types";
import type { Plateau } from "./types";

/** A neighbour counts as "similar" when its score reaches this share of the finalist's score. */
export const NEIGHBOUR_SHARE = 0.5;
/** A plateau needs at least this share of similar neighbours. */
export const PLATEAU_MIN = 0.6;

export interface Neighbor {
  label: string;
  config: CustomConfig;
}

const r4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const snap = (v: number, step: number): number => r4(Math.round(v / step) * step);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function pushVariant(out: Neighbor[], base: CustomConfig, label: string, draft: CustomConfig): void {
  const config = sanitizeCustom(draft);
  if (customKey(config) === customKey(base)) return;
  if (validateCustom(config).some((i) => i.level === "error")) return;
  out.push({ label, config });
}

function exitsVariant(cfg: CustomConfig, f: (e: ExitsCfg) => void): CustomConfig {
  const exits = clone(cfg.exits);
  f(exits);
  return { ...cfg, exits };
}

/** Every one-number-at-a-time neighbour of a rule set (before the choice of `max`). */
export function allNeighbors(cfg: CustomConfig): Neighbor[] {
  const out: Neighbor[] = [];
  // numbers of the rules: the lab's parameter grid (±25 %, snapped to the parameter's grid)
  for (const ax of gridAxes(cfg).axes) {
    for (const v of ax.values) if (v !== ax.base) pushVariant(out, cfg, `${ax.label} ${v}`, withParam(cfg, ax.leaf, ax.key, v));
  }
  const s = cfg.stop;
  const stopPairs: [string, Partial<typeof s>][] =
    s.kind === "atr"
      ? [0.75, 1.25].map((f) => [`Stop ${snap(s.atr * f, 0.05)} × ATR`, { atr: snap(s.atr * f, 0.05) }] as [string, Partial<typeof s>])
      : s.kind === "percent"
        ? [0.8, 1.25].map((f) => [`Stop ${snap(s.pct * f, 0.05)} %`, { pct: snap(s.pct * f, 0.05) }] as [string, Partial<typeof s>])
        : [0.75, 1.25].map((f) => [`Stop ${Math.max(3, Math.round(s.swing * f))} Kerzen`, { swing: Math.max(3, Math.round(s.swing * f)) }] as [string, Partial<typeof s>]);
  for (const [label, patch] of stopPairs) pushVariant(out, cfg, label, { ...cfg, stop: { ...s, ...patch } });
  if (cfg.target.kind === "r") for (const f of [0.75, 1.25]) pushVariant(out, cfg, `Ziel ${snap(cfg.target.r * f, 0.05)} R`, { ...cfg, target: { kind: "r", r: snap(cfg.target.r * f, 0.05) } });
  const e = cfg.exits;
  if (e.breakEven.on) for (const f of [0.75, 1.25]) pushVariant(out, cfg, `Break-even ${snap(e.breakEven.value * f, 0.05)}`, exitsVariant(cfg, (x) => (x.breakEven.value = snap(e.breakEven.value * f, 0.05))));
  if (e.trail.on) {
    for (const f of [0.75, 1.25]) pushVariant(out, cfg, `Trailing ${snap(e.trail.value * f, 0.05)}`, exitsVariant(cfg, (x) => (x.trail.value = snap(e.trail.value * f, 0.05))));
    for (const d of [-0.5, 0.5]) pushVariant(out, cfg, `Trailing ab ${r4(e.trail.activateR + d)} R`, exitsVariant(cfg, (x) => (x.trail.activateR = Math.max(0, r4(e.trail.activateR + d)))));
  }
  if (e.partial.on) {
    for (const d of [-0.25, 0.25]) pushVariant(out, cfg, `Teilgewinn bei ${r4(e.partial.atR + d)} R`, exitsVariant(cfg, (x) => (x.partial.atR = r4(e.partial.atR + d))));
    for (const d of [-10, 10]) pushVariant(out, cfg, `Teilgewinn ${e.partial.fracPct + d} %`, exitsVariant(cfg, (x) => (x.partial.fracPct = e.partial.fracPct + d)));
  }
  if (e.maxBars > 0) for (const f of [0.75, 1.25]) pushVariant(out, cfg, `Zeit-Stop ${Math.max(3, Math.round(e.maxBars * f))}`, exitsVariant(cfg, (x) => (x.maxBars = Math.max(3, Math.round(e.maxBars * f)))));
  // the same variant twice (a clamp can make two neighbours equal) counts once
  const seen = new Set<string>();
  return out.filter((n) => {
    const k = customKey(n.config);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** At most `max` neighbours, chosen by a seeded shuffle (the same seed picks the same ones). */
export function neighborsOf(cfg: CustomConfig, rand: () => number, max: number): Neighbor[] {
  const all = allNeighbors(cfg);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, max);
}

/** How many of the checked neighbours are similar. `null` when none could be checked. */
export function plateauOf(score: number, neighborScores: readonly (number | null)[]): Plateau | null {
  if (!neighborScores.length) return null;
  const ok = neighborScores.filter((s) => s != null && s >= NEIGHBOUR_SHARE * score).length;
  return { checked: neighborScores.length, ok };
}

export const isPlateau = (p: Plateau): boolean => p.ok / p.checked >= PLATEAU_MIN;
