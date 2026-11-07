/**
 * Der Regelentwurf der Demo (F58): zwei Wege zu denselben Regeln des Labors.
 *   In Worten    `parseStrategyText` – der echte, lokale Übersetzer des Strategie-Studios (regelbasiert, ohne Netz, ohne Modell):
 *                verstanden / nicht verstanden / Rückfragen / Annahmen, die Regeln als Klartext.
 *   Baukasten    ein paar Wahlfelder, aus denen derselbe Regelbaum („Eigene Idee“) gebaut wird, den das Labor bearbeitet.
 * Beide enden im Klartext (`summarizeCustom`) und laufen im Test der Demo durch dieselbe Engine. Rein, ohne I/O.
 */
import { defaultParams, sanitizeParams } from "../lab/rules/blocks";
import { DEFAULT_EXITS, defaultCustom, mirrorGroup, newGroup, sanitizeCustom, summarizeCustom } from "../lab/rules/tree";
import type { BlockId, CustomConfig, Leaf, LeafParams } from "../lab/rules/types";
import { parseStrategyText } from "../strategytext";
import type { Answers, StrategyParse } from "../strategytext";

/** Beispielsätze zum Antippen – jeder ist eine fertig lesbare Idee (der Test der Demo hält das fest). */
export const DEMO_IDEAS: readonly { id: string; title: string; text: string }[] = [
  { id: "breakout", title: "Ausbruch", text: "Long, wenn der Kurs über das Hoch der letzten 20 Kerzen ausbricht. Stop 1,5 ATR, Ziel 2R, auf 4h." },
  { id: "pullback", title: "Rücksetzer im Trend", text: "Long, wenn der RSI unter 35 fällt und der Kurs über dem EMA 50 liegt. Stop 2 ATR, Ziel 1,5R, auf 1h." },
  { id: "cross", title: "Trendfolge", text: "Long, wenn der EMA 20 den EMA 50 nach oben kreuzt. Stop 2 ATR, Ziel 3R, auf 4h." },
];

/** Der Übersetzer in Worten: dieselbe Funktion wie im Strategie-Studio. */
export function readIdea(text: string, answers: Answers = {}): StrategyParse {
  return parseStrategyText(text, { answers });
}

// ── Baukasten ────────────────────────────────────────────────────────────────────────────────────────────────

export type KitEntry = "breakout" | "rsi" | "cross";
export type KitFilter = "none" | "trend";
export type KitStop = "atr15" | "atr2" | "pct1";
export type KitSide = "long" | "short";
export type KitInterval = "1h" | "4h";

export interface Kit {
  side: KitSide;
  entry: KitEntry;
  filter: KitFilter;
  stop: KitStop;
  /** Ziel in R */
  target: 1.5 | 2 | 3;
  interval: KitInterval;
}

export const DEFAULT_KIT: Kit = { side: "long", entry: "breakout", filter: "none", stop: "atr15", target: 2, interval: "4h" };

export const KIT_OPTIONS = {
  side: [
    { v: "long", label: "Long" },
    { v: "short", label: "Short" },
  ],
  entry: [
    { v: "breakout", label: "Ausbruch über das 20-Kerzen-Hoch" },
    { v: "rsi", label: "RSI fällt unter 30" },
    { v: "cross", label: "EMA 20 kreuzt EMA 50 nach oben" },
  ],
  filter: [
    { v: "none", label: "Kein Filter" },
    { v: "trend", label: "Kurs über dem EMA 100" },
  ],
  stop: [
    { v: "atr15", label: "1,5 × ATR" },
    { v: "atr2", label: "2 × ATR" },
    { v: "pct1", label: "1 %" },
  ],
  target: [
    { v: "1.5", label: "1,5 R" },
    { v: "2", label: "2 R" },
    { v: "3", label: "3 R" },
  ],
  interval: [
    { v: "1h", label: "1h" },
    { v: "4h", label: "4h" },
  ],
} as const;

function leaf(n: number, block: BlockId, params: LeafParams): Leaf {
  return { type: "leaf", id: `n${n}`, block, tf: "exec", params: sanitizeParams(block, { ...defaultParams(block), ...params }) };
}

const ENTRY_LEAF: Record<KitEntry, Leaf> = {
  breakout: leaf(1, "breakout", { mode: "up", n: 20, within: 1 }),
  rsi: leaf(1, "rsi", { len: 14, mode: "below", level: 30 }),
  cross: leaf(1, "maCross", { type: "ema", fast: 20, slow: 50, mode: "up", within: 1 }),
};

/** Die Regeln des Baukastens als Regelbaum des Labors („Eigene Idee“). Eine Short-Idee ist die Spiegelung der Long-Regeln. */
export function kitConfig(k: Kit): CustomConfig {
  const children: Leaf[] = [ENTRY_LEAF[k.entry]];
  if (k.filter === "trend") children.push(leaf(2, "maPrice", { type: "ema", len: 100, mode: "above" }));
  const long = newGroup("g1", "and", children);
  const stop = { kind: k.stop === "pct1" ? ("percent" as const) : ("atr" as const), atr: k.stop === "atr2" ? 2 : 1.5, pct: 1, swing: 10, buffer: 0.1 };
  const base = { ...defaultCustom(), name: "Baukasten-Idee", interval: k.interval, stop, target: { kind: "r" as const, r: k.target }, exits: JSON.parse(JSON.stringify(DEFAULT_EXITS)) as typeof DEFAULT_EXITS };
  return sanitizeCustom(k.side === "long" ? { ...base, sides: "long", long } : { ...base, sides: "short", short: mirrorGroup(long, "g2", 3) });
}

/** Die Idee als Klartext, eine Zeile je Aussage (was auch das Labor unter dem Regelbaum zeigt). */
export const plainText = (cfg: CustomConfig): string[] => summarizeCustom(cfg);
