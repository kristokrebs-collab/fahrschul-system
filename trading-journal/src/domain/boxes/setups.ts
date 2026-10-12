/**
 * Box-zu-Box setups (pure): box position or breakout + diagonal RSI trendline break + Binance top-trader bias +
 * the higher-timeframe box → a concrete plan (entry, stop, targets, CRV) graded A+ … C.
 * "Trade the best, fuck the rest": only A+ / A are flagged `best`; the UI leads with those and hides C.
 */
import type { Bar } from "../signals/indicators";
import { boxState, DEFAULT_BOX_CFG, type BoxCfg, type BoxState, type Target } from "./engine";
import { DEFAULT_RSI_LINE_CFG, rsiLines, type RsiLineCfg, type RsiLineState } from "./rsiLines";

export type Grade = "A+" | "A" | "B" | "C";
export type SetupKind = "range" | "breakout" | "retest" | "fakeout" | "pre";
export const KIND_TEXT: Readonly<Record<SetupKind, string>> = { range: "Range-Trade", breakout: "Ausbruch", retest: "Retest", fakeout: "Fehlausbruch", pre: "Ausbruch vorbereitet" };

export interface Reason {
  text: string;
  ok: boolean;
  weight: number;
}

export interface BoxSetup {
  side: "long" | "short";
  kind: SetupKind;
  grade: Grade;
  score: number;
  /** A+ / A and not a mere preparation */
  best: boolean;
  title: string;
  detail: string;
  entry: number;
  stop: number;
  targets: Target[];
  rr: number | null;
  reasons: Reason[];
}

/** Direction of the Binance top-trader read (−1 short-heavy … 1 long-heavy), null = no data. */
export type TraderBias = -1 | 0 | 1 | null;

export interface BoxAnalysis {
  tf: string;
  at: number;
  box: BoxState;
  rsi: RsiLineState | null;
  setups: BoxSetup[];
  best: BoxSetup | null;
  /** higher-timeframe context used for grading */
  htf: { tf: string; phase: BoxState["phase"]; dir: BoxState["dir"]; pos: number | null } | null;
}

export const gradeOf = (score: number): Grade => (score >= 85 ? "A+" : score >= 72 ? "A" : score >= 55 ? "B" : "C");
const capB = (g: Grade): Grade => (g === "A+" || g === "A" ? "B" : g);

function make(side: "long" | "short", kind: SetupKind, entry: number, stop: number, targets: Target[], reasons: Reason[], detail: string, weakBox: boolean): BoxSetup {
  const max = reasons.reduce((s, r) => s + r.weight, 0) || 1;
  const score = Math.round((reasons.reduce((s, r) => s + (r.ok ? r.weight : 0), 0) / max) * 100);
  const risk = Math.abs(entry - stop);
  const t1 = targets[0];
  const rr = t1 && risk > 0 ? Math.abs(t1.price - entry) / risk : null;
  let grade = gradeOf(score);
  // no target (no CRV) is never "the best" either – e.g. a breakout below a tall weekly box without a level beneath
  if (rr == null || rr < 1.5 || weakBox || kind === "pre") grade = capB(grade);
  return {
    side, kind, grade, score, best: grade === "A+" || grade === "A",
    title: `${KIND_TEXT[kind]} ${side === "long" ? "Long" : "Short"}`, detail, entry, stop, targets, rr, reasons,
  };
}

/** Does the higher timeframe allow this direction? (not breaking the other way, not pinned at the opposite edge) */
function htfAllows(h: BoxState | null | undefined, side: "long" | "short"): boolean {
  if (!h || !h.box) return true;
  if (h.phase === "breakout" || h.phase === "retest" || h.phase === "running") return side === "long" ? h.dir >= 0 : h.dir <= 0;
  if (h.pos == null) return true;
  return side === "long" ? h.pos < 0.8 : h.pos > 0.2;
}

