/**
 * Pure view model of the "Einstiegs-Check" card (`SignalCard`) and the hero strip (`SignalStrip`): rung tiles,
 * meter positions, the "neuer Einstieg" detection and the status pill. No React, no market access – the card feeds
 * it the published `SignalCheckState` (≤ 1/s), so every helper here is cheap and deterministic (tested in
 * `tests/unit/views.overview.signal.test.tsx`).
 */
import { isLongKind, isStrongKind, kindText, periodsText, ppText, roleText, whaleCfgOf, WHALE_TITLE, type Side, type SignalCfg, type Signals, type TfCheck, type Verdict, type WtKind, type ZoneInfo } from "@/domain/signals";
import type { SignalCheckState } from "@/market";
import type { StatusTone } from "@/motion/StatusPill";

export interface RungEvent {
  kind: WtKind;
  barsAgo: number;
}

/** One ladder tile. */
export interface RungView {
  tf: string;
  /** "Basis" / "Bestätigung" / "stärker" */
  role: string;
  /** part of the confirmed ladder for this side (`i < tiers`) – the tile lights up */
  lit: boolean;
  /** `null` = too few bars on this rung */
  check: TfCheck | null;
  /** event shown: the direction-matching strongest one, otherwise the latest of any direction (muted) */
  event: RungEvent | null;
  /** the event points in the selected direction */
  match: boolean;
  /** Bottom/Top/Kauf/Verkauf (filled dot) vs the small zero-line crosses (outlined) */
  strong: boolean;
  /** `true` when the event's dot sits on a long kind */
  longKind: boolean;
  text: string;
  /** RSI near the extreme for this side */
  rsiNear: boolean;
}

/** Rung tiles for `side`, one per ladder entry (a `null` check keeps its timeframe from the config). */
export function rungViews(sig: Pick<Signals, "checks">, v: Pick<Verdict, "tiers">, side: Side, cfg: Pick<SignalCfg, "ladder" | "required">): RungView[] {
  return sig.checks.map((c, i) => {
    const tf = c?.tf ?? cfg.ladder[i] ?? "";
    const own = c ? (side === "long" ? c.wt.long : c.wt.short) : null;
    const event: RungEvent | null = own ?? (c && c.wt.kind ? { kind: c.wt.kind, barsAgo: c.wt.barsAgo ?? 0 } : null);
    const longKind = !!event && isLongKind(event.kind);
    return {
      tf,
      role: roleText(i, cfg.required),
      lit: i < v.tiers,
      check: c,
      event,
      match: !!event && longKind === (side === "long"),
      strong: !!event && isStrongKind(event.kind),
      longKind,
      text: kindText(event?.kind ?? null),
      rsiNear: !!c && (side === "long" ? c.rsiLong : c.rsiShort),
    };
  });
}

