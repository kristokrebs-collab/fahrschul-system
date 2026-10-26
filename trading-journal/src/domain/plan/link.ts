/**
 * Der Link in den Handelsplan: `#plan?symbol=AAPL&side=long` (so baut ihn die Seite Aktien, "Plan erstellen →"; auch andere Seiten
 * können so verlinken, Krypto zum Beispiel mit `symbol=BTCUSDT`). Der Link füllt nur den Markt und die Richtung vor – er speichert
 * nichts und sendet nichts. Was der Handelsplan nicht versteht, wird übergangen UND gesagt (`ignored`), nie geraten.
 *
 * Welcher Markt ein Kürzel ist, sagt seine Form: ein Paar mit USDT/USDC am Ende ist ein Krypto-Perpetual von Binance, ein bis
 * fünf Buchstaben (mit Klassenzusatz wie BRK.B oder BF-B) sind eine US-Aktie. Das ist die Form, keine Prüfung bei der Börse –
 * ob die Quelle das Kürzel kennt, sagt später der Kerzenabruf mit Grund.
 *
 * Rein: kein Speicher, keine Uhr, kein Netz.
 */
import type { Side } from "../types";
import { DEFAULT_FORM, TF_MS, type PlanForm } from "./form";
import { formMarket, symbolMarket } from "./market";
import type { MarketKind, SessionId } from "./sessions";
import { MIN } from "./time";

export interface PlanLink {
  /** the link carried at least one key the Handelsplan knows or recognises as its own */
  present: boolean;
  symbol: string | null;
  market: MarketKind | null;
  side: Side | null;
  /** what could not be used, in words (German) */
  ignored: string[];
  /** the understood part as a query (`symbol=AAPL&side=long`); empty when nothing was understood */
  query: string;
}

const KNOWN = new Set(["symbol", "side"]);
const show = (v: string): string => (v.length > 24 ? `${v.slice(0, 24)}…` : v);

/**
 * `symbol=…&side=…` (with or without `?`, or a whole `#plan?…` hash) → what the link asks for. Invalid or unknown parts are
 * left out and named in `ignored`; the first value of a repeated key counts.
 */
export function parsePlanLink(input: string): PlanLink {
  const text = input.trim();
  const q = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text.startsWith("#") ? "" : text;
  const out: PlanLink = { present: false, symbol: null, market: null, side: null, ignored: [], query: "" };
  if (!q) return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(q);
  } catch {
    out.present = true;
    out.ignored.push("Der Link ließ sich nicht lesen – ignoriert.");
    return out;
  }
  for (const key of new Set(params.keys())) {
    if (!KNOWN.has(key)) {
      out.present = true;
      out.ignored.push(`„${show(key)}“ im Link kennt der Handelsplan nicht – ignoriert.`);
    }
  }
  const sym = params.get("symbol");
  if (sym !== null) {
    out.present = true;
    const s = sym.trim().toUpperCase();
    const market = s ? symbolMarket(s) : null;
    if (market) {
      out.symbol = s;
      out.market = market;
    } else {
      out.ignored.push(
        s
          ? `Das Kürzel „${show(sym.trim())}“ aus dem Link ist weder eine US-Aktie (ein bis fünf Buchstaben, zum Beispiel AAPL oder BRK.B) noch ein Krypto-Paar (zum Beispiel BTCUSDT) – ignoriert.`
          : "Das Kürzel im Link ist leer – ignoriert.",
      );
    }
  }
  const side = params.get("side");
  if (side !== null) {
    out.present = true;
    const d = side.trim().toLowerCase();
    if (d === "long" || d === "short") out.side = d;
    else out.ignored.push(`Die Richtung „${show(side.trim())}“ aus dem Link ist keine – erlaubt sind long und short – ignoriert.`);
  }
  const parts: string[] = [];
  if (out.symbol) parts.push(`symbol=${encodeURIComponent(out.symbol)}`);
  if (out.side) parts.push(`side=${out.side}`);
  out.query = parts.join("&");
  return out;
}

/** The link the page Aktien (and anyone else) writes: `#plan?symbol=AAPL&side=long`. */
export const planLinkHash = (symbol: string, side: Side): string => `#plan?symbol=${encodeURIComponent(symbol)}&side=${side}`;

/** A rule or price that was made for another symbol must not follow a link to a different one. */
const isPriceRule = (r: { kind: string }): boolean => r.kind === "price" || r.kind === "level";

const ceilTo = (x: number, m: number): number => Math.ceil(x / m) * m;

/** The session a market switch lands on: the US exchange for stocks, the New York session for crypto. */
export const sessionForMarket = (market: MarketKind): SessionId => (market === "stocks" ? "usstocks" : "newyork");

/**
 * The changes that put the form on `symbol` of `market`. Another market brings its own session, drops everything that only made
 * sense for the other one (a typed entry price, price steps, a clock time, absolute stop and target prices, the day) and keeps the
 * candle length if the new session can use it (a US session starts at 9:30, so one-hour candles do not fit). Another symbol of the
 * same market drops the prices typed for the old one. The same symbol changes nothing.
 */
export function formPatchFor(cur: PlanForm, to: { symbol: string; market: MarketKind }): Partial<PlanForm> {
  const patch: Partial<PlanForm> = { symbol: to.symbol };
  const sameMarket = formMarket(cur) === to.market;
  if (sameMarket && cur.symbol === to.symbol) return {};
  if (!sameMarket) {
    patch.session = sessionForMarket(to.market);
    patch.cutoffMin = null;
    patch.flatBy = null;
    patch.lot = null;
    patch.tick = null;
    if (to.market === "stocks" && cur.tf === "1h") {
      patch.tf = "5m";
      patch.orMinutes = cur.orMinutes % 5 === 0 ? cur.orMinutes : ceilTo(cur.orMinutes, 5);
    }
  }
  patch.manualEntry = null;
  patch.day = null;
  if (isPriceRule(cur.stop)) patch.stop = DEFAULT_FORM.stop;
  if (isPriceRule(cur.target)) patch.target = DEFAULT_FORM.target;
  // the range must still be a whole number of candles
  const tf = patch.tf ?? cur.tf;
  const m = TF_MS[tf] / MIN;
  const or = patch.orMinutes ?? cur.orMinutes;
  if (or % m !== 0) patch.orMinutes = ceilTo(or, m);
  return patch;
}

/** What a link changes in the form (`{}` when it asks for nothing usable). */
export function linkPatch(cur: PlanForm, link: PlanLink): Partial<PlanForm> {
  let patch: Partial<PlanForm> = {};
  let form = cur;
  if (link.symbol && link.market) {
    patch = formPatchFor(cur, { symbol: link.symbol, market: link.market });
    form = { ...cur, ...patch };
  }
  if (link.side && (form.sides !== link.side || form.manualSide !== link.side)) patch = { ...patch, sides: link.side, manualSide: link.side };
  return patch;
}
