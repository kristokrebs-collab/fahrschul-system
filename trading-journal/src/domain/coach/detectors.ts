/**
 * Behaviour detectors of the coach (P04) – rule based, deterministic, offline. Each detector reads the journal (entry
 * order, close instants, sizes, the trader's own tags and psych flags) and emits `BehaviorEvent`s with the evidence
 * trades (the triggering trade LAST), the triggering instant and a severity 1 Hinweis · 2 Warnung · 3 kritisch.
 *
 * Evidence first: an explicit mark by the trader (emotion, psych flag, mistake tag) always counts; derived signals need
 * a measurable reason (minutes after a loss, size against the trader's own median, stop moves, hold times). Signals
 * that are only "possible" carry severity 1 and say so in the note. No clinical language.
 */
import type { DayNotes, EnrichedTrade, Settings } from "../types";
import type { BehaviorEvent, BehaviorKey, BehaviorSeverity, DetectInput } from "./events";
import { leverageOverRule } from "../derive";
import { holdMs } from "../excursion";
import { disciplineLimits, type DisciplineLimits } from "../insights/discipline";
import { localDateKey } from "@/lib/dates";
import { r as fmtR, signed } from "@/lib/format";
import { accountOf, byEntry, closeMs, dec1, entryMs, fin, manualTags, median, minutesBetween, minutesLabel, psychFlags, sizeRatio } from "./shared";

/** Tuning of the detectors (exported for the explainers and the tests). */
export const DETECT = {
  /** a trade entered this long after a loss closed is a revenge candidate (the Auswertung's window) */
  revengeMin: 60,
  /** "hot" revenge: within this many minutes */
  revengeHotMin: 15,
  /** losses in a row (same day) before tilt */
  tiltLosses: 2,
  /** size against the trader's median that counts as "sized up" */
  sizeUp: 1.5,
  /** trades within `burstMin` minutes that count as a burst */
  burstN: 4,
  burstMin: 60,
  /** wins in a row before overconfidence is watched */
  winStreak: 3,
  /** early profit: share of the max favourable run that was kept, and the run it needs */
  earlyCapture: 0.35,
  earlyMfeR: 1.5,
  /** early profit without MFE: realised R below this share of the planned R:R */
  earlyRrShare: 0.4,
  /** loss aversion: loser hold ≥ this × the winners' median hold (n ≥ `holdMinN` each side) */
  lossHoldRatio: 2,
  holdMinN: 5,
  /** a loss beyond this many R without a stop history = "possibly moved" */
  bigLossR: -1.5,
  /** chase: entry worse than the planned price by this share of the stop distance */
  chaseShare: 0.25,
  /** impulsive: re-entry within this many minutes after a close */
  impulsiveGapMin: 5,
  /** setups are "used" when this share of the trades has one (else missing setups are not a signal) */
  setupUse: 0.5,
} as const;

export const BEHAVIOR_ORDER: readonly BehaviorKey[] = ["revenge", "tilt", "overtrading", "fomo", "stopMoved", "earlyProfit", "lossAversion", "overconfidence", "impulsive", "boredom", "ruleViolation"];

interface Ctx {
  /** every trade (open ones included), entry order */
  all: EnrichedTrade[];
  /** closed trades, close order */
  closedByClose: EnrichedTrade[];
  /** `closeMs` of `closedByClose` (ascending) */
  closeTimes: number[];
  settings: Settings;
  limits: DisciplineLimits;
  knownSetups: ReadonlySet<string>;
  /** the trader uses setups (≥ `DETECT.setupUse` of the trades carry one) */
  usesSetups: boolean;
  days?: DayNotes;
}

type Emit = (e: BehaviorEvent) => void;

