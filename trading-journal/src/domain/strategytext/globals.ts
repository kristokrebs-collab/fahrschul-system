/**
 * Keyword-led parts of a strategy text: risk per trade, market, test period, timeframe, the exit management (partial
 * take-profit, break-even, trailing, stop, target, time stop, counter signal), the time filters (session, weekday, clock
 * times) and the direction words. Each scanner reads the unread part of the working text and marks what it used, so the
 * number of a stop ("Stop 1,5 ATR") can never be read again as a volatility filter.
 */
import { EXEC_TFS, type TfId } from "../lab/rules/types";
import { Ctx, type SpecLeaf, type SpecNode } from "./ctx";
import { parseNum } from "./normalize";
import type { StudioPeriod } from "./types";

const N = String.raw`\d+(?:[.,]\d+)?`;
const SENT_RX = /[;\n]|\.(?!\d)/;
/** words that start another part of the strategy: a value window never reaches over them */
const CUT_RX = /\b(?:ziel|zielmarke|tp\d?|take[- ]?profit|break[- ]?even|breakeven|trail\w*|teil\w*|risiko|nur|long|short|stops?|stopps?|sl|wenn|falls|sobald)\b/;

/** The text after `from` (at most `max` characters) up to the end of the sentence or the next part of the strategy. */
function winAfter(ctx: Ctx, from: number, max = 46): { t: string; a: number } {
  const rest = ctx.w.slice(from, from + max);
  let cut = rest.length;
  const sent = rest.search(SENT_RX);
  if (sent >= 0) cut = Math.min(cut, sent);
  const kw = rest.search(CUT_RX);
  if (kw >= 0) cut = Math.min(cut, kw);
  return { t: rest.slice(0, cut), a: from };
}

/** Runs `fn` for every match of `rx` in the CURRENT working text (consumed parts no longer match). */
function each(ctx: Ctx, rx: RegExp, fn: (m: RegExpExecArray) => void): void {
  const g = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
  let pos = 0;
  for (let guard = 0; guard < 200; guard++) {
    g.lastIndex = pos;
    const m = g.exec(ctx.w);
    if (!m) break;
    fn(m);
    pos = m.index + Math.max(1, m[0].length);
  }
}

const ATR_RX = new RegExp(String.raw`(${N})\s*(?:x|\*|mal|-?fach\w*)?\s*atr\b`);
const ATR_AFTER_RX = new RegExp(String.raw`\batr\b\s*(?:\(\s*\d+\s*\)\s*)?(?:x|\*|mal)\s*(${N})`);
const PCT_RX = new RegExp(String.raw`(${N})\s*(?:%|prozent|pct|percent)`);
const R_RX = new RegExp(String.raw`\+?(${N})\s*(?:r\b|r-?(?:multiple|faktor|vielfache\w*)|x\s*(?:des\s+)?risiko\w*|-?fach\w*\s*(?:des\s+)?risiko\w*)`);
const RATIO_RX = new RegExp(String.raw`(${N})\s*:\s*(${N})`);

/** "ATR multiple" in `t`, or null. */
const atrIn = (t: string): { v: number; a: number; b: number } | null => {
  const m = ATR_RX.exec(t) ?? ATR_AFTER_RX.exec(t);
  return m ? { v: parseNum(m[1]!), a: m.index, b: m.index + m[0].length } : null;
};
const pctIn = (t: string): { v: number; a: number; b: number } | null => {
  const m = PCT_RX.exec(t);
  return m ? { v: parseNum(m[1]!), a: m.index, b: m.index + m[0].length } : null;
};
const rIn = (t: string): { v: number; a: number; b: number } | null => {
  const m = R_RX.exec(t);
  return m ? { v: parseNum(m[1]!), a: m.index, b: m.index + m[0].length } : null;
};

/* ------------------------------------------------------------------------------------------------- risk */

export function scanRisk(ctx: Ctx): void {
  const take = (m: RegExpExecArray, g: number): void => {
    const pct = parseNum(m[g]!);
    if (pct >= 0.05 && pct <= 10) ctx.add({ kind: "risk", pct, a: m.index, b: m.index + m[0].length });
    else ctx.noteUnclear(m.index, m.index + m[0].length, `Risiko pro Trade von ${String(pct).replace(".", ",")} % liegt außerhalb dessen, was das Labor rechnet (0,05 bis 10 %).`);
  };
  each(ctx, new RegExp(String.raw`\b(?:risiko|riskier\w*|risk|einsatz|risikobudget)\b[^.;\n]{0,24}?(${N})\s*(?:%|prozent|pct)(?:\s+(?:pro|je)\s+(?:trade|position))?`), (m) => take(m, 1));
  each(ctx, new RegExp(String.raw`(${N})\s*(?:%|prozent|pct)\s*(?:des\s+(?:kapitals|kontos|depots)\s+)?(?:risiko|risk|pro\s+trade|je\s+trade|pro\s+position|je\s+position|vom\s+kapital|des\s+kapitals|kontorisiko)`), (m) => take(m, 1));
}

