/**
 * Graded parts of the Einstiegs-Check (ours, decisions 5 + 10, 2026-10-08): conditions that add PARTIAL credit to a
 * side's score, strength and bias instead of passing / failing it. One uniform shape for the scorecard:
 *
 * | id | title (long / short) | items | grade |
 * |---|---|---|---|
 * | `traders` | Top-Trader long · Retail rot / short · Retail grün | `pos`, `acc`, `retail`, `zone` | met / 4 |
 * | `div` | Bullische / Bärische Divergenz | one per ladder rung (`30m` …) | best rung (regular 0.8, hidden 0.5, + 0.2 on both oscillators, provisional ½) |
 * | `sr` | Support + Platz / Widerstand + Platz | `near`, `room` | ½ near (≤ `nearAtr` ATR = 1, fading to 0 at 2×) + ½ room (R / `minR`, max 1) |
 *
 * points = weight × grade (0 without data); `bonus` (+1 strength for a valid entry, needs weight > 0): traders ≥
 * `bonusParts` met, div grade ≥ 0.8 (a regular divergence, closed), sr near AND room. Items carry their German value and
 * a lit flag (`met: null` = keine Daten). Pure.
 */
import { divCfgOf, srCfgOf, whaleCfgOf, type Side, type SignalCfg } from "./config";
import { ppText, zonePillText } from "./copy";
import { divGrade, type Divergence } from "./divergence";
import { STATE_RANK, type SignalState } from "./state";
import type { Level } from "./structure";
import { TRADERS_SIDE_TITLE, type TraderReading } from "./traders";
import type { TfCheck } from "./verdict";

export type PartId = "traders" | "div" | "sr";

export interface PartItem {
  /** `pos` · `acc` · `retail` · `zone` (traders), the rung's timeframe (div), `near` · `room` (sr) */
  id: string;
  /** German row label (`Top-Trader Positionen > 64 % Long`, `30m`, `Am Support / Demand`) */
  label: string;
  /** German value (`66,2 % Long`, `RSI regulär · WT versteckt`, `Demand-OB 82.450 · 0,4 ATR`, `keine Daten`) */
  value: string;
  /** the number behind it (long %, pp, grade, ATR distance, R multiple), `null` without */
  raw: number | null;
  /** lit / unlit; `null` = keine Daten */
  met: boolean | null;
}

export interface GradedPart {
  id: PartId;
  side: Side;
  /** German row title for the side */
  label: string;
  /** 0 … 1 */
  grade: number;
  /** score points added (weight × grade; 0 without data) */
  points: number;
  weight: number;
  /** the part holds fully (traders: ≥ `bonusParts` of 4 met; div: a closed regular divergence, grade ≥ 0.8; sr: near AND room) */
  ok: boolean;
  /** a valid entry gets +1 strength (`ok` with weight > 0) */
  bonus: boolean;
  /** `provisional` when the grade rests on a forming candle, else `confirmed` / `strong`; `none` without a hit */
  state: SignalState;
  /** at least one input had data (else excluded from score and bias, shown as "keine Daten") */
  data: boolean;
  items: PartItem[];
  /** German summary (`3 von 4 · +7,5 Punkte`) */
  detail: string;
  /** timeframe the part read (sr: the zone timeframe; div: the rung of the best hit) */
  tf?: string;
  /** traders: met parts (of 4) and the reading */
  met?: number;
  reading?: TraderReading | null;
  /** div: the active hits of the side, with their timeframe (chart) */
  hits?: Array<Divergence & { tf: string }>;
  /** sr: the level leaned on, the target level, the stop below / above it and the R multiple (`null` = no level) */
  levels?: { lean: Level | null; target: Level | null; stop: number | null; r: number | null };
}

const fmt0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n0 = (x: number): string => (Number.isFinite(x) ? fmt0.format(x).replace("-", "−") : "–");
const n1 = (x: number): string => (Number.isFinite(x) ? fmt1.format(x).replace("-", "−") : "–");
const pts = (x: number): string => `${x > 0 ? "+" : "±"}${n1(x)} Punkte`;
const NO_DATA = "keine Daten";

// ------------------------------------------------------------------ traders

