/**
 * Falling-Knife-Filter (ours, decision 11, 2026-10-08): the safety check for macro longs ("kein fallendes Messer") —
 * the Einstiegs-Check is the entry trigger. Every point runs LIVE from the same evaluation as the Einstiegs-Check
 * (single source of truth: the same checks, divergences, structure and Top-Trader part), so the two never contradict.
 * The former manual point "Preis in Support-/Liquiditätszone" is gone. Short mirrored (`side = "short"`).
 *
 * | id | long | short | where |
 * |---|---|---|---|
 * | `structure` | first higher low (internal structure, unbroken) OR a bullish BOS / CHoCH within `KNIFE_BREAK_MAX_AGE` bars | first lower high OR a bearish break | 1h, 4h (`KNIFE_TFS`; a timeframe outside ladder + zone = no data) |
 * | `divergence` | an active REGULAR bullish RSI divergence on a closed candle (hidden = continuation, not a reversal; WaveTrend hits listed only) OR a falling RSI trendline broken on a close | bearish / rising line broken downward | every ladder rung |
 * | `whale` | top traders long-heavy (positions OR accounts > `topPct`) AND the Whale–Retail-Delta red (negative or falling) — the Top-Trader-Kombi's own items (5-min data) | short-heavy AND the delta green (positive or rising) | live reading |
 *
 * `met: null` = keine Daten (switched off, too few bars, no Binance top-trader data). Pure.
 */
import { divCfgOf, whaleCfgOf, type Side, type SignalCfg } from "./config";
import type { Divergence } from "./divergence";
import { tradersPart, type GradedPart } from "./parts";
import { lastInternalPivot, type Structure } from "./structure";
import type { Signals, TfCheck } from "./verdict";

export type KnifeId = "structure" | "divergence" | "whale";

export interface KnifeItem {
  id: KnifeId;
  /** German row label for the side */
  label: string;
  /** `null` = keine Daten */
  met: boolean | null;
  /** German detail (`1h: erstes Higher Low 81.240 · vor 6 Kerzen`, `4h: RSI regulär · bestätigt`, `3 von 4 · Positionen 66,2 % Long …`) */
  detail: string;
  /** timeframes that hold the point (structure / divergence) */
  tfs: string[];
}

export interface KnifeFilter {
  side: Side;
  items: KnifeItem[];
  /** points met (of 3) */
  n: number;
  total: number;
  /** all three met */
  all: boolean;
  /** at least one point has data */
  data: boolean;
  /** German summary (`2 von 3 erfüllt`) */
  label: string;
}

/** Timeframes of the structure point. */
export const KNIFE_TFS: readonly string[] = ["1h", "4h"];
/** A break older than this many bars of its timeframe no longer counts as "BOS" for the filter. */
export const KNIFE_BREAK_MAX_AGE = 20;
export const KNIFE_TITLE = "Falling-Knife-Filter";
/** One-line explanation (dialog intro): filter vs entry check, shared data. */
export const KNIFE_INFO =
  "Sicherheits-Check für Makro-Longs („kein fallendes Messer“). Der Einstiegs-Check ist der Auslöser, dieser Filter die Absicherung – beide lesen dieselben Live-Daten (Struktur, Divergenzen, Top-Trader), deshalb widersprechen sie sich nie.";

const LABEL: Readonly<Record<KnifeId, Readonly<Record<Side, string>>>> = {
  structure: { long: "Erstes Higher Low oder BOS auf 1H/4H", short: "Erstes Lower High oder BOS auf 1H/4H" },
  divergence: { long: "RSI bullische Divergenz oder Trendlinienbruch", short: "RSI bärische Divergenz oder Trendlinienbruch" },
  whale: { long: "Top-Trader long · Whale–Retail-Delta rot", short: "Top-Trader short · Whale–Retail-Delta grün" },
};

const fmt0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const price = (x: number): string => (Number.isFinite(x) ? fmt0.format(x) : "–");
const ago = (bars: number): string => (bars <= 0 ? "jetzt" : bars === 1 ? "vor 1 Kerze" : `vor ${bars} Kerzen`);
const NO_DATA = "keine Daten";

/** The check of a timeframe (ladder or zone), `null` when not evaluated. */
function checkOf(sig: Pick<Signals, "checks" | "zone">, tf: string): TfCheck | null {
  return sig.checks.find((c) => c?.tf === tf) ?? (sig.zone?.tf === tf ? sig.zone : null);
}

