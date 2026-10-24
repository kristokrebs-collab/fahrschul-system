/**
 * Routes of the assistant's evaluation tools (the answers of the finished analyses: Prüfbericht, Belastung, Forward-Test,
 * Trendlinien, Signale, Monatsnutzen, ähnliche Situationen, „Passt zu dir?“, Strategie-Bibliothek). Pure language matching on
 * the normalised question – no data, no imports of the analyses – so the routing stays in the small part of the chunk and
 * the figures are fetched only when a route fires.
 *
 * A rule is a function of the question's words (`has` = word starts with a stem or is a typo of it, see `fuzzy.ts`), not a
 * regular expression: "Forwadtest", "Singale ausgelassen" or "Trendlinine" still reach their tool. The rules sit behind the
 * „Wo finde ich …?“ rules in `understand.ts` and are written so that the journal questions stay journal questions: a bare
 * „Win-Rate am Montag“ has none of the nouns below, and the figures that exist in the journal AND in the lab (a losing
 * streak) go to the lab only when the question names the lab run or does not say „mein / im Journal“.
 */
import { has, tokensOf } from "./fuzzy";

export const INSIGHT_TOOL_IDS = ["audit", "stress", "forward", "trend", "signals", "quality", "benefit", "situation", "fit", "demands", "library", "discovery", "evolve"] as const;
export type InsightToolId = (typeof INSIGHT_TOOL_IDS)[number];
export const isInsightTool = (t: string): t is InsightToolId => (INSIGHT_TOOL_IDS as readonly string[]).includes(t);

export interface InsightRule {
  tool: InsightToolId;
  /** learned topic (interest counter) */
  topic: string;
  /** chip „so habe ich dich verstanden“ */
  label: string;
  test: { test(norm: string): boolean };
}

/* ------------------------------------------------------------------ vocabulary */

/** Words that name the lab run / the tested idea. */
const LAB_RUN = ["backtest", "=labor", "=lauf", "testlauf", "simulation"] as const;
/** … plus the nouns that name a tested idea (only for „passt zu mir“ / „was verlangt“, where nothing else is asked). */
const LAB = [...LAB_RUN, "strategie", "=idee", "=ideen", "=system"] as const;
/** Words that make a question about the trader's own journal. */
const OWN = ["=mein", "=meine", "=meinen", "=meinem", "=meiner", "=meines", "journal", "=real", "=echt", "=konto"] as const;
/** Words of a time period (for follow-ups). */
const PERIOD = ["=heute", "=gestern", "=woche", "=wochen", "=monat", "=monate", "=januar", "=februar", "=maerz", "=april", "=mai", "=juni", "=juli", "=august", "=september", "=oktober", "=november", "=dezember"] as const;
const TF = /\b(30m|1h|2h|3h|4h|1d|1w)\b/;

const rule = (tool: InsightToolId, topic: string, label: string, f: (t: string[], n: string) => boolean): InsightRule => ({ tool, topic, label, test: { test: (n: string) => f(tokensOf(n), n) } });

/* ------------------------------------------------------------------ the rules */