/** Top-Trader-Kombi for one side (`null` when the condition is off). */
export function tradersPart(side: Side, reading: TraderReading | null | undefined, zoneRef: TfCheck | null | undefined, cfg: Pick<SignalCfg, "whale">): GradedPart | null {
  const w = whaleCfgOf(cfg);
  if (!w.on) return null;
  const long = side === "long";
  const r = reading ?? null;
  const lo = 100 - w.topPct;
  const sideWord = long ? "Long" : "Short";
  const share = (v: number | null): string => (v == null ? NO_DATA : `${n1(long ? v : 100 - v)} % ${sideWord}`);
  // strict on both sides (exact mirror): long > topPct % long, short > topPct % short (= long share < 100 − topPct)
  const top = (v: number | null): boolean | null => (v == null ? null : long ? v > w.topPct : v < lo);
  const z = zoneRef?.zone ?? null;
  const items: PartItem[] = [
    { id: "pos", label: `Top-Trader Positionen > ${n0(w.topPct)} % ${sideWord}`, value: share(r?.position ?? null), raw: r?.position ?? null, met: top(r?.position ?? null) },
    { id: "acc", label: `Top-Trader Konten > ${n0(w.topPct)} % ${sideWord}`, value: share(r?.account ?? null), raw: r?.account ?? null, met: top(r?.account ?? null) },
    {
      id: "retail",
      label: long ? `Retail rot · Long-Anteil fällt (${r?.period ?? w.retailPeriod})` : `Retail grün · Long-Anteil steigt (${r?.period ?? w.retailPeriod})`,
      value: r?.retailChg == null ? NO_DATA : ppText(r.retailChg),
      raw: r?.retailChg ?? null,
      met: r?.retailChg == null ? null : long ? r.retailChg < 0 : r.retailChg > 0,
    },
    {
      id: "zone",
      label: `Preis im ${long ? "Discount" : "Premium"}${zoneRef ? ` (${zoneRef.tf})` : ""}`,
      value: z ? zonePillText(z) : NO_DATA,
      raw: z && Number.isFinite(z.pos) ? z.pos : null,
      met: z ? (long ? z.zone === "discount" : z.zone === "premium") : null,
    },
  ];
  const met = items.filter((i) => i.met === true).length;
  const data = !!r && (r.position != null || r.account != null || r.retailChg != null);
  const grade = met / 4;
  const points = data ? w.weight * grade : 0;
  return {
    id: "traders",
    side,
    label: TRADERS_SIDE_TITLE[side],
    grade,
    points,
    weight: w.weight,
    ok: data && met >= w.bonusParts,
    bonus: data && w.weight > 0 && met >= w.bonusParts,
    state: data && met > 0 ? "confirmed" : "none",
    data,
    items,
    detail: data ? `${met} von 4${w.weight > 0 ? ` · ${pts(points)}` : " · zählt nicht"}` : NO_DATA,
    met,
    reading: r,
  };
}

// ------------------------------------------------------------------ divergences

const OSC_TEXT = { rsi: "RSI", wt: "WT" } as const;
const KIND_TEXT = { regular: "regulär", hidden: "versteckt" } as const;

/** `RSI regulär · WT versteckt` (+ ` · vorläufig` when every hit is provisional). */
export function divHitsText(hits: readonly Divergence[]): string {
  if (!hits.length) return "keine";
  const seen: string[] = [];
  for (const d of hits) {
    const s = `${OSC_TEXT[d.osc]} ${KIND_TEXT[d.kind]}`;
    if (!seen.includes(s)) seen.push(s);
  }
  return `${seen.join(" · ")}${hits.every((d) => d.state === "provisional") ? " · vorläufig" : ""}`;
}

const bestState = (hits: readonly Divergence[]): SignalState => hits.reduce<SignalState>((a, d) => (STATE_RANK[d.state] > STATE_RANK[a] ? d.state : a), "none");

/** Divergences of the ladder for one side (`null` when off). */
export function divPart(side: Side, checks: readonly (TfCheck | null)[], cfg: Pick<SignalCfg, "div" | "ladder">): GradedPart | null {
  const d = divCfgOf(cfg);
  if (!d.on) return null;
  const n = Math.max(checks.length, cfg.ladder.length);
  const items: PartItem[] = [];
  const hits: Array<Divergence & { tf: string }> = [];
  let grade = 0;
  let best: { tf: string; hits: Divergence[] } | null = null;
  let data = false;
  for (let i = 0; i < n; i++) {
    const c = checks[i] ?? null;
    const tf = c?.tf ?? cfg.ladder[i] ?? `#${i + 1}`;
    if (!c || !c.div) {
      items.push({ id: tf, label: tf, value: c ? NO_DATA : "Zu wenig Kerzen", raw: null, met: null });
      continue;
    }
    data = true;
    const h = side === "long" ? c.div.long : c.div.short;
    const g = divGrade(h);
    for (const x of h) hits.push({ ...x, tf });
    items.push({ id: tf, label: tf, value: divHitsText(h), raw: Math.round(g * 100) / 100, met: g > 0 });
    if (g > grade) {
      grade = g;
      best = { tf, hits: h };
    }
  }
  const points = data ? d.weight * grade : 0;
  return {
    id: "div",
    side,
    label: side === "long" ? "Bullische Divergenz" : "Bärische Divergenz",
    grade,
    points,
    weight: d.weight,
    ok: data && grade >= 0.8 - 1e-9,
    bonus: data && d.weight > 0 && grade >= 0.8 - 1e-9,
    state: best ? bestState(best.hits) : "none",
    data,
    items,
    detail: !data ? NO_DATA : best ? `${best.tf}: ${divHitsText(best.hits)}${d.weight > 0 ? ` · ${pts(points)}` : " · zählt nicht"}` : "keine Divergenz",
    tf: best?.tf,
    hits,
  };
}

