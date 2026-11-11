/**
 * Strategy description of an Entscheidungsgrundlage (P07): `SetupX = Setup & StrategyExtras`. The extras live as
 * PASSTHROUGH keys on the entries of `settings.setups` – `normalizeSettings` spreads every setup (`...s`), backups and
 * the cloud merge keep unknown keys – so no schema change, and a setup without them reads exactly as before.
 *
 * `strategyOf(setup)` reads them defensively (every field defaulted, wrong types dropped); `withStrategy(setup, x)`
 * writes them back (empty fields are removed so an untouched setup stays byte-identical); `cleanStrategy` is what the
 * editor saves (trimmed, de-duplicated, empty rows dropped).
 */
import type { Grade, SetupKind } from "../boxes";
import type { SessionKey } from "../insights/time";
import type { Setup, Side } from "../types";

export interface CriteriaItem {
  id: string;
  text: string;
}

/** Where the stop goes by plan. */
export type StopRule = "box" | "struktur" | "atr" | "fix";
export const STOP_RULE_LABEL: Readonly<Record<StopRule, string>> = { box: "Boxkante", struktur: "Struktur", atr: "ATR", fix: "Fester Abstand" };

export interface RiskModel {
  /** risk per trade in % of the account capital (1 = 1 %) */
  riskPct: number | null;
  maxLeverage: number | null;
  /** minimum planned reward-to-risk */
  minRR: number | null;
  stop: StopRule | null;
}

/** Automatic recognition rules (the classifier reads them; empty = inferred from the texts and the history). */
export interface AutoRule {
  /** Box-zu-Box setup kinds at entry (`trade.boxSnap`) */
  boxKinds: SetupKind[];
  /** minimum box grade at entry */
  minGrade: Grade | null;
  /** minimum strength of the stored entry check (`trade.signal`) */
  minStrength: number | null;
  sessions: SessionKey[];
  sides: Side[];
}

export interface StrategyExtras {
  entryCriteria: CriteriaItem[];
  exitCriteria: CriteriaItem[];
  riskModel: RiskModel;
  tags: string[];
  /** best-practice example trades (trade ids) */
  examples: string[];
  /** markets the strategy is meant for (Binance spelling "BTCUSDT"; empty = any) */
  markets: string[];
  /** timeframes (journal spelling "4h", "1D"; empty = any) */
  tf: string[];
  auto: AutoRule;
}

export type SetupX = Setup & StrategyExtras;

export const EMPTY_RISK: Readonly<RiskModel> = Object.freeze({ riskPct: null, maxLeverage: null, minRR: null, stop: null });
export const EMPTY_AUTO: Readonly<AutoRule> = Object.freeze({ boxKinds: [], minGrade: null, minStrength: null, sessions: [], sides: [] });

const BOX_KINDS: readonly SetupKind[] = ["range", "breakout", "retest", "fakeout", "pre"];
const GRADES: readonly Grade[] = ["A+", "A", "B", "C"];
const SESSIONS: readonly SessionKey[] = ["asia", "london", "ny", "late", "weekend"];
const STOPS: readonly StopRule[] = ["box", "struktur", "atr", "fix"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function strings(v: unknown, max = 40): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s && !out.includes(s)) out.push(s.slice(0, 60));
    if (out.length >= max) break;
  }
  return out;
}

function criteria(v: unknown): CriteriaItem[] {
  if (!Array.isArray(v)) return [];
  const out: CriteriaItem[] = [];
  v.forEach((x, i) => {
    if (!isObj(x) || typeof x.text !== "string") return;
    const id = typeof x.id === "string" && x.id ? x.id : `k${i}`;
    if (out.some((c) => c.id === id)) return;
    out.push({ id, text: x.text });
  });
  return out.slice(0, 30);
}

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? (v.filter((x) => allowed.includes(x as T)) as T[]).filter((x, i, a) => a.indexOf(x) === i) : []);

/** Normalised market symbol: "BTC/USDT", "BINANCE:BTCUSDT.P", "btcusdt" → "BTCUSDT". */
export function marketKey(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^[A-Z0-9]+:/, "").replace(/\.P$/, "").replace(/[^A-Z0-9]/g, "");
  return s;
}

