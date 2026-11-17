/**
 * „Passt diese Strategie zu mir?“ / „Was verlangt die Idee von mir?“ – the card „Passt zu dir?“ of the Labor in words. What a
 * finished Labor run DEMANDS (`strategyFacts`: trade frequency, hold time, losing streak, drawdown, risk, time windows) is held
 * against what the trader's own journal SHOWS (`journalProfile`) by `compareFit`; the assistant quotes the domain's own sentences
 * (`FitItem.text`) with both samples. No total score, no „geeignet / ungeeignet“, no advice to trade or to skip – and a
 * statement the journal cannot support yet is „nicht beurteilbar“ with the reason.
 */
import { holdLabel } from "@/domain/excursion";
import { compareFit, journalProfile, MIN_STRATEGY, strategyFacts, type StrategyFacts } from "@/domain/fit";
import type { SessionKey } from "@/domain/insights/time";
import type { ToolEnv, ToolReply } from "../tools";
import { labRun } from "./sources";
import { dayText, dec, fact, openAction, pctText, plural, range, reply } from "./shared";

const NAMES: Readonly<Record<string, string>> = { custom: "Eigene Idee", box: "Box-zu-Box", mcb: "MCB-Leiter", rules: "Regel-Baukasten" };
const SPOT = { page: "labor", testid: "labor-fit" } as const;
const WEEKDAY = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
const SESSION: Readonly<Record<SessionKey, string>> = { asia: "Asien-Session (00–07 UTC)", london: "London-Session (07–13 UTC)", ny: "New-York-Session (13–21 UTC)", late: "späte Session (21–24 UTC)", weekend: "Wochenende" };

async function facts(env: ToolEnv): Promise<StrategyFacts | null> {
  const run = await labRun(env);
  if (!run) return null;
  const r = run.result;
  return strategyFacts({ name: r.name ?? NAMES[r.strategy] ?? r.strategy, from: r.from, to: r.to, riskPct: run.riskPct, maxDD: r.stats.maxDD, trades: r.trades });
}

function noRun(env: ToolEnv): ToolReply {
  return reply({
    title: "Noch kein Labor-Lauf",
    text: "Dazu brauche ich eine getestete Idee: Im Labor liegt kein fertiger Lauf. Starte dort einen Test – danach halte ich ihn gegen dein Journal (Trefferquote, Haltedauer, Verlustserien, Rückgang, Handelshäufigkeit, Zeitfenster, Risiko). Ich starte nichts von mir aus.",
    tone: "mute",
    actions: [openAction(env, "Labor öffnen", { page: "labor", feature: "labor" })],
  });
}