/* ----------------------------------------------------------------------------------------------- market */

const STRONG_COINS: Readonly<Record<string, string>> = {
  btc: "BTC",
  bitcoin: "BTC",
  eth: "ETH",
  ethereum: "ETH",
  ether: "ETH",
  xrp: "XRP",
  ripple: "XRP",
  bnb: "BNB",
  solana: "SOL",
  doge: "DOGE",
  dogecoin: "DOGE",
  cardano: "ADA",
  avalanche: "AVAX",
  avax: "AVAX",
  litecoin: "LTC",
  ltc: "LTC",
  polkadot: "DOT",
  chainlink: "LINK",
};
/** short words that are also German words or common abbreviations: only with a trigger word before them */
const WEAK_COINS: Readonly<Record<string, string>> = { sol: "SOL", ada: "ADA", dot: "DOT", link: "LINK", near: "NEAR", op: "OP", arb: "ARB", sui: "SUI", pol: "POL", inj: "INJ", atom: "ATOM", apt: "APT", trx: "TRX", ton: "TON" };

export function scanMarket(ctx: Ctx): void {
  const seen = new Set<string>();
  const add = (sym: string, a: number, b: number): void => {
    if (seen.size && !seen.has(sym)) {
      ctx.noteUnclear(a, b, `Mehrere Märkte genannt (${[...seen, sym].join(", ")}); ein Test läuft auf einem Markt. Ich nehme ${[...seen][0]}.`);
      return;
    }
    seen.add(sym);
    ctx.add({ kind: "market", symbol: sym, a, b });
  };
  each(ctx, /\b([a-z0-9]{2,10})\s*[-/]?\s*usdt(?:\.p)?\b/, (m) => add(`${m[1]!.toUpperCase()}USDT`, m.index, m.index + m[0].length));
  const strongNames = Object.keys(STRONG_COINS).join("|");
  each(ctx, new RegExp(String.raw`\b(${strongNames})\b`), (m) => add(`${STRONG_COINS[m[1]!]!}USDT`, m.index, m.index + m[0].length));
  const weakNames = Object.keys(WEAK_COINS).join("|");
  each(ctx, new RegExp(String.raw`\b(?:auf|fuer|handel\w*|coin|paar|markt|im|am)\s+(?:den\s+|dem\s+|das\s+)?(${weakNames})\b`), (m) => add(`${WEAK_COINS[m[1]!]!}USDT`, m.index, m.index + m[0].length));
}

/* ------------------------------------------------------------------------------------------------ period */

const PERIOD_OF_MONTHS: Readonly<Record<number, StudioPeriod>> = { 3: "3m", 6: "6m", 12: "1y", 24: "2y", 36: "3y" };

export function scanPeriod(ctx: Ctx): void {
  each(ctx, new RegExp(String.raw`\b(?:letzte[nrms]?|vergangene[nrms]?|ueber|seit|fuer|zeitraum|historie)\s+(?:die\s+|den\s+|das\s+|dem\s+|der\s+)?(?:letzten?\s+|vergangenen\s+)?(${N})\s*(monat\w*|jahr\w*)\b`), (m) => {
    const n = parseNum(m[1]!);
    const months = /^jahr/.test(m[2]!) ? n * 12 : n;
    const period = PERIOD_OF_MONTHS[months];
    if (period) ctx.add({ kind: "period", period, a: m.index, b: m.index + m[0].length });
    else ctx.noteUnclear(m.index, m.index + m[0].length, "Das Labor testet über 3 oder 6 Monate oder über 1, 2 oder 3 Jahre – diesen Zeitraum kennt es nicht.");
  });
  each(ctx, /\b(?:das\s+|im\s+)?(?:letzte[nrms]?|vergangene[nrms]?)\s+(jahr|halbjahr)\b|\bhalbes\s+jahr\b/, (m) => ctx.add({ kind: "period", period: m[1] === "jahr" ? "1y" : "6m", a: m.index, b: m.index + m[0].length }));
}

/* ---------------------------------------------------------------------------------------------- timeframe */

