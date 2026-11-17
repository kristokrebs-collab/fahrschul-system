/**
 * „Hängt mein Backtest an wenigen Trades?“ / „Wie lang war die längste Verlustserie?“ – the assistant reads the last
 * finished Labor run: `auditRun` (Strategie-Prüfbericht: outliers, data holes, signals, tested periods) and
 * `lossStreakStress` (longest losing streak, worst stretches, deepest drawdown, order Monte Carlo). The scenario table
 * and the filter comparison are only quoted when the trader has already computed them (`useExtras`); otherwise the
 * answer says where to start them. Every sentence is the domain's own, with the sample it rests on; nothing is computed
 * by a model and nothing is started here.
 */
import { AUDIT, auditRun, type Audit } from "@/domain/lab/report";
import { lossStreakStress, type StreakStress } from "@/domain/lab/stress";
import type { ScenarioRow } from "@/domain/lab/stress/types";
import { has, tokensOf } from "../fuzzy";
import type { ToolEnv, ToolReply } from "../tools";
import { filterCompare, labRun, stressRows } from "./sources";
import { dayText, dec, fact, openAction, pctText, plural, reply, rText, tone } from "./shared";
import type { LabRunInput } from "./types";

const NAMES: Readonly<Record<string, string>> = { custom: "Eigene Idee", box: "Box-zu-Box", mcb: "MCB-Leiter", rules: "Regel-Baukasten" };
const nameOf = (run: LabRunInput): string => run.result.name ?? NAMES[run.result.strategy] ?? run.result.strategy;

/** No finished run: say so and where one starts. Never starts a run. */
function noRun(env: ToolEnv, what: string, journalChip?: string): ToolReply {
  return reply({
    title: "Noch kein Labor-Lauf",
    text: `Im Labor liegt kein fertiger Lauf, ${what}. Starte dort einen Test – danach kann ich dir sagen, ob das Ergebnis an wenigen Trades hängt, wie lang die längste Verlustserie war und was die Belastung zeigt. Ich starte nichts von mir aus.`,
    actions: [openAction(env, "Labor öffnen", { page: "labor", feature: "labor" })],
    followUps: journalChip ? [journalChip] : [],
    tone: "mute",
  });
}

/* ------------------------------------------------------------------ Prüfbericht */

function outlierReply(a: Audit, name: string, env: ToolEnv): ToolReply {
  const o = a.outliers;
  const best = (k: number) => o.rows.find((r) => r.kind === "best" && r.k === k);
  const titles = { abhaengig: "Das Ergebnis hängt an wenigen Trades", tragfaehig: "Auch ohne die besten Trades positiv", verlust: "Schon insgesamt nicht positiv", zuwenig: "Zu wenige Trades für diese Frage" } as const;
  const facts = [fact("Trades", String(o.n), "fg", o.n), fact("Summe R", rText(o.sumR), tone(o.sumR), o.sumR)];
  for (const k of [3, 5]) {
    const r = best(k);
    if (r) facts.push(fact(`Ohne die besten ${k}`, rText(r.remainSumR), tone(r.remainSumR), r.remainSumR));
  }
  return reply({
    title: titles[o.verdict],
    text: `Letzter Labor-Lauf (${name}): ${o.text}${o.rows.some((r) => r.thin && r.kind === "best") ? " Bei den größeren Zeilen sind die entfernten Trades schon ein Fünftel oder mehr aller Trades – dort sagt die Zeile wenig." : ""}`,
    facts,
    tone: o.verdict === "abhaengig" ? "loss" : "fg",
    actions: [openAction(env, "Prüfbericht öffnen", { page: "labor", feature: "pruefbericht" })],
    followUps: ["Wie lang war die längste Verlustserie?", "Gibt es Datenlücken im Backtest?"],
  });
}

