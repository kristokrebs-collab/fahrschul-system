/**
 * "Warum handeln oder auslassen?" (F10) – the live Einstiegs-Check explained as four separate groups, each row with a
 * plain-language reason:
 *
 * - **Pflichtbedingungen**: without them there is no trade, whatever the score says (confirming rungs, RSI, a CLOSED
 *   signal candle, the Lage gate, a stop on the right side, fresh data);
 * - **Optionale Bestätigungen**: they raise the quality (zone, strong signal, more rungs, Top-Trader, divergence, S/R);
 * - **Widersprüche**: things that speak against the side (the other side is valid too, wrong zone, a rung that says the
 *   opposite, falling-knife filter, Lage warning, no room to the next level);
 * - **Fehlende Daten**: what could not be judged – named, never counted as met and never as unmet.
 *
 * Plus **zu spät**: when the price already ran more than `maxLateR` of the planned risk (|trigger − stop|) past the
 * trigger, the entry is skipped and the text says by how much. A high score NEVER overrides a failed required
 * condition; the decision is derived from the groups, the score only appears in a note. Pure – no React, no I/O.
 */
import { n0, n1, n2 } from "@/lib/format";
import type { KnifeFilter } from "../signals/knife";
import type { Side, SignalCfg } from "../signals/config";
import type { GradedPart } from "../signals/parts";
import type { TfCheck, Verdict } from "../signals/verdict";

export type RowStatus = "met" | "unmet" | "unknown" | "conflict";

export interface WhyRow {
  id: string;
  label: string;
  status: RowStatus;
  /** plain German: why this row is what it is */
  reason: string;
}

export type Decision = "trade" | "caution" | "skip" | "unclear";

export interface LateEntry {
  /** `ok` = within the limit (or the price has not reached the trigger), `late`, `unknown` = not computable */
  status: "ok" | "late" | "unknown";
  /** how far past the trigger in multiples of the planned risk (`null` when unknown) */
  movedR: number | null;
  /** planned risk in price points */
  risk: number | null;
  maxR: number;
  /** the price is already beyond the stop (the setup is dead, not just late) */
  beyondStop: boolean;
  text: string;
}

export interface WhyExplanation {
  side: Side;
  decision: Decision;
  /** short headline (`Auslassen – zu spät`) */
  headline: string;
  /** one sentence: the deciding reason */
  summary: string;
  required: WhyRow[];
  optional: WhyRow[];
  contradictions: WhyRow[];
  missing: WhyRow[];
  late: LateEntry;
  /** why the score does not decide (`null` when there is nothing to say) */
  scoreNote: string | null;
  score: number;
}

export const LATE_MAX_R_DEFAULT = 0.5;
export const LATE_MAX_R_MIN = 0.1;
export const LATE_MAX_R_MAX = 3;

/** `settings.signals.lateMaxR` (R, 0.1 … 3), default 0.5. */
export function lateMaxROf(rawSignals: unknown): number {
  const v = rawSignals && typeof rawSignals === "object" ? (rawSignals as { lateMaxR?: unknown }).lateMaxR : undefined;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(LATE_MAX_R_MAX, Math.max(LATE_MAX_R_MIN, Math.round(v * 100) / 100)) : LATE_MAX_R_DEFAULT;
}

/** `settings.signals` with `lateMaxR` set; every other key survives. Same object when unchanged. */
export function withLateMaxR(rawSignals: unknown, maxR: number): Record<string, unknown> {
  const prev = rawSignals && typeof rawSignals === "object" && !Array.isArray(rawSignals) ? (rawSignals as Record<string, unknown>) : {};
  const next = lateMaxROf({ lateMaxR: maxR });
  return prev.lateMaxR === next ? prev : { ...prev, lateMaxR: next };
}

export interface EntryPlan {
  /** the reference entry – the close of the signal candle (or the key level's trigger) */
  trigger: number | null;
  /** the planned stop */
  stop: number | null;
}

/**
 * Is the entry too late? `movedR = (price − trigger) / |trigger − stop|` for a long (mirrored for a short). Late when
 * `movedR > maxR`. Without trigger, stop or price nothing is claimed (`unknown`).
 */
