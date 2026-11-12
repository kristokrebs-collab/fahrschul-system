/**
 * Ausstiegsplan (nach dem Skill trader-exit): Stop und Ziel stehen VOR dem Einstieg fest – der Stop ist der Preis, bei dem
 * die Idee gescheitert ist, das Ziel der, bei dem man mitnimmt, was man wollte.
 *
 * Stop: Range-Mitte (Standard beim Range-Ausbruch), die andere Seite der Range, ein Vielfaches der ATR, ein Prozentabstand
 * oder ein eigener Preis. Der Stop wird vom Einstieg WEG auf den Kursschritt gerundet (Long: ab, Short: auf) – das Risiko
 * wird nie kleiner gerechnet, als es ist. Ziel: ein Vielfaches des Risikos (R), die Range-Projektion, eine Schlüsselmarke
 * oder ein eigener Preis; das Ziel rundet auf den nächsten Kursschritt, bei Gleichstand vom Einstieg weg.
 *
 * Abgelehnt – mit Grund, nichts wird stillschweigend zurechtgebogen: ein Stop auf der falschen Seite des Einstiegs oder bei
 * null, ein Ziel auf der falschen Seite, ein Risiko unter 0,05 % des Preises (zu eng, schon der Spread löst es aus), ein
 * Einstieg zur oder nach der "Flat by"-Zeit. Hinweise (keine Ablehnung): der Stop ist im Vergleich zur ATR sehr eng oder weit.
 *
 * Ein Stop ist ein Plan, keine Garantie: bei einer Kurslücke oder in einem schnellen Markt kann die Ausführung schlechter sein.
 */
import type { Side } from "../types";
import { num, numTrim, pctText, priceText, rText, toStep } from "./format";
import type { RangeInfo } from "./entry";
import { clockIn } from "./time";

export type StopRule =
  | { kind: "range-mid" }
  /** the far side of the range: Tief for a Long, Hoch for a Short */
  | { kind: "range-far" }
  | { kind: "atr"; mult: number }
  | { kind: "pct"; pct: number }
  | { kind: "price"; price: number };

export type TargetRule =
  | { kind: "r"; r: number }
  /** the range's height, projected from the broken edge */
  | { kind: "range-projection"; mult: number }
  /** a key level of the trader */
  | { kind: "level"; price: number; name: string }
  | { kind: "price"; price: number };

export const DEFAULT_STOP: StopRule = { kind: "range-mid" };
export const DEFAULT_TARGET: TargetRule = { kind: "r", r: 2 };

/** A risk below this fraction of the price is "too tight to survive the spread" (Skill trader-exit). */
export const MIN_RISK_FRACTION = 0.0005;
/** Rules of thumb of the app (not of the skill): under this many ATR a stop is within normal candle noise … */
export const ATR_TIGHT = 0.5;
/** … and over this many ATR it makes the position small and the loss large against the move. */
export const ATR_WIDE = 3;

export interface ExitInput {
  side: Side;
  entry: number;
  range: Pick<RangeInfo, "high" | "low"> | null;
  atr: { value: number; bars: number } | null;
  stop: StopRule;
  target: TargetRule;
  /** price step of the market */
  tick: number;
  /** the entry candle's close (ms) and the "flat by" instant: an entry at or after it is refused */
  entryMs?: number | null;
  flatByMs?: number | null;
  /** zone for the clock in the words */
  tz?: string;
}

export type ExitError = "entry" | "range" | "atr" | "stop-side" | "stop-zero" | "stop-tight" | "target-side" | "flat-by" | "rule";

export interface ExitHint {
  key: "atr-tight" | "atr-wide" | "atr-short" | "rr-low";
  text: string;
}

export interface ExitPlan {
  ok: true;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** distance entry → stop per unit (price) */
  risk: number;
  /** risk ÷ entry */
  riskPct: number;
  reward: number;
  /** reward ÷ risk */
  rr: number;
  stopLabel: string;
  stopDetail: string;
  targetLabel: string;
  targetDetail: string;
  /** risk ÷ ATR, `null` without an ATR */
  atrRatio: number | null;
  hints: ExitHint[];
  flatByMs: number | null;
}

export interface ExitRefusal {
  ok: false;
  code: ExitError;
  reason: string;
}