/** Structure point of one timeframe: `{ met, text }`, `null` without structure data. */
export function knifeStructure(s: Structure, side: Side): { met: boolean; text: string } {
  const long = side === "long";
  const piv = lastInternalPivot(s, !long);
  const firstOk = !!piv && piv.first && !piv.pivot.broken;
  const dir = long ? 1 : -1;
  let brk: Structure["breaks"][number] | null = null;
  for (let i = s.breaks.length - 1; i >= 0; i--) {
    const b = s.breaks[i]!;
    if (b.dir === dir) {
      brk = b;
      break;
    }
  }
  const brkAge = brk ? s.last - brk.index : Infinity;
  const brkOk = !!brk && brkAge <= KNIFE_BREAK_MAX_AGE;
  // the newest break overall must not be against the side (a later opposite break cancels it)
  const newest = s.breaks[s.breaks.length - 1];
  const brkValid = brkOk && newest === brk;
  if (firstOk) return { met: true, text: `${long ? "erstes Higher Low" : "erstes Lower High"} ${price(piv!.pivot.price)} · ${ago(s.last - piv!.pivot.index)}` };
  if (brkValid) return { met: true, text: `${brk!.kind} ${long ? "↑ über" : "↓ unter"} ${price(brk!.level)} · ${ago(brkAge)}` };
  const last = piv ? `letztes ${long ? "Tief" : "Hoch"} ${piv.pivot.label}` : `noch kein ${long ? "Tief" : "Hoch"}`;
  return { met: false, text: `${last}, kein ${long ? "bullischer" : "bärischer"} Bruch` };
}

const OSC = { rsi: "RSI", wt: "WT" } as const;
const KIND = { regular: "regulär", hidden: "versteckt" } as const;

/** The falling-knife filter of an evaluation for `side` (default long). */
export function knifeFilter(sig: Pick<Signals, "checks" | "zone" | "long" | "short" | "traders">, cfg: SignalCfg, side: Side = "long"): KnifeFilter {
  const long = side === "long";

  // ---- structure on 1h / 4h
  const sTfs: string[] = [];
  const sTexts: string[] = [];
  let sData = false;
  for (const tf of KNIFE_TFS) {
    const c = checkOf(sig, tf);
    // closed bars decide (a break on the running candle can still repaint); the live structure is only a preview
    const s = c?.structureClosed ?? c?.structure;
    if (!s) continue;
    sData = true;
    const r = knifeStructure(s, side);
    if (r.met) sTfs.push(tf);
    const live = !r.met && c?.structureClosed && c.structure ? knifeStructure(c.structure, side) : null;
    sTexts.push(`${tf}: ${live?.met ? `${live.text} (vorläufig)` : r.text}`);
  }
  const structure: KnifeItem = { id: "structure", label: LABEL.structure[side], met: sData ? sTfs.length > 0 : null, detail: sData ? sTexts.join(" · ") : NO_DATA, tfs: sTfs };

  // ---- RSI divergence (regular, closed) or an RSI trendline break (closed) on the ladder rungs
  const dOn = divCfgOf(cfg).on;
  const dTfs: string[] = [];
  const dTexts: string[] = [];
  let dData = false;
  let provisional = false;
  for (const c of sig.checks) {
    if (!c?.div) continue;
    dData = true;
    const hits: Divergence[] = long ? c.div.long : c.div.short;
    const tl = (long ? c.div.trend?.long : c.div.trend?.short) ?? null;
    const rsiReg = hits.filter((d) => d.osc === "rsi" && d.kind === "regular");
    const closed = rsiReg.some((d) => d.state !== "provisional") || (!!tl?.active && tl.state !== "provisional");
    if (closed) dTfs.push(c.tf);
    else if (rsiReg.length || tl?.active) provisional = true;
    const seen = [...new Set(hits.map((d) => `${OSC[d.osc]} ${KIND[d.kind]}${d.state === "provisional" ? " (vorläufig)" : ""}`))];
    if (tl?.active) seen.push(`Trendlinie gebrochen${tl.state === "provisional" ? " (vorläufig)" : ""}`);
    if (seen.length) dTexts.push(`${c.tf}: ${seen.join(", ")}`);
  }
  const dMet = dOn && dData ? dTfs.length > 0 : null;
  const divergence: KnifeItem = {
    id: "divergence",
    label: LABEL.divergence[side],
    met: dMet,
    detail: dMet === null ? NO_DATA : dTexts.length ? dTexts.join(" · ") : provisional ? "nur vorläufig" : "keine",
    tfs: dTfs,
  };

  // ---- whale vs retail: the Top-Trader-Kombi's items (same part as the Einstiegs-Check)
  const v = long ? sig.long : sig.short;
  const part: GradedPart | null = v.parts?.find((p) => p.id === "traders") ?? (whaleCfgOf(cfg).on ? tradersPart(side, sig.traders ?? null, sig.zone ?? sig.checks[0] ?? null, cfg) : null);
  let whale: KnifeItem;
  if (!part || !part.data) whale = { id: "whale", label: LABEL.whale[side], met: null, detail: NO_DATA, tfs: [] };
  else {
    const item = (id: string) => part.items.find((i) => i.id === id);
    const top = item("pos")?.met === true || item("acc")?.met === true;
    const retail = item("retail")?.met === true;
    const vals = part.items.filter((i) => i.id !== "zone").map((i) => `${i.id === "pos" ? "Positionen" : i.id === "acc" ? "Konten" : "Delta"} ${i.value}`);
    whale = { id: "whale", label: LABEL.whale[side], met: top && retail, detail: `${part.met ?? 0} von 4 · ${vals.join(" · ")}`, tfs: [] };
  }

  const items = [structure, divergence, whale];
  const n = items.filter((i) => i.met === true).length;
  return { side, items, n, total: items.length, all: n === items.length, data: items.some((i) => i.met !== null), label: `${n} von ${items.length} erfüllt` };
}
