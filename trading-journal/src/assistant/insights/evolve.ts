/**
 * „Verbessere meine Strategie im Hintergrund“ / „Was hat der Optimierer gefunden?“ / „Was hat der Optimierer gelernt?“ – the
 * assistant reads `settings.evolve` (the open proposals with their probability of being luck and their sample, the counters of
 * tried variants, what was learned from the user's decisions) through the optimiser's own functions. It never starts a run,
 * never decides a proposal and never changes a strategy: it says where the optimiser is and opens its card.
 */
import { evolveCfgOf } from "@/domain/evolve/config";
import { learnedSummary } from "@/domain/evolve/learned";
import { overfitLevel } from "@/domain/evolve/significance";
import type { StoredProposal } from "@/domain/evolve/types";
import { has, tokensOf } from "../fuzzy";
import type { ToolEnv, ToolReply } from "../tools";
import { evolveSource } from "./sources";
import { fact, openAction, pctText, plural, reply, rText } from "./shared";

const SPOT = { page: "labor", feature: "hintergrund-optimierer" } as const;
const NO_ADVICE = "Keine professionelle Finanzberatung.";
const LEVEL = { low: "gering", mid: "unsicher", high: "hoch" } as const;

function line(p: StoredProposal): string {
  const first = p.changes[0] ?? "(keine sichtbare Änderung)";
  const more = p.changes.length > 1 ? ` (+ ${plural(p.changes.length - 1, "weitere Änderung", "weitere Änderungen")})` : "";
  return `„${p.strategyName}“: ${first}${more} – Überanpassungs-Wahrscheinlichkeit ${pctText(p.overfit.p)} (${LEVEL[overfitLevel(p.overfit.p)]}), ${plural(p.test.cand.n, "Trade", "Trades")} in den Testfenstern, Ø ${rText(p.test.cand.avgR)} gegen ${rText(p.test.base.avgR)} bei der jetzigen Version.`;
}

export async function evolveAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const cfg = evolveCfgOf(evolveSource(env));
  const sum = learnedSummary(cfg);
  const open = cfg.proposals.filter((p) => p.decision === "open").sort((a, b) => a.overfit.p - b.overfit.p);
  const t = tokensOf(norm);
  const action = openAction(env, "Hintergrund-Optimierer öffnen", SPOT);

  if (has(t, "gelernt", "lernst", "lernt", "bewaehrt", "treffer")) {
    if (sum.empty) {
      return reply({
        title: "Noch nichts gelernt",
        text: `Der Optimierer hat noch keine Entscheidung und kein Live-Urteil von dir. Sobald du über Vorschläge entscheidest, merkt er sich, welche Art von Änderung du annimmst oder ablehnst – und ob sich Vorschläge im Vorwärtstest bestätigt haben. Zahlen nennt er erst ab ${5} Entscheidungen bzw. ${3} Live-Urteilen. ${NO_ADVICE}`,
        tone: "mute",
        actions: [action],
      });
    }
    const parts: string[] = [];
    parts.push(sum.acceptRate ? `Von ${sum.decided} entschiedenen Vorschlägen hast du ${sum.accepted} angenommen (${pctText(sum.acceptRate.p)}, 80-%-Bereich ${Math.round(sum.acceptRate.ci.lo * 100)}–${Math.round(sum.acceptRate.ci.hi * 100)} %).` : `Bisher ${plural(sum.decided, "Entscheidung", "Entscheidungen")} – zu wenig für eine Quote.`);
    parts.push(sum.live.rate ? `Von ${sum.live.n} live geprüften Vorschlägen haben sich ${sum.live.confirmed} bestätigt (${pctText(sum.live.rate.p)}).` : `Bisher ${plural(sum.live.n, "Live-Urteil", "Live-Urteile")} – zu wenig, um zu sagen, wie oft sich Vorschläge bestätigen.`);
    if (sum.match.avgDevPct != null) parts.push(`Das tatsächliche Ergebnis lag im Schnitt ${Math.abs(sum.match.avgDevPct).toFixed(1).replace(".", ",")} Prozentpunkte pro 30 Tage ${sum.match.avgDevPct < 0 ? "unter" : "über"} der Vorhersage.`);
    const top = sum.kinds.find((k) => k.note);
    if (top) parts.push(`${top.label}: ${top.note}`);
    return reply({
      title: "Das hat der Optimierer gelernt",
      text: `${parts.join(" ")} ${NO_ADVICE}`,
      facts: [fact("Entschieden", String(sum.decided), "fg", sum.decided), fact("Angenommen", String(sum.accepted), "fg", sum.accepted), fact("Live-Urteile", String(sum.live.n), "fg", sum.live.n), fact("Bestätigt", String(sum.live.confirmed), "fg", sum.live.confirmed)],
      actions: [action],
      followUps: ["Was hat der Optimierer gefunden?"],
    });
  }

  if (!open.length && !sum.trials && !sum.proposed) {
    return reply({
      title: "Der Optimierer ist noch nicht gelaufen",
      text: `Der Hintergrund-Optimierer probiert kleine, erklärte Änderungen an deinen Strategien aus (Schwellen, Filter, Ausstiege, Richtung), bewertet jede Variante nur auf Zeiträumen nach dem Training und rechnet alle getesteten Varianten in die Wahrscheinlichkeit ein, dass ein gutes Ergebnis nur Zufall ist. Er läuft nur, solange die App offen ist, und ändert nichts ohne deinen Klick je Vorschlag. Ich starte ihn nicht von mir aus – du startest ihn im Labor. ${NO_ADVICE}`,
      tone: "mute",
      actions: [action],
    });
  }

  const shown = open.slice(0, 2);
  const text = open.length
    ? `Offen sind ${plural(open.length, "Vorschlag", "Vorschläge")}. ${shown.map(line).join(" ")} Nichts davon ist angewendet: du entscheidest je Vorschlag, ob er eine neue Version wird, als Herausforderer live läuft oder abgelehnt wird. Gezählt sind bisher ${plural(Math.round(sum.trials), "Versuch", "Versuche")} über ${plural(sum.strategies, "Strategie", "Strategien")}. ${NO_ADVICE}`
    : `Zurzeit ist kein Vorschlag offen. Bisher zählt der Optimierer ${plural(Math.round(sum.trials), "Versuch", "Versuche")} über ${plural(sum.strategies, "Strategie", "Strategien")}; ${plural(sum.decided, "Vorschlag ist", "Vorschläge sind")} entschieden. „Nichts gefunden“ ist ein ehrliches Ergebnis – nicht jede Idee lässt sich mit kleinen Änderungen verbessern. ${NO_ADVICE}`;
  return reply({
    title: open.length ? "Offene Vorschläge des Optimierers" : "Kein offener Vorschlag",
    text,
    facts: [fact("Offen", String(open.length), "fg", open.length), fact("Versuche", String(Math.round(sum.trials)), "fg", sum.trials), fact("Entschieden", String(sum.decided), "fg", sum.decided)],
    tone: "fg",
    actions: [action],
    followUps: ["Was hat der Optimierer gelernt?"],
  });
}
