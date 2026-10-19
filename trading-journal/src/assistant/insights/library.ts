/**
 * „Gibt es eine Strategie mit Bollinger?“ / „Welche Werte nimmt man für die Supertrend-Strategie?“ – the strategy library of the
 * Labor (`@/domain/lab/library`: well-known ideas as cards with typical values in three settings). The assistant finds the card
 * by its words (tolerating typos), names its idea, usual timeframes and typical values and offers „In Eigene Idee laden“, which
 * only fills the lab's draft (with the way back of „Idee aus dem Journal“) – nothing is saved or started. The cards carry no
 * result: bekannt heißt nicht wirksam; what an idea did on real history shows only the trader's own run.
 */
import type { IdeaDraft } from "@/domain/lab";
import { KIND_LABEL, KIND_ORDER, STRATEGY_CARDS, buildCard, valueText, type StrategyCard } from "@/domain/lab/library";
import { leafText, leavesOf, summarizeCustom } from "@/domain/lab/rules/tree";
import { TF_LABEL } from "@/domain/lab/rules/types";
import { near, tokensOf } from "../fuzzy";
import { closeAssistant } from "../open";
import type { ReplyAction, ToolEnv, ToolReply } from "../tools";
import { fact, reply } from "./shared";

/** Words of the question that say what is asked, not which strategy: they are not looked up in the cards. */
const STOP = new Set(
  "gibt es eine ne nen ein einen einem einer strategie strategien handelsstrategie system systeme mit ohne fuer fuers auf nach und oder die der das den dem des zur zum zu im in von bei aus wie was wo welche welcher welches werte wert nimmt nehmen man ueblich ueblichen typisch typische typischen standard standardwerte einstellung einstellungen parameter zahlen hast du kennst ich mir mich mal bitte nenn nenne zeig zeige gibts basiert basierend indikator indikatoren bibliothek idee ideen ist sind kann gibt's gaebe existiert empfiehl empfiehlst fuer's alle alles noch auch gern".split(" "),
);

/** Cards whose words match the question's content words best (all of them if several tie, at most three). */
export function findCards(norm: string, cards: readonly StrategyCard[] = STRATEGY_CARDS): { cards: StrategyCard[]; keywords: string[] } {
  const keywords = tokensOf(norm).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!keywords.length) return { cards: [], keywords };
  const scored = cards.map((c, i) => {
    const hay = tokensOf(` ${c.id.replace(/-/g, " ")} ${c.title} ${c.sub} ${c.knownFrom} ${KIND_LABEL[c.kind]} ${c.params.map((p) => p.name).join(" ")} ${c.tfs.join(" ")} `.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9 ]+/g, " "));
    const title = tokensOf(c.title.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9 ]+/g, " "));
    const hit = (kw: string, words: readonly string[]): boolean => words.some((w) => near(w, kw) || (w.length >= 5 && kw.startsWith(w)));
    const score = keywords.filter((k) => hit(k, hay)).length + keywords.filter((k) => hit(k, title)).length * 0.5;
    return { c, score, i };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best < 1) return { cards: [], keywords };
  return { cards: scored.filter((s) => s.score === best).sort((a, b) => a.i - b.i).slice(0, 3).map((s) => s.c), keywords };
}

const num = (v: number): string => String(v).replace(".", ",");

/** The typical values of a card in one sentence: Standard first, the two other settings in brackets. */
export function valuesLine(c: StrategyCard): string {
  return c.params.map((p) => `${p.name}: ${valueText(p, 1)} (konservativ ${num(p.v[0])}, aggressiv ${num(p.v[2])})`).join("; ");
}

/** The lab draft of a card's Standard setting (the same rule tree the library sheet loads). */
export function draftOfCard(c: StrategyCard): IdeaDraft {
  const config = buildCard(c, "standard");
  return { source: "combo", origin: `Strategie-Bibliothek: ${c.title} (Standard)`, symbol: null, config, rules: leavesOf(config.long).map(leafText), mapped: summarizeCustom(config), notes: c.approx ? [c.approx] : [], gaps: [], testable: true, blocked: null };
}

