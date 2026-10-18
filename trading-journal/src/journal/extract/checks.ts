/**
 * Plausibility checks of a candidate (F29) – pure. Everything the preview should point at before a trade is opened:
 * stop and targets on the right side of the entry, prices of one scale, quantities that add up, times in order, the
 * screenshot's result against the result the prices give, a market whose price is far from the trader's own history,
 * and duplicates. A check never changes a value; a `fix` is an offer the trader can take.
 */
import type { Side, Trade } from "@/domain/types";
import { averagePrice, firstAt, grossPnl, lastAt, pairKey, totalQty, type Candidate } from "./candidate";
import { findDuplicate, unjudged, type DuplicateMatch } from "./dedupe";
import { entryRef } from "./merge";
import { minutesBetween } from "./time";

export type CheckLevel = "warn" | "info" | "dup";
export type FieldKey = "pair" | "side" | "kind" | "exchange" | "entry" | "exit" | "qty" | "date" | "exitDate" | "stop" | "targets" | "leverage" | "fees" | "funding" | "pnl";

export interface Check {
  code: string;
  level: CheckLevel;
  text: string;
  field?: FieldKey;
  /** An offer the preview can show as a button. */
  fix?: { kind: "side"; value: Side; label: string } | { kind: "pnlMode"; value: "shot" | "calc"; label: string };
  /** `dup`: the stored trade. */
  duplicate?: DuplicateMatch;
}

export interface CheckContext {
  trades: readonly Trade[];
  now: Date;
  currency: string;
}

const num = (v: number, digits = 2): string => new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(v);
const signedNum = (v: number): string => (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v));

/* ------------------------------------------------------------------ result */

export interface PnlComparison {
  shot: number | null;
  /** Gross result of the prices, and after fees / funding. */
  gross: number | null;
  net: number | null;
  diff: number | null;
  /** Which reading of the prices matches the screenshot, `null` when none (or nothing to compare). */
  match: "net" | "gross-fees" | "gross" | null;
  /** The two numbers could be compared. */
  comparable: boolean;
  tolerance: number;
}

/** Tolerance for rounding in the displayed numbers: 1.5 % of the stated result, at least 0.05. */
const pnlTolerance = (shot: number): number => Math.max(0.05, 0.015 * Math.abs(shot));

/** Screenshot result against the result the prices give (net of the stated fees and funding, or gross). */
export function comparePnl(c: Candidate, side: Side | null = c.side.value): PnlComparison {
  const shot = c.pnl.value;
  const gross = grossPnl(c, side);
  const fees = c.fees.value ?? 0;
  const funding = c.funding.value ?? 0;
  const net = gross == null ? null : gross - fees - funding;
  const tolerance = shot == null ? 0.05 : pnlTolerance(shot);
  if (shot == null || gross == null || net == null) return { shot, gross, net, diff: null, match: null, comparable: false, tolerance };
  const options: [PnlComparison["match"], number][] = [
    ["net", net],
    ["gross-fees", gross - fees],
    ["gross", gross],
  ];
  const hit = options.find(([, v]) => Math.abs(v - shot) <= tolerance);
  return { shot, gross, net, diff: shot - net, match: hit ? hit[0] : null, comparable: true, tolerance };
}

/** Which result lands in the trade: the trader's choice, else the screenshot's number only when the prices disagree with it. */
export function resolvedPnlMode(c: Candidate): "shot" | "calc" {
  if (c.pnlMode !== "auto") return c.pnlMode;
  if (c.pnl.value == null) return "calc";
  const cmp = comparePnl(c);
  if (!cmp.comparable) return c.exits.length || c.status !== "closed" ? "calc" : "shot";
  return cmp.match ? "calc" : "shot";
}

/* ------------------------------------------------------------------ checks */

function medianEntry(trades: readonly Trade[], key: string): number | null {
  const v = trades
    .filter((t) => pairKey(t.pair) === key && t.entry != null && t.entry > 0)
    .slice(-30)
    .map((t) => t.entry!)
    .sort((a, b) => a - b);
  if (v.length < 3) return null;
  return v[Math.floor(v.length / 2)]!;
}

