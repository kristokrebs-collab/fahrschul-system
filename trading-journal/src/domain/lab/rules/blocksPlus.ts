/**
 * More building blocks for "Eigene Idee" (F06): well-known indicators as pure functions over CLOSED bars of one timeframe –
 * Donchian, ADX / DI, Stochastic, Keltner, Ichimoku, CCI, Williams %R, OBV, VWAP, Opening Range, Inside Bar, Heikin-Ashi,
 * pivot break, Fibonacci retracement, Supertrend, Chandelier exit and the funding rate. Same contract as `blocks.ts`:
 * tri-state per bar (0 false · 1 true · 2 unknown), the value at bar i uses bars ≤ i only, parameters clamped by
 * `sanitizeParams`, German labels. The series maths lives in `series.ts` (Wilder / TradingView definitions).
 */
import { bollingerSeries, triFrom, withinBars } from "./indicators";
import type { LeafParams } from "./types";
import {
  type BlockDef,
  type EvalCtx,
  REL_MIRROR,
  REL_OPTIONS,
  REL_WORD,
  WITHIN,
  closeOf,
  de,
  highOf,
  isCross,
  lowOf,
  num,
  relate,
  sessionOfSec,
  str,
  swap,
  type Rel,
  whenCross,
  within,
} from "./kit";
import { TRUE, UNKNOWN } from "./types";
import { sma } from "../../signals/indicators";
import { cciSeries, chandelierSeries, dmiSeries, fundingSeries, heikinAshi, ichimokuSeries, keltnerSeries, obvSeries, pivotLevels, stochSeries, supertrendSeries, vwapSeries, williamsRSeries, windowExtreme } from "./series";

const fin = (x: number): boolean => Number.isFinite(x);
const DAY = 86_400;

// ── Donchian ────────────────────────────────────────────────────────────────────────────────────────────────────

const donchianBlock: BlockDef = {
  id: "donchian",
  label: "Donchian-Kanal",
  family: "structure",
  help: "Ausbruch über das höchste Hoch (unter das tiefste Tief) der N Kerzen davor – wie die Turtle-Regeln – oder Lage zur Kanalmitte.",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 20, min: 2, max: 400, unit: "Kerzen" },
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "breakUp",
      options: [
        { v: "breakUp", label: "Ausbruch nach oben" },
        { v: "breakDown", label: "Ausbruch nach unten" },
        { v: "aboveMid", label: "über der Kanalmitte" },
        { v: "belowMid", label: "unter der Kanalmitte" },
      ],
    },
    {
      key: "basis",
      label: "Gilt, wenn",
      kind: "select",
      def: "close",
      options: [
        { v: "close", label: "der Schluss ausbricht" },
        { v: "wick", label: "das Hoch / Tief ausbricht (Turtle)" },
      ],
      when: (p) => str(p, "mode") === "breakUp" || str(p, "mode") === "breakDown",
    },
    { ...WITHIN, when: (p) => str(p, "mode") === "breakUp" || str(p, "mode") === "breakDown" },
  ],
  warmup: (p) => num(p, "len") + 1,
  eval(c, p) {
    const len = num(p, "len");
    const hh = c.memo(`dcH${len}`, () => windowExtreme(highOf(c), len, true));
    const ll = c.memo(`dcL${len}`, () => windowExtreme(lowOf(c), len, false));
    const mode = str(p, "mode");
    const wick = str(p, "basis") === "wick";
    if (mode === "aboveMid" || mode === "belowMid") {
      return triFrom(c.n, (i) => (fin(hh[i]!) ? (mode === "aboveMid" ? c.bars[i]!.c > (hh[i]! + ll[i]!) / 2 : c.bars[i]!.c < (hh[i]! + ll[i]!) / 2) : null));
    }
    const up = mode === "breakUp";
    const ev = triFrom(c.n, (i) => {
      if (i < 1 || !fin(hh[i - 1]!)) return null;
      const b = c.bars[i]!;
      return up ? (wick ? b.h : b.c) > hh[i - 1]! : (wick ? b.l : b.c) < ll[i - 1]!;
    });
    return withinBars(ev, num(p, "within"));
  },
  text(p) {
    const len = num(p, "len");
    const m = str(p, "mode");
    if (m === "aboveMid") return `Schluss über der Mitte des Donchian-Kanals (${len})`;
    if (m === "belowMid") return `Schluss unter der Mitte des Donchian-Kanals (${len})`;
    const w = str(p, "basis") === "wick" ? (m === "breakUp" ? "Hoch" : "Tief") : "Schluss";
    return `${w} bricht ${m === "breakUp" ? "über das Hoch" : "unter das Tief"} der letzten ${len} Kerzen aus${within(num(p, "within"))}`;
  },
  mirror: (p) => swap(p, "mode", { breakUp: "breakDown", breakDown: "breakUp", aboveMid: "belowMid", belowMid: "aboveMid" }),
};

// ── ADX / DI ────────────────────────────────────────────────────────────────────────────────────────────────────

const ADX_TEXT: Record<string, string> = {
  adxAbove: "ADX über der Schwelle (Trend ist stark)",
  adxBelow: "ADX unter der Schwelle (kein klarer Trend)",
  trendUp: "ADX über der Schwelle und +DI über −DI (starker Aufwärtstrend)",
  trendDown: "ADX über der Schwelle und −DI über +DI (starker Abwärtstrend)",
  diUp: "+DI kreuzt −DI nach oben",
  diDown: "−DI kreuzt +DI nach oben",
};
const ADX_PHRASE = (m: string, lv: string): string =>
  ({ adxAbove: `ADX über ${lv} (Trend ist stark)`, adxBelow: `ADX unter ${lv} (kein klarer Trend)`, trendUp: `ADX über ${lv} und +DI über −DI (starker Aufwärtstrend)`, trendDown: `ADX über ${lv} und −DI über +DI (starker Abwärtstrend)`, diUp: "+DI kreuzt −DI nach oben", diDown: "−DI kreuzt +DI nach oben" })[m] ?? m;