function dataReply(a: Audit, name: string, env: ToolEnv): ToolReply {
  const d = a.data;
  const biggest = d.spans[0];
  const extra = biggest ? ` Die größte Lücke: ${dayText(biggest.fromMs)} bis ${dayText(biggest.toMs)} (${plural(biggest.missing, "Kerze", "Kerzen")}).` : "";
  return reply({
    title: d.gaps ? "Der Lauf hat Datenlücken" : "Keine Datenlücken im Lauf",
    text: `Letzter Labor-Lauf (${name}, ${d.interval}): ${d.notes.join(" ")}${extra}`,
    facts: [
      fact("Kerzen", `${d.received.toLocaleString("de-DE")} von ${d.expected.toLocaleString("de-DE")}`, "fg", d.received),
      fact("Lücken", String(d.gaps), d.gaps ? "loss" : "fg", d.gaps),
      fact("Fehlend", d.missingShare == null ? "–" : pctText(d.missingShare, 1), d.missingShare != null && d.missingShare > AUDIT.missingShare ? "loss" : "fg", d.missingShare),
    ],
    tone: d.missingShare != null && d.missingShare > AUDIT.missingShare ? "loss" : "fg",
    actions: [openAction(env, "Prüfbericht öffnen", { page: "labor", feature: "pruefbericht" })],
    followUps: ["Hängt mein Backtest an wenigen Trades?"],
  });
}

function periodsReply(a: Audit, name: string, env: ToolEnv): ToolReply {
  const p = a.periods;
  const parts: string[] = [];
  if (p.oos.used) parts.push(`Out-of-Sample: der letzte Abschnitt (${p.oos.share != null ? pctText(p.oos.share) : "–"} des Zeitraums) hat ${plural(p.oos.n ?? 0, "Trade", "Trades")}.`);
  if (p.walkForward) parts.push(`Walk-forward: ${plural(p.walkForward.windows, "Fenster", "Fenster")}, zusammen ${plural(p.walkForward.testTrades, "ungesehener Trade", "ungesehene Trades")}.`);
  return reply({
    title: "Welche Zeiträume ungesehen getestet sind",
    text: `Letzter Labor-Lauf (${name}, ${Math.round(p.days)} Tage): ${parts.join(" ")} ${p.notes.join(" ")}`.replace("  ", " "),
    facts: [fact("Zeitraum", `${Math.round(p.days)} Tage`), fact("Trades je Drittel", p.thirds.map((t) => t.n).join(" · "), "fg"), fact("Ungesehen (OOS)", p.oos.n == null ? "–" : String(p.oos.n), "fg", p.oos.n)],
    actions: [openAction(env, "Prüfbericht öffnen", { page: "labor", feature: "pruefbericht" })],
    followUps: ["Hängt mein Backtest an wenigen Trades?"],
  });
}

function signalsReply(a: Audit, name: string, env: ToolEnv): ToolReply {
  const s = a.signals;
  const skipped = s.skippedGap + s.skippedRisk;
  return reply({
    title: "Nachträglich sichtbare Signale",
    text: `Letzter Labor-Lauf (${name}): ${s.late.text} Von ${plural(s.handed, "Signal", "Signalen")}, die die Strategie dem Test gab, wurden ${skipped} übersprungen (Lücke zum nächsten Open: ${s.skippedGap}, Stopp zu nah oder keine Größe: ${s.skippedRisk}); ${s.executed} wurden Trades.`,
    facts: [fact("Signale", String(s.handed), "fg", s.handed), fact("Übersprungen", String(skipped), "fg", skipped), fact("Trades", String(s.executed), "fg", s.executed)],
    actions: [openAction(env, "Prüfbericht öffnen", { page: "labor", feature: "pruefbericht" })],
  });
}