// ------------------------------------------------------------------ support / resistance

/** Stop buffer beyond the level, in ATR. */
export const SR_STOP_ATR = 0.1;

/**
 * Support / resistance for one side on the zone timeframe (`null` when off). Long: the nearest support / demand below
 * the close (lean) and the nearest resistance above (target); R = (target − close) / (close − stop), stop = the level's
 * bottom − 0.1 ATR. Short mirrored. No target → room is free (R = ∞).
 */
export function srPart(side: Side, zoneRef: TfCheck | null | undefined, cfg: Pick<SignalCfg, "sr">): GradedPart | null {
  const sc = srCfgOf(cfg);
  if (!sc.on) return null;
  const long = side === "long";
  const s = zoneRef?.structure ?? null;
  const label = long ? "Support + Platz nach oben" : "Widerstand + Platz nach unten";
  const nearLabel = long ? "Am Support / Demand" : "Am Widerstand / Supply";
  const roomLabel = `Platz bis ${long ? "Widerstand" : "Support"} (≥ ${n1(sc.minR)} R)`;
  if (!s) {
    return {
      id: "sr",
      side,
      label,
      grade: 0,
      points: 0,
      weight: sc.weight,
      ok: false,
      bonus: false,
      state: "none",
      data: false,
      items: [
        { id: "near", label: nearLabel, value: NO_DATA, raw: null, met: null },
        { id: "room", label: roomLabel, value: NO_DATA, raw: null, met: null },
      ],
      detail: NO_DATA,
      tf: zoneRef?.tf,
      levels: { lean: null, target: null, stop: null, r: null },
    };
  }
  const unit = Number.isFinite(s.atr) && s.atr > 0 ? s.atr : Math.abs(s.close) * 0.002 || 1;
  const lean = long ? s.support : s.resistance;
  const target = long ? s.resistance : s.support;
  const near = !!lean && lean.distAtr <= sc.nearAtr;
  const nearScore = !lean ? 0 : near ? 1 : Math.max(0, 1 - (lean.distAtr - sc.nearAtr) / sc.nearAtr);
  const stop = lean ? (long ? lean.btm - SR_STOP_ATR * unit : lean.top + SR_STOP_ATR * unit) : null;
  const risk = stop == null ? null : Math.max(Math.abs(s.close - stop), SR_STOP_ATR * unit);
  const r = risk == null ? null : target ? target.dist / risk : Infinity;
  const room = r != null && r >= sc.minR;
  const roomScore = r == null ? 0 : Math.min(1, r / sc.minR);
  const grade = 0.5 * nearScore + 0.5 * roomScore;
  const points = sc.weight * grade;
  const leanText = !lean ? (long ? "kein Support darunter" : "kein Widerstand darüber") : lean.dist === 0 ? `im ${lean.label} ${n0(lean.btm)}–${n0(lean.top)}` : `${lean.label} ${n0(lean.price)} · ${n1(lean.distAtr)} ATR`;
  const roomText = r == null ? "–" : r === Infinity ? `frei (kein ${long ? "Widerstand" : "Support"})` : `${target!.label} ${n0(target!.price)} · ${n1(r)} R`;
  return {
    id: "sr",
    side,
    label,
    grade,
    points,
    weight: sc.weight,
    ok: near && room,
    bonus: sc.weight > 0 && near && room,
    state: grade > 0 ? "confirmed" : "none",
    data: true,
    items: [
      { id: "near", label: nearLabel, value: leanText, raw: lean ? Math.round(lean.distAtr * 100) / 100 : null, met: near },
      { id: "room", label: roomLabel, value: roomText, raw: r == null ? null : r === Infinity ? null : Math.round(r * 100) / 100, met: r == null ? false : room },
    ],
    detail: `${near ? "am Level" : lean ? "weg vom Level" : "kein Level"} · ${r == null ? "kein Stop" : r === Infinity ? "Platz frei" : `${n1(r)} R`}${sc.weight > 0 ? ` · ${pts(points)}` : " · zählt nicht"}`,
    tf: zoneRef?.tf,
    levels: { lean, target, stop, r },
  };
}

/** Reason line of a part (appended to the verdict's reasons, `ok` = the part holds fully). */
export function partReasonText(p: GradedPart): string {
  if (!p.data) return `${p.label} (${NO_DATA})`;
  if (p.id === "traders") return `${p.label} (${p.met ?? 0} von 4)`;
  if (p.id === "div") return p.tf ? `${p.label} (${p.tf})` : p.label;
  const r = p.levels?.r;
  return r == null ? p.label : `${p.label} (${r === Infinity ? "frei" : `${n1(r)} R`})`;
}

/** The part with `id` of a verdict (`undefined` when off). */
export function verdictPart(v: { parts?: readonly GradedPart[] }, id: PartId): GradedPart | undefined {
  return v.parts?.find((p) => p.id === id);
}