/** „Was verlangt die Idee von mir?“ – the demands of the run, each with its number; the journal is not needed. */
export async function demandsAnswer(_norm: string, env: ToolEnv): Promise<ToolReply> {
  const s = await facts(env);
  if (!s) return noRun(env);
  if (!s.n) return reply({ title: "Der Lauf hat keine Trades", text: `Der letzte Labor-Lauf (${s.name}) hat keine Trades – er verlangt nichts, weil er nie einsteigt.`, tone: "mute", actions: [openAction(env, "Labor öffnen", { page: "labor", feature: "labor" })] });
  const top = (shares: readonly number[], names: readonly string[]): string | null => {
    const i = shares.reduce((b, v, k) => (v > shares[b]! ? k : b), 0);
    return shares[i]! >= 0.3 ? `${names[i]} (${pctText(shares[i])} der Einstiege)` : null;
  };
  const day = top(s.weekday, WEEKDAY);
  const sessions = Object.keys(s.session) as SessionKey[];
  const sess = top(sessions.map((k) => s.session[k]), sessions.map((k) => SESSION[k]));
  const parts = [
    `Die Idee „${s.name}“ (Lauf ${dayText(s.from)} bis ${dayText(s.to)}, ${plural(s.n, "Trade", "Trades")}) verlangt von dir:`,
    s.perWeek != null ? `im Schnitt ${dec(s.perWeek)} Trades pro Woche;` : "eine Handelshäufigkeit, die sich bei unter einer Woche Laufzeit nicht angeben lässt;",
    s.holdMedianMs != null ? `eine Haltedauer von im Median ${holdLabel(s.holdMedianMs)};` : "",
    `eine Trefferquote von ${pctText(s.win.share)} (80-%-Bereich ${range(s.win.lo, s.win.hi)}), also auch ${plural(s.n - s.win.k, "Verlusttrade", "Verlusttrades")} auszuhalten;`,
    `bis zu ${plural(s.longestLosing, "Verlusttrade", "Verlusttrades")} in Folge;`,
    `einen Rückgang von bis zu ${dec(s.drawdownR)} R${s.drawdownPct != null ? ` (${dec(s.drawdownPct)} % des Kontos${s.riskPct != null ? ` bei ${dec(s.riskPct)} % Risiko je Trade` : ""})` : ""};`,
    day || sess ? `Einstiege vor allem ${[day, sess].filter(Boolean).join(" und ")}.` : "Einstiege über alle Wochentage und Sessions verteilt.",
  ].filter(Boolean);
  const warn = s.n < MIN_STRATEGY ? ` Mit ${plural(s.n, "Trade", "Trades")} ist das eine dünne Grundlage (ab ${MIN_STRATEGY} vergleiche ich mit deinem Journal).` : "";
  return reply({
    title: "Das verlangt die Idee",
    text: `${parts.join(" ")} Das sind Zahlen aus dem Test, keine Zusage für künftige Trades.${warn}`,
    facts: [fact("Trades/Woche", s.perWeek == null ? "–" : dec(s.perWeek), "fg", s.perWeek), fact("Längste Serie", `${s.longestLosing} Trades`, "fg", s.longestLosing), fact("Rückgang", `−${dec(s.drawdownR)} R`, "loss", -s.drawdownR), fact("Trefferquote", pctText(s.win.share), "fg", s.win.share)],
    actions: [openAction(env, "Passt zu dir? öffnen", SPOT)],
    followUps: ["Passt diese Strategie zu mir?"],
  });
}

/** „Passt diese Strategie zu mir?“ – the agreements and frictions of the card, the domain's own sentences. */
export async function fitAnswer(_norm: string, env: ToolEnv): Promise<ToolReply> {
  const s = await facts(env);
  if (!s) return noRun(env);
  const closed = env.list ?? env.data.closed;
  const report = compareFit(s, journalProfile(closed, env.data.settings, env.data.events));
  const open = openAction(env, "Passt zu dir? öffnen", SPOT);
  if (report.status !== "ok") return reply({ title: "Noch kein Vergleich möglich", text: report.reason ?? "Der Vergleich ist noch nicht möglich.", tone: "mute", actions: [open] });
  const fr = report.items.filter((i) => i.kind === "friction");
  const ok = report.items.filter((i) => i.kind === "match");
  const unk = report.items.filter((i) => i.kind === "unknown");
  const j = report.profile!;
  const parts = [`Die Idee „${s.name}“ (${plural(s.n, "Trade", "Trades")}) gegen dein Journal (${plural(j.n, "abgeschlossener Trade", "abgeschlossene Trades")}): ${ok.length} Punkte stimmen überein, ${fr.length} reiben sich${unk.length ? `, ${unk.length} sind nicht beurteilbar` : ""}.`];
  if (fr.length) parts.push(`Reibungspunkte: ${fr.map((i) => `${i.title}: ${i.text}`).join(" ")}`);
  if (ok.length) parts.push(`Übereinstimmungen: ${ok.map((i) => `${i.title}: ${i.text}`).join(" ")}`);
  if (unk.length) parts.push(`Nicht beurteilbar: ${unk.map((i) => `${i.title} (${i.text})`).join(" ")}`);
  parts.push("Das ist kein Gesamturteil und keine Empfehlung: Es sind Beobachtungen aus beiden Stichproben, keine Vorhersage, wie du handeln würdest.");
  return reply({
    title: fr.length ? `Passt in ${ok.length} von ${report.items.length} Punkten, ${plural(fr.length, "Reibung", "Reibungen")}` : `Keine Reibung in ${ok.length} beurteilbaren Punkten`,
    text: parts.join(" "),
    facts: [fact("Reibungen", String(fr.length), fr.length ? "loss" : "fg", fr.length), fact("Passt", String(ok.length), "win", ok.length), fact("Idee: Trades", String(s.n), "fg", s.n), fact("Journal: Trades", String(j.n), "fg", j.n)],
    actions: [open],
    followUps: ["Was verlangt die Idee von mir?"],
  });
}