function generalReply(a: Audit, name: string, env: ToolEnv): ToolReply {
  const o = a.outliers;
  const lines = [o.text];
  if (a.data.missingShare != null && a.data.missingShare > AUDIT.missingShare) lines.push(`Außerdem fehlen ${pctText(a.data.missingShare, 1)} der Kerzen (${a.data.gaps} Lücken).`);
  lines.push(`Robustheits-Urteil des Labors: ${a.robust.text}`);
  return reply({
    title: "Wie belastbar ist der letzte Lauf?",
    text: `Letzter Labor-Lauf (${name}, ${o.n} Trades): ${lines.join(" ")}`,
    facts: [fact("Trades", String(o.n), "fg", o.n), fact("Summe R", rText(o.sumR), tone(o.sumR), o.sumR), fact("Urteil", a.robust.verdict, "fg")],
    actions: [openAction(env, "Prüfbericht öffnen", { page: "labor", feature: "pruefbericht" })],
    followUps: ["Wie lang war die längste Verlustserie?"],
  });
}

export async function auditAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const run = await labRun(env);
  if (!run) return noRun(env, "den ich prüfen könnte");
  const a = auditRun(run.result, run.bars.length ? run.bars : null);
  const t = tokensOf(norm);
  const name = nameOf(run);
  if (has(t, "luecke", "luecken", "datenluecke", "fehlende")) return dataReply(a, name, env);
  if (has(t, "=sample", "walk", "ungesehen", "pruefzeitraum", "zurueckgehalten", "trainiert")) return periodsReply(a, name, env);
  if (has(t, "nachtraeglich", "repaint", "uebersprungen")) return signalsReply(a, name, env);
  if (has(t, "robust", "glueck", "zufall", "belastbar", "aussagekraeftig", "verlaesslich", "pruefbericht")) return generalReply(a, name, env);
  return outlierReply(a, name, env);
}

/* ------------------------------------------------------------------ Belastung */

const span = (s: { fromTime: number; toTime: number }): string => `${dayText(s.fromTime)} bis ${dayText(s.toTime)}`;

function streakReply(st: StreakStress, run: LabRunInput, env: ToolEnv): ToolReply {
  const name = nameOf(run);
  if (!st.n) return reply({ title: "Keine Trades im Lauf", text: `Der letzte Labor-Lauf (${name}) hat keine Trades – eine Verlustserie gibt es dort nicht.`, tone: "mute", actions: [openAction(env, "Labor öffnen", { page: "labor", feature: "labor" })] });
  const L = st.longestLosing;
  const parts: string[] = [L ? `Die längste Verlustserie im letzten Labor-Lauf (${name}, ${plural(st.n, "Trade", "Trades")}) waren ${plural(L.trades, "Trade", "Trades")} in Folge (${span(L)}), zusammen ${rText(L.sumR)}.` : `Der letzte Labor-Lauf (${name}) hat unter ${plural(st.n, "Trade", "Trades")} keinen Verlusttrade.`];
  if (st.worstWindows.length) parts.push(`Die schwächsten Abschnitte am Stück: ${st.worstWindows.map((w) => `${w.k} Trades ${rText(w.span.sumR)}`).join(", ")}.`);
  if (st.drawdownR) parts.push(`Tiefster Rückgang der aufsummierten R: ${dec(st.drawdownR.depth)} R (${span(st.drawdownR.span)})${st.drawdownShare != null ? `, das sind etwa ${dec(st.drawdownShare * 100, 1)} % des Kontos bei ${dec(run.riskPct ?? 1)} % Risiko je Trade (ohne Zinseszins)` : ""}.`);
  if (st.mc) parts.push(`Mischt man die Reihenfolge der ${st.n} Trades ${st.mc.runs.toLocaleString("de-DE")}-mal neu (feste Zufallszahl), liegt die längste Verlustserie im Median bei ${st.mc.streakP50} und in 95 % der Mischungen bei höchstens ${st.mc.streakP95}; der Rückgang war in ${pctText(st.mc.shareAtLeastReal)} der Mischungen mindestens so tief wie in der echten Reihenfolge (Median ${dec(st.mc.ddP50)} R, 95 % ${dec(st.mc.ddP95)} R).`);
  else if (st.mcNote) parts.push(st.mcNote);
  parts.push(`Das sind Beobachtungen an ${plural(st.n, "Trade", "Trades")}: Mit mehr Trades kommen längere Serien vor.`);
  return reply({
    title: "Verlustserien im Labor-Lauf",
    text: parts.join(" "),
    facts: [fact("Längste Serie", L ? `${L.trades} Trades` : "keine", L ? "loss" : "fg", L?.trades ?? 0), fact("Rückgang", st.drawdownR ? `−${dec(st.drawdownR.depth)} R` : "keiner", st.drawdownR ? "loss" : "fg", st.drawdownR ? -st.drawdownR.depth : 0), fact("Trades", String(st.n), "fg", st.n), fact("Summe R", rText(st.sumR), tone(st.sumR), st.sumR)],
    actions: [openAction(env, "Belastungstest öffnen", { page: "labor", feature: "belastungstest" })],
    followUps: ["Was passiert bei doppelten Gebühren?", "Hängt mein Backtest an wenigen Trades?"],
  });
}