export function boxSetups(bs: BoxState, rl: RsiLineState | null, bias: TraderBias, htf?: BoxState | null): BoxSetup[] {
  const B = bs.box;
  const out: BoxSetup[] = [];
  if (!B || !Number.isFinite(bs.price)) return out;
  const p = bs.price;
  const buf = 0.25 * B.atr;
  const sBuf = Math.max(buf * 2, B.atr * 0.6);
  const rsiUp = !!rl?.breakUp;
  const rsiDown = !!rl?.breakDown;
  const weak = B.grade === "schwach";
  const edge = (price: number, label: string): Target => ({ price, kind: "box", label, zone: null, i: null });
  const strong = { text: `Box ${B.grade} (${B.touchesTop}× oben, ${B.touchesBottom}× unten)`, ok: B.grade === "stark", weight: 12 };

  if (bs.phase === "inside" || bs.phase === "failed") {
    if (bs.zone === "bottom") {
      out.push(make("long", bs.phase === "failed" ? "fakeout" : "range", p, B.bottom - sBuf, [edge(B.mid, "Box-Mitte"), edge(B.top, "Box-Oberkante")], [
        { text: "Preis im unteren Viertel der Box (Support)", ok: true, weight: 28 },
        { text: "RSI-Abwärtslinie nach oben gebrochen", ok: rsiUp, weight: 26 },
        { text: "Keine gebrochene RSI-Aufwärtslinie", ok: !rsiDown, weight: 8 },
        strong,
        { text: "Top Trader positionieren sich long", ok: bias === 1, weight: 14 },
        { text: "Höherer Timeframe spricht nicht dagegen", ok: htfAllows(htf, "long"), weight: 12 },
      ], "Swing von der Unterkante zur Oberkante. Stop knapp unter dem Support.", weak));
    }
    if (bs.zone === "top") {
      out.push(make("short", bs.phase === "failed" ? "fakeout" : "range", p, B.top + sBuf, [edge(B.mid, "Box-Mitte"), edge(B.bottom, "Box-Unterkante")], [
        { text: "Preis im oberen Viertel der Box (Widerstand)", ok: true, weight: 28 },
        { text: "RSI-Aufwärtslinie nach unten gebrochen", ok: rsiDown, weight: 26 },
        { text: "Keine gebrochene RSI-Abwärtslinie", ok: !rsiUp, weight: 8 },
        strong,
        { text: "Top Trader positionieren sich short", ok: bias === -1, weight: 14 },
        { text: "Höherer Timeframe spricht nicht dagegen", ok: htfAllows(htf, "short"), weight: 12 },
      ], "Swing von der Oberkante zur Unterkante. Stop knapp über dem Widerstand.", weak));
    }
    if (bs.phase === "inside" && rl) {
      const nearRes = rl.distRes != null && rl.distRes < 3;
      const nearSup = rl.distSup != null && rl.distSup < 3;
      if (nearRes || rsiUp || bs.pending === 1)
        out.push(make("long", "pre", B.top + buf, B.mid, bs.up, [
          { text: rsiUp ? "RSI-Abwärtslinie gebrochen" : "RSI drückt gegen seine Abwärtslinie", ok: true, weight: 30 },
          { text: bs.pending === 1 ? "Kurs über der Box – Kerzenschluss abwarten" : "Schlusskurs über dem Widerstand", ok: false, weight: 45 },
          { text: "Top Trader long", ok: bias === 1, weight: 15 },
          { text: "Höherer Timeframe frei", ok: htfAllows(htf, "long"), weight: 10 },
        ], "Ausbruch vorbereitet: Einstieg erst mit Schlusskurs über der Box.", weak));
      if (nearSup || rsiDown || bs.pending === -1)
        out.push(make("short", "pre", B.bottom - buf, B.mid, bs.down, [
          { text: rsiDown ? "RSI-Aufwärtslinie gebrochen" : "RSI drückt gegen seine Aufwärtslinie", ok: true, weight: 30 },
          { text: bs.pending === -1 ? "Kurs unter der Box – Kerzenschluss abwarten" : "Schlusskurs unter dem Support", ok: false, weight: 45 },
          { text: "Top Trader short", ok: bias === -1, weight: 15 },
          { text: "Höherer Timeframe frei", ok: htfAllows(htf, "short"), weight: 10 },
        ], "Ausbruch vorbereitet: Einstieg erst mit Schlusskurs unter der Box.", weak));
    }
  } else if (bs.phase === "breakout" || bs.phase === "retest") {
    const long = bs.dir > 0;
    const side = long ? "long" : "short";
    const fresh = (bs.barsSince ?? 99) <= 6;
    const stop = long ? Math.min(B.mid, p - B.atr) : Math.max(B.mid, p + B.atr);
    out.push(make(side, bs.phase === "retest" ? "retest" : "breakout", p, stop, bs.targets, [
      { text: `Schlusskurs ${long ? "über dem Widerstand" : "unter dem Support"}`, ok: true, weight: 22 },
      { text: long ? "RSI-Abwärtslinie nach oben gebrochen" : "RSI-Aufwärtslinie nach unten gebrochen", ok: long ? rsiUp : rsiDown, weight: 26 },
      { text: bs.phase === "retest" ? "Retest der Kante hält" : "Ausbruch ist frisch", ok: bs.phase === "retest" || fresh, weight: 14 },
      strong,
      { text: `Top Trader positionieren sich ${side}`, ok: bias === (long ? 1 : -1), weight: 14 },
      { text: "Höherer Timeframe in dieselbe Richtung", ok: htfAllows(htf, side), weight: 12 },
    ], `Box zu Box: Ziel ist ${bs.targets[0]?.label ?? "die nächste Zone"}. Stop ${long ? "unter" : "über"} der Box-Mitte.`, weak));
  }
  return out.sort((a, b) => Number(b.best) - Number(a.best) || b.score - a.score);
}

export interface AnalyzeInput {
  tf: string;
  /** closed bars of `tf` */
  bars: readonly Bar[];
  /** live price (running candle close) */
  live?: number;
  bias?: TraderBias;
  htf?: { tf: string; state: BoxState } | null;
  boxCfg?: BoxCfg;
  rsiCfg?: RsiLineCfg;
}

export function analyzeBoxes(x: AnalyzeInput): BoxAnalysis | null {
  if (x.bars.length < 60) return null;
  const box = boxState(x.bars, x.boxCfg ?? DEFAULT_BOX_CFG, x.live);
  const rsi = rsiLines(x.bars, x.rsiCfg ?? DEFAULT_RSI_LINE_CFG);
  const setups = boxSetups(box, rsi, x.bias ?? null, x.htf?.state ?? null);
  const h = x.htf?.state;
  return {
    tf: x.tf, at: x.bars[x.bars.length - 1]!.t, box, rsi, setups, best: setups[0] ?? null,
    htf: h && x.htf ? { tf: x.htf.tf, phase: h.phase, dir: h.dir, pos: h.pos } : null,
  };
}

