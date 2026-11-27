/**
 * Review of ONE trade (P04, shown by `TradeCoachPanel` in the trade detail): plan against execution, R against the
 * plan, MAE / MFE, the rules it met or broke, the entry-check and Box-zu-Box context, the behaviours it triggered and
 * how similar trades of the trader ended. Every line comes from a field the trade or the journal carries; a missing
 * field gives no line (never a guess). Pure.
 */
import type { EnrichedTrade, Settings } from "../types";
import { aggregate } from "../agg";
import { boxGradeOf } from "../boxes/snapshot";
import { captureRatio, holdLabel, holdMs } from "../excursion";
import { disciplineLimits } from "../insights/discipline";
import { snapOf } from "../insights/signal";
import { sessionOf, SESSIONS } from "../insights/time";
import { tradeTime } from "@/lib/dates";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { BEHAVIOR_LABEL, type BehaviorEvent } from "./events";
import { brokenRules, stopWidenings } from "./detectors";
import { dec1, fin } from "./shared";

export type ReviewTone = "win" | "loss" | "warn" | "fg" | "mute";
export type ReviewSection = "plan" | "excursion" | "rules" | "context" | "behavior";

export interface ReviewLine {
  section: ReviewSection;
  label: string;
  value: string;
  tone: ReviewTone;
  /** one explaining sentence (optional) */
  text?: string;
}

export interface SimilarTrades {
  /** how they were matched ("Gleiche Grundlage · Long · London") */
  label: string;
  n: number;
  winRate: number | null;
  avgR: number | null;
  net: number;
  /** ids, newest first (≤ 5) */
  ids: string[];
}

export interface TradeReview {
  id: string;
  lines: ReviewLine[];
  /** behaviour events this trade triggered */
  behaviors: BehaviorEvent[];
  similar: SimilarTrades | null;
  /** execution grade from the lines (A best … D) – `null` while the trade is open */
  grade: "A" | "B" | "C" | "D" | null;
  /** one-sentence verdict */
  verdict: { tone: ReviewTone; text: string };
}

export interface ReviewInput {
  trade: EnrichedTrade;
  /** all enriched trades of the journal (similar trades) */
  all: readonly EnrichedTrade[];
  settings: Settings;
  events: readonly BehaviorEvent[];
  currency: string;
}

const SIMILAR_MIN = 3;

function similarTrades(t: EnrichedTrade, all: readonly EnrichedTrade[], settings: Settings): SimilarTrades | null {
  const known = new Set(settings.setups.map((s) => s.id));
  const setup = (t.setups ?? []).find((id) => known.has(id));
  const setupName = setup ? settings.setups.find((s) => s.id === setup)?.name : null;
  const sess = sessionOf(tradeTime(t));
  const others = all.filter((o) => o.id !== t.id && o.result !== "open");
  const side = (o: EnrichedTrade) => (o.side === "short" ? "short" : "long") === (t.side === "short" ? "short" : "long");
  const tiers: { label: string; match: (o: EnrichedTrade) => boolean }[] = [];
  const sideLabel = t.side === "short" ? "Short" : "Long";
  const sessLabel = SESSIONS.find((s) => s.key === sess)?.label ?? sess;
  if (setup) {
    tiers.push({ label: `${setupName} · ${sideLabel} · ${sessLabel}`, match: (o) => (o.setups ?? []).includes(setup) && side(o) && sessionOf(tradeTime(o)) === sess });
    tiers.push({ label: `${setupName} · ${sideLabel}`, match: (o) => (o.setups ?? []).includes(setup) && side(o) });
    tiers.push({ label: `${setupName}`, match: (o) => (o.setups ?? []).includes(setup) });
  }
  if (t.pair) tiers.push({ label: `${t.pair} · ${sideLabel}`, match: (o) => o.pair === t.pair && side(o) });
  for (const tier of tiers) {
    const ts = others.filter(tier.match);
    if (ts.length < SIMILAR_MIN) continue;
    const g = aggregate(ts);
    const ids = [...ts].sort((a, b) => +tradeTime(b) - +tradeTime(a)).slice(0, 5).map((o) => o.id);
    return { label: tier.label, n: g.n, winRate: g.winRate, avgR: g.avgR, net: g.net, ids };
  }
  return null;
}