const STARTS = "Er rechnet den Lauf mit doppelten Gebühren, mehr Slippage, Funding, einer Kerze später und anderen Stopps noch einmal – das braucht Zeit und startet nur du, im Labor unter „Kosten- und Belastungstest“. Ich starte ihn nicht.";

async function scenarioReply(run: LabRunInput, env: ToolEnv): Promise<ToolReply> {
  const ex = await stressRows(env);
  const open = openAction(env, "Belastungstest öffnen", { page: "labor", feature: "belastungstest" });
  if (ex.status === "running") return reply({ title: "Belastungstest läuft", text: "Der Kosten- und Belastungstest rechnet gerade im Labor. Sobald er fertig ist, nenne ich dir die Zahlen.", tone: "mute", actions: [open] });
  const rows = ex.result?.rows ?? [];
  const base = rows.find((r) => r.id === "base");
  if (ex.status !== "done" || !base?.stats) return reply({ title: "Belastungstest noch nicht gerechnet", text: `Für diesen Lauf (${nameOf(run)}) hat noch niemand den Kosten- und Belastungstest gerechnet. ${STARTS}`, tone: "mute", actions: [open], followUps: ["Wie lang war die längste Verlustserie?"] });
  const usable = (r: ScenarioRow): r is ScenarioRow & { stats: NonNullable<ScenarioRow["stats"]> } => r.id !== "base" && r.status !== "unavailable" && r.stats != null && r.dSumR != null;
  const worst = rows.filter((r) => usable(r) && r.id !== "combined").sort((a, b) => a.dSumR! - b.dSumR!)[0] as (ScenarioRow & { stats: NonNullable<ScenarioRow["stats"]> }) | undefined;
  const combined = rows.find((r) => r.id === "combined" && usable(r));
  const parts = [`Gerechnet für den Lauf (${nameOf(run)}): Basis ${plural(base.stats.n, "Trade", "Trades")}, ${rText(base.stats.sumR)}, größter Rückgang ${pctText(base.stats.maxDD, 1)}.`];
  if (worst) parts.push(`Am meisten kostet „${worst.label}“: ${rText(worst.stats.sumR)} (${rText(worst.dSumR)} gegenüber der Basis).${worst.status === "approx" ? " Mit einer Annahme gerechnet, siehe Hinweis in der Tabelle." : ""}`);
  if (combined && combined.stats) parts.push(`Alles zusammen („${combined.label}“): ${rText(combined.stats.sumR)}${combined.stats.sumR <= 0 && base.stats.sumR > 0 ? " – das Ergebnis kippt ins Negative" : ""}.`);
  const approx = rows.filter((r) => r.status === "approx").length;
  if (approx) parts.push(`${plural(approx, "Zeile ist", "Zeilen sind")} mit einer genannten Annahme gerechnet, nicht gemessen.`);
  return reply({
    title: "Belastungstest des Laufs",
    text: parts.join(" "),
    facts: [fact("Basis", rText(base.stats.sumR), tone(base.stats.sumR), base.stats.sumR), ...(worst ? [fact("Schwächste Zeile", rText(worst.stats.sumR), tone(worst.stats.sumR), worst.stats.sumR)] : []), ...(combined?.stats ? [fact("Alles zusammen", rText(combined.stats.sumR), tone(combined.stats.sumR), combined.stats.sumR)] : [])],
    actions: [open],
    followUps: ["Wie lang war die längste Verlustserie?"],
  });
}