const sev = (n: number): BehaviorSeverity => (n >= 3 ? 3 : n <= 1 ? 1 : 2);
const isLoss = (t: EnrichedTrade): boolean => t.result === "loss";
const isWin = (t: EnrichedTrade): boolean => t.result === "win";
const hasSetup = (t: EnrichedTrade, known: ReadonlySet<string>): boolean => (t.setups ?? []).some((id) => known.has(id));
const tagged = (t: EnrichedTrade, tag: string): boolean => manualTags(t).includes(tag);
const flagged = (t: EnrichedTrade, key: BehaviorKey): boolean => psychFlags(t).includes(key);

/** Number of closed trades that closed at or before `ms` (binary search over the close instants). */
function closedUntil(ctx: Ctx, ms: number): number {
  let lo = 0;
  let hi = ctx.closeTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.closeTimes[mid]! <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Closed trades the trader knew at `ms` (closed at or before it, `t` itself excluded), newest first, read lazily
 * while `take` returns true – O(log n + k) per entry instead of a scan of the whole journal.
 */
function walkBack(ctx: Ctx, ms: number, selfId: string, take: (c: EnrichedTrade) => boolean): void {
  for (let i = closedUntil(ctx, ms) - 1; i >= 0; i--) {
    const c = ctx.closedByClose[i]!;
    if (c.id === selfId) continue;
    if (!take(c)) return;
  }
}

/** The newest closed trade before `ms` (not `t` itself). */
function lastClosed(ctx: Ctx, ms: number, selfId: string): EnrichedTrade | undefined {
  let out: EnrichedTrade | undefined;
  walkBack(ctx, ms, selfId, (c) => {
    out = c;
    return false;
  });
  return out;
}

/* ------------------------------------------------------------------ revenge */

function revenge(ctx: Ctx, emit: Emit): void {
  const earlier: EnrichedTrade[] = [];
  for (const t of ctx.all) {
    const at = entryMs(t);
    const prev = lastClosed(ctx, at, t.id);
    const explicit = t.emotion === "Revenge" || flagged(t, "revenge") || tagged(t, "Revenge-Trade");
    const gap = prev ? (at - closeMs(prev)) / 60_000 : Infinity;
    const window = prev && isLoss(prev) && gap >= 0 && gap <= DETECT.revengeMin;
    if (window || explicit) {
      const ratio = sizeRatio(t, earlier);
      const up = ratio != null && ratio >= DETECT.sizeUp;
      let s = window ? 1 : 2;
      if (up || (window && explicit)) s++;
      if (window && gap <= DETECT.revengeHotMin && isLoss(t)) s++;
      const parts: string[] = [];
      if (window) parts.push(`${minutesLabel(Math.round(gap))} nach einem Verlust (${signed(prev!.pnl, 0)})`);
      if (up) parts.push(`Größe ${dec1(ratio!)}× üblich`);
      if (explicit) parts.push("als Revenge markiert");
      emit({ key: "revenge", tradeIds: window ? [prev!.id, t.id] : [t.id], at, severity: sev(s), note: parts.join(" · ") });
    }
    earlier.push(t);
  }
}

/* ------------------------------------------------------------------ tilt */

function tilt(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    const at = entryMs(t);
    const day = localDateKey(new Date(at));
    // losses in a row that closed today before this entry (a win resets, the day resets) and today's net so far
    const streak: EnrichedTrade[] = [];
    let open = true;
    let dayNet = 0;
    walkBack(ctx, at, t.id, (c) => {
      if (localDateKey(new Date(closeMs(c))) !== day) return false;
      if (accountOf(c) === accountOf(t)) dayNet += c.pnl ?? 0;
      if (open) {
        if (isLoss(c)) streak.unshift(c);
        else if (c.result === "win") open = false;
      }
      return true;
    });
    const explicit = flagged(t, "tilt");
    if (streak.length >= DETECT.tiltLosses || explicit) {
      const cap = ctx.settings.capital[accountOf(t)] ?? 0;
      const limit = cap > 0 ? ctx.limits.maxLossDayPct * cap : Infinity;
      let s = streak.length >= DETECT.tiltLosses ? (streak.length >= 3 ? 2 : 1) : 2;
      if (explicit && streak.length >= DETECT.tiltLosses) s = Math.max(s, 2);
      if (dayNet <= -limit) s = 3;
      else if (dayNet <= -0.5 * limit && s < 2) s = 2;
      const note = streak.length >= DETECT.tiltLosses ? `${streak.length} Verluste in Folge heute (${signed(dayNet, 0)})${dayNet <= -limit ? " · Tageslimit schon gerissen" : ""}` : "als Tilt markiert";
      emit({ key: "tilt", tradeIds: [...streak.map((c) => c.id), t.id], at, severity: sev(s), note });
    }
  }
}