export type ExitResult = ExitPlan | ExitRefusal;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Words for a stop rule ("Range-Mitte", "1,5 × ATR"). */
export function stopRuleText(r: StopRule, side: Side): string {
  switch (r.kind) {
    case "range-mid":
      return "Mitte der Range";
    case "range-far":
      return side === "long" ? "Tief der Range" : "Hoch der Range";
    case "atr":
      return `${num(r.mult, Number.isInteger(r.mult) ? 0 : 1)} × ATR`;
    case "pct":
      return `${num(r.pct, Number.isInteger(r.pct) ? 0 : 2)} % Abstand`;
    case "price":
      return "eigener Preis";
  }
}

export function targetRuleText(r: TargetRule): string {
  switch (r.kind) {
    case "r":
      return rText(r.r);
    case "range-projection":
      return r.mult === 1 ? "Range-Projektion" : `${num(r.mult, 1)} × Range-Projektion`;
    case "level":
      return `Schlüsselmarke ${r.name}`;
    case "price":
      return "eigener Preis";
  }
}

const refuse = (code: ExitError, reason: string): ExitRefusal => ({ ok: false, code, reason });

/** Entry, stop and target of one trade – or why it is refused. */
export function exitPlan(i: ExitInput): ExitResult {
  const { side, entry, tick } = i;
  const P = (x: number): string => priceText(x, tick);
  const long = side === "long";
  if (!fin(entry) || !(entry > 0)) return refuse("entry", "Der Einstiegspreis fehlt oder ist null.");
  if (!(tick > 0)) return refuse("rule", "Der Kursschritt fehlt.");

  // ---- stop
  let rawStop: number;
  let stopDetail = "";
  const r = i.stop;
  switch (r.kind) {
    case "range-mid":
    case "range-far": {
      const rg = i.range;
      if (!rg || !(rg.high > rg.low)) return refuse("range", "Für diesen Stop braucht es eine fertige Range (Hoch über Tief).");
      if (r.kind === "range-mid") {
        rawStop = (rg.high + rg.low) / 2;
        stopDetail = `(${P(rg.high)} + ${P(rg.low)}) / 2 = ${numTrim(rawStop, 4)}`;
      } else {
        rawStop = long ? rg.low : rg.high;
      }
      break;
    }
    case "atr": {
      if (!i.atr || !(i.atr.value > 0)) return refuse("atr", "Für einen ATR-Stop fehlen mindestens drei geschlossene Kerzen.");
      if (!(r.mult > 0)) return refuse("rule", "Der ATR-Faktor muss über null liegen.");
      rawStop = long ? entry - r.mult * i.atr.value : entry + r.mult * i.atr.value;
      stopDetail = `ATR ${numTrim(i.atr.value, 4)} über ${i.atr.bars} Kerzen${i.atr.bars < 14 ? " (weniger als 14 vorhanden)" : ""}`;
      break;
    }
    case "pct": {
      if (!(r.pct > 0) || r.pct >= 100) return refuse("rule", "Der Prozentabstand muss zwischen 0 und 100 liegen.");
      rawStop = long ? entry * (1 - r.pct / 100) : entry * (1 + r.pct / 100);
      stopDetail = `${P(entry)} ${long ? "−" : "+"} ${num(r.pct, 2)} %`;
      break;
    }
    case "price": {
      if (!fin(r.price)) return refuse("rule", "Der Stop-Preis fehlt.");
      rawStop = r.price;
      break;
    }
  }
  const stop = toStep(rawStop, tick, long ? "floor" : "ceil");
  if (Math.abs(stop - rawStop) > tick * 1e-6) stopDetail = `${stopDetail ? `${stopDetail}, ` : ""}vom Einstieg weg auf ${P(stop)} gerundet`;
  if (!(stop > 0)) return refuse("stop-zero", `Der Stop liegt bei ${P(stop)} – er muss über null liegen.`);
  if (long ? stop >= entry : stop <= entry) {
    return refuse("stop-side", `Der Stop ${P(stop)} liegt ${long ? "auf oder über" : "auf oder unter"} dem Einstieg ${P(entry)} – bei ${long ? "Long" : "Short"} gehört er ${long ? "darunter" : "darüber"}.`);
  }
  const risk = Math.abs(entry - stop);
  const riskPct = risk / entry;
  if (riskPct < MIN_RISK_FRACTION - 1e-12) {
    return refuse("stop-tight", `Der Stop ist nur ${P(risk)} (${pctText(riskPct, 3)}) vom Einstieg entfernt – unter 0,05 % des Preises. So eng löst schon der normale Spread ihn aus. Weiter weg setzen.`);
  }

  // ---- target
  const t = i.target;
  let rawTarget: number;
  let targetDetail = "";
  switch (t.kind) {
    case "r":
      if (!(t.r > 0)) return refuse("rule", "Das R-Vielfache muss über null liegen.");
      rawTarget = long ? entry + t.r * risk : entry - t.r * risk;
      targetDetail = `${P(entry)} ${long ? "+" : "−"} ${num(t.r, Number.isInteger(t.r) ? 0 : 2)} × ${P(risk)}`;
      break;
    case "range-projection": {
      const rg = i.range;
      if (!rg || !(rg.high > rg.low)) return refuse("range", "Die Range-Projektion braucht eine fertige Range.");
      if (!(t.mult > 0)) return refuse("rule", "Der Faktor der Projektion muss über null liegen.");
      const height = rg.high - rg.low;
      rawTarget = long ? rg.high + t.mult * height : rg.low - t.mult * height;
      targetDetail = `${long ? "Range-Hoch" : "Range-Tief"} ${P(long ? rg.high : rg.low)} ${long ? "+" : "−"} ${num(t.mult, 1)} × Range-Höhe ${P(height)}`;
      break;
    }
    case "level":
    case "price":
      if (!fin(t.price)) return refuse("rule", "Der Ziel-Preis fehlt.");
      rawTarget = t.price;
      if (t.kind === "level") targetDetail = `Schlüsselmarke „${t.name}“`;
      break;
  }
  const target = toStep(rawTarget, tick, "nearest-away", long ? 1 : -1);
  if (!(target > 0) || (long ? target <= entry : target >= entry)) {
    return refuse("target-side", `Das Ziel ${P(target)} liegt ${long ? "auf oder unter" : "auf oder über"} dem Einstieg ${P(entry)} – bei ${long ? "Long" : "Short"} gehört es ${long ? "darüber" : "darunter"}. Die Bewegung, auf die das Ziel wartet, ist dann schon passiert.`);
  }
  const reward = Math.abs(target - entry);
  const rr = reward / risk;
  if (t.kind !== "r") targetDetail = `${targetDetail ? `${targetDetail}, ` : ""}${num(rr, 2)} × das Risiko`;

  // ---- flat by
  if (i.flatByMs != null && i.entryMs != null && i.entryMs >= i.flatByMs) {
    const at = i.tz ? clockIn(i.flatByMs, i.tz) : "";
    return refuse("flat-by", `Der Einstieg liegt zur oder nach der „Flat by“-Zeit${at ? ` (${at} Uhr)` : ""} – bis dahin sollst du draußen sein, ein Einstieg danach hat keinen Platz mehr im Plan.`);
  }

  // ---- hints
  const hints: ExitHint[] = [];
  const atrRatio = i.atr && i.atr.value > 0 ? risk / i.atr.value : null;
  if (atrRatio == null) hints.push({ key: "atr-short", text: "Ohne ATR (zu wenige Kerzen) lässt sich nicht sagen, ob der Stop zur üblichen Schwankung passt." });
  else if (atrRatio < ATR_TIGHT) hints.push({ key: "atr-tight", text: `Der Stop ist nur ${num(atrRatio, 2)} ATR vom Einstieg entfernt – normales Kerzenrauschen kann ihn auslösen (Richtwert der App: unter ${num(ATR_TIGHT, 1)} ATR).` });
  else if (atrRatio > ATR_WIDE) hints.push({ key: "atr-wide", text: `Der Stop ist ${num(atrRatio, 2)} ATR weit – die Menge wird klein, und das Risiko ist groß im Vergleich zur üblichen Bewegung (Richtwert der App: über ${num(ATR_WIDE, 0)} ATR).` });
  if (rr < 1) hints.push({ key: "rr-low", text: `Das Ziel ist nur ${num(rr, 2)} × so weit entfernt wie der Stop: ohne Kosten bräuchte es eine Trefferquote von über ${num(100 / (1 + rr), 0)} %, um bei null zu landen.` });

  return {
    ok: true,
    side,
    entry,
    stop,
    target,
    risk,
    riskPct,
    reward,
    rr,
    stopLabel: stopRuleText(r, side),
    stopDetail,
    targetLabel: targetRuleText(t),
    targetDetail,
    atrRatio,
    hints,
    flatByMs: i.flatByMs ?? null,
  };
}