async function filterReply(run: LabRunInput, env: ToolEnv): Promise<ToolReply> {
  const ex = await filterCompare(env);
  const open = openAction(env, "Filtervergleich öffnen", { page: "labor", feature: "filtervergleich" });
  if (ex.status === "running") return reply({ title: "Filtervergleich läuft", text: "Der Varianten- und Filtervergleich rechnet gerade im Labor. Sobald er fertig ist, nenne ich dir die Zahlen.", tone: "mute", actions: [open] });
  const c = ex.result;
  const base = c?.rows.find((r) => r.id === "base");
  if (ex.status !== "done" || !c || !base?.stats) return reply({ title: "Filtervergleich noch nicht gerechnet", text: `Für diesen Lauf (${nameOf(run)}) wurde der Varianten- und Filtervergleich noch nicht gerechnet. Du wählst die Filter und startest ihn im Labor unter „Varianten- und Filtervergleich“ – ich starte ihn nicht.`, tone: "mute", actions: [open] });
  const others = c.rows.filter((r) => r.id !== "base" && r.stats && r.delta);
  const lines = others.slice(0, 3).map((r) => `${r.label}: ${plural(r.stats!.n, "Trade", "Trades")}, ${rText(r.stats!.sumR)} (${rText(r.delta!.dSumR)} gegenüber „Ohne Filter“, ${r.blocked} Signale abgewiesen)`);
  return reply({
    title: "Filtervergleich des Laufs",
    text: `Ohne Filter: ${plural(base.stats.n, "Trade", "Trades")}, ${rText(base.stats.sumR)}. ${lines.length ? lines.join("; ") + "." : "Es wurden keine Filter verglichen."}${c.overlap ? ` Die Beiträge der Filter überschneiden sich (${c.overlap.multi} von ${c.overlap.blocked} abgewiesenen Signalen traf mehr als ein Filter) und addieren sich nicht.` : ""} Weniger Trades heißt auch weniger Stichprobe.`,
    facts: [fact("Ohne Filter", rText(base.stats.sumR), tone(base.stats.sumR), base.stats.sumR), ...others.slice(0, 2).map((r) => fact(r.label, rText(r.stats!.sumR), tone(r.stats!.sumR), r.stats!.sumR))],
    actions: [open],
  });
}

export async function stressAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const t = tokensOf(norm);
  // „die längste Verlustserie“ without a word for the lab may as well be about the journal: offer that question too
  const journalMaybe = !has(t, "=mein", "=meine", "=meinen", "=meiner", "journal", "backtest", "=labor", "=lauf", "testlauf", "simulation") && env.data.closed.length > 0;
  const run = await labRun(env);
  if (!run) return noRun(env, "dessen Verlustserien ich nachzählen könnte", journalMaybe ? "Wie lang war meine längste Verlustserie im Journal?" : undefined);
  const streak = has(t, "verlustserie", "serie", "serien", "=streak", "drawdown", "rueckgang", "hintereinander", "folge", "verlustreihe", "durststrecke");
  if (!streak && has(t, "filter", "filtervergleich")) return filterReply(run, env);
  if (!streak && has(t, "belastungstest", "belastung", "stresstest", "=stress", "szenario", "gebuehr", "slippage", "funding", "kosten", "spaeter", "stopp", "stop")) return scenarioReply(run, env);
  return streakReply(lossStreakStress(run.result.trades, run.riskPct ?? 1), run, env);
}