/* ------------------------------------------------------------------ overtrading */

function overtrading(ctx: Ctx, emit: Emit): void {
  const perDay = new Map<string, EnrichedTrade[]>();
  for (const t of ctx.all) {
    const k = `${localDateKey(new Date(entryMs(t)))}|${accountOf(t)}`;
    const arr = perDay.get(k);
    if (arr) arr.push(t);
    else perDay.set(k, [t]);
  }
  const inDay = new Set<string>();
  for (const [k, ts] of perDay) {
    const acc = k.split("|")[1] as "makro" | "scalp";
    const limit = ctx.limits.maxTrades[acc];
    if (ts.length <= limit) continue;
    const trigger = ts[limit]!;
    const excess = ts.length - limit;
    const s = ts.length >= 2 * limit && excess >= 3 ? 3 : excess >= 2 ? 2 : 1;
    for (const t of ts) inDay.add(t.id);
    emit({ key: "overtrading", tradeIds: [...ts.filter((t) => t !== trigger).map((t) => t.id), trigger.id], at: entryMs(trigger), severity: sev(s), note: `${ts.length} Trades an einem Tag (${acc === "makro" ? "Makro" : "Scalp"}, Grenze ${limit})` });
  }
  // bursts: N trades within an hour (any account), outside an overtrading day
  let i = 0;
  while (i < ctx.all.length) {
    const start = entryMs(ctx.all[i]!);
    let j = i;
    while (j + 1 < ctx.all.length && entryMs(ctx.all[j + 1]!) - start <= DETECT.burstMin * 60_000) j++;
    const burst = ctx.all.slice(i, j + 1);
    if (burst.length >= DETECT.burstN && !burst.some((t) => inDay.has(t.id))) {
      const last = burst[burst.length - 1]!;
      emit({ key: "overtrading", tradeIds: burst.map((t) => t.id), at: entryMs(last), severity: 1, note: `${burst.length} Trades in ${minutesLabel(minutesBetween(start, entryMs(last)))}` });
      i = j + 1;
    } else i++;
  }
}

/* ------------------------------------------------------------------ fomo */

function fomo(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    const explicit = t.emotion === "FOMO" || flagged(t, "fomo") || tagged(t, "FOMO-Einstieg");
    let chase: number | null = null;
    if (fin(t.plannedEntry) && fin(t.entry) && fin(t.stop) && t.stop > 0 && t.entry > 0) {
      const dist = Math.abs(t.entry - t.stop);
      const worse = t.side === "short" ? t.plannedEntry - t.entry : t.entry - t.plannedEntry;
      if (dist > 0 && worse / dist >= DETECT.chaseShare) chase = worse / dist;
    }
    if (!explicit && chase == null) continue;
    const s = explicit ? (isLoss(t) && fin(t.r) && t.r < -1 ? 3 : 2) : 1;
    const parts: string[] = [];
    if (explicit) parts.push(t.emotion === "FOMO" ? "Gefühl FOMO" : "als FOMO markiert");
    if (chase != null) parts.push(`Einstieg ${dec1(chase)} R schlechter als geplant`);
    emit({ key: "fomo", tradeIds: [t.id], at: entryMs(t), severity: sev(s), note: parts.join(" · ") });
  }
}

/* ------------------------------------------------------------------ stop moved */