export function checksOf(c: Candidate, ctx: CheckContext): Check[] {
  const out: Check[] = [];
  const side = c.side.value;
  const ref = entryRef(c);
  const exit = averagePrice(c.exits);
  const stop = c.stop.value;
  const cur = ctx.currency;

  if (c.status === "planned") out.push({ code: "planned", level: "info", text: "Geplante Order – noch nichts ausgeführt. Sie wird als offener Trade mit geplantem Einstieg angelegt, ohne Fills." });

  if (side && ref != null) {
    if (stop != null && (side === "long" ? stop >= ref : stop <= ref))
      out.push({ code: "stop_side", level: "warn", field: "stop", text: `Bei ${side === "long" ? "Long" : "Short"} muss der Stop ${side === "long" ? "unter" : "über"} dem Einstieg liegen (Stop ${num(stop, 8)}, Einstieg ${num(ref, 8)}). Richtung oder Stop prüfen.` });
    const bad = c.targets.filter((t) => t.value != null && (side === "long" ? t.value <= ref : t.value >= ref));
    if (bad.length) out.push({ code: "target_side", level: "warn", field: "targets", text: `Ziel ${bad.map((t) => num(t.value!, 8)).join(", ")} liegt bei ${side === "long" ? "Long" : "Short"} auf der falschen Seite des Einstiegs.` });
    if (stop != null && Math.abs(stop - ref) / ref > 0.5) out.push({ code: "stop_far", level: "warn", field: "stop", text: "Der Stop liegt mehr als 50 % vom Einstieg entfernt – Dezimalstelle oder Zahlenformat prüfen." });
  }

  if (ref != null && exit != null && (exit / ref > 1.5 || exit / ref < 1 / 1.5)) out.push({ code: "exit_scale", level: "warn", field: "exit", text: "Einstieg und Ausstieg liegen weit auseinander – Dezimalstelle oder Zahlenformat prüfen." });

  const qIn = totalQty(c.entries);
  const qOut = totalQty(c.exits);
  if (qIn != null && qOut != null && qOut > qIn * 1.01) out.push({ code: "qty_over", level: "warn", field: "qty", text: `Die Ausstiege (${num(qOut, 8)}) schließen mehr, als eröffnet wurde (${num(qIn, 8)}) – eventuell ist ein Fill doppelt gelesen.` });

  const t0 = firstAt(c.entries);
  const t1 = lastAt(c.exits);
  if (t0 && t1 && minutesBetween(t0, t1) < 0) out.push({ code: "time_order", level: "warn", field: "exitDate", text: "Der Ausstieg liegt zeitlich vor dem Einstieg – Zeitzone oder Datum prüfen." });
  if (t0) {
    const nowLocal = `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, "0")}-${String(ctx.now.getDate()).padStart(2, "0")}T${String(ctx.now.getHours()).padStart(2, "0")}:${String(ctx.now.getMinutes()).padStart(2, "0")}`;
    if (minutesBetween(nowLocal, t0) > 5) out.push({ code: "time_future", level: "warn", field: "date", text: "Der Einstieg liegt in der Zukunft – Zeitzone oder Datum prüfen." });
  } else if (c.status !== "planned" && c.entries.length) out.push({ code: "no_time", level: "info", field: "date", text: "Die Einstiegszeit fehlt. Im Editor steht dann „jetzt“ – bitte anpassen." });

  const lev = c.leverage.value;
  if (lev != null && (lev < 1 || lev > 125)) out.push({ code: "lev_range", level: "warn", field: "leverage", text: `Hebel ${num(lev)}× wirkt unplausibel.` });

  // closed without any way to a result
  if (c.status === "closed" && !exit && c.pnl.value == null) out.push({ code: "closed_no_exit", level: "warn", field: "exit", text: "Als geschlossen erkannt, aber weder Ausstieg noch Ergebnis gelesen. Bitte ergänzen oder den Trade als offen anlegen." });

  // the screenshot's result against the prices
  const cmp = comparePnl(c);
  if (cmp.comparable && cmp.shot != null && cmp.net != null) {
    if (cmp.match) {
      out.push({
        code: "pnl_ok",
        level: "info",
        field: "pnl",
        text: `Ergebnis stimmt mit den Preisen überein (Screenshot ${signedNum(cmp.shot)} ${cur}${cmp.match === "gross" ? ", brutto vor Gebühren" : cmp.match === "gross-fees" ? ", nach Gebühren" : ""}).`,
      });
    } else {
      const mode = resolvedPnlMode(c);
      const flipped = side ? comparePnl(c, side === "long" ? "short" : "long") : null;
      const flipFits = flipped?.match != null && side != null;
      out.push({
        code: "pnl_mismatch",
        level: "warn",
        field: "pnl",
        text: `Screenshot zeigt ${signedNum(cmp.shot)} ${cur}, aus den Preisen ergibt sich ${signedNum(cmp.net)} ${cur} (Differenz ${signedNum(cmp.shot - cmp.net)}). ${
          mode === "shot" ? "Übernommen wird das Ergebnis laut Screenshot – es enthält, was nur die Börse kennt." : "Übernommen wird das aus den Preisen berechnete Ergebnis."
        }`,
        fix: mode === "shot" ? { kind: "pnlMode", value: "calc", label: "Aus Preisen berechnen" } : { kind: "pnlMode", value: "shot", label: "Ergebnis laut Screenshot" },
      });
      if (flipFits && side) out.push({ code: "side_flip", level: "warn", field: "side", text: `Mit der Richtung ${side === "long" ? "Short" : "Long"} würde das Ergebnis zu den Preisen passen.`, fix: { kind: "side", value: side === "long" ? "short" : "long", label: `${side === "long" ? "Short" : "Long"} übernehmen` } });
    }
  } else if (!side && c.entries.length && c.exits.length && c.pnl.value != null && c.pnl.value !== 0) {
    // direction unknown: the prices and the result together point at it – an offer, never applied silently
    const dir = (averagePrice(c.exits)! - averagePrice(c.entries)!) * c.pnl.value > 0 ? "long" : "short";
    out.push({ code: "side_hint", level: "info", field: "side", text: `Richtung nicht lesbar. Aus Preisen und Ergebnis würde ${dir === "long" ? "Long" : "Short"} folgen.`, fix: { kind: "side", value: dir, label: `${dir === "long" ? "Long" : "Short"} übernehmen` } });
  }

  // a stop seen on a running / finished position may have been moved
  if (stop != null && c.status !== "planned" && !c.stopOriginal)
    out.push({ code: "stop_not_original", level: "info", field: "stop", text: `Stop ${num(stop, 8)} ist der im Screenshot sichtbare Stand – ob es der ursprüngliche war, weißt nur du. Er kommt als Notiz in den Trade, nicht als Original-Stop (ohne ihn bleibt R leer).` });

  // price scale against the trader's own history of the market
  const key = pairKey(c.pair.value);
  const med = key && ref != null ? medianEntry(ctx.trades, key) : null;
  if (med != null && ref != null && (ref / med > 3 || ref / med < 1 / 3)) out.push({ code: "journal_scale", level: "warn", field: "entry", text: `Der Einstieg weicht stark von deinen bisherigen ${c.pair.value} Trades ab (typisch ${num(med, 8)}) – Dezimalstelle oder Zahlenformat prüfen.` });

  // duplicates
  const dup = findDuplicate(c, ctx.trades);
  if (dup) out.push({ code: "duplicate", level: "dup", text: `Wahrscheinlich schon vorhanden: ${dup.trade.pair} ${dup.trade.side === "long" ? "Long" : "Short"} vom ${dup.trade.date.replace("T", " ")} (Einstieg ${num(dup.priceDiff * 100, 3)} % daneben, ${Math.round(dup.minutes)} min Abstand).`, duplicate: dup });
  else {
    const why = unjudged(c);
    if (why && c.status !== "planned") out.push({ code: "dup_unjudged", level: "info", text: why });
  }
  return out;
}