const TF_PATTERNS: readonly [TfId, RegExp][] = [
  ["15m", /\b(?:15\s*(?:m|min|minuten?)|m15|viertelstunden\w*|15-?minuten\w*)\b/],
  ["30m", /\b(?:30\s*(?:m|min|minuten?)|m30|halbstunden\w*|30-?minuten\w*)\b/],
  ["1h", /\b(?:1\s*(?:h|std|stunde)\b|h1|stundenchart\w*|stundenkerzen\w*|stuendlich\w*|stundentakt|1-?stunden\w*|60\s*(?:m|min)\w*)/],
  ["2h", /\b(?:2\s*(?:h|std|stunden)\b|h2|2-?stunden\w*)/],
  ["4h", /\b(?:4\s*(?:h|std|stunden)\b|h4|4-?stunden\w*)/],
  ["1d", /\b(?:1\s*d\b|d1|tages-?chart\w*|tageskerzen\w*|tagesbasis|taeglich\w*|daily|1-?tages\w*)/],
];
const TF_UNSUPPORTED = /\b(?:zeitrahmen|timeframe|zeiteinheit|tf|auf|im|mit)\s+(?:dem\s+)?(\d+)\s*(h|std|stunden?|m|min|minuten?|d|tag(?:e|es)?|w|wochen?)\b|\b(\d+)\s*(h|std|stunden?|m|min|minuten?|d|tag(?:e|es)?|w|wochen?)[- ]?(?:chart|kerzen|zeitrahmen|timeframe|zeiteinheit)\b|\b(wochenchart\w*|wochenkerzen\w*|monatschart\w*|1w|w1|1\s*woche)\b/;

export function scanTimeframes(ctx: Ctx): void {
  for (const [tf, rx] of TF_PATTERNS)
    each(ctx, rx, (m) => {
      // "Zeitrahmen 1h", "Timeframe: 4h" and "1h-Chart" are one phrase
      const lead = /(?:zeitrahmen|timeframe|zeiteinheit|tf)\s*[:=]?\s*$/.exec(ctx.w.slice(Math.max(0, m.index - 16), m.index));
      const trail = /^[- ]?(?:chart\w*|kerzen|zeitrahmen|zeiteinheit)\b/.exec(ctx.w.slice(m.index + m[0].length));
      ctx.add({ kind: "tf", tf, a: lead ? m.index - lead[0].length : m.index, b: m.index + m[0].length + (trail ? trail[0].length : 0) });
    });
  each(ctx, TF_UNSUPPORTED, (m) => {
    const lab = EXEC_TFS.map((t) => (t === "1d" ? "1D" : t)).join(", ");
    ctx.noteUnclear(m.index, m.index + m[0].length, `Diesen Zeitrahmen rechnet das Labor nicht – es kennt ${lab}.`);
  });
}

/* ---------------------------------------------------------------------------------------- exit management */

const FRAC_HALF = /\b(?:haelfte|halbe[nrs]?\s+(?:position|menge|gewinn)\w*|die\s+haelfte|halbe\s+position)\b/;

export function scanPartial(ctx: Ctx): void {
  const make = (a: number, b: number, atR: number | null, frac: number | null): void => {
    const fromDefault = atR == null || frac == null;
    ctx.add({ kind: "partial", atR: atR ?? 1, fracPct: frac ?? 50, fromDefault, a, b });
    if (atR == null)
      ctx.ask({ id: "partial-r", text: "Bei wie viel Gewinn soll der Teilgewinn mitgenommen werden?", options: [0.5, 1, 1.5, 2].map((v) => ({ id: String(v), label: `${String(v).replace(".", ",")} R` })), blocking: false, span: { a, b } });
    if (frac == null)
      ctx.ask({ id: "partial-frac", text: "Wie viel der Position soll beim Teilgewinn verkauft werden?", options: [25, 33, 50, 75].map((v) => ({ id: String(v), label: `${v} %` })), blocking: false, span: { a, b } });
  };
  // "50 % bei 1R verkaufen", "die Hälfte bei 1R schließen"
  each(ctx, new RegExp(String.raw`(?:(${N})\s*(?:%|prozent)|(haelfte|halbe[nrs]?\s+position|halbe\s+menge))[^.;\n]{0,32}?(?:bei|ab|nach)\s*\+?(${N})\s*r\b[^.;\n]{0,24}?(?:verkauf\w*|schliess\w*|mitnehm\w*|realisier\w*|nehmen|nehme|raus|gewinn\w*)`), (m) => {
    make(m.index, m.index + m[0].length, parseNum(m[3]!), m[1] ? parseNum(m[1]) : 50);
  });
  // "bei 1R 50 % verkaufen" / "bei 1R die Hälfte schließen"
  each(ctx, new RegExp(String.raw`(?:bei|ab|nach)\s*\+?(${N})\s*r\b[^.;\n]{0,24}?(?:(${N})\s*(?:%|prozent)|(haelfte|halbe[nrs]?\s+position))[^.;\n]{0,24}?(?:verkauf\w*|schliess\w*|mitnehm\w*|realisier\w*|nehmen|nehme|raus)`), (m) => {
    make(m.index, m.index + m[0].length, parseNum(m[1]!), m[2] ? parseNum(m[2]) : 50);
  });
  // "Teilgewinn / Teilziel / Teilverkauf …"
  each(ctx, /\b(?:teil[- ]?(?:gewinn\w*|ziel\w*|verkauf\w*|verkaeuf\w*|schliess\w*|tp|take[- ]?profit|realisier\w*)|scale[- ]?out|teilausstieg\w*)\b/, (m) => {
    const w = winAfter(ctx, m.index + m[0].length, 56);
    const r = rIn(w.t);
    const p = pctIn(w.t);
    const half = FRAC_HALF.test(w.t);
    const end = m.index + m[0].length + Math.max(r?.b ?? 0, p?.b ?? 0, half ? (FRAC_HALF.exec(w.t)?.index ?? 0) + (FRAC_HALF.exec(w.t)?.[0].length ?? 0) : 0);
    make(m.index, end, r ? r.v : null, p ? p.v : half ? 50 : null);
  });
}