/** Moves of the stop away from the entry (risk widened) in a stop history; trailing towards profit is fine. */
export function stopWidenings(t: Pick<EnrichedTrade, "side" | "stopHistory">): { from: number; to: number; at: string }[] {
  const h = [...(t.stopHistory ?? [])].filter((x) => fin(x.price)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: { from: number; to: number; at: string }[] = [];
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1]!.price;
    const b = h[i]!.price;
    const eps = Math.abs(a) * 1e-9;
    if (t.side === "short" ? b > a + eps : b < a - eps) out.push({ from: a, to: b, at: h[i]!.at });
  }
  return out;
}

function stopMoved(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    const wid = stopWidenings(t);
    const explicit = tagged(t, "Stop verschoben");
    const hasHistory = (t.stopHistory ?? []).length > 1;
    const big = t.result === "loss" && fin(t.r) && t.r <= DETECT.bigLossR && !hasHistory && !explicit;
    if (!wid.length && !explicit && !big) continue;
    const exchange = (t.stopHistory ?? []).some((x) => x.source === "exchange");
    let s = wid.length || explicit ? 2 : 1;
    if ((wid.length || explicit) && isLoss(t) && fin(t.r) && t.r < -1.1) s = 3;
    const note = wid.length
      ? `Stop ${wid.length}× vom Einstieg weg verschoben${exchange ? " (laut Börse)" : ""}${fin(t.r) && isLoss(t) ? ` · ${fmtR(t.r)}` : ""}`
      : explicit
        ? "als „Stop verschoben“ markiert"
        : `Verlust ${fmtR(t.r)} – mehr als der Stop (verschoben oder Slippage?)`;
    emit({ key: "stopMoved", tradeIds: [t.id], at: entryMs(t), severity: sev(s), note });
  }
}

/* ------------------------------------------------------------------ early profit */

function earlyProfit(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    if (!isWin(t)) continue;
    const explicit = tagged(t, "Zu früh raus");
    let s = 0;
    let note = "";
    if (fin(t.r) && fin(t.mfeR) && t.mfeR > 0 && t.mfeR >= Math.max(DETECT.earlyMfeR, fin(t.rr) ? t.rr : 0) && t.r / t.mfeR < DETECT.earlyCapture) {
      s = 2;
      note = `${fmtR(t.r)} mitgenommen, ${fmtR(t.mfeR)} waren drin (${Math.round((t.r / t.mfeR) * 100)} %)`;
    } else if (fin(t.r) && fin(t.rr) && t.rr >= 1 && t.r < DETECT.earlyRrShare * t.rr && t.psych?.exitReason !== "Ziel erreicht" && t.psych?.exitReason !== "Trailing-Stop") {
      s = 1;
      note = `Raus bei ${fmtR(t.r)} statt geplanter ${fmtR(t.rr)}`;
    }
    if (explicit) {
      s = Math.max(s, 2);
      note = note ? `${note} · als „Zu früh raus“ markiert` : "als „Zu früh raus“ markiert";
    }
    if (s) emit({ key: "earlyProfit", tradeIds: [t.id], at: entryMs(t), severity: sev(s), note });
  }
}

/* ------------------------------------------------------------------ loss aversion */

function lossAversion(ctx: Ctx, emit: Emit): void {
  const held = ctx.closedByClose.map((t) => ({ t, ms: holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt }) })).filter((x) => x.ms != null) as { t: EnrichedTrade; ms: number }[];
  const wins = held.filter((x) => isWin(x.t)).map((x) => x.ms);
  const losses = held.filter((x) => isLoss(x.t));
  const winMed = wins.length >= DETECT.holdMinN && losses.length >= DETECT.holdMinN ? median(wins) : null;
  const lossMed = losses.length ? median(losses.map((x) => x.ms)) : null;
  const pattern = winMed != null && winMed > 0 && lossMed != null && lossMed >= DETECT.lossHoldRatio * winMed;
  const done = new Set<string>();
  if (pattern)
    for (const { t, ms } of losses)
      if (ms >= DETECT.lossHoldRatio * winMed!) {
        done.add(t.id);
        emit({ key: "lossAversion", tradeIds: [t.id], at: entryMs(t), severity: flagged(t, "lossAversion") ? 2 : 1, note: `Verlierer ${minutesLabel(Math.round(ms / 60_000))} gehalten – Gewinner im Median ${minutesLabel(Math.round(winMed! / 60_000))}` });
      }
  for (const t of ctx.all)
    if (!done.has(t.id) && flagged(t, "lossAversion")) emit({ key: "lossAversion", tradeIds: [t.id], at: entryMs(t), severity: 2, note: "als Verlustangst markiert" });
}

