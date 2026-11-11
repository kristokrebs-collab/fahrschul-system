/**
 * The rule tree of "Eigene Idee" (F73): defaults, sanitising (every number clamped, unknown blocks dropped), versioned
 * parsing of stored drafts, validation with German messages, the plain-language summary ("Long wenn …"), pure tree edits
 * for the builder UI, and the evaluation – leaves onto the execution bars (a higher timeframe only through its CLOSED bars)
 * and the Kleene combination of AND / OR groups.
 */
import { DEFAULT_SIGNAL_CFG, type SignalCfg } from "../../signals/config";
import { MIN_RISK_FRAC } from "../../backtest/engine";
import type { Bar, FundingPoint } from "../../backtest/types";
import { now, type Stepper } from "../../backtest/strategies/types";
import type { McbFacts } from "../../backtest/strategies/mcbLadder";
import { BLOCKS, BLOCK_ORDER, defaultParams, isBlockId, makeCtx, sanitizeParams, type EvalCtx } from "./blocks";
import { notTri } from "./indicators";
import {
  CUSTOM_VERSION,
  EXEC_TFS,
  FALSE,
  TF_IDS,
  TF_LABEL,
  TF_SEC,
  TRUE,
  UNKNOWN,
  type BlockId,
  type CustomConfig,
  type ExitsCfg,
  type Group,
  type Issue,
  type Leaf,
  type Node,
  type StopCfg,
  type TargetCfg,
  type TfId,
} from "./types";

// ── limits ────────────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_DEPTH = 4;
export const MAX_CHILDREN = 12;
export const MAX_LEAVES_PER_SIDE = 24;
export const MAX_NAME = 60;

const de = (v: number): string => String(Math.round(v * 10_000) / 10_000).replace(".", ",");
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clampNum = (v: unknown, lo: number, hi: number, d: number, int = false): number => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(x)) return d;
  const c = Math.max(lo, Math.min(hi, x));
  return int ? Math.round(c) : Math.round(c * 10_000) / 10_000;
};
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : d);

// ── construction ──────────────────────────────────────────────────────────────────────────────────────────────

export const newLeaf = (id: string, block: BlockId, tf: Leaf["tf"] = "exec"): Leaf => ({ type: "leaf", id, block, tf, params: defaultParams(block) });
export const newGroup = (id: string, op: Group["op"] = "and", children: Node[] = []): Group => ({ type: "group", id, op, children });

export const DEFAULT_STOP: StopCfg = { kind: "atr", atr: 1.5, pct: 1.5, swing: 10, buffer: 0.1 };
export const DEFAULT_TARGET: TargetCfg = { kind: "r", r: 2 };
export const DEFAULT_EXITS: ExitsCfg = {
  breakEven: { on: false, trigger: "r", value: 1, to: "entry" },
  trail: { on: false, kind: "atr", value: 2, activateR: 1 },
  partial: { on: false, atR: 1, fracPct: 50, thenBreakEven: true },
  maxBars: 0,
  exitOnOpposite: false,
};

/** The configuration a new draft starts with: a long idea on 4h with a daily trend filter – a sensible first experiment. */
export function defaultCustom(): CustomConfig {
  const long = newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { ...defaultParams("rsi"), mode: "below", level: 40 } }, { ...newLeaf("n2", "maPrice", "1d"), params: { ...defaultParams("maPrice"), len: 50, mode: "above" } }]);
  return {
    version: CUSTOM_VERSION,
    name: "Meine Idee",
    interval: "4h",
    sides: "long",
    long,
    short: mirrorGroup(long, "g2", 3),
    stop: { ...DEFAULT_STOP },
    target: { ...DEFAULT_TARGET },
    exits: JSON.parse(JSON.stringify(DEFAULT_EXITS)) as ExitsCfg,
  };
}

/** The same idea for the other side: every block mirrored (RSI below 30 → above 70 …), ids renumbered from `fromNum`. */
export function mirrorGroup(g: Group, id: string, fromNum: number): Group {
  let k = fromNum;
  const walk = (n: Node, isRoot: boolean): Node => {
    if (n.type === "leaf") return { ...n, id: `n${k++}`, params: BLOCKS[n.block].mirror(n.params) };
    return { type: "group", id: isRoot ? id : `g${k++}`, op: n.op, children: n.children.map((c) => walk(c, false)) };
  };
  return walk(g, true) as Group;
}