export function lateEntry(side: Side, plan: EntryPlan | null | undefined, price: number | null | undefined, maxR: number = LATE_MAX_R_DEFAULT): LateEntry {
  const base = { maxR, movedR: null, risk: null, beyondStop: false };
  if (!plan || plan.trigger == null || plan.stop == null) return { ...base, status: "unknown", text: plan?.trigger == null ? "Kein Trigger-Kurs bekannt – Verspätung nicht prüfbar." : "Kein Stop geplant – Verspätung nicht prüfbar." };
  if (price == null || !Number.isFinite(price)) return { ...base, status: "unknown", text: "Kein Live-Kurs – Verspätung nicht prüfbar." };
  const long = side === "long";
  const risk = Math.abs(plan.trigger - plan.stop);
  if (!(risk > 0)) return { ...base, status: "unknown", text: "Stop und Trigger liegen auf demselben Kurs – kein Risiko berechenbar." };
  const stopOk = long ? plan.stop < plan.trigger : plan.stop > plan.trigger;
  if (!stopOk) return { ...base, risk, status: "unknown", text: `Der Stop ${n0(plan.stop)} liegt auf der falschen Seite des Triggers ${n0(plan.trigger)}.` };
  const moved = long ? price - plan.trigger : plan.trigger - price;
  const movedR = moved / risk;
  const beyondStop = long ? price <= plan.stop : price >= plan.stop;
  if (beyondStop) return { status: "ok", movedR, risk, maxR, beyondStop, text: `Der Kurs ${n0(price)} liegt schon ${long ? "unter" : "über"} dem Stop ${n0(plan.stop)} – das Setup ist erledigt.` };
  if (movedR > maxR) {
    return {
      status: "late",
      movedR,
      risk,
      maxR,
      beyondStop,
      text: `Zu spät: Der Kurs ${n0(price)} ist schon ${n2(movedR)} R ${long ? "über" : "unter"} dem Trigger ${n0(plan.trigger)} (geplantes Risiko ${n0(risk)} Punkte, erlaubt sind ${n1(maxR)} R). Ein Einstieg jetzt hat deutlich weniger Platz zum Ziel als geplant.`,
    };
  }
  return { status: "ok", movedR, risk, maxR, beyondStop, text: moved <= 0 ? "Der Kurs hat den Trigger noch nicht überschritten." : `Noch rechtzeitig: ${n2(movedR)} R vom Trigger entfernt (erlaubt sind ${n1(maxR)} R).` };
}

export type FeedState = "ok" | "stale" | "offline" | "loading";

export interface WhyInput {
  side: Side;
  verdict: Pick<Verdict, "valid" | "rsiOk" | "zoneOk" | "tiers" | "strength" | "score" | "strongSignal" | "label"> & Partial<Pick<Verdict, "state" | "parts" | "lage" | "provStrength">>;
  /** the other side's verdict */
  other?: Pick<Verdict, "valid" | "strength" | "label"> | null;
  /** the ladder rungs (`null` = too few candles) */
  checks: readonly (TfCheck | null)[];
  /** the check of the zone timeframe (Premium / Discount) */
  zone?: TfCheck | null;
  cfg: Pick<SignalCfg, "ladder" | "required" | "rsiOs" | "rsiOb" | "rsiNear">;
  knife?: KnifeFilter | null;
  /** the Lage gate: `on` and whether the Lage has data (`hasData: false` → "keine Daten") */
  lage?: { on: boolean; hasData: boolean } | null;
  price?: number | null;
  plan?: EntryPlan | null;
  maxLateR?: number;
  feed?: FeedState;
}

const SIDE_WORD: Readonly<Record<Side, string>> = { long: "Long", short: "Short" };
const row = (id: string, label: string, status: RowStatus, reason: string): WhyRow => ({ id, label, status, reason });

function partRow(p: GradedPart): WhyRow {
  const status: RowStatus = !p.data ? "unknown" : p.ok ? "met" : "unmet";
  return row(`part:${p.id}`, p.label, status, !p.data ? "Keine Daten." : p.ok ? p.detail : `${p.detail} – nicht voll erfüllt.`);
}