const HONEST = "Das sind übliche Einstellungen der Idee, keine Empfehlung und kein Ergebnis: bekannt heißt nicht wirksam. Was sie auf echter Historie täte, zeigt nur dein Lauf im Labor.";

function loadAction(env: ToolEnv, c: StrategyCard, several: boolean): ReplyAction {
  return {
    label: several ? `${c.title} in Eigene Idee laden` : "In Eigene Idee laden",
    run: () => {
      // fills the lab's draft with the way back („Vorheriges Setup zurück“); nothing is saved, nothing starts
      env.applyIdea?.(draftOfCard(c));
      closeAssistant();
      env.go("labor");
    },
  };
}

function libraryAction(env: ToolEnv): ReplyAction {
  return {
    label: "Bibliothek öffnen",
    run: () => {
      closeAssistant();
      if (env.openLibrary) env.openLibrary();
      else env.go("labor");
    },
  };
}

export async function libraryAnswer(norm: string, env: ToolEnv): Promise<ToolReply> {
  const { cards, keywords } = findCards(norm);
  const asksValues = tokensOf(norm).some((w) => ["wert", "werte", "einstellung", "einstellungen", "parameter", "standard", "standardwerte", "nimmt", "nehmen", "ueblich", "typisch"].some((s) => w.startsWith(s)));
  if (!keywords.length) {
    const byKind = KIND_ORDER.map((k) => `${KIND_LABEL[k]} ${STRATEGY_CARDS.filter((c) => c.kind === k).length}`).join(", ");
    return reply({
      title: `${STRATEGY_CARDS.length} Strategien in der Bibliothek`,
      text: `Die Strategie-Bibliothek im Labor hat ${STRATEGY_CARDS.length} bekannte Ideen mit üblichen Werten (${byKind}). Nenne mir einen Indikator oder Namen – zum Beispiel „Gibt es eine Strategie mit Bollinger?“ –, dann suche ich die Karte. ${HONEST}`,
      facts: [fact("Karten", String(STRATEGY_CARDS.length), "fg", STRATEGY_CARDS.length)],
      actions: [libraryAction(env)],
      followUps: ["Gibt es eine Strategie mit Bollinger?", "Welche Werte nimmt man für die Supertrend-Strategie?"],
    });
  }
  if (!cards.length) {
    return reply({
      title: "Keine passende Strategie",
      text: `Zu „${keywords.join(" ")}“ finde ich keine Karte in der Bibliothek (${STRATEGY_CARDS.length} Ideen, nach Indikator, Name oder Typ durchsuchbar). Vielleicht heißt es dort anders – die Bibliothek hat eine eigene Suche. Ich erfinde keine Strategie dazu.`,
      tone: "mute",
      actions: [libraryAction(env)],
      followUps: ["Gibt es eine Strategie mit Bollinger?"],
    });
  }
  const top = cards[0]!;
  const several = cards.length > 1;
  const lines = cards.map((c, i) => {
    const head = `${c.title} (${KIND_LABEL[c.kind]}, üblich auf ${c.tfs.map((t) => TF_LABEL[t]).join(" · ")}): ${c.sub}`;
    return i === 0 || asksValues ? `${head} Typische Werte – ${valuesLine(c)}.` : head;
  });
  const weak = top.weaknesses[0] ? ` Typische Schwäche: ${top.weaknesses[0]}` : "";
  return reply({
    title: several ? `${cards.length} passende Strategien` : top.title,
    text: `${several ? `Das passt zu „${keywords.join(" ")}“: ` : "Ja: "}${lines.join(" ")}${several ? "" : weak} ${HONEST}${top.approx ? ` Hinweis zur Karte: ${top.approx}` : ""}`,
    facts: [fact("Typ", KIND_LABEL[top.kind]), ...top.params.slice(0, 3).map((p) => fact(p.name, valueText(p, 1)))],
    actions: [...cards.slice(0, 2).map((c) => loadAction(env, c, several)), libraryAction(env)],
    followUps: asksValues ? ["Gibt es eine Strategie mit Bollinger?"] : [`Welche Werte nimmt man für die ${top.title.replace(/\s*\(.*\)\s*$/, "")}-Strategie?`],
  });
}