export const INSIGHT_RULES: readonly InsightRule[] = [
  // 1 · Prüfbericht of the last lab run: does the result hang on a few trades, data holes, unseen periods
  rule("audit", "audit", "Prüfbericht", (t) => {
    const lab = has(t, ...LAB_RUN);
    const few = has(t, "wenig", "=paar", "einzeln", "best", "groessten", "=top") && has(t, "trade", "gewinn", "ausreisser", "treffer");
    const depends = has(t, "haeng", "abhaeng", "abhang", "verlass", "beruht", "stuetzt", "lebt");
    return (
      has(t, "pruefbericht") ||
      (lab && (has(t, "ausreisser", "ausreiser") || (depends && few) || (few && has(t, "=ohne")) || has(t, "datenluecke", "luecken", "=sample", "walk", "ungesehen", "nachtraeglich", "glueck", "zufall", "robust", "belastbar", "aussagekraeftig", "verlaesslich")))
    );
  }),
  // 1 · loss streaks and stress scenarios of the last lab run
  rule("stress", "stress", "Verlustserien & Belastung", (t, n) => {
    const lab = has(t, ...LAB_RUN);
    const own = has(t, ...OWN);
    const streak = has(t, "verlustserie", "verlustreihe", "verlustphase", "durststrecke", "negativserie", "pechstraehne", "hintereinander") || n.includes(" in folge") || (has(t, "serie", "serien", "=streak") && has(t, "verlust", "verlier", "minus"));
    if (streak && (lab || !own)) return true;
    if (has(t, "belastungstest", "stresstest", "belastungsszenario")) return true;
    if (lab && has(t, "drawdown", "rueckgang", "einbruch", "belastung", "=stress", "szenario", "filter", "filtervergleich")) return true;
    return lab && has(t, "gebuehr", "slippage", "funding", "kosten", "spaeter") && has(t, "doppelt", "verdoppel", "hoeher", "schlechter", "wuerde", "waere", "wenn", "mehr");
  }),
  // 2 · forward test (virtual account)
  rule("forward", "forward", "Forward-Test", (t) => has(t, "forward", "forwardtest", "vorwaerts", "vorwaertstest", "papierkonto", "paperkonto", "papiertrading", "papierhandel") || (has(t, "virtuell") && has(t, "konto", "konten", "depot"))),
  // 3 · trendlines of the price per timeframe: approach, break, retest, distance, locked timeframes
  rule("trend", "trend", "Trendlinien", (t) => {
    const unit = has(t, "zeiteinheit", "timeframe", "zeitebene");
    return has(t, "trendlini", "trendlin", "trendgerade") || (has(t, "=linie", "=linien") && has(t, "kurs", "preis", "abstand", "weit", "naechst", "annaeher", "bruch", "retest")) || (unit && has(t, "annaeher", "bruch", "retest", "gesperrt", "gebrochen"));
  }),
  // 4 · alert quality: how long the app was open, delayed alerts (before the signals rule: „Alarme mit Verspätung“)
  rule("quality", "quality", "Alarm- & Datenqualität", (t) => {
    const alerts = has(t, "alarm", "signal", "meldung", "benachricht", "push");
    const app = has(t, "=app", "programm", "=tab", "browser", "journal", "=seite");
    return (
      has(t, "alarmqualitaet", "datenqualitaet", "zustellprotokoll") ||
      (alerts && has(t, "verspaet", "verzoeger", "=delay", "zuverlaessig", "puenktlich", "zustell")) ||
      (app && has(t, "offen", "geoeffnet", "laeuft", "lief", "geschlossen", "ausfall", "unterbroch", "online") && has(t, "monat", "woche", "wochen", "tage", "tagen", "lange", "anteil", "zeit", "wieviel", "stunden"))
    );
  }),
  // 4 · signals: inbox, left out, hit rate, outcomes
  rule("signals", "signals", "Signale", (t) => {
    const sig = has(t, "signal", "alarm", "einstiegssignal");
    const box = has(t, "box") && has(t, "setup", "signal", "alarm", "scanner");
    return (
      has(t, "posteingang", "signalarchiv", "signalbilanz", "signalinbox") ||
      (sig && has(t, "ausgelassen", "auslassen", "verpasst", "uebersehen", "ignoriert", "gehandelt", "ziel", "stopp", "ausgang", "trefferquote", "quote", "bilanz", "treffer", "ausgegangen", "gewonn")) ||
      (box && has(t, "trefferquote", "quote", "treffer", "bilanz", "ausgang", "ziel", "erfolg", "hitrate", "wie gut")) ||
      (has(t, "ausgelassen", "verpasst") && has(t, "einstieg", "setup", "signal", "chance"))
    );
  }),
  // 5 · benefit of the journal in a month
  rule("benefit", "benefit", "Monatsnutzen", (t) => has(t, "monatsnutzen", "journalnutzen") || (has(t, "journal", "=app", "tool", "programm") && has(t, "gebracht", "bringt", "bringen", "nutzen", "genuetzt", "geholfen", "hilft", "vorteil", "lohnt", "gelohnt"))),
  // 6 · what happened after similar situations (the Markt card itself is opened by the existing „similar“ rule)
  rule("situation", "situation", "Ähnliche Situationen: Auswertung", (t) => {
    const similar = has(t, "aehnlich", "vergleichbar") || (has(t, "historisch", "frueher", "damals") && has(t, "situation", "lage", "kerze", "muster"));
    const subject = has(t, "situation", "lage", "marktlage", "kerze", "muster", "konstellation", "faelle", "fall");
    const outcome = has(t, "weiter", "danach", "passiert", "ging", "lief", "oft", "haeufig", "gestiegen", "gefallen", "stieg", "fiel", "hoeher", "tiefer", "verlauf", "quote", "prozent", "ausgang", "nachher", "gegenbeispiel", "statistik", "wahrscheinlich", "ergebnis", "gegenteil");
    return (similar && subject && outcome) || (has(t, "gegenbeispiel") && (subject || similar));
  }),
  // 6 · does the tested idea fit me / what does it ask of me
  rule("demands", "fit", "Was die Idee verlangt", (t) => {
    const idea = has(t, ...LAB);
    return idea && (has(t, "verlang", "abverlang", "erwartet", "fordert", "anforderung", "voraussetzung", "aushalten", "aushalt") || (has(t, "braucht", "benoetigt", "muss") && has(t, "=mir", "=mich", "=ich", "=von")));
  }),
  rule("fit", "fit", "Passt zu dir?", (t) => has(t, ...LAB, "=methode", "=ansatz") && has(t, "passt", "passen", "passend", "geeignet", "taugt", "liegt") && has(t, "=mir", "=mich", "=dir", "=dich", "=mein", "=meinem", "=meinen", "=meiner", "stil", "handelsstil", "journal", "typ")),
  // 6 · what the winners (or losers) have in common: the Muster-Entdecker of the Labor (only quotes a finished search – it never starts one)
  rule("discovery", "discovery", "Muster der Gewinner", (t) => {
    const side = has(t, "gewinner", "gewinntrade", "gewinnende", "gewonnene", "gewonnenen", "verlierer", "verlusttrade", "verlierende", "verlorene", "verlorenen", "erfolgreiche", "erfolgreichen");
    const common = has(t, "gemeinsam", "gemeinsamkeit", "unterscheid", "zusammenhang", "zusammenhaeng", "muster", "auffaellig");
    return has(t, "musterentdecker", "mustersuche", "musteranalyse") || (side && common);
  }),
  // 7 · strategy library (cards with typical values)
  rule("library", "library", "Strategie-Bibliothek", (t) => {
    const strategy = has(t, "strategie", "strategien", "handelsstrategie", "=system", "=systeme");
    // a question about the trader's own strategies („meine beste Strategie“, „die profitabelste“) is a journal question
    const journal = has(t, "=mir", "=mich", "=mein", "=meine", "=meinen", "=meiner", "=ich", "=beste", "=besten", "=bester", "beste", "schlecht", "profitabel", "erfolgreich", "verlust", "gewinn");
    return (
      has(t, "strategiebibliothek") ||
      (strategy && has(t, "bibliothek")) ||
      (strategy && !journal && has(t, "=gibt", "=gibts", "kennst", "existiert", "gaebe", "empfiehl", "=nenn", "=zeig")) ||
      // „Welche Werte nimmt man für …?“ – the usual settings of an idea
      (has(t, "=wert", "=werte", "einstellung", "parameter", "standardwert") && has(t, "=man", "nimmt", "nehmen", "ueblich", "typisch"))
    );
  }),
  // 8 · the background optimiser: „Verbessere meine Strategie im Hintergrund“, what it found, what it learned. „Woran soll ich arbeiten?“
  //     and the other journal improvements stay with the existing `improve` tool: the optimiser needs the strategy AND one of its own words
  rule("evolve", "evolve", "Hintergrund-Optimierer", (t) => {
    const strategy = has(t, "strategie", "strategien", "=idee", "=ideen", "regelsatz", "regelsaetze", "=regeln");
    const better = has(t, "verbesser", "optimier", "weiterentwickel", "verfeiner", "nachjustier", "feinschleif");
    const proposals = has(t, "=vorschlag", "=vorschlaege", "=vorschlaegen"); // the noun – „vorschlagen“ (suggest) asks the library
    const own = proposals || has(t, "hintergrund", "automatisch", "laufend", "staendig", "herausforder", "turnier", "versuchsprotokoll");
    return (
      has(t, "optimierer", "hintergrundoptimierer", "hintergrundoptimierung", "strategieoptimierer") ||
      (strategy && better && (own || has(t, "optimier", "weiterentwickel"))) ||
      (strategy && proposals) ||
      ((has(t, "optimierer", "hintergrund") || proposals) && has(t, "gelernt", "treffer", "bewaehrt"))
    );
  }),
];

/* ------------------------------------------------------------------ follow-ups */

/** The question names a period or a timeframe and carries no tool of its own: „und letzte Woche?“, „und auf 1h?“. */
export function followsInsight(norm: string, tool: InsightToolId): boolean {
  const t = tokensOf(norm);
  const period = has(t, ...PERIOD) || /\b20\d\d\b/.test(norm);
  const tf = TF.test(norm);
  switch (tool) {
    case "signals":
    case "quality":
    case "benefit":
      return period;
    case "situation":
      return tf;
    default:
      return false;
  }
}
