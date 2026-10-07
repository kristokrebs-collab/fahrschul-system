/**
 * Trigger engine – bundle `Ng` (21740–21770) plus the market-panel checks (Plan 4.9):
 * weekly confirmation, zone check, trigger distances. Stateless, strict comparisons.
 */
import type { MarketLevels } from "./types";
import { n0, n2, pct, signed } from "@/lib/format";
import { ED } from "./edition";

export type ScenarioKey = "bear" | "long" | "short" | "range";
export type ScenarioTone = "win" | "loss" | "mute" | "warn";

export interface Scenario {
  key: ScenarioKey;
  tone: ScenarioTone;
  title: string;
  detail: string;
}

/** Bundle `Ng`: 4-way classifier on the last CLOSED 4H close. Equality falls to "range". */
export function scenario(close4h: number | null | undefined, m: MarketLevels): Scenario | null {
  if (close4h == null) return null;
  const f = n0;
  if (close4h < m.invalidation)
    return { key: "bear", tone: "loss", title: "Volles Bär-Szenario", detail: `4H-Schluss unter ${f(m.invalidation)}.${ED.COPY.scenarioTargets.bear}` };
  if (close4h > m.longTrigger)
    return {
      key: "long",
      tone: "win",
      title: "Long-Trigger aktiv",
      detail: `4H-Schluss über ${f(m.longTrigger)}.${ED.COPY.scenarioTargets.long} Invalidierung unter ${f(m.longStop)}.`,
    };
  if (close4h < m.shortTrigger)
    return {
      key: "short",
      tone: "loss",
      title: "Short-Trigger aktiv",
      detail: `4H-Schluss unter ${f(m.shortTrigger)}.${ED.COPY.scenarioTargets.short} Stop über ${f(m.longStop)}.`,
    };
  return { key: "range", tone: "mute", title: "Range, kein Trigger", detail: `4H-Schluss zwischen ${f(m.shortTrigger)} und ${f(m.longTrigger)}. Abwarten.` };
}

export interface TriggerInput {
  /** last price (aggTrade), never the mark price */
  price?: number | null;
  /** last CLOSED 4H close */
  close4h?: number | null;
  /** running (unclosed) 4H candle close – only for the live preview line */
  close4hLive?: number | null;
  /** last CLOSED weekly close */
  closeW?: number | null;
  /** weekly RSI (14, Wilder) */
  rsiW?: number | null;
  levels: MarketLevels;
}

export interface CheckRow {
  label: string;
  value: string;
  ok: boolean | null;
}

export interface TriggerState {
  scenario: Scenario | null;
  /** "würde … auslösen" preview from the running 4H candle; null when equal to the closed scenario */
  livePreview: Scenario | null;
  /** "Bärenmarkt-Ende bestätigt?" block */
  weekly: {
    show: boolean;
    weeklyOk: boolean | null;
    rsiOk: boolean | null;
    /** 0–100, `min(100, rsiW / rsiWeekly · 100)` */
    rsiBar: number;
    rows: [CheckRow, CheckRow];
  };
  zone: {
    inZone: boolean;
    /** "Preis liegt in der Makro-Long-Zone …" or null */
    warning: string | null;
  };
  distance: {
    /** (longTrigger − price) / price */
    toLong: number | null;
    /** (price − shortTrigger) / price */
    toShort: number | null;
    /** "Long-Trigger in +0,42 %" */
    longLabel: string | null;
    shortLabel: string | null;
    /** < 0,3 % */
    longInReach: boolean;
    shortInReach: boolean;
    /** whether the long trigger is already above (true) or below the price */
    longAbove: boolean | null;
  };
  /** "Long-Invalidierung": price fell back under `longStop` while the long scenario is active */
  longInvalidated: boolean;
}

export const TRIGGER_REACH_THRESHOLD = 0.003;
export const LONG_IN_REACH_LABEL = "Long-Trigger in Reichweite";
export const SHORT_IN_REACH_LABEL = "Short-Trigger in Reichweite";
export const LONG_INVALIDATION_LABEL = "Long-Invalidierung";
export const TRIGGER_FOOTER = "Letzter geschlossener 4H-Schluss · ";
export const SCENARIO_TOAST_TITLE = (s: Scenario): string => `Neues Szenario: ${s.title}`;
export const SCENARIO_TOAST_VALUE = (close4h: number): string => `4H ${n0(close4h)}`;
export const SCENARIO_TOAST_MS = 5200;

export function zoneWarning(price: number | null | undefined, m: MarketLevels): string | null {
  if (price == null || !(price >= m.zoneLow && price <= m.zoneHigh)) return null;
  return `Preis liegt in der Makro-Long-Zone ${n0(m.zoneLow)}–${n0(m.zoneHigh)}. Falling-Knife-Filter prüfen, bevor du kaufst.`;
}

/** Live-preview line under the scenario box. */
export function livePreviewLabel(preview: Scenario, mmss: string): string {
  return `Aktuelle 4H-Kerze: würde ${preview.title} auslösen, schließt in ${mmss}`;
}

/** mm:ss countdown from a remaining duration in ms. */
export function countdownLabel(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

export function evaluateTrigger(input: TriggerInput): TriggerState {
  const m = input.levels;
  const price = input.price ?? null;
  const close4h = input.close4h ?? null;
  const closeW = input.closeW ?? null;
  const rsiW = input.rsiW ?? null;

  const sc = scenario(close4h, m);
  const live = input.close4hLive == null ? null : scenario(input.close4hLive, m);
  const livePreview = live && (!sc || live.key !== sc.key) ? live : null;

  const weeklyOk = closeW != null ? closeW > m.lowerHigh : null;
  const rsiOk = rsiW != null ? rsiW > m.rsiWeekly : null;
  const rsiBar = rsiW != null && m.rsiWeekly > 0 ? Math.min(100, (rsiW / m.rsiWeekly) * 100) : 0;

  const inZone = price != null && price >= m.zoneLow && price <= m.zoneHigh;

  const toLong = price != null && price > 0 ? (m.longTrigger - price) / price : null;
  const toShort = price != null && price > 0 ? (price - m.shortTrigger) / price : null;

  return {
    scenario: sc,
    livePreview,
    weekly: {
      show: rsiW != null || closeW != null,
      weeklyOk,
      rsiOk,
      rsiBar,
      rows: [
        { label: `Weekly Close über ${n0(m.lowerHigh)}`, value: n0(closeW), ok: weeklyOk },
        { label: `Weekly RSI über ${n2(m.rsiWeekly)}`, value: rsiW == null ? "–" : signed(rsiW, 1).replace(/^\+/, ""), ok: rsiOk },
      ],
    },
    zone: { inZone, warning: zoneWarning(price, m) },
    distance: {
      toLong,
      toShort,
      longLabel: toLong == null ? null : `Long-Trigger in ${pct(toLong)}`,
      shortLabel: toShort == null ? null : `Short-Trigger in ${pct(toShort)}`,
      longInReach: toLong != null && toLong >= 0 && toLong < TRIGGER_REACH_THRESHOLD,
      shortInReach: toShort != null && toShort >= 0 && toShort < TRIGGER_REACH_THRESHOLD,
      longAbove: price == null ? null : m.longTrigger > price,
    },
    longInvalidated: sc?.key === "long" && price != null && price < m.longStop,
  };
}

/** Glyph for a check row: "·" null, "✓" true, "✕" false. */
export function checkGlyph(ok: boolean | null): "·" | "✓" | "✕" {
  return ok == null ? "·" : ok ? "✓" : "✕";
}

export const Ng = scenario;