/** The strategy extras of a setup (defaults for everything missing). */
export function strategyOf(setup: Setup): SetupX {
  const r = setup as unknown as Record<string, unknown>;
  const rm = isObj(r.riskModel) ? r.riskModel : {};
  const au = isObj(r.auto) ? r.auto : {};
  return {
    ...setup,
    entryCriteria: criteria(r.entryCriteria),
    exitCriteria: criteria(r.exitCriteria),
    riskModel: {
      riskPct: num(rm.riskPct, 0.01, 100),
      maxLeverage: num(rm.maxLeverage, 1, 200),
      minRR: num(rm.minRR, 0.1, 50),
      stop: STOPS.includes(rm.stop as StopRule) ? (rm.stop as StopRule) : null,
    },
    tags: strings(r.tags),
    examples: strings(r.examples, 24),
    markets: strings(r.markets).map(marketKey).filter((m, i, a) => m && a.indexOf(m) === i),
    tf: strings(r.tf, 12),
    auto: {
      boxKinds: pick(au.boxKinds, BOX_KINDS),
      minGrade: GRADES.includes(au.minGrade as Grade) ? (au.minGrade as Grade) : null,
      minStrength: num(au.minStrength, 0, 4),
      sessions: pick(au.sessions, SESSIONS),
      sides: pick(au.sides, ["long", "short"] as const),
    },
  };
}

/** Whether the setup carries any strategy data beyond the classic fields. */
export function hasStrategyData(x: StrategyExtras): boolean {
  const rm = x.riskModel;
  const a = x.auto;
  return (
    x.entryCriteria.length > 0 ||
    x.exitCriteria.length > 0 ||
    x.tags.length > 0 ||
    x.examples.length > 0 ||
    x.markets.length > 0 ||
    x.tf.length > 0 ||
    rm.riskPct != null ||
    rm.maxLeverage != null ||
    rm.minRR != null ||
    rm.stop != null ||
    a.boxKinds.length > 0 ||
    a.minGrade != null ||
    a.minStrength != null ||
    a.sessions.length > 0 ||
    a.sides.length > 0
  );
}

/** Trimmed criteria, empty rows dropped. */
export const cleanCriteria = (list: readonly CriteriaItem[]): CriteriaItem[] => list.filter((c) => c.text.trim()).map((c) => ({ id: c.id, text: c.text.trim() }));

/** What the editor saves: extras cleaned (trimmed, unique, empty removed). */
export function cleanStrategy(x: StrategyExtras): StrategyExtras {
  return {
    entryCriteria: cleanCriteria(x.entryCriteria),
    exitCriteria: cleanCriteria(x.exitCriteria),
    riskModel: { ...x.riskModel },
    tags: strings(x.tags),
    examples: strings(x.examples, 24),
    markets: strings(x.markets).map(marketKey).filter((m, i, a) => m && a.indexOf(m) === i),
    tf: strings(x.tf, 12),
    auto: { ...x.auto, boxKinds: [...x.auto.boxKinds], sessions: [...x.auto.sessions], sides: [...x.auto.sides] },
  };
}

const EXTRA_KEYS = ["entryCriteria", "exitCriteria", "riskModel", "tags", "examples", "markets", "tf", "auto"] as const;

/**
 * Writes the extras onto a setup: only non-empty parts are stored (an untouched setup keeps exactly its old keys);
 * unknown keys of the setup survive.
 */
export function withStrategy<S extends Setup>(setup: S, x: StrategyExtras): S {
  const c = cleanStrategy(x);
  const out: Record<string, unknown> = { ...(setup as unknown as Record<string, unknown>) };
  for (const k of EXTRA_KEYS) delete out[k];
  if (c.entryCriteria.length) out.entryCriteria = c.entryCriteria;
  if (c.exitCriteria.length) out.exitCriteria = c.exitCriteria;
  const rm = c.riskModel;
  if (rm.riskPct != null || rm.maxLeverage != null || rm.minRR != null || rm.stop != null) out.riskModel = rm;
  if (c.tags.length) out.tags = c.tags;
  if (c.examples.length) out.examples = c.examples;
  if (c.markets.length) out.markets = c.markets;
  if (c.tf.length) out.tf = c.tf;
  const a = c.auto;
  if (a.boxKinds.length || a.minGrade != null || a.minStrength != null || a.sessions.length || a.sides.length) out.auto = a;
  return out as unknown as S;
}

/** The extras part of a SetupX (for forms / comparisons). */
export function extrasOf(x: SetupX): StrategyExtras {
  return { entryCriteria: x.entryCriteria, exitCriteria: x.exitCriteria, riskModel: x.riskModel, tags: x.tags, examples: x.examples, markets: x.markets, tf: x.tf, auto: x.auto };
}

/** Canonical JSON of the extras (dirty check of the editor: same saved meaning ⇔ same string). */
export function extrasKey(x: StrategyExtras): string {
  const c = cleanStrategy(x);
  return JSON.stringify([c.entryCriteria.map((k) => [k.id, k.text]), c.exitCriteria.map((k) => [k.id, k.text]), c.riskModel, c.tags, c.examples, c.markets, c.tf, c.auto]);
}
