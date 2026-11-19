/**
 * „Was haben meine Gewinner gemeinsam?“ – the answer behind the card „Muster-Entdecker“ of the Labor. The assistant does NOT
 * search by itself (like every evaluation tool it reads what exists): it quotes the last finished search of this session – the
 * number of tests, the patterns that held up against chance with their rates and sample, and the stamp of the search – and
 * otherwise says honestly that nothing was computed, how many journal trades there are against the minimum, and opens the card.
 * Patterns are observations, never causes; nothing is changed, started or adopted.
 */
import { countsSentence, findingSentence, DISCLAIMER } from "@/domain/discovery/text";
import { LIMITS, type Finding } from "@/domain/discovery/types";
import type { ToolEnv, ToolReply } from "../tools";
import { discoveryMemory } from "./sources";
import { fact, openAction, plural, reply, stampText } from "./shared";

const SPOT = { page: "labor", testid: "labor-discovery", feature: "muster-entdecker" } as const;

export async function discoveryAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const mem = await discoveryMemory(env);
  const open = openAction(env, "Muster-Entdecker öffnen", SPOT);
  const wantLoss = /\b(verlier\w*|verlust\w*|verlor\w*)\b/.test(norm) && !/\bgewinn\w*|gewonn\w*/.test(norm);
  if (!mem) {
    const have = (env.list ?? env.data.closed).filter((t) => t.r != null && Number.isFinite(t.r)).length;
    return reply({
      title: "Das habe ich noch nicht gerechnet",
      text: `Was Gewinner und Verlierer gemeinsam haben, prüft der Muster-Entdecker im Labor (ganz unten): viele Merkmale des Einstiegs, einzeln und paarweise, gegen den Zufall – mit der Zahl der Prüfungen und den verworfenen Mustern. Er braucht mindestens ${LIMITS.minTrades} Trades mit bekanntem R; dein Journal hat ${plural(have, "solchen Trade", "solche Trades")}${have < LIMITS.minTrades ? ` – das reicht noch nicht, mit weniger fände die Suche vor allem Zufall` : ""}. Ich starte die Suche nicht von mir aus: Öffne die Karte und drück „Muster suchen“.`,
      tone: "mute",
      facts: [fact("Trades mit R", String(have), "fg", have), fact("Mindestens", String(LIMITS.minTrades), "mute", LIMITS.minTrades)],
      actions: [open],
      followUps: ["Hängt mein Backtest an wenigen Trades?"],
    });
  }
  const r = mem.result;
  const what = `${mem.label ?? (mem.source === "journal" ? "Journal" : "Backtest")} · ${plural(r.n, "Trade", "Trades")} · Stand ${stampText(mem.at)}`;
  if (r.status !== "ok") {
    return reply({ title: "Keine Prüfung möglich", text: `${what}: ${r.note ?? "Die Suche hatte nichts zu prüfen."}`, tone: "mute", actions: [open] });
  }
  const confirmed = r.findings.filter((f) => f.tier === "confirmed");
  const asked: Finding[] = confirmed.filter((f) => f.side === (wantLoss ? "loss" : "win")).slice(0, 3);
  const other = confirmed.filter((f) => f.side === (wantLoss ? "win" : "loss")).length;
  const word = wantLoss ? "Verlierer" : "Gewinner";
  const head = `${countsSentence(r.counts)} (${what}.)`;
  const body = asked.length
    ? `Bestätigt – also auch an den neueren Trades gleich und nach Korrektur für alle Prüfungen nicht mit Zufall erklärbar: ${asked.map(findingSentence).join(" · ")}.`
    : `Für ${word} hält kein Muster gegen den Zufall stand${r.counts.hint > 0 ? `; ${plural(r.counts.hint, "Hinweis", "Hinweise")} gibt es nur im älteren Teil der Trades (nicht bestätigt)` : ""}${other > 0 ? `. Bestätigt ${other === 1 ? "ist" : "sind"} dagegen ${plural(other, "Muster", "Muster")} auf der anderen Seite` : ""}.`;
  return reply({
    title: asked.length ? `Das haben deine ${word} gemeinsam` : `Nichts Gemeinsames bei den ${word}n bestätigt`,
    text: `${head} ${body} ${DISCLAIMER}`,
    tone: asked.length ? "fg" : "mute",
    facts: [fact("Geprüft", r.counts.tested.toLocaleString("de-DE"), "fg", r.counts.tested), fact("Bestätigt", String(r.counts.confirmed), r.counts.confirmed ? "win" : "mute", r.counts.confirmed), fact("Hinweise", String(r.counts.hint), "mute", r.counts.hint), fact("Trades", String(r.n), "fg", r.n)],
    actions: [open],
    followUps: wantLoss ? ["Was haben meine Gewinner gemeinsam?"] : ["Was haben meine Verlierer gemeinsam?"],
  });
}