export function scanBreakEven(ctx: Ctx): void {
  const kw = /\b(?:break[- ]?even\w*|be\b|einstand\w*|stop\s+(?:nachziehen\s+|verschieben\s+|setzen\s+|ziehen\s+)?(?:auf|an|bei|zum|zu)\s+(?:den\s+|dem\s+|dein\w*\s+)?(?:einstieg\w*|einstand\w*|break[- ]?even\w*|be\b|null))/;
  each(ctx, kw, (m) => {
    const kwEnd = m.index + m[0].length;
    const aft = winAfter(ctx, kwEnd, 52);
    const beforeAll = ctx.w.slice(Math.max(0, m.index - 28), m.index);
    const cutAt = Math.max(beforeAll.lastIndexOf("."), beforeAll.lastIndexOf(";"), beforeAll.lastIndexOf("\n"), beforeAll.lastIndexOf(","));
    const bef = cutAt >= 0 ? beforeAll.slice(cutAt + 1) : beforeAll;
    const befStart = m.index - bef.length;
    const net = /\b(?:netto|inkl\w*\s+gebuehr\w*|gebuehren|kosten)\b/.test(aft.t);
    let a = m.index;
    let b = kwEnd;
    let value: { trigger: "r" | "pct"; v: number } | null = null;
    const ra = rIn(aft.t);
    const pa = ra ? null : pctIn(aft.t);
    if (ra) {
      value = { trigger: "r", v: ra.v };
      b = kwEnd + ra.b;
    } else if (pa) {
      value = { trigger: "pct", v: pa.v };
      b = kwEnd + pa.b;
    } else {
      const rb = rIn(bef);
      const pb = rb ? null : pctIn(bef);
      if (rb) {
        value = { trigger: "r", v: rb.v };
        a = befStart + rb.a;
      } else if (pb) {
        value = { trigger: "pct", v: pb.v };
        a = befStart + pb.a;
      }
    }
    ctx.add({ kind: "breakEven", trigger: value?.trigger ?? "r", value: value?.v ?? 1, to: net ? "net" : "entry", fromDefault: !value, a, b });
    if (!value) ctx.assume({ id: "be", text: "Break-even ab +1 R (im Text stand kein Wert)", options: [0.5, 1, 1.5, 2].map((v) => ({ id: String(v), label: `+${String(v).replace(".", ",")} R` })), def: "1" });
  });
}

export function scanTrailing(ctx: Ctx): void {
  each(ctx, /\b(?:trailing[- ]?(?:stop|sl)?|trail\w*|stop\s+nachzieh\w*|nachzieh\w*|mitzieh\w*|mitlaufend\w*)\b/, (m) => {
    const aft = winAfter(ctx, m.index + m[0].length, 52);
    const atr = atrIn(aft.t);
    const pct = atr ? null : pctIn(aft.t);
    const act = /\bab\s*\+?(\d+(?:[.,]\d+)?)\s*r\b/.exec(aft.t);
    const end = m.index + m[0].length + Math.max(atr?.b ?? 0, pct?.b ?? 0, act ? act.index + act[0].length : 0);
    const have = atr ?? pct;
    ctx.add({ kind: "trailing", tkind: atr ? "atr" : pct ? "pct" : "atr", value: have?.v ?? 2, activateR: act ? parseNum(act[1]!) : 1, fromDefault: !have, a: m.index, b: end });
    if (!have) ctx.assume({ id: "trail", text: "Trailing-Stop mit 2 × ATR (im Text stand kein Wert)", options: [1.5, 2, 3].map((v) => ({ id: `atr${v}`, label: `${String(v).replace(".", ",")} × ATR` })), def: "atr2" });
  });
}