const adxBlock: BlockDef = {
  id: "adx",
  label: "ADX / DI",
  family: "trend",
  help: "Trendstärke (ADX) über oder unter einer Schwelle, oder Richtung über die Directional-Indicator-Linien (+DI / −DI).",
  params: [
    { key: "len", label: "DI-Länge", kind: "int", def: 14, min: 2, max: 100 },
    { key: "smooth", label: "ADX-Glättung", kind: "int", def: 14, min: 2, max: 100 },
    { key: "mode", label: "Bedingung", kind: "select", def: "trendUp", options: Object.keys(ADX_TEXT).map((v) => ({ v, label: ADX_TEXT[v]! })) },
    { key: "level", label: "Schwelle", kind: "float", def: 25, min: 5, max: 60, step: 1, hint: "Üblich: 20–25. Darunter gilt der Markt als trendlos.", when: (p) => /adx|trend/.test(str(p, "mode")) },
    { ...WITHIN, when: (p) => /^di/.test(str(p, "mode")) },
  ],
  warmup: (p) => num(p, "len") + num(p, "smooth") * 2 + 2,
  eval(c, p) {
    const len = num(p, "len");
    const sm = num(p, "smooth");
    const d = c.memo(`dmi${len}_${sm}`, () => dmiSeries(c.bars, len, sm));
    const lv = num(p, "level");
    const mode = str(p, "mode");
    switch (mode) {
      case "adxAbove":
        return triFrom(c.n, (i) => (fin(d.adx[i]!) ? d.adx[i]! > lv : null));
      case "adxBelow":
        return triFrom(c.n, (i) => (fin(d.adx[i]!) ? d.adx[i]! < lv : null));
      case "trendUp":
        return triFrom(c.n, (i) => (fin(d.adx[i]!) && fin(d.plus[i]!) ? d.adx[i]! > lv && d.plus[i]! > d.minus[i]! : null));
      case "trendDown":
        return triFrom(c.n, (i) => (fin(d.adx[i]!) && fin(d.plus[i]!) ? d.adx[i]! > lv && d.minus[i]! > d.plus[i]! : null));
      case "diUp":
        return relate(c.n, d.plus, d.minus, "crossUp", num(p, "within"), len + sm);
      default:
        return relate(c.n, d.plus, d.minus, "crossDown", num(p, "within"), len + sm);
    }
  },
  text(p) {
    const m = str(p, "mode");
    return `DMI(${num(p, "len")}, ${num(p, "smooth")}): ${ADX_PHRASE(m, de(num(p, "level")))}${/^di/.test(m) ? within(num(p, "within")) : ""}`;
  },
  mirror: (p) => swap(p, "mode", { trendUp: "trendDown", trendDown: "trendUp", diUp: "diDown", diDown: "diUp", adxAbove: "adxAbove", adxBelow: "adxBelow" }),
};

// ── Stochastic ──────────────────────────────────────────────────────────────────────────────────────────────────

const stochBlock: BlockDef = {
  id: "stoch",
  label: "Stochastic",
  family: "momentum",
  help: "%K gegen ein Niveau (überverkauft / überkauft) oder %K kreuzt %D – optional nur im Extrembereich.",
  params: [
    { key: "kLen", label: "Länge %K", kind: "int", def: 14, min: 3, max: 100 },
    { key: "kSmooth", label: "Glättung %K", kind: "int", def: 3, min: 1, max: 20 },
    { key: "dSmooth", label: "Glättung %D", kind: "int", def: 3, min: 1, max: 20 },
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "kdUp",
      options: [
        { v: "below", label: "%K unter Niveau" },
        { v: "above", label: "%K über Niveau" },
        { v: "crossUp", label: "%K kreuzt das Niveau nach oben" },
        { v: "crossDown", label: "%K kreuzt das Niveau nach unten" },
        { v: "kdUp", label: "%K kreuzt %D nach oben" },
        { v: "kdDown", label: "%K kreuzt %D nach unten" },
      ],
    },
    { key: "level", label: "Niveau", kind: "float", def: 20, min: 1, max: 99, step: 1, hint: "Üblich: 20 (überverkauft) und 80 (überkauft)." },
    {
      key: "zone",
      label: "Kreuzung nur im Extrembereich",
      kind: "select",
      def: "any",
      options: [
        { v: "any", label: "egal" },
        { v: "extreme", label: "ja: vorher %K und %D hinter dem Niveau" },
      ],
      when: (p) => str(p, "mode") === "kdUp" || str(p, "mode") === "kdDown",
    },
    { ...WITHIN, when: (p) => isCross(str(p, "mode")) || str(p, "mode") === "kdUp" || str(p, "mode") === "kdDown" },
  ],
  warmup: (p) => num(p, "kLen") + num(p, "kSmooth") + num(p, "dSmooth") + 2,
  eval(c, p) {
    const s = c.memo(`stoch${num(p, "kLen")}_${num(p, "kSmooth")}_${num(p, "dSmooth")}`, () => stochSeries(c.bars, num(p, "kLen"), num(p, "kSmooth"), num(p, "dSmooth")));
    const mode = str(p, "mode");
    const lv = num(p, "level");
    const w = num(p, "within");
    const warm = num(p, "kLen") + num(p, "kSmooth") - 2;
    if (mode === "kdUp" || mode === "kdDown") {
      const up = mode === "kdUp";
      const raw = relate(c.n, s.k, s.d, up ? "crossUp" : "crossDown", 1, warm + num(p, "dSmooth") - 1);
      if (str(p, "zone") !== "extreme") return withinBars(raw, w);
      const gated = triFrom(c.n, (i) => {
        if (raw[i] === UNKNOWN) return null;
        if (raw[i] !== TRUE) return false;
        const k = s.k[i - 1]!;
        const d = s.d[i - 1]!;
        if (!fin(k) || !fin(d)) return null;
        return up ? k < lv && d < lv : k > 100 - lv && d > 100 - lv;
      });
      return withinBars(gated, w);
    }
    return relate(c.n, s.k, lv, mode as Rel, w, warm);
  },
  text(p) {
    const m = str(p, "mode");
    const head = `Stochastic(${num(p, "kLen")}, ${num(p, "kSmooth")}, ${num(p, "dSmooth")})`;
    if (m === "kdUp" || m === "kdDown") {
      const zone = str(p, "zone") === "extreme" ? ` im Extrembereich (${m === "kdUp" ? `unter ${de(num(p, "level"))}` : `über ${de(100 - num(p, "level"))}`})` : "";
      return `${head}: %K kreuzt %D nach ${m === "kdUp" ? "oben" : "unten"}${zone}${within(num(p, "within"))}`;
    }
    return `${head}: %K ${REL_WORD[m as Rel]} ${de(num(p, "level"))}${isCross(m) ? within(num(p, "within")) : ""}`;
  },
  mirror: (p) => ({ ...swap(p, "mode", { ...REL_MIRROR, kdUp: "kdDown", kdDown: "kdUp" }), level: Math.round((str(p, "mode") === "kdUp" || str(p, "mode") === "kdDown" ? num(p, "level") : 100 - num(p, "level")) * 100) / 100 }),
};

// ── Keltner ─────────────────────────────────────────────────────────────────────────────────────────────────────

const KC_LABEL: Record<string, string> = {
  closeBelow: "Schluss unter dem unteren Band",
  closeAbove: "Schluss über dem oberen Band",
  touchLower: "Kurs berührt das untere Band",
  touchUpper: "Kurs berührt das obere Band",
  backInLower: "Schluss kehrt über das untere Band zurück",
  backInUpper: "Schluss kehrt unter das obere Band zurück",
  squeeze: "Squeeze: Bollinger-Bänder liegen innerhalb des Kanals",
};