/** Explains the live check of one side. */
export function explainDecision(inp: WhyInput): WhyExplanation {
  const { side, verdict: v, checks, cfg } = inp;
  const long = side === "long";
  const maxR = inp.maxLateR ?? LATE_MAX_R_DEFAULT;
  const feed = inp.feed ?? "ok";
  const required: WhyRow[] = [];
  const optional: WhyRow[] = [];
  const contradictions: WhyRow[] = [];
  const missing: WhyRow[] = [];
  const markMissing = (id: string, label: string, reason: string): void => void missing.push(row(id, label, "unknown", reason));

  // ---- data freshness (a required fact: stale candles cannot confirm anything)
  if (feed !== "ok") {
    const text = feed === "loading" ? "Die Kerzen werden noch geladen." : feed === "stale" ? "Die Marktdaten sind veraltet – der Check zeigt den letzten Stand." : "Keine Marktdaten (offline).";
    required.push(row("data", "Aktuelle Marktdaten", "unknown", text));
    markMissing("data", "Marktdaten", text);
  }

  // ---- ladder
  const need = Math.max(1, cfg.required);
  const names = cfg.ladder.slice(0, v.tiers);
  if (v.tiers >= need) {
    required.push(row("ladder", "Zeiteinheiten bestätigen", "met", `${v.tiers} von ${cfg.ladder.length} Zeiteinheiten bestätigen (${names.join(", ")}); verlangt sind ${need}.`));
  } else {
    const nextTf = cfg.ladder[v.tiers];
    const nextCheck = checks[v.tiers];
    if (nextTf && nextCheck === null) {
      required.push(row("ladder", "Zeiteinheiten bestätigen", "unknown", `${nextTf}: zu wenig Kerzen – die Leiter lässt sich nicht bis zur geforderten Stufe prüfen.`));
    } else {
      required.push(row("ladder", "Zeiteinheiten bestätigen", "unmet", `${v.tiers ? `Nur ${names.join(", ")} bestätigt` : "Noch keine Zeiteinheit bestätigt"} – verlangt sind ${need}${nextTf ? `; als Nächstes fehlt ${nextTf}` : ""}.`));
    }
  }
  if (v.tiers > need) optional.push(row("rungs", "Weitere Zeiteinheiten", "met", `${v.tiers - need} Stufe${v.tiers - need === 1 ? "" : "n"} über dem Minimum bestätigen zusätzlich.`));

  // ---- RSI (mandatory)
  const base = checks[0] ?? null;
  const thr = long ? cfg.rsiOs + cfg.rsiNear : cfg.rsiOb - cfg.rsiNear;
  if (!base) required.push(row("rsi", "RSI an der Extremzone", "unknown", `${cfg.ladder[0] ?? "Basis"}: zu wenig Kerzen für den RSI.`));
  else if (v.rsiOk) required.push(row("rsi", "RSI an der Extremzone", "met", `RSI ${n1(base.rsi)} ${long ? "≤" : "≥"} ${n0(thr)} – ${long ? "überverkauft" : "überkauft"} genug.`));
  else required.push(row("rsi", "RSI an der Extremzone", "unmet", `RSI ${n1(base.rsi)} liegt ${long ? "über" : "unter"} ${n0(thr)} – noch nicht ${long ? "überverkauft" : "überkauft"}.`));

  // ---- candle close
  if (v.state === "provisional") {
    required.push(row("closed", "Signalkerze geschlossen", "unmet", "Das Signal steht noch auf der laufenden Kerze (vorläufig) – es zählt erst mit dem Schluss."));
  } else if (v.state === "confirmed" || v.state === "strong") {
    required.push(row("closed", "Signalkerze geschlossen", "met", v.state === "strong" ? "Die Signalkerze ist geschlossen und das Signal hielt weitere Schlüsse." : "Die Signalkerze ist geschlossen – das Signal ist bestätigt."));
  }

  // ---- Lage gate (long only)
  if (long && inp.lage?.on) {
    if (!inp.lage.hasData) {
      required.push(row("lage", "Lage-Ampel", "unknown", "Die Lage-Ampel hat keine Tagesdaten."));
      markMissing("lage", "Lage-Ampel", "Keine Tagesdaten – die Sperre lässt sich nicht prüfen.");
    } else if (v.lage?.blocked) {
      required.push(row("lage", "Lage-Ampel", "unmet", v.lage.label ? `${v.lage.label}.` : "Die Lage sperrt Kaufsignale."));
    } else {
      required.push(row("lage", "Lage-Ampel", "met", "Die Lage sperrt dieses Kaufsignal nicht."));
      if (v.lage?.label) contradictions.push(row("lage-warn", "Lage-Warnung", "conflict", `${v.lage.label} (nur Warnung, das Signal zählt).`));
    }
  }

  // ---- stop on the right side
  const plan = inp.plan ?? null;
  if (plan && plan.trigger != null && plan.stop != null) {
    const ok = long ? plan.stop < plan.trigger : plan.stop > plan.trigger;
    required.push(row("stop", "Stop auf der richtigen Seite", ok ? "met" : "unmet", ok ? `Stop ${n0(plan.stop)} liegt ${long ? "unter" : "über"} dem Einstieg ${n0(plan.trigger)}.` : `Stop ${n0(plan.stop)} liegt ${long ? "über" : "unter"} dem Einstieg ${n0(plan.trigger)} – so ist kein ${SIDE_WORD[side]} möglich.`));
  } else if (!plan || plan.stop == null) {
    markMissing("stop", "Geplanter Stop", "Kein Stop berechenbar (Support/Widerstand-Teil aus oder ohne Level) – Verspätung und CRV lassen sich nicht prüfen.");
  }

  // ---- optional confirmations
  optional.push(row("zone", long ? "Preis im Discount" : "Preis im Premium", v.zoneOk ? "met" : "unmet", v.zoneOk ? `Der Preis liegt im ${long ? "Discount" : "Premium"} (${inp.zone?.tf ?? "Zonen-Zeiteinheit"}).` : `Der Preis liegt nicht im ${long ? "Discount" : "Premium"}.`));
  optional.push(row("strong", "Starkes Signal (Bottom/Top)", v.strongSignal ? "met" : "unmet", v.strongSignal ? "Ein Bottom/Top-Signal liegt vor." : "Nur ein einfaches Kauf-/Verkaufssignal, kein Bottom/Top."));
  for (const p of v.parts ?? []) {
    const r = partRow(p);
    if (r.status === "unknown") markMissing(r.id, p.label, "Keine Daten für diesen Teil.");
    else optional.push(r);
  }

  // ---- contradictions
  if (inp.other?.valid) contradictions.push(row("other", `${SIDE_WORD[long ? "short" : "long"]} ist auch gültig`, "conflict", `Die Gegenrichtung zeigt ebenfalls einen gültigen Einstieg (${inp.other.label}).`));
  const z = inp.zone?.zone.zone;
  if (z && ((long && z === "premium") || (!long && z === "discount"))) contradictions.push(row("zone-against", "Zone gegen die Richtung", "conflict", `Der Preis liegt im ${z === "premium" ? "Premium (teuer)" : "Discount (billig)"} – für ${SIDE_WORD[side]} ungünstig.`));
  checks.forEach((c, i) => {
    if (!c || i < v.tiers) return;
    if (long ? c.shortSignal : c.longSignal) contradictions.push(row(`against:${c.tf}`, `${c.tf} zeigt das Gegen-Signal`, "conflict", `${c.tf} hat ein ${SIDE_WORD[long ? "short" : "long"]}-Signal – die Leiter ist nicht einig.`));
  });
  if (long && inp.knife) {
    if (!inp.knife.data) markMissing("knife", "Falling-Knife-Filter", "Keine Daten für den Filter.");
    else if (!inp.knife.all) contradictions.push(row("knife", "Falling-Knife-Filter", "conflict", `${inp.knife.label} – der Filter rät zur Vorsicht.`));
  }
  const sr = v.parts?.find((p) => p.id === "sr");
  const room = sr?.items.find((i) => i.id === "room");
  if (sr?.data && room && room.met === false) contradictions.push(row("room", "Wenig Platz", "conflict", `${room.label}: ${room.value}.`));

  // ---- missing data from the rungs
  checks.forEach((c, i) => {
    if (c === null) markMissing(`rung:${cfg.ladder[i] ?? i}`, `${cfg.ladder[i] ?? `Stufe ${i + 1}`}`, "Zu wenig Kerzen für diese Zeiteinheit.");
  });

  // ---- too late
  const late = lateEntry(side, plan, inp.price, maxR);
  if (late.status === "unknown" && plan && plan.trigger != null && plan.stop != null) markMissing("late", "Verspätung", late.text);

  // ---- decision (the score never decides)
  const unmet = required.filter((r) => r.status === "unmet");
  const unknown = required.filter((r) => r.status === "unknown");
  let decision: Decision;
  let headline: string;
  let summary: string;
  if (unmet.length) {
    decision = "skip";
    headline = "Auslassen – Pflichtbedingung fehlt";
    summary = `${unmet[0]!.label}: ${unmet[0]!.reason}${unmet.length > 1 ? ` (+${unmet.length - 1} weitere)` : ""}`;
  } else if (late.status === "late") {
    decision = "skip";
    headline = "Auslassen – zu spät";
    summary = late.text;
  } else if (late.beyondStop) {
    decision = "skip";
    headline = "Auslassen – Stop schon erreicht";
    summary = late.text;
  } else if (unknown.length) {
    decision = "unclear";
    headline = "Nicht beurteilbar – Daten fehlen";
    summary = `${unknown[0]!.label}: ${unknown[0]!.reason}`;
  } else if (contradictions.length) {
    decision = "caution";
    headline = "Handeln mit Vorsicht – es gibt Widersprüche";
    summary = `Alle Pflichtbedingungen sind erfüllt, aber: ${contradictions[0]!.reason}`;
  } else {
    decision = "trade";
    headline = "Handeln – alle Pflichtbedingungen erfüllt";
    summary = "Pflichtbedingungen erfüllt, kein Widerspruch, rechtzeitig.";
  }
  let scoreNote: string | null = null;
  if (decision === "skip" || decision === "unclear") {
    scoreNote = v.score >= 50 ? `Der Score ${v.score} ist hoch – er ersetzt keine Pflichtbedingung: ${decision === "skip" ? "eine davon fehlt bzw. der Einstieg ist zu spät" : "ohne die fehlenden Daten bleibt es offen"}.` : `Score ${v.score}: er entscheidet nicht, nur die Pflichtbedingungen und die Rechtzeitigkeit.`;
  } else if (decision === "caution") scoreNote = `Score ${v.score}: er hebt die Widersprüche nicht auf.`;

  return { side, decision, headline, summary, required, optional, contradictions, missing, late, scoreNote, score: v.score };
}