export function scanStop(ctx: Ctx): void {
  // "1,5 ATR als Stop"
  each(ctx, new RegExp(String.raw`(${N})\s*(?:x|\*|mal|-?fach\w*)?\s*atr\s+(?:als\s+)?(?:stop[- ]?loss|stoploss|stopps?|stops?|sl)\b`), (m) => ctx.add({ kind: "stop", stop: { kind: "atr", value: parseNum(m[1]!) }, a: m.index, b: m.index + m[0].length }));
  each(ctx, /\b(?:stop[- ]?loss|stoploss|stopps?|stops?|sl)\b/, (m) => {
    const end0 = m.index + m[0].length;
    const aft = winAfter(ctx, end0, 54);
    const atr = atrIn(aft.t);
    const pct = atr ? null : pctIn(aft.t);
    if (atr) return ctx.add({ kind: "stop", stop: { kind: "atr", value: atr.v }, a: m.index, b: end0 + atr.b });
    if (pct) return ctx.add({ kind: "stop", stop: { kind: "percent", value: pct.v }, a: m.index, b: end0 + pct.b });
    const sw = /(\d+)[- ]?(?:kerzen|bars)[- ]?(?:swing[- ]?)?(?:tief|hoch|low|high|swing)\w*|(?:(?:unter|ueber|hinter)\s+(?:dem\s+|der\s+)?(?:letzten?\s+|vorherigen?\s+|naechsten?\s+)?)?(?:swing[- ]?(?:tief|hoch|low|high|stop)?|tief|hoch)\w*/.exec(aft.t);
    if (sw) return ctx.add({ kind: "stop", stop: { kind: "swing", value: sw[1] ? Number(sw[1]) : 10, fromDefault: !sw[1] }, a: m.index, b: end0 + sw.index + sw[0].length });
    const price = new RegExp(String.raw`(?:bei|auf|unter|ueber)\s+\$?\s*\d{1,3}(?:\.\d{3})+|(?:bei|auf)\s+\d{4,}`).exec(aft.t);
    if (price) return ctx.noteUnclear(m.index, end0 + price.index + price[0].length, "Ein Stop bei einem festen Preis passt nicht zu einer Regel für viele Trades – das Labor setzt den Stop relativ (ATR, Prozent oder Swing).");
    // "ohne Stop": the lab never trades without one
    const noStopAt = /\b(?:ohne|kein\w*)\s*$/.exec(ctx.w.slice(Math.max(0, m.index - 12), m.index));
    if (noStopAt) return ctx.noteUnclear(Math.max(0, m.index - 12) + noStopAt.index, end0, "Das Labor handelt nie ohne Stop – jeder Trade braucht eine Risikogröße. Es nimmt einen Standard-Stop (siehe Annahmen); schreibe einen Wert wie „Stop 1,5 ATR“, wenn du einen anderen willst.");
    // the word "stop" alone (or with an adjective) says nothing the lab can use
    ctx.add({ kind: "stop", stop: null, a: m.index, b: end0 });
  });
}

export function scanTarget(ctx: Ctx): void {
  const NONE_RX = /\b(?:kein(?:e[nm]?)?|ohne)\s+(?:festes?\s+|festen\s+)?(?:ziel\w*|tp|take[- ]?profit|gewinnziel\w*)\b|\b(?:ziel|tp|take[- ]?profit)\s+(?:offen|weglassen|entfaellt)\b/;
  each(ctx, NONE_RX, (m) => ctx.add({ kind: "target", r: null, none: true, a: m.index, b: m.index + m[0].length }));
  // "2R Ziel"
  each(ctx, new RegExp(String.raw`\+?(${N})\s*r\s+(?:ziel\w*|tp|take[- ]?profit)\b`), (m) => ctx.add({ kind: "target", r: parseNum(m[1]!), a: m.index, b: m.index + m[0].length }));
  each(ctx, /\b(?:ziel(?:marke)?\w*|tp\d?|take[- ]?profit|gewinnziel\w*|kursziel\w*|target|crv|chance[- ]?risiko\w*|rrr|rr)\b/, (m) => {
    const end0 = m.index + m[0].length;
    const aft = winAfter(ctx, end0, 52);
    const r = rIn(aft.t);
    if (r) return ctx.add({ kind: "target", r: r.v, a: m.index, b: end0 + r.b });
    const ratio = RATIO_RX.exec(aft.t);
    if (ratio) {
      const x = parseNum(ratio[1]!);
      const y = parseNum(ratio[2]!);
      const v = Math.max(x, y) / Math.max(1e-9, Math.min(x, y));
      return ctx.add({ kind: "target", r: Math.round(v * 100) / 100, a: m.index, b: end0 + ratio.index + ratio[0].length });
    }
    const pct = pctIn(aft.t);
    if (pct) return ctx.noteUnclear(m.index, end0 + pct.b, "Das Labor kennt Ziele nur als Vielfaches des Risikos (R), nicht als Prozent vom Kurs.");
    const bare = /^\s*(?:von\s+|bei\s+|:|=)?\s*\+?(\d+(?:[.,]\d+)?)\b/.exec(aft.t);
    if (bare && /^(?:crv|rrr|rr|chance)/.test(m[0])) return ctx.add({ kind: "target", r: parseNum(bare[1]!), a: m.index, b: end0 + bare[0].length });
    ctx.add({ kind: "target", r: null, a: m.index, b: end0 });
  });
}