// ── tree helpers ──────────────────────────────────────────────────────────────────────────────────────────────

export function leavesOf(n: Node): Leaf[] {
  return n.type === "leaf" ? [n] : n.children.flatMap(leavesOf);
}

/** The groups of a tree including itself. */
export function groupsOf(n: Node): Group[] {
  return n.type === "leaf" ? [] : [n, ...n.children.flatMap(groupsOf)];
}

export const sidesOf = (cfg: Pick<CustomConfig, "sides">): ("long" | "short")[] => (cfg.sides === "both" ? ["long", "short"] : [cfg.sides]);

/** Every leaf of the active sides. */
export function activeLeaves(cfg: CustomConfig): Leaf[] {
  return sidesOf(cfg).flatMap((s) => leavesOf(cfg[s]));
}

export function findNode(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  if (root.type === "group") for (const c of root.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** Next free `n…` / `g…` number of a configuration (both sides). */
export function nextNum(cfg: Pick<CustomConfig, "long" | "short">): number {
  let m = 0;
  const walk = (n: Node) => {
    const k = Number(n.id.slice(1));
    if (Number.isFinite(k)) m = Math.max(m, k);
    if (n.type === "group") n.children.forEach(walk);
  };
  walk(cfg.long);
  walk(cfg.short);
  return m + 1;
}

/** Immutable edit of one node (`fn` returns the replacement, `null` removes it). The root cannot be removed. */
export function editNode(root: Group, id: string, fn: (n: Node) => Node | null): Group {
  const walk = (n: Node): Node | null => {
    if (n.id === id) return fn(n);
    if (n.type === "group") {
      const kids = n.children.map(walk).filter((c): c is Node => c !== null);
      return kids.length === n.children.length && kids.every((c, i) => c === n.children[i]) ? n : { ...n, children: kids };
    }
    return n;
  };
  const out = walk(root);
  return out && out.type === "group" ? out : root;
}

// ── sanitising & versioned parsing ────────────────────────────────────────────────────────────────────────────

export function sanitizeStop(raw: unknown): StopCfg {
  const r = isRec(raw) ? raw : {};
  return {
    kind: pick(r.kind, ["atr", "percent", "swing"] as const, DEFAULT_STOP.kind),
    atr: clampNum(r.atr, 0.3, 10, DEFAULT_STOP.atr),
    pct: clampNum(r.pct, 0.05, 30, DEFAULT_STOP.pct),
    swing: clampNum(r.swing, 2, 200, DEFAULT_STOP.swing, true),
    buffer: clampNum(r.buffer, 0, 3, DEFAULT_STOP.buffer),
  };
}

export function sanitizeTarget(raw: unknown): TargetCfg {
  const r = isRec(raw) ? raw : {};
  return { kind: pick(r.kind, ["r", "none"] as const, DEFAULT_TARGET.kind), r: clampNum(r.r, 0.25, 20, DEFAULT_TARGET.r) };
}

export function sanitizeExits(raw: unknown): ExitsCfg {
  const r = isRec(raw) ? raw : {};
  const be = isRec(r.breakEven) ? r.breakEven : {};
  const tr = isRec(r.trail) ? r.trail : {};
  const pa = isRec(r.partial) ? r.partial : {};
  const d = DEFAULT_EXITS;
  const trigger = pick(be.trigger, ["r", "pct"] as const, d.breakEven.trigger);
  const tkind = pick(tr.kind, ["atr", "pct"] as const, d.trail.kind);
  return {
    breakEven: { on: be.on === true, trigger, value: trigger === "r" ? clampNum(be.value, 0.2, 10, d.breakEven.value) : clampNum(be.value, 0.1, 50, 2), to: pick(be.to, ["entry", "net"] as const, d.breakEven.to) },
    trail: { on: tr.on === true, kind: tkind, value: tkind === "atr" ? clampNum(tr.value, 0.5, 10, d.trail.value) : clampNum(tr.value, 0.2, 30, 3), activateR: clampNum(tr.activateR, 0, 10, d.trail.activateR) },
    partial: { on: pa.on === true, atR: clampNum(pa.atR, 0.2, 10, d.partial.atR), fracPct: clampNum(pa.fracPct, 5, 95, d.partial.fracPct, true), thenBreakEven: pa.thenBreakEven !== false },
    maxBars: clampNum(r.maxBars, 0, 2000, 0, true),
    exitOnOpposite: r.exitOnOpposite === true,
  };
}

/** Rebuilds a group from stored data: unknown blocks / malformed nodes dropped, parameters clamped, ids made unique. */
function sanitizeGroup(raw: unknown, rootId: string, used: Set<string>, counter: { n: number }, budget: { leaves: number }): Group {
  const takeId = (want: unknown, prefix: "n" | "g"): string => {
    if (typeof want === "string" && /^[ng][0-9]{1,6}$/.test(want) && want[0] === prefix && !used.has(want)) {
      used.add(want);
      counter.n = Math.max(counter.n, Number(want.slice(1)));
      return want;
    }
    let id: string;
    do id = `${prefix}${++counter.n}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
  const walk = (r: unknown, depth: number, root: boolean): Node | null => {
    if (!isRec(r)) return null;
    if (r.type === "leaf") {
      if (!isBlockId(r.block) || budget.leaves <= 0) return null;
      budget.leaves--;
      const tf = r.tf === "exec" ? "exec" : (TF_IDS as readonly unknown[]).includes(r.tf) ? (r.tf as TfId) : "exec";
      const leaf: Leaf = { type: "leaf", id: takeId(r.id, "n"), block: r.block, tf, params: sanitizeParams(r.block, r.params) };
      if (r.not === true) leaf.not = true;
      return leaf;
    }
    if (r.type === "group" || root) {
      const id = root ? (used.add(rootId), rootId) : takeId(r.id, "g");
      const kids = depth >= MAX_DEPTH || !Array.isArray(r.children) ? [] : r.children.slice(0, MAX_CHILDREN).map((c) => walk(c, depth + 1, false)).filter((c): c is Node => c !== null);
      return { type: "group", id, op: r.op === "or" ? "or" : "and", children: kids };
    }
    return null;
  };
  const g = walk(isRec(raw) ? { ...raw, type: "group" } : { type: "group", children: [] }, 0, true);
  return (g as Group) ?? newGroup(rootId);
}

/** A stored configuration made valid (never throws): shape, clamps, ids. Content problems are `validateCustom`'s business. */
export function sanitizeCustom(raw: unknown): CustomConfig {
  const r = isRec(raw) ? raw : {};
  const used = new Set<string>();
  const counter = { n: 0 };
  // claim the root ids first so a leaf cannot take them
  const long = sanitizeGroup(r.long, "g1", used, counter, { leaves: MAX_LEAVES_PER_SIDE });
  const short = sanitizeGroup(r.short, "g2", used, counter, { leaves: MAX_LEAVES_PER_SIDE });
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, MAX_NAME) : "Meine Idee";
  return {
    version: CUSTOM_VERSION,
    name,
    interval: pick(r.interval, EXEC_TFS, "4h"),
    sides: pick(r.sides, ["long", "short", "both"] as const, "long"),
    long,
    short,
    stop: sanitizeStop(r.stop),
    target: sanitizeTarget(r.target),
    exits: sanitizeExits(r.exits),
  };
}

/**
 * Versioned parsing of a stored / imported draft: `version: 1` is sanitised; a missing or newer version is refused with a
 * message instead of being guessed at.
 */
export function parseCustom(raw: unknown): { config: CustomConfig | null; error: string | null } {
  if (!isRec(raw)) return { config: null, error: "Der Entwurf ist kein gültiges Objekt." };
  if (raw.version === undefined) return { config: null, error: "Dem Entwurf fehlt die Versionsangabe." };
  if (raw.version !== CUSTOM_VERSION) return { config: null, error: `Der Entwurf hat die Version ${String(raw.version)}; diese App versteht Version ${CUSTOM_VERSION}.` };
  return { config: sanitizeCustom(raw), error: null };
}

/** Stable key of a configuration (compare cards, caches): same rules + stop + exits → same key. Name excluded. */
export function customKey(cfg: CustomConfig): string {
  const { name: _name, ...rest } = cfg;
  void _name;
  const json = JSON.stringify(rest);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = (Math.imul(h, 33) ^ json.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── availability (disabled options come with a reason) ────────────────────────────────────────────────────────

/** What the surrounding lab set-up offers (a block that needs run data is locked without it). Absent = not checked. */
export interface CheckEnv {
  /** the run loads the real funding history (cost setting "Funding: Historie") */
  funding?: boolean;
}

export const FUNDING_LOCK = "Funding-Extrem braucht die echte Funding-Historie des Laufs. Stelle bei den Kosten „Funding“ auf „Historie“ – ohne sie gibt es keine Funding-Werte, und der Baustein bliebe unbekannt.";

/** Can this block run on the execution interval (and with the run's data)? */
export function blockAvailability(id: BlockId, exec: TfId, env?: CheckEnv): { ok: boolean; reason?: string } {
  if (id === "mcbLadder" && exec !== "1h" && exec !== "4h") return { ok: false, reason: "Die MCB-Leiter prüft im Takt 1h oder 4h wie dein Einstiegs-Check. Wähle diese Ausführung." };
  if (BLOCKS[id].needsRunData === "funding" && env && env.funding === false) return { ok: false, reason: FUNDING_LOCK };
  return { ok: true };
}

/** Can a leaf use timeframe `tf` on the execution interval `exec`? */
export function tfAvailability(tf: TfId, exec: TfId, block?: BlockId): { ok: boolean; reason?: string } {
  if (tf === exec) return { ok: true };
  const def = block ? BLOCKS[block] : null;
  if (def?.execOnly) return { ok: false, reason: def.execOnly };
  if (TF_SEC[tf] < TF_SEC[exec]) return { ok: false, reason: `${TF_LABEL[tf]} ist niedriger als die Ausführung (${TF_LABEL[exec]}). Die Engine rechnet auf den Ausführungskerzen, feinere Kerzen kann sie nicht auswerten.` };
  return { ok: true };
}

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────

export function validateCustom(cfg: CustomConfig, env?: CheckEnv): Issue[] {
  const out: Issue[] = [];
  const err = (text: string, node?: string) => out.push({ level: "error", text, node });
  const warn = (text: string, node?: string) => out.push({ level: "warn", text, node });
  const sideName = { long: "Long", short: "Short" } as const;
  for (const side of sidesOf(cfg)) {
    const g = cfg[side];
    const ls = leavesOf(g);
    if (!ls.length) err(`${sideName[side]}-Regeln: Ohne mindestens eine Bedingung gibt es kein Signal.`, g.id);
    for (const grp of groupsOf(g)) if (!grp.children.length && ls.length) err(`${sideName[side]}: Eine leere Gruppe erfüllt nichts – füge eine Bedingung hinzu oder entferne sie.`, grp.id);
    for (const l of ls) {
      const def = BLOCKS[l.block];
      const label = `${sideName[side]} · ${def.label}`;
      const av = blockAvailability(l.block, cfg.interval, env);
      if (!av.ok) err(`${label}: ${av.reason}`, l.id);
      if (l.tf !== "exec") {
        const t = tfAvailability(l.tf, cfg.interval, l.block);
        if (!t.ok) err(`${label} [${TF_LABEL[l.tf]}]: ${t.reason}`, l.id);
      }
      const problem = def.check?.(l.params, TF_SEC[l.tf === "exec" ? cfg.interval : l.tf]);
      if (problem) err(`${label}: ${problem}`, l.id);
      if (l.block === "keyLevel" && !(Number(l.params.level) > 0)) err(`${label}: Der Preis fehlt.`, l.id);
      if (def.heavy && TF_SEC[l.tf === "exec" ? cfg.interval : l.tf] < 3600 && l.block !== "mcbLadder") warn(`${label}: ${def.heavy}`, l.id);
      if (l.block === "mcbLadder" && l.not) warn(`${label}: „Nicht“ bei der Leiter heißt nur „kein gültiges Urteil“ – ohne Urteil (zu wenig Daten) bleibt es unbekannt.`, l.id);
    }
  }
  if (cfg.stop.kind === "percent" && cfg.stop.pct < MIN_RISK_FRAC * 100) err(`Stop: ${de(cfg.stop.pct)} % ist enger als das Minimum der Engine (${de(MIN_RISK_FRAC * 100)} %).`);
  const ex = cfg.exits;
  if (cfg.target.kind === "r") {
    if (ex.partial.on && ex.partial.atR >= cfg.target.r) warn(`Teil-Gewinnmitnahme bei ${de(ex.partial.atR)} R liegt nicht vor dem Ziel (${de(cfg.target.r)} R) – die Engine verwirft sie.`);
    if (ex.breakEven.on && ex.breakEven.trigger === "r" && ex.breakEven.value >= cfg.target.r) warn(`Break-even greift erst bei ${de(ex.breakEven.value)} R, das Ziel liegt bei ${de(cfg.target.r)} R – er kommt nie vor dem Ziel zum Einsatz.`);
  } else if (!ex.trail.on && ex.maxBars === 0 && !ex.exitOnOpposite) {
    warn("Ohne Ziel, Trailing-Stop, Zeit-Stop oder Gegensignal endet ein Trade nur am Stop oder am Ende des Zeitraums.");
  }
  if (ex.exitOnOpposite && cfg.sides !== "both") warn("„Ausstieg bei Gegensignal“ braucht Long- und Short-Regeln. Mit nur einer Seite gibt es kein Gegensignal.");
  if (cfg.sides === "both" && leavesOf(cfg.long).length && nodeText(cfg.long) === nodeText(cfg.short)) warn("Long- und Short-Regeln sind identisch: bei jedem Signal wäre die Richtung widersprüchlich, der Lauf handelt dann nicht.");
  return out;
}

// ── plain-language summary ────────────────────────────────────────────────────────────────────────────────────

export function leafText(l: Leaf): string {
  const base = BLOCKS[l.block].text(l.params);
  const tf = l.tf === "exec" ? "" : ` [${TF_LABEL[l.tf]}]`;
  return l.not ? `NICHT: ${base}${tf}` : `${base}${tf}`;
}

export function nodeText(n: Node, top = true): string {
  if (n.type === "leaf") return leafText(n);
  const parts = n.children.map((c) => nodeText(c, false));
  if (!parts.length) return "(leer)";
  const s = parts.join(n.op === "and" ? " UND " : " ODER ");
  return top || parts.length === 1 ? s : `(${s})`;
}

export function stopText(s: StopCfg): string {
  return s.kind === "atr" ? `${de(s.atr)} × ATR(14)` : s.kind === "percent" ? `${de(s.pct)} % vom Schlusskurs` : `${s.swing}-Kerzen-Swing${s.buffer > 0 ? ` plus ${de(s.buffer)} × ATR` : ""}`;
}

export function exitsText(cfg: Pick<CustomConfig, "target" | "exits">): string[] {
  const out: string[] = [];
  const { target, exits: e } = cfg;
  out.push(target.kind === "r" ? `Ziel bei ${de(target.r)} R` : "Kein festes Ziel");
  if (e.breakEven.on) out.push(`Break-even nach ${e.breakEven.trigger === "r" ? `+${de(e.breakEven.value)} R` : `+${de(e.breakEven.value)} %`} (Stop auf ${e.breakEven.to === "net" ? "den Netto-Break-even inkl. Gebühren" : "den Einstieg"})`);
  if (e.trail.on) out.push(`Trailing-Stop ${e.trail.kind === "atr" ? `${de(e.trail.value)} × ATR` : `${de(e.trail.value)} %`} hinter dem besten Kurs${e.trail.activateR > 0 ? ` ab +${de(e.trail.activateR)} R` : ""}`);
  if (e.partial.on) out.push(`${e.partial.fracPct} % der Position bei +${de(e.partial.atR)} R verkaufen${e.partial.thenBreakEven ? ", dann Stop auf Break-even" : ""}`);
  if (e.maxBars > 0) out.push(`Zeit-Stop nach ${e.maxBars} Kerzen`);
  if (e.exitOnOpposite) out.push("Ausstieg bei neuem Gegensignal");
  return out;
}

/** The idea in plain language, one line per statement. */
export function summarizeCustom(cfg: CustomConfig): string[] {
  const out: string[] = [];
  for (const side of sidesOf(cfg)) {
    const g = cfg[side];
    out.push(`${side === "long" ? "Long" : "Short"} wenn ${leavesOf(g).length ? nodeText(g) : "…"}.`);
  }
  out.push(`Geprüft wird zum Schluss jeder ${TF_LABEL[cfg.interval]}-Kerze, gekauft zur Eröffnung der nächsten – und nur bei einem NEUEN Signal (die Bedingung war an der Kerze davor nicht erfüllt).`);
  out.push(`Stop: ${stopText(cfg.stop)}. ${exitsText(cfg).join(". ")}.`);
  return out;
}

// ── requirements of a configuration ───────────────────────────────────────────────────────────────────────────

/** Timeframes the active leaves need besides the execution interval (higher ones only), small → large. */
export function higherTfsOf(cfg: CustomConfig): TfId[] {
  const set = new Set<TfId>();
  for (const l of activeLeaves(cfg)) if (l.tf !== "exec" && l.tf !== cfg.interval && TF_SEC[l.tf] > TF_SEC[cfg.interval]) set.add(l.tf);
  return TF_IDS.filter((t) => set.has(t));
}

export const needsLadder = (cfg: CustomConfig): boolean => activeLeaves(cfg).some((l) => l.block === "mcbLadder");

/** Longest warm-up of the active leaves in ms (each in its own timeframe) plus a margin of 25 %. */
export function warmupMsOf(cfg: CustomConfig): number {
  let ms = TF_SEC[cfg.interval] * 1000 * Math.max(60, cfg.stop.swing + 20);
  for (const l of activeLeaves(cfg)) {
    const tf = l.tf === "exec" || TF_SEC[l.tf] < TF_SEC[cfg.interval] ? cfg.interval : l.tf;
    ms = Math.max(ms, BLOCKS[l.block].warmup(l.params) * TF_SEC[tf] * 1000);
  }
  return Math.round(ms * 1.25);
}

// ── evaluation ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Maps a series of a HIGHER timeframe onto the execution bars: execution bar i sees the value of the newest higher bar
 * that had CLOSED at i's close (`t + secHtf ≤ t_i + secExec`) – never the running one. A gap in the higher data (the last
 * closed bar is a full higher bar or more behind) gives unknown.
 */
export function mapToExec(src: Uint8Array, htf: readonly Bar[], htfSec: number, exec: readonly Bar[], execSec: number): Uint8Array {
  const out = new Uint8Array(exec.length).fill(UNKNOWN);
  let k = -1;
  for (let i = 0; i < exec.length; i++) {
    const closeAt = exec[i]!.t + execSec;
    while (k + 1 < htf.length && htf[k + 1]!.t + htfSec <= closeAt) k++;
    if (k < 0) continue;
    if (closeAt - (htf[k]!.t + htfSec) >= htfSec) continue; // stale: a higher bar is missing
    out[i] = src[k] ?? UNKNOWN;
  }
  return out;
}

export interface SeriesSet {
  exec: { tf: TfId; bars: readonly Bar[] };
  /** other timeframes by id (bars ascending, closed) */
  other: Partial<Record<TfId, readonly Bar[]>>;
}

/**
 * Evaluates every leaf of `leaves` onto the execution bars (tri-state, WITHOUT the `not` flag). Unique (block, timeframe,
 * parameters) are computed once. Stepped: heavy blocks give the loop back between slices.
 */
export function evaluateLeaves(leaves: readonly Leaf[], series: SeriesSet, signal: SignalCfg = DEFAULT_SIGNAL_CFG, ladder: McbFacts | null = null, funding: readonly FundingPoint[] | null = null): Stepper<Map<string, Uint8Array>> {
  const execSec = TF_SEC[series.exec.tf];
  const n = series.exec.bars.length;
  const ctxs = new Map<string, EvalCtx>();
  const ctxOf = (tf: TfId, bars: readonly Bar[], withLadder: boolean): EvalCtx => {
    const key = `${tf}${withLadder ? "L" : ""}`;
    let c = ctxs.get(key);
    if (!c) ctxs.set(key, (c = makeCtx(bars, signal, withLadder ? ladder : null, { tfSec: TF_SEC[tf], funding })));
    return c;
  };
  const keyOf = (l: Leaf): string => `${l.block}|${l.tf === "exec" ? series.exec.tf : l.tf}|${Object.keys(l.params).sort().map((k) => `${k}=${String(l.params[k])}`).join(",")}`;
  const tasks: { key: string; leaf: Leaf }[] = [];
  const seen = new Set<string>();
  for (const l of leaves) {
    const k = keyOf(l);
    if (!seen.has(k)) {
      seen.add(k);
      tasks.push({ key: k, leaf: l });
    }
  }
  const results = new Map<string, Uint8Array>();
  let t = 0;
  let active: { key: string; leaf: Leaf; run: Stepper<Uint8Array> } | null = null;

  const unknownAll = (): Uint8Array => new Uint8Array(n).fill(UNKNOWN);
  const finishTask = (key: string, leaf: Leaf, raw: Uint8Array): void => {
    const tf = leaf.tf === "exec" ? series.exec.tf : leaf.tf;
    results.set(key, tf === series.exec.tf ? raw : mapToExec(raw, series.other[tf] ?? [], TF_SEC[tf], series.exec.bars, execSec));
  };
  const start = (key: string, leaf: Leaf): void => {
    const tf = leaf.tf === "exec" ? series.exec.tf : leaf.tf;
    // not usable: a lower timeframe, an exec-only block elsewhere, no data – never silently true
    if (!tfAvailability(tf, series.exec.tf, leaf.block).ok || !blockAvailability(leaf.block, series.exec.tf).ok) {
      results.set(key, unknownAll());
      return;
    }
    const bars = tf === series.exec.tf ? series.exec.bars : series.other[tf];
    if (!bars || !bars.length) {
      results.set(key, unknownAll());
      return;
    }
    const r = BLOCKS[leaf.block].eval(ctxOf(tf, bars, tf === series.exec.tf && leaf.block === "mcbLadder"), leaf.params);
    if (r instanceof Uint8Array) finishTask(key, leaf, r);
    else active = { key, leaf, run: r };
  };

  return {
    step(deadline: number): boolean {
      let worked = false;
      for (;;) {
        if (active) {
          if (!active.run.step(deadline)) return false;
          finishTask(active.key, active.leaf, active.run.result());
          active = null;
          t++;
          worked = true;
        }
        if (t >= tasks.length) return true;
        if (worked && now() >= deadline) return false;
        start(tasks[t]!.key, tasks[t]!.leaf);
        worked = true;
        if (!active) t++;
      }
    },
    progress: () => (tasks.length ? Math.min(1, t / tasks.length) : 1),
    result() {
      while (!this.step(Number.POSITIVE_INFINITY)) {
        /* run to the end */
      }
      const out = new Map<string, Uint8Array>();
      for (const l of leaves) out.set(l.id, results.get(keyOf(l)) ?? unknownAll());
      return out;
    },
  };
}

export interface Combined {
  /** tri-state of every group and leaf (with `not` applied) that took part */
  nodes: Map<string, Uint8Array>;
  /** the root's series, or null when nothing is left of the tree */
  hit: Uint8Array | null;
}

/**
 * Kleene combination of a tree over `n` bars from the leaf series. `without` drops leaves (and groups that become empty) –
 * the "ohne diesen Filter" comparison. An empty group is unknown, never true.
 */
export function combineTree(root: Group, leafSeries: ReadonlyMap<string, Uint8Array>, n: number, without?: ReadonlySet<string>): Combined {
  const nodes = new Map<string, Uint8Array>();
  const walk = (node: Node): Uint8Array | null => {
    if (node.type === "leaf") {
      if (without?.has(node.id)) return null;
      const raw = leafSeries.get(node.id) ?? new Uint8Array(n).fill(UNKNOWN);
      let s = raw;
      if (node.not) {
        s = new Uint8Array(n);
        for (let i = 0; i < n; i++) s[i] = notTri(raw[i] as 0 | 1 | 2);
      }
      nodes.set(node.id, s);
      return s;
    }
    const kids = node.children.map(walk).filter((s): s is Uint8Array => s !== null);
    if (!kids.length) return null;
    const out = new Uint8Array(n);
    const and = node.op === "and";
    for (let i = 0; i < n; i++) {
      let st: number = and ? TRUE : FALSE;
      for (let k = 0; k < kids.length; k++) {
        const v = kids[k]![i]!;
        if (and) {
          if (v === FALSE) {
            st = FALSE;
            break;
          }
          if (v === UNKNOWN) st = UNKNOWN;
        } else {
          if (v === TRUE) {
            st = TRUE;
            break;
          }
          if (v === UNKNOWN) st = UNKNOWN;
        }
      }
      out[i] = st;
    }
    nodes.set(node.id, out);
    return out;
  };
  return { nodes, hit: walk(root) };
}

export { BLOCK_ORDER };