const keltnerBlock: BlockDef = {
  id: "keltner",
  label: "Keltner-Kanal",
  family: "volatility",
  help: "EMA ± Vielfaches der ATR: Schluss außerhalb, Rückkehr in den Kanal – oder der Squeeze (Bollinger-Bänder liegen innerhalb des Kanals).",
  params: [
    { key: "len", label: "EMA-Länge", kind: "int", def: 20, min: 5, max: 200 },
    { key: "atrLen", label: "ATR-Länge", kind: "int", def: 10, min: 2, max: 100 },
    { key: "mult", label: "ATR-Faktor", kind: "float", def: 2, min: 0.5, max: 6, step: 0.1, unit: "×" },
    { key: "mode", label: "Bedingung", kind: "select", def: "closeBelow", options: Object.keys(KC_LABEL).map((v) => ({ v, label: KC_LABEL[v]! })) },
    { key: "bbMult", label: "Bollinger-Abweichung", kind: "float", def: 2, min: 0.5, max: 5, step: 0.1, unit: "σ", hint: "Nur für den Squeeze: so breit sind die Bollinger-Bänder (gleiche Länge).", when: (p) => str(p, "mode") === "squeeze" },
    WITHIN,
  ],
  warmup: (p) => Math.max(num(p, "len") * 3, num(p, "atrLen") * 3) + 1,
  eval(c, p) {
    const len = num(p, "len");
    const kc = c.memo(`kc${len}_${num(p, "atrLen")}_${num(p, "mult")}`, () => keltnerSeries(c.bars, len, num(p, "atrLen"), num(p, "mult")));
    const mode = str(p, "mode");
    const warm = Math.max(len * 3, num(p, "atrLen") * 3);
    if (mode === "squeeze") {
      const bb = c.memo(`bb${len}_${num(p, "bbMult")}`, () => bollingerSeries(closeOf(c), len, num(p, "bbMult")));
      const ev = triFrom(c.n, (i) => (i < warm || !fin(bb.upper[i]!) || !fin(kc.upper[i]!) ? null : bb.upper[i]! < kc.upper[i]! && bb.lower[i]! > kc.lower[i]!));
      return withinBars(ev, num(p, "within"));
    }
    const ev = triFrom(c.n, (i) => {
      if (i < warm || !fin(kc.upper[i]!)) return null;
      const b = c.bars[i]!;
      switch (mode) {
        case "closeBelow":
          return b.c < kc.lower[i]!;
        case "closeAbove":
          return b.c > kc.upper[i]!;
        case "touchLower":
          return b.l <= kc.lower[i]!;
        case "touchUpper":
          return b.h >= kc.upper[i]!;
        case "backInLower":
          return i > 0 && c.bars[i - 1]!.c < kc.lower[i - 1]! && b.c >= kc.lower[i]!;
        default:
          return i > 0 && c.bars[i - 1]!.c > kc.upper[i - 1]! && b.c <= kc.upper[i]!;
      }
    });
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => `Keltner(${num(p, "len")}, ATR ${num(p, "atrLen")} × ${de(num(p, "mult"))}): ${KC_LABEL[str(p, "mode")] ?? str(p, "mode")}${str(p, "mode") === "squeeze" ? ` (Bollinger ${de(num(p, "bbMult"))}σ)` : ""}${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "mode", { closeBelow: "closeAbove", closeAbove: "closeBelow", touchLower: "touchUpper", touchUpper: "touchLower", backInLower: "backInUpper", backInUpper: "backInLower", squeeze: "squeeze" }),
};

// ── Ichimoku ────────────────────────────────────────────────────────────────────────────────────────────────────

const ICHI_LABEL: Record<string, string> = {
  aboveCloud: "Schluss über der Wolke",
  belowCloud: "Schluss unter der Wolke",
  inCloud: "Schluss in der Wolke",
  breakUp: "Schluss bricht nach oben aus der Wolke",
  breakDown: "Schluss bricht nach unten aus der Wolke",
  tkUp: "Tenkan kreuzt Kijun nach oben",
  tkDown: "Tenkan kreuzt Kijun nach unten",
  greenCloud: "Wolke steigend (Senkou A über B)",
  redCloud: "Wolke fallend (Senkou A unter B)",
};

const ichimokuBlock: BlockDef = {
  id: "ichimoku",
  label: "Ichimoku",
  family: "trend",
  help: "Lage des Schlusskurses zur Wolke (Kumo), Wolkenausbruch, Tenkan/Kijun-Kreuz oder Wolkenfarbe. Wolke wie bei TradingView 25 Kerzen vorausgezeichnet.",
  params: [
    { key: "conv", label: "Tenkan", kind: "int", def: 9, min: 2, max: 100 },
    { key: "base", label: "Kijun", kind: "int", def: 26, min: 3, max: 200 },
    { key: "spanB", label: "Senkou B", kind: "int", def: 52, min: 5, max: 300 },
    { key: "shift", label: "Verschiebung", kind: "int", def: 26, min: 1, max: 100, unit: "Kerzen", hint: "Wie bei TradingView wird die Wolke um Verschiebung − 1 Kerzen nach vorn gezeichnet." },
    { key: "mode", label: "Bedingung", kind: "select", def: "breakUp", options: Object.keys(ICHI_LABEL).map((v) => ({ v, label: ICHI_LABEL[v]! })) },
    { ...WITHIN, when: (p) => /break|^tk/.test(str(p, "mode")) },
  ],
  warmup: (p) => Math.max(num(p, "spanB"), num(p, "base")) + num(p, "shift") + 1,
  fix: (p) => {
    const conv = Math.min(num(p, "conv"), num(p, "base") - 1);
    return { ...p, conv: Math.max(2, conv), spanB: Math.max(num(p, "spanB"), num(p, "base") + 1) };
  },
  eval(c, p) {
    const ic = c.memo(`ichi${num(p, "conv")}_${num(p, "base")}_${num(p, "spanB")}_${num(p, "shift")}`, () => ichimokuSeries(c.bars, num(p, "conv"), num(p, "base"), num(p, "spanB"), num(p, "shift")));
    const mode = str(p, "mode");
    const w = num(p, "within");
    const top = (i: number): number => Math.max(ic.cloudA[i]!, ic.cloudB[i]!);
    const bot = (i: number): number => Math.min(ic.cloudA[i]!, ic.cloudB[i]!);
    const ok = (i: number): boolean => i >= 0 && fin(ic.cloudA[i]!) && fin(ic.cloudB[i]!);
    switch (mode) {
      case "aboveCloud":
        return triFrom(c.n, (i) => (ok(i) ? c.bars[i]!.c > top(i) : null));
      case "belowCloud":
        return triFrom(c.n, (i) => (ok(i) ? c.bars[i]!.c < bot(i) : null));
      case "inCloud":
        return triFrom(c.n, (i) => (ok(i) ? c.bars[i]!.c <= top(i) && c.bars[i]!.c >= bot(i) : null));
      case "greenCloud":
        return triFrom(c.n, (i) => (ok(i) ? ic.cloudA[i]! > ic.cloudB[i]! : null));
      case "redCloud":
        return triFrom(c.n, (i) => (ok(i) ? ic.cloudA[i]! < ic.cloudB[i]! : null));
      case "breakUp":
        return withinBars(triFrom(c.n, (i) => (ok(i) && ok(i - 1) ? c.bars[i]!.c > top(i) && c.bars[i - 1]!.c <= top(i - 1) : null)), w);
      case "breakDown":
        return withinBars(triFrom(c.n, (i) => (ok(i) && ok(i - 1) ? c.bars[i]!.c < bot(i) && c.bars[i - 1]!.c >= bot(i - 1) : null)), w);
      case "tkUp":
        return relate(c.n, ic.tenkan, ic.kijun, "crossUp", w, num(p, "base"));
      default:
        return relate(c.n, ic.tenkan, ic.kijun, "crossDown", w, num(p, "base"));
    }
  },
  text: (p) => `Ichimoku(${num(p, "conv")}, ${num(p, "base")}, ${num(p, "spanB")}): ${ICHI_LABEL[str(p, "mode")] ?? str(p, "mode")}${/break|^tk/.test(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", { aboveCloud: "belowCloud", belowCloud: "aboveCloud", inCloud: "inCloud", breakUp: "breakDown", breakDown: "breakUp", tkUp: "tkDown", tkDown: "tkUp", greenCloud: "redCloud", redCloud: "greenCloud" }),
};

// ── CCI / Williams %R ───────────────────────────────────────────────────────────────────────────────────────────

const cciBlock: BlockDef = {
  id: "cci",
  label: "CCI",
  family: "momentum",
  help: "Commodity Channel Index (typischer Preis) über / unter einem Niveau oder beim Kreuzen des Niveaus (üblich ±100).",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 20, min: 3, max: 200 },
    { key: "mode", label: "Bedingung", kind: "select", def: "crossUp", options: REL_OPTIONS },
    { key: "level", label: "Niveau", kind: "float", def: -100, min: -300, max: 300, step: 10 },
    { ...WITHIN, when: whenCross },
  ],
  warmup: (p) => num(p, "len") + 1,
  eval(c, p) {
    const len = num(p, "len");
    const v = c.memo(`cci${len}`, () => cciSeries(c.bars, len));
    return relate(c.n, v, num(p, "level"), str(p, "mode") as Rel, num(p, "within"), len);
  },
  text: (p) => `CCI(${num(p, "len")}) ${REL_WORD[str(p, "mode") as Rel]} ${de(num(p, "level"))}${isCross(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => ({ ...swap(p, "mode", REL_MIRROR), level: -num(p, "level") }),
};

const willrBlock: BlockDef = {
  id: "willr",
  label: "Williams %R",
  family: "momentum",
  help: "Williams %R (−100 … 0) über / unter einem Niveau oder beim Kreuzen (üblich −80 überverkauft, −20 überkauft).",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 14, min: 2, max: 200 },
    { key: "mode", label: "Bedingung", kind: "select", def: "crossUp", options: REL_OPTIONS },
    { key: "level", label: "Niveau", kind: "float", def: -80, min: -99, max: -1, step: 1 },
    { ...WITHIN, when: whenCross },
  ],
  warmup: (p) => num(p, "len") + 1,
  eval(c, p) {
    const len = num(p, "len");
    const v = c.memo(`wpr${len}`, () => williamsRSeries(c.bars, len));
    return relate(c.n, v, num(p, "level"), str(p, "mode") as Rel, num(p, "within"), len);
  },
  text: (p) => `Williams %R(${num(p, "len")}) ${REL_WORD[str(p, "mode") as Rel]} ${de(num(p, "level"))}${isCross(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => ({ ...swap(p, "mode", REL_MIRROR), level: Math.round((-100 - num(p, "level")) * 100) / 100 }),
};

// ── OBV ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const OBV_LABEL: Record<string, string> = {
  above: "liegt über seinem Durchschnitt",
  below: "liegt unter seinem Durchschnitt",
  crossUp: "kreuzt seinen Durchschnitt nach oben",
  crossDown: "kreuzt seinen Durchschnitt nach unten",
  newHigh: "erreicht ein neues N-Kerzen-Hoch",
  newLow: "erreicht ein neues N-Kerzen-Tief",
};

/** Number of bars without volume in (i − span, i] – any of them makes a volume indicator unknown there. */
function volumeGaps(c: EvalCtx): Int32Array {
  return c.memo("volGaps", () => {
    const out = new Int32Array(c.n + 1);
    for (let i = 0; i < c.n; i++) out[i + 1] = out[i]! + (c.bars[i]!.v !== undefined && Number.isFinite(c.bars[i]!.v) ? 0 : 1);
    return out;
  });
}

const obvBlock: BlockDef = {
  id: "obv",
  label: "OBV (Volumenfluss)",
  family: "price",
  help: "On-Balance-Volume gegen seinen Durchschnitt oder als neues Hoch / Tief – bestätigt oder widerspricht der Kursbewegung.",
  needsVolume: true,
  params: [
    { key: "len", label: "Durchschnitt", kind: "int", def: 20, min: 3, max: 200, unit: "Kerzen" },
    { key: "mode", label: "Bedingung", kind: "select", def: "crossUp", options: Object.keys(OBV_LABEL).map((v) => ({ v, label: OBV_LABEL[v]! })) },
    { key: "n", label: "Rückblick", kind: "int", def: 20, min: 3, max: 400, unit: "Kerzen", when: (p) => /^new/.test(str(p, "mode")) },
    { ...WITHIN, when: (p) => /cross|^new/.test(str(p, "mode")) },
  ],
  warmup: (p) => Math.max(num(p, "len"), num(p, "n")) + 2,
  eval(c, p) {
    const o = c.memo("obv", () => obvSeries(c.bars));
    const gaps = volumeGaps(c);
    const len = num(p, "len");
    const mode = str(p, "mode");
    const span = /^new/.test(mode) ? num(p, "n") + 1 : len + 1;
    const noVol = (i: number): boolean => i < span || gaps[i + 1]! - gaps[Math.max(0, i + 1 - span)]! > 0;
    const w = num(p, "within");
    if (mode === "newHigh" || mode === "newLow") {
      const n = num(p, "n");
      const ext = c.memo(`obvX${mode}${n}`, () => windowExtreme(o, n, mode === "newHigh"));
      const ev = triFrom(c.n, (i) => (noVol(i) || i < 1 ? null : mode === "newHigh" ? o[i]! > ext[i - 1]! : o[i]! < ext[i - 1]!));
      return withinBars(ev, w);
    }
    const m = c.memo(`obvMa${len}`, () => sma(o, len));
    const rel = relate(c.n, o, m, mode as Rel, w, len);
    return triFrom(c.n, (i) => (noVol(i) ? null : rel[i] === UNKNOWN ? null : rel[i] === TRUE));
  },
  text: (p) => `OBV ${OBV_LABEL[str(p, "mode")] ?? str(p, "mode")}${/^new/.test(str(p, "mode")) ? ` (${num(p, "n")} Kerzen)` : ` (Ø ${num(p, "len")})`}${/cross|^new/.test(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", { above: "below", below: "above", crossUp: "crossDown", crossDown: "crossUp", newHigh: "newLow", newLow: "newHigh" }),
};

// ── VWAP ────────────────────────────────────────────────────────────────────────────────────────────────────────

const SESSION_ID: Record<string, number> = { asia: 0, london: 1, ny: 2, late: 3, weekend: 4 };
const VWAP_LABEL: Record<string, string> = {
  above: "Schluss über dem VWAP",
  below: "Schluss unter dem VWAP",
  crossUp: "Schluss kreuzt den VWAP nach oben",
  crossDown: "Schluss kreuzt den VWAP nach unten",
  belowBy: "Schluss mindestens X % unter dem VWAP",
  aboveBy: "Schluss mindestens X % über dem VWAP",
};
const ANCHOR_LABEL: Record<string, string> = { day: "seit Tagesbeginn (00:00 UTC)", session: "seit Sitzungsbeginn (UTC-Sessions der App)", week: "seit Wochenbeginn (Montag 00:00 UTC)" };

function vwapCheck(p: LeafParams, tfSec: number): string | null {
  const a = str(p, "anchor");
  if (tfSec <= 0) return null;
  if (a === "session" && tfSec > 3600) return "Der Session-VWAP braucht Kerzen von höchstens 1h – bei größeren Kerzen passt keine Sitzung hinein.";
  if (a === "day" && tfSec >= DAY) return "Der Tages-VWAP braucht Kerzen unter 1D – bei Tageskerzen wäre er nur der typische Preis der Kerze.";
  if (a === "week" && tfSec >= 7 * DAY) return "Der Wochen-VWAP braucht Kerzen unter einer Woche.";
  return null;
}

const vwapBlock: BlockDef = {
  id: "vwap",
  label: "VWAP",
  family: "price",
  help: "Volumengewichteter Durchschnittspreis (typischer Preis) seit Tag-, Session- oder Wochenbeginn (UTC): Lage des Kurses, Kreuzung oder Abstand.",
  needsVolume: true,
  params: [
    { key: "anchor", label: "Neustart", kind: "select", def: "day", options: Object.keys(ANCHOR_LABEL).map((v) => ({ v, label: ANCHOR_LABEL[v]! })) },
    { key: "mode", label: "Bedingung", kind: "select", def: "belowBy", options: Object.keys(VWAP_LABEL).map((v) => ({ v, label: VWAP_LABEL[v]! })) },
    { key: "dist", label: "Abstand", kind: "float", def: 1, min: 0.05, max: 20, step: 0.05, unit: "%", when: (p) => /By$/.test(str(p, "mode")) },
    { ...WITHIN, when: whenCross },
  ],
  warmup: () => 0,
  check: vwapCheck,
  eval(c, p) {
    const anchor = str(p, "anchor");
    const key = anchor === "week" ? (t: number) => Math.floor((t - 4 * DAY) / (7 * DAY)) : anchor === "session" ? (t: number) => Math.floor(t / DAY) * 8 + (SESSION_ID[sessionOfSec(t)] ?? 7) : (t: number) => Math.floor(t / DAY);
    const v = c.memo(`vwap${anchor}`, () => vwapSeries(c.bars, key));
    const mode = str(p, "mode");
    const close = closeOf(c);
    if (vwapCheck(p, c.tfSec)) return new Uint8Array(c.n).fill(UNKNOWN);
    if (mode === "belowBy" || mode === "aboveBy") {
      const d = num(p, "dist") / 100;
      return triFrom(c.n, (i) => (fin(v[i]!) ? (mode === "belowBy" ? close[i]! <= v[i]! * (1 - d) : close[i]! >= v[i]! * (1 + d)) : null));
    }
    return relate(c.n, close, v, mode as Rel, num(p, "within"), 0);
  },
  text: (p) => {
    const m = str(p, "mode");
    const what = /By$/.test(m) ? `Schluss mindestens ${de(num(p, "dist"))} % ${m === "belowBy" ? "unter" : "über"} dem VWAP` : VWAP_LABEL[m]!;
    return `${what} (${ANCHOR_LABEL[str(p, "anchor")] ?? str(p, "anchor")})${isCross(m) ? within(num(p, "within")) : ""}`;
  },
  mirror: (p) => swap(p, "mode", { above: "below", below: "above", crossUp: "crossDown", crossDown: "crossUp", belowBy: "aboveBy", aboveBy: "belowBy" }),
};

// ── Opening range ───────────────────────────────────────────────────────────────────────────────────────────────

const ORB_START: Record<string, number> = { asia: 0, london: 7, ny: 13 };
const ORB_NAME: Record<string, string> = { asia: "Asien (00:00 UTC)", london: "London (07:00 UTC)", ny: "New York (13:00 UTC)" };

const orbBlock: BlockDef = {
  id: "orb",
  label: "Opening-Range-Ausbruch",
  family: "structure",
  help: "Hoch und Tief der ersten N Minuten einer Sitzung (UTC) bilden die Spanne; gilt, wenn ein Schluss danach darüber / darunter liegt – nur einige Stunden lang.",
  params: [
    { key: "session", label: "Sitzung", kind: "select", def: "london", options: Object.keys(ORB_NAME).map((v) => ({ v, label: ORB_NAME[v]! })) },
    { key: "minutes", label: "Spanne", kind: "int", def: 60, min: 5, max: 480, step: 5, unit: "Minuten", hint: "Muss ein Vielfaches der Kerzenlänge sein (z. B. 60 Minuten bei 15m- oder 1h-Kerzen)." },
    { key: "validHours", label: "Gültig", kind: "int", def: 4, min: 1, max: 12, unit: "Stunden", hint: "So lange nach Ende der Spanne zählt ein Ausbruch." },
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "up",
      options: [
        { v: "up", label: "Schluss über der Spanne" },
        { v: "down", label: "Schluss unter der Spanne" },
        { v: "inside", label: "Schluss innerhalb der Spanne" },
      ],
    },
    {
      key: "first",
      label: "Zählt",
      kind: "select",
      def: "first",
      options: [
        { v: "first", label: "nur der erste Ausbruch der Sitzung" },
        { v: "all", label: "jede Kerze, die die Bedingung erfüllt" },
      ],
      when: (p) => str(p, "mode") !== "inside",
    },
  ],
  warmup: () => 0,
  execOnly: "Die Spanne hängt an der Uhrzeit der Kerzen – sie gilt für die Ausführungskerze (UTC).",
  check(p, tfSec) {
    const sec = num(p, "minutes") * 60;
    if (tfSec > 0 && (sec < tfSec || sec % tfSec !== 0)) return `Die Spanne von ${num(p, "minutes")} Minuten passt nicht zu ${Math.round(tfSec / 60)}-Minuten-Kerzen – wähle ein Vielfaches der Kerzenlänge.`;
    return null;
  },
  eval(c, p) {
    const tf = c.tfSec;
    const startS = ORB_START[str(p, "session")]! * 3600;
    const rangeS = num(p, "minutes") * 60;
    const endS = startS + rangeS;
    const validS = num(p, "validHours") * 3600;
    const mode = str(p, "mode");
    const first = str(p, "first") === "first" && mode !== "inside";
    if (!(tf > 0) || rangeS < tf || rangeS % tf !== 0) return new Uint8Array(c.n).fill(UNKNOWN);
    const need = rangeS / tf;
    const ranges = c.memo(`orb${startS}_${rangeS}`, () => {
      const m = new Map<number, { hi: number; lo: number; cnt: number }>();
      for (const b of c.bars) {
        const day = Math.floor(b.t / DAY);
        const sod = b.t - day * DAY;
        if (sod < startS || sod + tf > endS) continue;
        const r = m.get(day) ?? { hi: -Infinity, lo: Infinity, cnt: 0 };
        r.hi = Math.max(r.hi, b.h);
        r.lo = Math.min(r.lo, b.l);
        r.cnt++;
        m.set(day, r);
      }
      return m;
    });
    const fired = new Set<number>();
    return triFrom(c.n, (i) => {
      const b = c.bars[i]!;
      const day = Math.floor(b.t / DAY);
      const sod = b.t - day * DAY;
      if (sod < endS || sod >= endS + validS) return false;
      const r = ranges.get(day);
      if (!r || r.cnt < need) return null;
      const hit = mode === "up" ? b.c > r.hi : mode === "down" ? b.c < r.lo : b.c <= r.hi && b.c >= r.lo;
      if (!first) return hit;
      if (hit && !fired.has(day)) {
        fired.add(day);
        return true;
      }
      return false;
    });
  },
  text: (p) => {
    const m = str(p, "mode");
    const what = m === "up" ? "Schluss über" : m === "down" ? "Schluss unter" : "Schluss innerhalb";
    return `${what} der Opening Range (${num(p, "minutes")} Min ab ${ORB_NAME[str(p, "session")]}, ${num(p, "validHours")} h gültig${m !== "inside" && str(p, "first") === "first" ? ", erster Ausbruch" : ""})`;
  },
  mirror: (p) => swap(p, "mode", { up: "down", down: "up", inside: "inside" }),
};

// ── Inside bar ──────────────────────────────────────────────────────────────────────────────────────────────────

const insideBarBlock: BlockDef = {
  id: "insideBar",
  label: "Inside Bar",
  family: "structure",
  help: "Eine Kerze liegt komplett innerhalb der vorigen (Pause) – oder der Schluss bricht danach aus dem Hoch / Tief der Mutterkerze aus.",
  params: [
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "breakUp",
      options: [
        { v: "inside", label: "diese Kerze ist eine Inside Bar" },
        { v: "breakUp", label: "Ausbruch nach oben nach einer Inside Bar" },
        { v: "breakDown", label: "Ausbruch nach unten nach einer Inside Bar" },
      ],
    },
    { ...WITHIN, when: (p) => str(p, "mode") !== "inside" },
  ],
  warmup: () => 3,
  eval(c, p) {
    const mode = str(p, "mode");
    const isInside = (i: number): boolean => i >= 1 && c.bars[i]!.h < c.bars[i - 1]!.h && c.bars[i]!.l > c.bars[i - 1]!.l;
    if (mode === "inside") return triFrom(c.n, (i) => (i < 1 ? null : isInside(i)));
    const up = mode === "breakUp";
    const ev = triFrom(c.n, (i) => {
      if (i < 2) return null;
      if (!isInside(i - 1)) return false;
      const mother = c.bars[i - 2]!;
      return up ? c.bars[i]!.c > mother.h : c.bars[i]!.c < mother.l;
    });
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => {
    const m = str(p, "mode");
    return m === "inside" ? "Kerze ist eine Inside Bar" : `Schluss bricht nach einer Inside Bar ${m === "breakUp" ? "über das Hoch" : "unter das Tief"} der Mutterkerze aus${within(num(p, "within"))}`;
  },
  mirror: (p) => swap(p, "mode", { inside: "inside", breakUp: "breakDown", breakDown: "breakUp" }),
};

// ── Heikin-Ashi ─────────────────────────────────────────────────────────────────────────────────────────────────

const HA_LABEL: Record<string, string> = {
  bull: "grüne Heikin-Ashi-Kerzen in Folge",
  bear: "rote Heikin-Ashi-Kerzen in Folge",
  strongBull: "grüne Kerzen in Folge ohne unteren Docht (starker Aufwärtstrend)",
  strongBear: "rote Kerzen in Folge ohne oberen Docht (starker Abwärtstrend)",
  flipUp: "Farbwechsel von rot auf grün",
  flipDown: "Farbwechsel von grün auf rot",
};

const heikinBlock: BlockDef = {
  id: "heikin",
  label: "Heikin-Ashi-Trend",
  family: "trend",
  help: "Geglättete Heikin-Ashi-Kerzen: mehrere gleichfarbige Kerzen in Folge (optional ohne Docht gegen den Trend) oder ein Farbwechsel.",
  params: [
    { key: "mode", label: "Bedingung", kind: "select", def: "bull", options: Object.keys(HA_LABEL).map((v) => ({ v, label: HA_LABEL[v]! })) },
    { key: "n", label: "Anzahl", kind: "int", def: 3, min: 1, max: 12, unit: "Kerzen", when: (p) => !/^flip/.test(str(p, "mode")) },
    { ...WITHIN, when: (p) => /^flip/.test(str(p, "mode")) },
  ],
  warmup: (p) => 20 + num(p, "n"),
  eval(c, p) {
    const ha = c.memo("ha", () => heikinAshi(c.bars));
    const mode = str(p, "mode");
    const n = num(p, "n");
    const green = (i: number): boolean => ha.c[i]! > ha.o[i]!;
    const red = (i: number): boolean => ha.c[i]! < ha.o[i]!;
    const eps = (i: number): number => Math.abs(ha.c[i]!) * 1e-9;
    const noLower = (i: number): boolean => ha.l[i]! >= ha.o[i]! - eps(i);
    const noUpper = (i: number): boolean => ha.h[i]! <= ha.o[i]! + eps(i);
    const warm = 20 + n;
    if (mode === "flipUp" || mode === "flipDown") {
      const ev = triFrom(c.n, (i) => (i < warm ? null : mode === "flipUp" ? green(i) && !green(i - 1) : red(i) && !red(i - 1)));
      return withinBars(ev, num(p, "within"));
    }
    return triFrom(c.n, (i) => {
      if (i < warm) return null;
      for (let k = i - n + 1; k <= i; k++) {
        if (mode === "bull" && !green(k)) return false;
        if (mode === "bear" && !red(k)) return false;
        if (mode === "strongBull" && !(green(k) && (k < i || noLower(k)))) return false;
        if (mode === "strongBear" && !(red(k) && (k < i || noUpper(k)))) return false;
      }
      return true;
    });
  },
  text: (p) => {
    const m = str(p, "mode");
    return /^flip/.test(m) ? `Heikin-Ashi: ${HA_LABEL[m]}${within(num(p, "within"))}` : `${num(p, "n")} ${HA_LABEL[m]}`;
  },
  mirror: (p) => swap(p, "mode", { bull: "bear", bear: "bull", strongBull: "strongBear", strongBear: "strongBull", flipUp: "flipDown", flipDown: "flipUp" }),
};

// ── pivots: break of the last swing high / low, Fibonacci retracement ───────────────────────────────────────────

const pivotBreakBlock: BlockDef = {
  id: "pivotBreak",
  label: "Pivot-Bruch (Struktur)",
  family: "structure",
  help: "Der Schluss bricht das zuletzt bestätigte Pivot-Hoch (Pivot-Tief) – ein Pivot ist erst nach den rechten Kerzen bestätigt, also nie rückwirkend.",
  params: [
    {
      key: "mode",
      label: "Richtung",
      kind: "select",
      def: "up",
      options: [
        { v: "up", label: "über das letzte Pivot-Hoch" },
        { v: "down", label: "unter das letzte Pivot-Tief" },
      ],
    },
    { key: "left", label: "Kerzen links", kind: "int", def: 5, min: 1, max: 50 },
    { key: "right", label: "Kerzen rechts", kind: "int", def: 5, min: 1, max: 50, hint: "So viele Kerzen nach dem Pivot, bis es bestätigt ist." },
    WITHIN,
  ],
  warmup: (p) => num(p, "left") + num(p, "right") + 2,
  eval(c, p) {
    const pv = c.memo(`piv${num(p, "left")}_${num(p, "right")}`, () => pivotLevels(c.bars, num(p, "left"), num(p, "right")));
    const up = str(p, "mode") === "up";
    const lv = up ? pv.hi : pv.lo;
    const ev = triFrom(c.n, (i) => {
      if (i < 1 || !fin(lv[i]!)) return null;
      const now = c.bars[i]!.c;
      const prev = c.bars[i - 1]!.c;
      return up ? now > lv[i]! && !(prev > lv[i]!) : now < lv[i]! && !(prev < lv[i]!);
    });
    return withinBars(ev, num(p, "within"));
  },
  text: (p) => `Schluss bricht ${str(p, "mode") === "up" ? "über das letzte Pivot-Hoch" : "unter das letzte Pivot-Tief"} (${num(p, "left")}/${num(p, "right")} Kerzen)${within(num(p, "within"))}`,
  mirror: (p) => swap(p, "mode", { up: "down", down: "up" }),
};

const fibBlock: BlockDef = {
  id: "fib",
  label: "Fibonacci-Rücksetzer (Golden Pocket)",
  family: "structure",
  help: "Der letzte bestätigte Swing (Pivot-Tief → Pivot-Hoch, oder umgekehrt) wird gemessen; gilt, wenn der Kurs in die Rücksetzer-Zone (Standard 0,618–0,65) zurückläuft.",
  params: [
    {
      key: "dir",
      label: "Richtung",
      kind: "select",
      def: "long",
      options: [
        { v: "long", label: "Rücksetzer im Aufwärts-Swing (Long)" },
        { v: "short", label: "Erholung im Abwärts-Swing (Short)" },
      ],
    },
    { key: "len", label: "Pivot-Länge", kind: "int", def: 8, min: 2, max: 50, unit: "Kerzen", hint: "Kerzen links und rechts, die einen Swing-Punkt bestätigen." },
    { key: "from", label: "Zone von", kind: "float", def: 0.618, min: 0.1, max: 1, step: 0.01, hint: "Anteil des Swings, den der Kurs zurückgelaufen ist (0,5 = Hälfte)." },
    { key: "to", label: "Zone bis", kind: "float", def: 0.65, min: 0.1, max: 1, step: 0.01 },
    {
      key: "basis",
      label: "Gilt, wenn",
      kind: "select",
      def: "close",
      options: [
        { v: "close", label: "der Schluss in der Zone liegt" },
        { v: "touch", label: "die Kerze die Zone berührt" },
      ],
    },
  ],
  warmup: (p) => num(p, "len") * 4 + 2,
  fix: (p) => {
    const a = Math.min(num(p, "from"), num(p, "to"));
    const b = Math.max(num(p, "from"), num(p, "to"));
    return { ...p, from: a, to: b > a ? b : Math.min(1, a + 0.01) };
  },
  eval(c, p) {
    const len = num(p, "len");
    const pv = c.memo(`piv${len}_${len}`, () => pivotLevels(c.bars, len, len));
    const long = str(p, "dir") === "long";
    const a = num(p, "from");
    const b = num(p, "to");
    const touch = str(p, "basis") === "touch";
    return triFrom(c.n, (i) => {
      const H = pv.hi[i]!;
      const L = pv.lo[i]!;
      if (!fin(H) || !fin(L)) return null;
      const upLeg = pv.loAt[i]! < pv.hiAt[i]!; // the low came first: the last swing went up
      if (long !== upLeg || !(H > L)) return false;
      const range = H - L;
      const lo = long ? H - b * range : L + a * range;
      const hi = long ? H - a * range : L + b * range;
      const bar = c.bars[i]!;
      return touch ? bar.l <= hi && bar.h >= lo : bar.c >= lo && bar.c <= hi;
    });
  },
  text: (p) => `Kurs ${str(p, "basis") === "touch" ? "berührt" : "schließt in"} der Fibonacci-Zone ${de(num(p, "from"))}–${de(num(p, "to"))} des letzten ${str(p, "dir") === "long" ? "Aufwärts" : "Abwärts"}-Swings (Pivot ${num(p, "len")})`,
  mirror: (p) => swap(p, "dir", { long: "short", short: "long" }),
};

// ── trend following: Supertrend, Chandelier ─────────────────────────────────────────────────────────────────────

const DIR_LABEL: Record<string, string> = { up: "Aufwärtstrend", down: "Abwärtstrend", flipUp: "Wechsel auf Aufwärtstrend", flipDown: "Wechsel auf Abwärtstrend" };
const DIR_MIRROR = { up: "down", down: "up", flipUp: "flipDown", flipDown: "flipUp" };

function dirSignal(c: EvalCtx, dir: readonly number[], mode: string, win: number, warm: number): Uint8Array {
  if (mode === "up" || mode === "down") return triFrom(c.n, (i) => (i < warm || !fin(dir[i]!) ? null : mode === "up" ? dir[i]! > 0 : dir[i]! < 0));
  const ev = triFrom(c.n, (i) => (i < warm || i < 1 || !fin(dir[i]!) || !fin(dir[i - 1]!) ? null : mode === "flipUp" ? dir[i]! > 0 && dir[i - 1]! < 0 : dir[i]! < 0 && dir[i - 1]! > 0));
  return withinBars(ev, win);
}

const MODE_OPTIONS = Object.keys(DIR_LABEL).map((v) => ({ v, label: DIR_LABEL[v]! }));

const supertrendBlock: BlockDef = {
  id: "supertrend",
  label: "Supertrend",
  family: "trend",
  help: "ATR-Trendlinie (Standard ATR 10, Faktor 3): Aufwärts- oder Abwärtstrend, oder der Wechsel der Richtung.",
  params: [
    { key: "atrLen", label: "ATR-Länge", kind: "int", def: 10, min: 2, max: 100 },
    { key: "factor", label: "Faktor", kind: "float", def: 3, min: 0.5, max: 10, step: 0.1, unit: "×" },
    { key: "mode", label: "Bedingung", kind: "select", def: "flipUp", options: MODE_OPTIONS },
    { ...WITHIN, when: (p) => /^flip/.test(str(p, "mode")) },
  ],
  warmup: (p) => num(p, "atrLen") + 20,
  eval(c, p) {
    const st = c.memo(`st${num(p, "atrLen")}_${num(p, "factor")}`, () => supertrendSeries(c.bars, num(p, "atrLen"), num(p, "factor")));
    return dirSignal(c, st.dir, str(p, "mode"), num(p, "within"), num(p, "atrLen") + 20);
  },
  text: (p) => `Supertrend(${num(p, "atrLen")}, ${de(num(p, "factor"))}): ${DIR_LABEL[str(p, "mode")] ?? str(p, "mode")}${/^flip/.test(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", DIR_MIRROR),
};

const chandelierBlock: BlockDef = {
  id: "chandelier",
  label: "Chandelier-Stopp (ATR-Trailing)",
  family: "trend",
  help: "Der ATR-Trailing-Stopp hängt unter dem Hoch der letzten N Kerzen (Standard 22 Kerzen, Faktor 3). Die Richtung wechselt, wenn der Schluss die Gegenlinie kreuzt.",
  params: [
    { key: "len", label: "Länge", kind: "int", def: 22, min: 3, max: 200, unit: "Kerzen" },
    { key: "mult", label: "ATR-Faktor", kind: "float", def: 3, min: 0.5, max: 10, step: 0.1, unit: "×" },
    { key: "mode", label: "Bedingung", kind: "select", def: "flipUp", options: MODE_OPTIONS },
    { ...WITHIN, when: (p) => /^flip/.test(str(p, "mode")) },
  ],
  warmup: (p) => num(p, "len") * 2 + 5,
  eval(c, p) {
    const ch = c.memo(`ch${num(p, "len")}_${num(p, "mult")}`, () => chandelierSeries(c.bars, num(p, "len"), num(p, "mult")));
    return dirSignal(c, ch.dir, str(p, "mode"), num(p, "within"), num(p, "len") * 2 + 5);
  },
  text: (p) => `Chandelier(${num(p, "len")}, ${de(num(p, "mult"))} × ATR): ${DIR_LABEL[str(p, "mode")] ?? str(p, "mode")}${/^flip/.test(str(p, "mode")) ? within(num(p, "within")) : ""}`,
  mirror: (p) => swap(p, "mode", DIR_MIRROR),
};

// ── funding ─────────────────────────────────────────────────────────────────────────────────────────────────────

const fundingBlock: BlockDef = {
  id: "funding",
  label: "Funding-Extrem",
  family: "price",
  help: "Die Funding-Rate (in % je 8 h) ist extrem hoch oder tief – Gegenposition zur überfüllten Seite. Braucht die echte Funding-Historie des Laufs.",
  needsRunData: "funding",
  params: [
    {
      key: "mode",
      label: "Bedingung",
      kind: "select",
      def: "below",
      options: [
        { v: "below", label: "Funding unter Niveau (Shorts zahlen)" },
        { v: "above", label: "Funding über Niveau (Longs zahlen)" },
      ],
    },
    { key: "level", label: "Niveau", kind: "float", def: -0.02, min: -1, max: 1, step: 0.005, unit: "% je 8 h", hint: "Die Grundrate bei Binance ist 0,01 % je 8 h." },
    { key: "avgN", label: "Mittel über", kind: "int", def: 1, min: 1, max: 9, unit: "Zahlungen", hint: "3 Zahlungen = ein Tag." },
  ],
  warmup: () => 0,
  eval(c, p) {
    const pts = c.funding;
    if (!pts || !pts.length) return new Uint8Array(c.n).fill(UNKNOWN);
    const avg = num(p, "avgN");
    const f = c.memo(`fund${avg}`, () => fundingSeries(c.bars, c.tfSec, pts, avg));
    const below = str(p, "mode") === "below";
    return triFrom(c.n, (i) => (fin(f[i]!) ? (below ? f[i]! < num(p, "level") : f[i]! > num(p, "level")) : null));
  },
  text: (p) => `Funding${num(p, "avgN") > 1 ? ` (Ø ${num(p, "avgN")} Zahlungen)` : ""} ${str(p, "mode") === "below" ? "unter" : "über"} ${de(num(p, "level"))} % je 8 h`,
  mirror: (p) => ({ ...swap(p, "mode", { below: "above", above: "below" }), level: -num(p, "level") }),
};

export const PLUS_BLOCKS = {
  donchian: donchianBlock,
  adx: adxBlock,
  stoch: stochBlock,
  keltner: keltnerBlock,
  ichimoku: ichimokuBlock,
  cci: cciBlock,
  willr: willrBlock,
  obv: obvBlock,
  vwap: vwapBlock,
  orb: orbBlock,
  insideBar: insideBarBlock,
  heikin: heikinBlock,
  pivotBreak: pivotBreakBlock,
  fib: fibBlock,
  funding: fundingBlock,
  supertrend: supertrendBlock,
  chandelier: chandelierBlock,
} as const;