export function scanTimeStop(ctx: Ctx): void {
  const unit = (u: string): "bars" | "hours" | "days" => (/^(?:kerze|bar|candle)/.test(u) ? "bars" : /^(?:stunde|std|h)/.test(u) ? "hours" : "days");
  each(ctx, new RegExp(String.raw`\b(?:zeit[- ]?stop\w*|zeitstopp|time[- ]?stop|zeitausstieg)\b[^.;\n]{0,16}?(${N})\s*(kerzen?|bars?|candles?|stunden?|std|tage\w*)`), (m) => ctx.add({ kind: "timeStop", value: parseNum(m[1]!), unit: unit(m[2]!), a: m.index, b: m.index + m[0].length }));
  each(ctx, new RegExp(String.raw`\b(?:nach|spaetestens\s+nach|hoechstens|maximal|max\.?|laenger\s+als|nicht\s+laenger\s+als)\s*(${N})\s*(kerzen?|bars?|candles?|stunden?|std|tage\w*)\s*(?:wieder\s+)?(?:raus|schliess\w*|aussteig\w*|beend\w*|verkauf\w*|halten|ausstieg|exit|zumachen|glattstell\w*)?`), (m) => {
    // "nach 3 Kerzen" before a condition is a window, not an exit: it needs one of the exit words or "höchstens / maximal"
    const exitWord = /(?:raus|schliess|aussteig|beend|verkauf|halten|ausstieg|exit|zumachen|glattstell)/.test(m[0]);
    const limit = /^(?:hoechstens|maximal|max|laenger|nicht)/.test(m[0]);
    if (!exitWord && !limit) return;
    ctx.add({ kind: "timeStop", value: parseNum(m[1]!), unit: unit(m[2]!), a: m.index, b: m.index + m[0].length });
  });
}

export function scanOpposite(ctx: Ctx): void {
  each(ctx, /\b(?:(?:ausstieg|exit|raus)\s+(?:bei|per|durch|mit)\s+)?(?:gegen[- ]?signal\w*|gegenlaeufig\w*\s+signal\w*|umgekehrt\w*\s+signal\w*|entgegengesetzt\w*\s+signal\w*|bei\s+(?:einer\s+)?umkehr)(?:\s+(?:ausstieg|exit|raus))?\b/, (m) => ctx.add({ kind: "opposite", a: m.index, b: m.index + m[0].length }));
}

/* ----------------------------------------------------------------------------------------- time filters */

