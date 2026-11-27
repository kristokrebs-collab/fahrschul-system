/**
 * „Was hat mir das Journal im September gebracht?“ – the month benefit of the Berichte page (`monthBenefit`), in words: only
 * what the journal and its local traces can PROVE, counted. No avoided mistakes (nobody can count what did not happen), no
 * money „saved“, no cause. A trace that does not reach back to the start of the month (signal archive, Zustellprotokoll) is
 * named as incomplete instead of being read as „none“.
 */
import { buildReport, monthBenefit, periodOf, type MonthBenefit, type ReportPeriod } from "@/domain/reports";
import type { ReplyAction, ToolEnv, ToolReply } from "../tools";
import { periodMentioned } from "./period";
import { signalsSource } from "./sources";
import { dayText, fact, openAction, pctText, plural, reply } from "./shared";

const SPOT = { page: "berichte", testid: "benefit-card" } as const;
const share = (k: number, n: number): string => (n > 0 ? `${k} von ${n} (${pctText(k / n)})` : "–");

/** The month of the question: a named month / „letzten Monat“, else the running one. A week or a day mentioned is read as its month. */
export function monthOf(norm: string, now: number): { period: ReportPeriod; said: string | null } {
  const m = periodMentioned(norm, now);
  if (!m) return { period: periodOf("month", now), said: null };
  return { period: m.period.kind === "month" ? m.period : periodOf("month", m.period.from), said: m.said };
}

export function benefitText(b: MonthBenefit): string[] {
  const out: string[] = [];
  const a = b.alerts;
  out.push(`${plural(b.trades, "Trade", "Trades")} im Monat, davon ${share(b.entries.checked, b.trades)} mit einem Einstiegs-Check zum Zeitpunkt des Eintrags und ${share(b.entries.boxContext, b.trades)} mit Box-zu-Box-Kontext.`);
  if (b.rules.checklistTrades) out.push(`Checkliste vollständig bei ${share(b.rules.checklistComplete, b.rules.checklistTrades)}.`);
  if (b.rules.planTrades) out.push(`Plan befolgt bei ${share(b.rules.planFollowed, b.rules.planTrades)}.`);
  out.push(`${plural(b.rules.violations, "protokollierter Regelverstoß", "protokollierte Regelverstöße")}, ${plural(b.limits.dayBreaches, "Tag", "Tage")} über dem Tageslimit, ${plural(b.limits.overLimit, "Trade", "Trades")} über dem Limit pro Trade.`);
  out.push(`Reviews: ${share(b.review.reviewed, b.review.trades)}; ${plural(b.checkins.days, "Tag", "Tage")} mit Check-in.`);
  out.push(`Alarme: ${plural(a.signals, "Einstiegs-Signal", "Einstiegs-Signale")} festgehalten, ${plural(a.sent, "Meldung", "Meldungen")} gesendet.`);
  if (b.experiments.items.length) out.push(`Wochenexperimente: ${b.experiments.met} erfüllt, ${b.experiments.missed} nicht erfüllt, ${b.experiments.thin} mit zu wenig Daten, ${b.experiments.running} laufend.`);
  const gaps: string[] = [];
  if (!a.archive.complete) gaps.push(a.archive.oldest == null ? "Das Signalarchiv ist leer – es hat nichts festgehalten (nicht: nichts ist passiert)" : `Das Signalarchiv reicht nur bis ${dayText(a.archive.oldest)} zurück`);
  if (!a.log.complete && a.log.oldest != null) gaps.push(`das Zustellprotokoll (letzte 200 Zeilen) nur bis ${dayText(a.log.oldest)}`);
  if (gaps.length) out.push(`Unvollständig: ${gaps.join("; ")}.`);
  return out;
}

export async function benefitAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const { period, said } = monthOf(norm, env.now);
  const src = await signalsSource(env);
  const list = env.list ?? env.data.closed;
  const report = buildReport({ list, settings: env.data.settings, days: env.days, events: env.data.events, start: env.data.start, currency: env.data.currency, period, now: env.now });
  const b = monthBenefit({ report, list, settings: env.data.settings, events: env.data.events, days: env.days, signals: src.events, log: src.log, now: env.now });
  const open: ReplyAction = {
    label: "Monatsbericht öffnen",
    run: () => {
      env.openReport?.(period.key);
      openAction(env, "", SPOT).run();
    },
  };
  if (b.empty) {
    return reply({
      title: `${period.label}: nichts protokolliert`,
      text: `Für ${period.label}${said ? ` („${said}“)` : ""} ist weder ein Trade noch ein Alarm, Check-in oder Experiment protokolliert. Sobald es etwas gibt, zähle ich es – gezählt, nicht gedeutet.`,
      tone: "mute",
      actions: [open],
    });
  }
  const runs = period.to > env.now && period.from <= env.now ? "bisher " : "";
  return reply({
    title: `Das Journal im ${period.label}`,
    text: `Was im ${period.label} ${runs}belegbar ist: ${benefitText(b).join(" ")} Gezählt wird nur, was protokolliert ist – keine Geldbeträge „gespart“, keine vermiedenen Fehler, keine Ursache.`,
    facts: [fact("Trades", String(b.trades), "fg", b.trades), fact("Mit Check", b.trades ? pctText(b.entries.checked / b.trades) : "–", "fg", b.entries.checked), fact("Verstöße", String(b.rules.violations), b.rules.violations ? "loss" : "fg", b.rules.violations), fact("Check-in-Tage", String(b.checkins.days), "fg", b.checkins.days)],
    actions: [open],
    followUps: ["Was hat mir das Journal letzten Monat gebracht?"],
  });
}