/** `value` on `[min, max]` as 0..100 (clamped; non-finite → the middle). */
export function meterPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !(max > min)) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** Position of `price` in the zone range, 0..1 (clamped; falls back to the engine's `pos`). */
export function zonePosition(price: number, zone: Pick<ZoneInfo, "hi" | "lo" | "pos">): number {
  const span = zone.hi - zone.lo;
  if (!(price > 0) || !(span > 0)) return Math.max(0, Math.min(1, zone.pos));
  return Math.max(0, Math.min(1, (price - zone.lo) / span));
}

/** Entry level of one side: its strength while valid, else 0. */
export const entryLevel = (v: Pick<Verdict, "valid" | "strength">): number => (v.valid ? v.strength : 0);

export interface EntryLevels {
  long: number;
  short: number;
  /** base-rung bar (unix s) the levels belong to: a new bar may re-announce an entry of the same strength */
  base: number;
}

export function entryLevels(sig: Pick<Signals, "long" | "short" | "checks">): EntryLevels {
  return { long: entryLevel(sig.long), short: entryLevel(sig.short), base: sig.checks[0]?.closeAt ?? 0 };
}

/**
 * "Neuer Einstieg": the side whose entry level rose against the previous evaluation (a valid entry appeared or got
 * stronger) – never on the first evaluation (`prev` null), so loading the page announces nothing. Long wins a tie.
 */
export function freshEntry(prev: EntryLevels | null, next: EntryLevels): Side | null {
  if (!prev) return null;
  if (next.long > prev.long) return "long";
  if (next.short > prev.short) return "short";
  return null;
}

export const STATUS_LABEL: Record<SignalCheckState["state"], string> = {
  loading: "Lädt",
  ok: "Live",
  stale: "Veraltet",
  offline: "Offline",
};
const STATUS_TONE: Record<SignalCheckState["state"], StatusTone> = { loading: "muted", ok: "live", stale: "warn", offline: "error" };

export function statusPill(state: SignalCheckState["state"]): { tone: StatusTone; label: string } {
  return { tone: STATUS_TONE[state], label: STATUS_LABEL[state] };
}

/** `30m → 45m → 1h → 4h` */
export const ladderText = (ladder: readonly string[]): string => ladder.join(" → ");

/** Ring / label colour of a verdict (journal semantics: green long, red short, grey while not valid). */
export const verdictColor = (v: Pick<Verdict, "valid" | "side">): string => (v.valid ? (v.side === "long" ? "#3ddc84" : "#ff4d4f") : "#9b9b9b");
export const verdictText = (v: Pick<Verdict, "valid" | "side">): string => (v.valid ? (v.side === "long" ? "text-win" : "text-loss") : "text-fg");

/** RSI meter bands: near (≤ rsiOs + rsiNear / ≥ rsiOb − rsiNear) and the extreme itself (≤ rsiOs / ≥ rsiOb). */
export function rsiBands(cfg: Pick<SignalCfg, "rsiOs" | "rsiOb" | "rsiNear">): { nearLo: number; lo: number; nearHi: number; hi: number } {
  return { nearLo: cfg.rsiOs + cfg.rsiNear, lo: cfg.rsiOs, nearHi: cfg.rsiOb - cfg.rsiNear, hi: cfg.rsiOb };
}

/** One period chip of the top-trader / retail row. */
export interface WhalePeriodView {
  period: string;
  /** trailing periods that fit the side */
  run: number;
  ok: boolean;
}

/** View model of the "Top-Trader kaufen · Retail rot" row (card) and line (strip). */
export interface WhaleRowView {
  /** the condition is switched on (otherwise the row is not shown) */
  on: boolean;
  title: string;
  /** `ok` = holds (lit), `open` = data but not (yet) held, `none` = no data ("keine Daten") */
  state: "ok" | "open" | "none";
  run: number;
  need: number;
  /** period of the shown readings */
  period: string | null;
  /** `+1,2 pp` / `−0,8 pp` over the last `need` periods */
  top: string;
  retail: string;
  /** the reading points the way the side needs (long: top ↑ / retail ↓) */
  topFits: boolean;
  retailFits: boolean;
  periods: WhalePeriodView[];
  /** score points it adds now */
  points: number;
  weight: number;
  /** configured periods without data */
  missing: string[];
  /** `3 Perioden · 30m` / `keine Daten` */
  runText: string;
}

/** Row view for `side` from a published evaluation (works without a reading: `state: "none"`). */
export function whaleView(sig: Pick<Signals, "whale" | "long" | "short">, side: Side, cfg: Pick<SignalCfg, "whale">): WhaleRowView {
  const w = whaleCfgOf(cfg);
  const v = sig[side].whale;
  const reading = sig.whale;
  const base = { on: w.on, title: WHALE_TITLE[side], need: w.minRun, weight: w.weight };
  if (!v || !reading) {
    return { ...base, state: "none", run: 0, period: null, top: "–", retail: "–", topFits: false, retailFits: false, periods: [], points: 0, missing: w.periods, runText: "keine Daten" };
  }
  const sign = side === "long" ? 1 : -1;
  const periods = reading.periods.map((p) => {
    const run = side === "long" ? p.runLong : p.runShort;
    return { period: p.period, run, ok: run >= w.minRun };
  });
  return {
    ...base,
    state: v.ok ? "ok" : "open",
    run: v.run,
    period: v.period,
    top: ppText(v.topChg),
    retail: ppText(v.retailChg),
    topFits: v.topChg * sign > 0,
    retailFits: v.retailChg * sign < 0,
    periods,
    points: v.points,
    missing: reading.missing,
    runText: `${periodsText(v.run)} · ${v.period}`,
  };
}
