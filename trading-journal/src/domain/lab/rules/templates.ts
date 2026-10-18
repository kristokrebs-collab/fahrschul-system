/**
 * Starting points for "Eigene Idee" (F73): ready-made rule trees the builder can load and the user changes freely. They are
 * ideas to START from, not recommendations – the lab shows what each one would have done on real history.
 */
import { defaultParams, sanitizeParams } from "./blocks";
import { DEFAULT_EXITS, defaultCustom, mirrorGroup, newGroup, sanitizeCustom } from "./tree";
import type { BlockId, CustomConfig, ExitsCfg, Leaf, LeafParams, TfId } from "./types";

export interface CustomTemplate {
  id: string;
  title: string;
  /** one sentence: what the idea bets on */
  sub: string;
  build(): CustomConfig;
}

function leaf(n: number, block: BlockId, params: LeafParams, tf: "exec" | TfId = "exec"): Leaf {
  return { type: "leaf", id: `n${n}`, block, tf, params: sanitizeParams(block, { ...defaultParams(block), ...params }) };
}

const exits = (patch: Partial<ExitsCfg>): ExitsCfg => ({ ...(JSON.parse(JSON.stringify(DEFAULT_EXITS)) as ExitsCfg), ...patch });

export const CUSTOM_TEMPLATES: readonly CustomTemplate[] = [
  {
    id: "oversold-trend",
    title: "Überverkauft im Aufwärtstrend",
    sub: "RSI fällt unter 30, der Tageschart bleibt über seinem EMA 200.",
    build: () =>
      sanitizeCustom({
        ...defaultCustom(),
        name: "Überverkauft im Aufwärtstrend",
        interval: "4h",
        sides: "long",
        long: newGroup("g1", "and", [leaf(1, "rsi", { mode: "below", level: 30 }), leaf(2, "maPrice", { type: "ema", len: 200, mode: "above" }, "1d")]),
        stop: { kind: "atr", atr: 1.5, pct: 1.5, swing: 10, buffer: 0.1 },
        target: { kind: "r", r: 2 },
        exits: exits({ breakEven: { on: true, trigger: "r", value: 1, to: "net" } }),
      }),
  },
  {
    id: "mcb-discount",
    title: "MCB-Punkt in der Discount-Zone",
    sub: "Großer MCB-Punkt (Bottom oder Kauf) im Discount, der 4h-Trend zeigt nach oben. Short gespiegelt.",
    build: () => {
      const long = newGroup("g1", "and", [leaf(1, "wtEvent", { kind: "majorLong", within: 3 }), leaf(2, "zone", { mode: "discount" }), leaf(3, "maPrice", { type: "ema", len: 100, mode: "above" }, "4h")]);
      return sanitizeCustom({
        ...defaultCustom(),
        name: "MCB-Punkt in der Discount-Zone",
        interval: "1h",
        sides: "both",
        long,
        short: mirrorGroup(long, "g2", 4),
        stop: { kind: "swing", atr: 1.5, pct: 1.5, swing: 12, buffer: 0.2 },
        target: { kind: "r", r: 2 },
        exits: exits({ partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true } }),
      });
    },
  },
  {
    id: "volume-breakout",
    title: "Ausbruch mit Volumen",
    sub: "Schluss über dem 20-Kerzen-Hoch mit Volumen-Spitze, der Markt ist nicht im Leerlauf.",
    build: () =>
      sanitizeCustom({
        ...defaultCustom(),
        name: "Ausbruch mit Volumen",
        interval: "1h",
        sides: "long",
        long: newGroup("g1", "and", [leaf(1, "breakout", { mode: "up", n: 20, within: 1 }), leaf(2, "volume", { len: 20, mult: 2, candle: "bull" }), leaf(3, "atrPct", { mode: "above", pct: 40, lookback: 100 })]),
        stop: { kind: "swing", atr: 1.5, pct: 1.5, swing: 10, buffer: 0.1 },
        target: { kind: "none", r: 2 },
        exits: exits({ trail: { on: true, kind: "atr", value: 2, activateR: 1 }, maxBars: 72 }),
      }),
  },
  {
    id: "mtf-pullback",
    title: "Rücksetzer im Mehrzeitrahmen-Trend",
    sub: "4h und 1D zeigen nach oben, der RSI dreht auf 1h aus der Schwäche zurück.",
    build: () =>
      sanitizeCustom({
        ...defaultCustom(),
        name: "Rücksetzer im Mehrzeitrahmen-Trend",
        interval: "1h",
        sides: "long",
        long: newGroup("g1", "and", [leaf(1, "maPrice", { type: "ema", len: 50, mode: "above" }, "4h"), leaf(2, "maPrice", { type: "ema", len: 200, mode: "above" }, "1d"), leaf(3, "rsi", { mode: "crossUp", level: 40, within: 3 })]),
        stop: { kind: "atr", atr: 1.5, pct: 1.5, swing: 10, buffer: 0.1 },
        target: { kind: "r", r: 2.5 },
        exits: exits({}),
      }),
  },
];