/** The review of one trade. */
export function tradeReview(input: ReviewInput): TradeReview {
  const { trade: t, settings, currency: cur } = input;
  const lines: ReviewLine[] = [];
  const open = t.result === "open";
  let good = 0;
  let bad = 0;
  const add = (l: ReviewLine) => {
    lines.push(l);
    if (l.tone === "win") good++;
    else if (l.tone === "loss") bad += 2;
    else if (l.tone === "warn") bad++;
  };

  // plan vs execution
  if (fin(t.plannedEntry) && fin(t.entry) && fin(t.stop) && t.entry !== t.stop) {
    const dist = Math.abs(t.entry - t.stop);
    const worse = (t.side === "short" ? t.plannedEntry - t.entry : t.entry - t.plannedEntry) / dist;
    add({ section: "plan", label: "Einstieg vs. Plan", value: worse > 0.01 ? `${dec1(worse)} R schlechter` : worse < -0.01 ? `${dec1(-worse)} R besser` : "wie geplant", tone: worse >= 0.25 ? "loss" : worse > 0.05 ? "warn" : "win" });
  }
  if (!open && fin(t.r) && fin(t.rr) && t.rr > 0) {
    const share = t.r / t.rr;
    const tone: ReviewTone = t.r < 0 ? (t.r < -1.1 ? "loss" : "fg") : share >= 0.8 ? "win" : share >= 0.4 ? "fg" : "warn";
    add({ section: "plan", label: "R vs. Plan", value: `${fmtR(t.r)} von ${fmtR(t.rr)}`, tone, text: t.r < 0 ? (t.r < -1.1 ? "Verlust größer als der geplante Stop." : "Verlust im Rahmen des Stops.") : share >= 0.8 ? "Ziel (fast) erreicht." : `${Math.round(share * 100)} % des geplanten R:R mitgenommen.` });
  } else if (!open && fin(t.r)) add({ section: "plan", label: "Ergebnis", value: fmtR(t.r), tone: t.r > 0 ? "win" : t.r < 0 ? "fg" : "mute" });
  if (t.followedPlan != null) add({ section: "plan", label: "Plan befolgt", value: t.followedPlan ? "Ja" : "Nein", tone: t.followedPlan ? "win" : "loss" });
  const exitReason = t.psych?.exitReason?.trim();
  if (exitReason) add({ section: "plan", label: "Ausstieg", value: exitReason, tone: "fg" });
  const hold = holdMs({ date: t.date, exitDate: t.exitDate, createdAt: t.createdAt });
  if (hold != null) add({ section: "plan", label: "Haltedauer", value: holdLabel(hold), tone: "fg" });

  // excursion
  if (fin(t.maeR)) add({ section: "excursion", label: "MAE", value: `${dec1(t.maeR)} R gegen dich`, tone: t.maeR >= 0.9 ? "warn" : "fg", text: t.maeR >= 0.9 ? "Fast am Stop – der Einstieg kam früh." : undefined });
  if (fin(t.mfeR)) add({ section: "excursion", label: "MFE", value: `${dec1(t.mfeR)} R für dich`, tone: "fg" });
  if (!open && fin(t.entry) && fin(t.mfe)) {
    const cap = captureRatio(t.side, t.entry, t.exit, t.mfe);
    if (cap != null) add({ section: "excursion", label: "Mitgenommen", value: pct0(Math.max(0, Math.min(1, cap))), tone: cap >= 0.6 ? "win" : cap >= 0.3 ? "fg" : "warn", text: cap < 0.3 && t.result === "win" ? "Großteil des Laufs liegen gelassen." : undefined });
  }

  // rules
  const broken = brokenRules(t, settings, disciplineLimits(settings as Settings & { discipline?: unknown }));
  if (broken.length) for (const b of broken) add({ section: "rules", label: "Regel", value: b.label, tone: b.weight >= 2 ? "loss" : "warn" });
  else add({ section: "rules", label: "Regeln", value: "alle eingehalten", tone: "win" });
  const wid = stopWidenings(t);
  if (wid.length) add({ section: "rules", label: "Stop", value: `${wid.length}× vom Einstieg weg`, tone: "loss" });
  if (t.complete === true) add({ section: "rules", label: "Checkliste", value: "komplett", tone: "win" });

  // context
  const snap = snapOf(t);
  if (snap) {
    add({ section: "context", label: "Einstiegs-Check", value: `${snap.valid ? "gültig" : "nicht gültig"} · Stärke ${snap.strength}/4`, tone: snap.valid ? (snap.strength >= 3 ? "win" : "fg") : "warn" });
    if (snap.lage?.state && snap.lage.state !== "none") add({ section: "context", label: "Lage", value: snap.lage.state === "green" ? "grün" : snap.lage.state === "amber" ? "gelb" : "rot", tone: snap.lage.state === "green" ? "win" : snap.lage.state === "red" ? "warn" : "fg" });
  }
  const grade = boxGradeOf(t);
  if (grade) add({ section: "context", label: "Box-Note", value: grade, tone: grade === "A+" || grade === "A" ? "win" : grade === "B" ? "fg" : "warn" });
  if (fin(t.atrPct)) add({ section: "context", label: "Volatilität", value: `ATR ${dec1(t.atrPct)} %`, tone: "mute" });

  // behaviours of this trade (as the trigger)
  const behaviors = input.events.filter((e) => e.tradeIds[e.tradeIds.length - 1] === t.id);
  for (const e of behaviors) add({ section: "behavior", label: BEHAVIOR_LABEL[e.key], value: e.note ?? "", tone: e.severity >= 2 ? "loss" : "warn" });

  const similar = similarTrades(t, input.all, settings);
  const score = good - bad;
  const gradeOut: TradeReview["grade"] = open ? null : score >= 3 && bad === 0 ? "A" : score >= 1 ? "B" : score >= -2 ? "C" : "D";

  let verdict: TradeReview["verdict"];
  if (open) verdict = { tone: "mute", text: "Der Trade läuft noch – die Auswertung folgt nach dem Ausstieg." };
  else if (behaviors.some((e) => e.severity >= 2)) verdict = { tone: "loss", text: `Ausführung prüfen: ${behaviors.filter((e) => e.severity >= 2).map((e) => BEHAVIOR_LABEL[e.key]).join(", ")}.` };
  else if (broken.length) verdict = { tone: "warn", text: `Regel gebrochen: ${broken.map((b) => b.label).join(", ")}.` };
  else if (t.result === "loss") verdict = { tone: "fg", text: "Sauberer Verlust – Regeln eingehalten. Das ist Trading, kein Fehler." };
  else if (t.result === "win") verdict = { tone: "win", text: `Sauberer Gewinn${fin(t.r) ? ` (${fmtR(t.r)})` : ` (${signed(t.pnl, 0)} ${cur})`} – so wiederholen.` };
  else verdict = { tone: "mute", text: "Break-even." };

  return { id: t.id, lines, behaviors, similar, grade: gradeOut, verdict };
}