/* ------------------------------------------------------------------ overconfidence */

function overconfidence(ctx: Ctx, emit: Emit): void {
  const earlier: EnrichedTrade[] = [];
  for (const t of ctx.all) {
    const at = entryMs(t);
    const streak: EnrichedTrade[] = [];
    walkBack(ctx, at, t.id, (c) => {
      if (isWin(c)) streak.unshift(c);
      return !isLoss(c);
    });
    const wins = streak.length;
    const explicit = flagged(t, "overconfidence");
    if (wins >= DETECT.winStreak || explicit) {
      const ratio = sizeRatio(t, earlier);
      const up = ratio != null && ratio >= DETECT.sizeUp;
      const lev = leverageOverRule(t.leverage, accountOf(t));
      if (up || lev || explicit) {
        const s = (up || lev) && isLoss(t) ? 3 : 2;
        const parts: string[] = [];
        if (wins >= DETECT.winStreak) parts.push(`nach ${wins} Gewinnen in Folge`);
        if (up) parts.push(`Größe ${dec1(ratio!)}× üblich`);
        if (lev) parts.push(`Hebel ${dec1(t.leverage!)}× über der Regel`);
        if (explicit) parts.push("als Selbstüberschätzung markiert");
        emit({ key: "overconfidence", tradeIds: [...streak.slice(-5).map((c) => c.id), t.id], at, severity: sev(s), note: parts.join(" · ") });
      }
    }
    earlier.push(t);
  }
}

/* ------------------------------------------------------------------ impulsive · boredom */

function impulsiveAndBoredom(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    const at = entryMs(t);
    const noSetup = ctx.usesSetups && !hasSetup(t, ctx.knownSetups);
    const noReason = !(t.reason ?? "").trim();
    const lowConv = t.conviction != null && t.conviction <= 2;
    // boredom first (a low-conviction trade without a base is boredom, not "impulsive")
    const boredFlag = flagged(t, "boredom");
    const boredDerived = lowConv && noSetup;
    if (boredFlag || boredDerived) {
      emit({ key: "boredom", tradeIds: [t.id], at, severity: boredFlag ? 2 : 1, note: boredFlag ? "als Langeweile markiert" : `Überzeugung ${t.conviction}, keine Grundlage` });
      if (!flagged(t, "impulsive")) continue;
    }
    const impFlag = flagged(t, "impulsive");
    const prev = lastClosed(ctx, at, t.id);
    const gap = prev ? (at - closeMs(prev)) / 60_000 : Infinity;
    const quick = prev != null && !isLoss(prev) && gap >= 0 && gap <= DETECT.impulsiveGapMin && noSetup;
    const bare = noSetup && noReason && t.complete !== true;
    if (!impFlag && !quick && !bare) continue;
    const s = impFlag ? 2 : quick ? 2 : 1;
    const note = impFlag ? "als impulsiv markiert" : quick ? `${minutesLabel(Math.max(0, Math.round(gap)))} nach dem letzten Ausstieg, ohne Grundlage` : "ohne Grundlage und ohne Begründung";
    emit({ key: "impulsive", tradeIds: quick && prev ? [prev.id, t.id] : [t.id], at, severity: sev(s), note });
  }
}

/* ------------------------------------------------------------------ rule violations */