export const SESSION_WORD: Readonly<Record<string, string>> = { asia: "Asien", london: "London", ny: "New York", late: "Spät", weekend: "Wochenende" };
const SESSION_RX: readonly [string, RegExp][] = [
  ["weekend", /\bwochenende\w*|\b(?:samstag|sonntag)s?\s*(?:und|\/|&|sowie)\s*(?:samstag|sonntag)s?\b/],
  ["late", /\b(?:spaet\w*\s+session|abendsession|spaetsession|abend-?handel)\b/],
  ["ny", /\b(?:new\s*york\w*|nyse|ny(?:-?session)?|us[- ](?:session|handel|boerse|zeit|markt)\w*|amerika\w*|wall\s*street|usa)\b/],
  ["london", /\blondon\w*/],
  ["asia", /\b(?:asien\w*|asia\w*|asiatisch\w*|tokio\w*|tokyo\w*)/],
];
const SESSION_OTHER = /\b(?:frankfurt\w*|europa\w*|eu-?(?:session|handel|zeit)|europaeisch\w*|sydney\w*)(?:[- ](?:session|handel\w*|zeit|boerse))?\b/;
const DAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"] as const;
const DAY_KEY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<string, string> = { mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag" };
export const dayName = (k: string): string => DAY_NAME[k] ?? k;

const timeLeaf = (p: Record<string, string>, not?: boolean): SpecLeaf => ({ t: "leaf", block: "timeWindow", tf: "exec", params: { weekday: "any", session: "any", ...p }, ...(not ? { not: true } : {}) });

interface Tok {
  kind: "session" | "day";
  key: string;
  a: number;
  b: number;
}

export function scanTimeFilters(ctx: Ctx): void {
  // Monday to Friday (and "werktags") is "not on the weekend" in the lab's UTC week
  each(ctx, /\b(?:montag\w*\s*(?:bis|-)\s*freitag\w*|mo\.?\s*-\s*fr\.?|werktags|werktaegig\w*|wochentags|unter\s+der\s+woche|nur\s+wochentage\w*)\b/, (m) => {
    ctx.add({ kind: "cond", filter: true, node: timeLeaf({ session: "weekend" }, true), a: m.index, b: m.index + m[0].length });
  });
  const toks: Tok[] = [];
  for (const [key, rx] of SESSION_RX) each(ctx, rx, (m) => (toks.push({ kind: "session", key, a: m.index, b: m.index + m[0].length }), ctx.consume(m.index, m.index + m[0].length)));
  each(ctx, new RegExp(String.raw`\b(${DAYS.join("|")})s?\b`), (m) => (toks.push({ kind: "day", key: DAY_KEY[DAYS.indexOf(m[1] as (typeof DAYS)[number])]!, a: m.index, b: m.index + m[0].length }), ctx.consume(m.index, m.index + m[0].length)));
  // the answer decides: a session chip becomes the time filter, "keine Zeitbeschränkung" drops the words on purpose
  const SESSION_ANSWERS = ["london", "ny", "asia", "none"] as const;
  const answered = (id: string, m: RegExpExecArray): boolean => {
    const ans = ctx.answer(id, SESSION_ANSWERS);
    if (ans == null) return false;
    if (ans === "none") ctx.consume(m.index, m.index + m[0].length);
    else ctx.add({ kind: "cond", filter: true, node: timeLeaf({ session: ans }), a: m.index, b: m.index + m[0].length });
    return true;
  };
  each(ctx, SESSION_OTHER, (m) => {
    ctx.ask({ id: "session-other", text: `Welche Session meinst du mit „${ctx.phrase(m.index, m.index + m[0].length)}“?`, options: [{ id: "london", label: "London" }, { id: "ny", label: "New York" }, { id: "asia", label: "Asien" }, { id: "none", label: "Keine Zeitbeschränkung" }], blocking: false, span: { a: m.index, b: m.index + m[0].length } });
    if (!answered("session-other", m)) ctx.noteUnclear(m.index, m.index + m[0].length, "Diese Session kennt das Labor nicht – es rechnet Asien (00–07 UTC), London (07–13), New York (13–21), Spät (21–24) und das Wochenende.");
  });
  toks.sort((x, y) => x.a - y.a);
  // group tokens of one kind that are only joined by "und / oder / , / bis"
  let i = 0;
  while (i < toks.length) {
    const first = toks[i]!;
    const group = [first];
    let j = i + 1;
    while (j < toks.length && toks[j]!.kind === first.kind && /^[\s,]*(?:und|oder|sowie|bis|-|\/|&|,)?[\s,]*(?:in\s+der\s+|am\s+|an\s+|im\s+)?$/.test(ctx.s.slice(group[group.length - 1]!.b, toks[j]!.a))) {
      group.push(toks[j]!);
      j++;
    }
    const range = group.length === 2 && first.kind === "day" && /\bbis\b|-/.test(ctx.s.slice(first.b, group[1]!.a));
    let keys = group.map((g) => g.key);
    if (range) {
      const lo = DAY_KEY.indexOf(keys[0] as (typeof DAY_KEY)[number]);
      const hi = DAY_KEY.indexOf(keys[1] as (typeof DAY_KEY)[number]);
      keys = lo <= hi ? DAY_KEY.slice(lo, hi + 1) : [...DAY_KEY.slice(lo), ...DAY_KEY.slice(0, hi + 1)];
    }
    const a = first.a;
    // the phrase includes the little words before it ("nur in der", "nicht am")
    const lead = /(?:(?:nur|nicht|kein\w*|ohne|ausser|niemals|nie)\s+(?:(?:handel\w*|handeln|trade\w*|traden|einstieg\w*|einstiege|position\w*|signal\w*|eroeffnung\w*|orders?)\s+)?)?(?:in\s+der\s+|in\s+den\s+|im\s+|am\s+|an\s+|waehrend\s+(?:der\s+|des\s+)?)?(?:nur\s+)?$/.exec(ctx.s.slice(Math.max(0, a - 30), a));
    const start = a - (lead ? lead[0].length : 0);
    const lastTok = group[group.length - 1]!;
    const trailWord = /^[\s,]*(?:\w+\s+)?(?:ausgeschlossen|ausschliessen|meiden|vermeiden|gesperrt|weglassen|auslassen|(?:nicht|nie|niemals)\s+(?:handeln|traden|einsteigen|kaufen|verkaufen)|(?:kein|keine)\s+(?:handel|trades?|einstiege?|positionen))\b/.exec(ctx.s.slice(lastTok.b, lastTok.b + 40));
    const end = lastTok.b + (/^[- ]?(?:session|handel\w*|zeit|boerse)\b/.exec(ctx.s.slice(lastTok.b, lastTok.b + 14))?.[0].length ?? 0) + (trailWord ? trailWord[0].length : 0);
    const trailNeg = /^[\s,]*(?:\w+\s+)?(ausgeschlossen|ausschliessen|meiden|vermeiden|gesperrt|weglassen|auslassen|raus|aus|(?:nicht|nie|niemals)\s+(?:handeln|traden|einsteigen|kaufen|verkaufen)|(?:kein|keine)\s+(?:handel|trades?|einstiege?|positionen))\b/.exec(ctx.s.slice(group[group.length - 1]!.b, group[group.length - 1]!.b + 40));
    const neg = (lead != null && /\b(?:nicht|kein\w*|ohne|ausser|nie|niemals)\b/.test(lead[0]) && !/\bnicht\s+nur\b/.test(lead[0])) || trailNeg != null;
    // a negation close before the time that the patterns above did not attach to it: never read it as "only then"
    const near = ctx.s.slice(Math.max(0, a - 34), a);
    if (!neg && /\b(?:nicht|kein\w*|ohne|ausser|nie|niemals)\b[^,;.\d]*$/.test(near) && !/\bnicht\s+nur\b/.test(near)) {
      ctx.noteUnclear(Math.max(0, start - 20), end, "Hier steht eine Verneinung (nicht / kein / ohne). Ich weiß nicht sicher, ob du diese Zeit ausschließen oder allein handeln willst – schreib es z. B. als „nicht am Wochenende“ oder „nur in der London-Session“.");
      i = j;
      continue;
    }
    const leaves: SpecNode[] = keys.map((k) => timeLeaf(first.kind === "session" ? { session: k } : { weekday: k }, neg));
    const node: SpecNode = leaves.length === 1 ? leaves[0]! : { t: "group", op: neg ? "and" : "or", kids: leaves };
    ctx.add({ kind: "cond", filter: true, node, a: Math.min(start, a), b: end });
    i = j;
  }
  // clock times are not part of the lab's rules
  let clockUsed = false;
  each(ctx, /\b(?:von|ab|zwischen|um|bis)\s*\d{1,2}(?::\d\d)?\s*(?:uhr)?\s*(?:bis|-|und)\s*\d{1,2}(?::\d\d)?\s*uhr\b|\b\d{1,2}:\d\d\s*(?:uhr)?(?:\s*(?:bis|-)\s*\d{1,2}:\d\d)?|\b\d{1,2}\s*uhr\b/, (m) => {
    // the chosen session replaces the clock time (once); "keine Zeitbeschränkung" drops it on purpose
    const ans = ctx.answer("clock", SESSION_ANSWERS);
    if (ans != null) {
      if (ans === "none" || clockUsed) ctx.consume(m.index, m.index + m[0].length);
      else ctx.add({ kind: "cond", filter: true, node: timeLeaf({ session: ans }), a: m.index, b: m.index + m[0].length });
      clockUsed = true;
    } else ctx.noteUnclear(m.index, m.index + m[0].length, "Uhrzeiten kennt das Labor nicht – nur feste Sessions (Asien 00–07, London 07–13, New York 13–21 UTC, Spät 21–24) und Wochentage.");
    ctx.ask({ id: "clock", text: "Welche Session kommt deiner Uhrzeit am nächsten?", options: [{ id: "asia", label: "Asien (00–07 UTC)" }, { id: "london", label: "London (07–13 UTC)" }, { id: "ny", label: "New York (13–21 UTC)" }, { id: "none", label: "Keine Zeitbeschränkung" }], blocking: false, span: { a: m.index, b: m.index + m[0].length } });
  });
}

/* --------------------------------------------------------------------------------------------- direction */

export function scanSides(ctx: Ctx): void {
  each(ctx, /\b(?:in\s+)?beide[nr]?\s+(?:richtung\w*|seiten?)\b|\bbeidseitig\w*|\bsowohl\s+long\s+als\s+auch\s+short\b|\b(?:long|short)\s*(?:und|\/|&|sowie|oder)\s*(?:short|long)\b/, (m) => ctx.add({ kind: "side", side: "both", a: m.index, b: m.index + m[0].length }));
  // "kein Short", "nicht short", "ohne Shorts"
  each(ctx, /\b(?:kein(?:e[nm]?)?|nicht|ohne|nie)\s+(longs?|shorts?|leerverkauf\w*)\b/, (m) => ctx.add({ kind: "noSide", side: /^long/.test(m[1]!) ? "long" : "short", a: m.index, b: m.index + m[0].length }));
  each(ctx, /\b(?:only\s+)?(longs?|shorts?|kaufen|kaufe|kauf|kaeufe|verkaufen|verkaufe|leerverkauf\w*|shorten|shorte|longen|longe|einkaufen|einsteigen\s+(?:long|short))(?:-(?:position\w*|strategie\w*|einstieg\w*|trade\w*|setup\w*|signal\w*|seite))?\b/, (m) => {
    const w = m[1]!;
    const side = /^(?:short|verkauf|leerverkauf|shorte)/.test(w) || /short$/.test(w) ? "short" : "long";
    ctx.add({ kind: "side", side, only: /^nur\s*$/.test(ctx.w.slice(Math.max(0, m.index - 5), m.index)), a: m.index, b: m.index + m[0].length });
  });
}

/** The order in which the keyword-led scanners run: what holds numbers of its own comes first. */
export function scanGlobals(ctx: Ctx): void {
  scanRisk(ctx);
  scanPeriod(ctx);
  scanMarket(ctx);
  scanPartial(ctx);
  scanBreakEven(ctx);
  scanTrailing(ctx);
  scanStop(ctx);
  scanTarget(ctx);
  scanTimeStop(ctx);
  scanOpposite(ctx);
  scanTimeframes(ctx);
  scanTimeFilters(ctx);
  scanSides(ctx);
}
