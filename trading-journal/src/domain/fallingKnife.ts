/**
 * Falling-Knife-Filter – 1:1 port of bundle `JG` (23884–23922) plus the card/dialog strings.
 */
import type { HyblockReading, MarketLevels } from "./types";
import { n0, signed } from "@/lib/format";
import type { Explanation, Verdict } from "./explain";

export type KnifePointKey = "zone" | "struct" | "delta" | "rsi";

export interface KnifePoint {
  k: KnifePointKey;
  l: string;
  ok: boolean | null;
  /** source line under the label */
  src: string;
}

export interface FallingKnife {
  pts: KnifePoint[];
  /** fulfilled points */
  n: number;
  rising: boolean | null;
  knife: boolean;
  all: boolean;
}

export type PriceSource = "TradingView" | "Binance" | "Bybit" | "OKX";

export interface KnifeMarket {
  price: number | null | undefined;
  /** label in the source line; default "TradingView" */
  source?: PriceSource | string;
}

export const KNIFE_TITLE = "Falling-Knife-Filter";
export const KNIFE_CARD_ALL = "Makro-Long-Trigger valide.";
export const KNIFE_CARD_KNIFE = "Anti-Muster: Messer fangen. Beobachten.";
export const KNIFE_CARD_NONE = "Kein Kaufsignal. Tippen für Details.";
export const KNIFE_WHAT =
  "Ein steigender Top-Trader-Long-% allein ist kein Kaufsignal: Top-Trader akkumulieren oft gestaffelt, während der Preis noch fällt. Ein Makro-Long ist nur valide, wenn alle 4 Punkte erfüllt sind.";

export function fallingKnife(
  cur: HyblockReading | null | undefined,
  prev: HyblockReading | null | undefined,
  market: KnifeMarket,
  s: { market: MarketLevels },
): FallingKnife {
  const price = market.price;
  const src = market.source ?? "TradingView";
  const m = s.market;
  const pts: KnifePoint[] = [
    {
      k: "zone",
      l: "Preis in Support-/Liquiditätszone",
      ok: price != null ? price >= m.zoneLow && price <= m.zoneHigh : null,
      src: price != null ? `${src} ${n0(price)} · Zone ${n0(m.zoneLow)}–${n0(m.zoneHigh)}` : "wartet auf Live-Kurs",
    },
    { k: "struct", l: "Erster Higher Low oder BOS auf 1H/4H", ok: cur ? cur.structure : null, src: "deine Ablesung" },
    {
      k: "delta",
      l: "Whale-vs-Retail-Delta positiv, 2–3 Kerzen",
      ok: cur ? cur.delta > 0 && cur.deltaCandles >= 2 : null,
      src: cur ? `Delta ${signed(cur.delta, 1)} · ${cur.deltaCandles} Kerzen` : "–",
    },
    { k: "rsi", l: "RSI bullische Divergenz oder Trendlinienbruch", ok: cur ? cur.rsi : null, src: "deine Ablesung" },
  ];
  const n = pts.filter((p) => p.ok).length;
  const rising = cur && prev ? cur.longPct > prev.longPct : null;
  const knife = !!(rising && cur && cur.delta <= 0 && !cur.structure && !cur.rsi);
  return { pts, n, rising, knife, all: n === 4 };
}

/** Card line under the 4 bars. */
export function knifeCardLine(fk: FallingKnife): string {
  return fk.all ? KNIFE_CARD_ALL : fk.knife ? KNIFE_CARD_KNIFE : KNIFE_CARD_NONE;
}

/** Row value in the dialog. */
export function knifePointValue(ok: boolean | null): "–" | "✓ erfüllt" | "✕ offen" {
  return ok == null ? "–" : ok ? "✓ erfüllt" : "✕ offen";
}

export function knifeVerdict(fk: FallingKnife): Verdict {
  if (fk.all) return { tone: "win", text: "Alle 4 Punkte erfüllt: Makro-Long-Trigger ist valide (T3 prüfen)." };
  if (fk.knife)
    return {
      tone: "loss",
      text: "Anti-Muster: Long-% steigt, aber Delta ist nicht positiv und die Struktur dreht nicht. Messer fangen: beobachten statt handeln.",
    };
  return { tone: "warn", text: `${fk.n} von 4 erfüllt. Kein Kaufsignal, weiter beobachten.` };
}

/** Dialog content (A.13). Rows carry the `src` line as fourth element. */
export function explainFallingKnife(fk: FallingKnife): Explanation {
  return {
    key: "fallingKnife",
    title: KNIFE_TITLE,
    what: KNIFE_WHAT,
    rows: fk.pts.map((p) => [p.l, knifePointValue(p.ok), p.ok == null ? "text-mute" : p.ok ? "text-win" : "text-loss", p.src]),
    verdict: knifeVerdict(fk),
  };
}

/** "Stand" tile: "vor 12 min" / "vor 3 h" (< 48 h) else the formatted date; warn when > 12 h. */
export function readingAge(at: string, now: number = Date.now()): { hours: number; label: string; warn: boolean } {
  const hours = (now - +new Date(at)) / 3.6e6;
  const label = hours < 48 ? `vor ${hours < 1 ? Math.max(1, Math.round(hours * 60)) + " min" : Math.round(hours) + " h"}` : "";
  return { hours, label, warn: hours > 12 };
}

/** Bundle: live connector synthesises a virtual reading; structure/rsi come from the last manual reading. */
export function liveReading(
  last: HyblockReading | null | undefined,
  live: { longPct: number; delta?: number | null; deltaCandles?: number | null; at: number },
): HyblockReading {
  return {
    id: last?.id || "",
    at: new Date(live.at).toISOString(),
    longPct: live.longPct,
    delta: live.delta ?? 0,
    deltaCandles: live.deltaCandles ?? 0,
    structure: !!last?.structure,
    rsi: !!last?.rsi,
    note: "Live von Hyblock",
  };
}

export const JG = fallingKnife;