/** Trade-level rules a trade broke (German labels), from the discipline limits. */
export function brokenRules(t: EnrichedTrade, settings: Pick<Settings, "capital">, limits: DisciplineLimits): { label: string; weight: number }[] {
  const out: { label: string; weight: number }[] = [];
  if (!(fin(t.stop) && t.stop > 0)) out.push({ label: "kein Stop", weight: 2 });
  if (leverageOverRule(t.leverage, accountOf(t))) out.push({ label: "Hebel über der Regel", weight: 1 });
  if (t.followedPlan === false) out.push({ label: "gegen den Plan", weight: 1 });
  if (t.complete === false) out.push({ label: "Checkliste unvollständig", weight: 1 });
  const cap = settings.capital[accountOf(t)] ?? 0;
  if (t.result !== "open" && cap > 0 && fin(t.pnl) && t.pnl < -limits.maxLossTradePct * cap) out.push({ label: `Verlust über ${dec1(limits.maxLossTradePct * 100)} %`, weight: 3 });
  return out;
}

function ruleViolation(ctx: Ctx, emit: Emit): void {
  for (const t of ctx.all) {
    const broken = brokenRules(t, ctx.settings, ctx.limits);
    if (!broken.length) continue;
    const s = broken.some((b) => b.weight >= 3) ? 3 : broken.length >= 2 || broken.some((b) => b.weight >= 2) ? 2 : 1;
    emit({ key: "ruleViolation", tradeIds: [t.id], at: entryMs(t), severity: sev(s), note: broken.map((b) => b.label).join(" · ") });
  }
  // day loss limit per account: the closing trade that crossed it
  const net = new Map<string, number>();
  const crossed = new Set<string>();
  for (const t of ctx.closedByClose) {
    const acc = accountOf(t);
    const cap = ctx.settings.capital[acc] ?? 0;
    if (!(cap > 0) || !fin(t.pnl)) continue;
    const k = `${localDateKey(new Date(closeMs(t)))}|${acc}`;
    const v = (net.get(k) ?? 0) + t.pnl;
    net.set(k, v);
    if (!crossed.has(k) && v < -ctx.limits.maxLossDayPct * cap) {
      crossed.add(k);
      emit({ key: "ruleViolation", tradeIds: [t.id], at: entryMs(t), severity: 3, note: `Tagesverlust ${signed(v, 0)} über der Grenze von ${dec1(ctx.limits.maxLossDayPct * 100)} %` });
    }
  }
}

/* ------------------------------------------------------------------ run */

const DETECTORS: readonly ((ctx: Ctx, emit: Emit) => void)[] = [revenge, tilt, overtrading, fomo, stopMoved, earlyProfit, lossAversion, overconfidence, impulsiveAndBoredom, ruleViolation];

/** All behaviour events of the journal, oldest first (ties: `BEHAVIOR_ORDER`, then the triggering trade id). */
export function runDetectors(input: DetectInput): BehaviorEvent[] {
  const all = byEntry(input.trades.filter((t) => !!t && typeof t.id === "string"));
  if (!all.length) return [];
  const closedByClose = all.filter((t) => t.result !== "open").sort((a, b) => closeMs(a) - closeMs(b) || entryMs(a) - entryMs(b));
  const knownSetups = new Set(input.settings.setups.map((s) => s.id));
  const withSetup = all.filter((t) => hasSetup(t, knownSetups)).length;
  const ctx: Ctx = {
    all,
    closedByClose,
    closeTimes: closedByClose.map(closeMs),
    settings: input.settings,
    limits: disciplineLimits(input.settings as Settings & { discipline?: unknown }),
    knownSetups,
    usesSetups: withSetup >= DETECT.setupUse * all.length && withSetup > 0,
    days: input.days,
  };
  const out: BehaviorEvent[] = [];
  const emit: Emit = (e) => out.push(e);
  for (const d of DETECTORS) d(ctx, emit);
  const rank = new Map(BEHAVIOR_ORDER.map((k, i) => [k, i]));
  return out.sort((a, b) => a.at - b.at || rank.get(a.key)! - rank.get(b.key)! || (a.tradeIds[a.tradeIds.length - 1]! < b.tradeIds[b.tradeIds.length - 1]! ? -1 : 1));
}
