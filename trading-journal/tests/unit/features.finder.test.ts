/**
 * The finder for the areas that came late – Handelsplan, Zeitmaschine, Aktien (Scanner, Watchlist, News, Kongress, Analyst, DCF),
 * Datenarchiv, Demo, Belege, Termine, Alarme – asked the way people ask: a goal, a question, a half word, a slip of the keys. The
 * first three hits of the finder (page, command navigation, assistant) AND of the global search must hold the right function. And
 * the other way round: nonsense and wishes the app does not fulfil (orders, tips) must not produce a confident answer. Complements
 * `features.intents.test.ts` (the first fifty intents); a miss here is a function nobody finds in ten seconds.
 */
import { describe, expect, it } from "vitest";
import { searchFeatures, STRONG_HIT, whereIs } from "@/app/featureQuery";
import { FEATURE_REGISTRY, featureById } from "@/app/features";
import { defaultSettings } from "@/domain/defaults";
import { searchIndex } from "@/search/rank";
import { buildSearchIndex } from "@/search/sources";

type Want = string | readonly string[];

/** query → the function(s) of which one must stand among the first three hits */
const ASK: readonly (readonly [string, Want])[] = [
  // Handelsplan, Zeitmaschine, Verwaltung
  ["Handelsplan erstellen", ["handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse"]],
  ["Wo plane ich meinen Trade", ["handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse"]],
  ["Trade planen", ["handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse", "tagesplan"]],
  ["Stop und Ziel festlegen", "handelsplan-ausstieg"],
  ["wann soll ich einsteigen", ["handelsplan-einstieg", "einstiegs-check"]],
  ["Plan ausdrucken oder kopieren", "handelsplan-ticket"],
  ["Ticket zum Kopieren", "handelsplan-ticket"],
  ["passt mein Plan zu meinen Limits", "handelsplan-risiko"],
  ["ist die Order ausführbar", "ausfuehrbarkeit-live"],
  ["Spread und Tiefe prüfen", "ausfuehrbarkeit-live"],
  ["Stop nachziehen planen", ["verwaltung-planen", "positionsverwaltung"]],
  ["Break-even testen", ["positionsverwaltung", "verwaltung-vergleich"]],
  ["Plan durchspielen", "zeitmaschine"],
  ["Zeitmaschine", "zeitmaschine"],
  ["Plan in der Vergangenheit testen", "zeitmaschine"],
  ["was wäre mein Plan gestern gewesen", "zeitmaschine"],
  ["wie wahrscheinlich ist mein Ziel", "zeitmaschine"],
  // Aktien
  ["Aktien scannen", "aktien-scanner"],
  ["Aktie suchen", ["aktien-scanner", "aktien-watchlist"]],
  ["Aktien beobachten", "aktien-watchlist"],
  ["Watchlist", "aktien-watchlist"],
  ["Nachrichten zu Apple", ["aktien-news", "zahlen-analyst"]],
  ["News lesen", "aktien-news"],
  ["Schlagzeilen", "aktien-news"],
  ["Kongress", "aktien-kongress"],
  ["Pelosi", "aktien-kongress"],
  ["Politiker Aktien", "aktien-kongress"],
  ["Branchen Trend", "branchen-trend"],
  ["Branchen Ampel", "branchen-trend"],
  ["welche Branchen sind im Aufwärtstrend", "branchen-trend"],
  ["Zarattini Antonacci", "branchen-trend"],
  ["Megatest Ergebnis laden", "branchen-trend"],
  ["Quartalszahlen", "zahlen-analyst"],
  ["Bilanz einer Firma", "zahlen-analyst"],
  ["Umsatz und Gewinn einer Aktie", "zahlen-analyst"],
  ["ist die Aktie zu teuer", "dcf-rechner"],
  ["fairer Wert Aktie", "dcf-rechner"],
  ["DCF", "dcf-rechner"],
  ["Kaufthese", "kaufthese"],
  ["warum habe ich die Aktie gekauft", "kaufthese"],
  ["Bewertung einer Aktie", "dcf-rechner"],
  // Datenarchiv, Squeeze, Termine, Alarme
  ["Datenarchiv", "datenarchiv"],
  ["Archiv", "datenarchiv"],
  ["Marktdaten speichern", "datenarchiv"],
  ["Börsenhistorie nachladen", "boersenhistorie-nachladen"],
  ["Short Squeeze erkennen", "squeeze-beobachtung"],
  ["Termine", "ereigniskalender"],
  ["Wirtschaftskalender", "ereigniskalender"],
  ["Wann ist die nächste Fed Sitzung", "ereigniskalender"],
  ["Was ist heute wichtig", "morgenbriefing"],
  ["E-Mail Alarm", "email-alarm"],
  ["Alarm per Mail", "email-alarm"],
  ["Benachrichtigung wenn die App zu ist", "email-alarm"],
  ["Preisalarm", ["alarme", "schluesselmarken"]],
  ["Wichtige Preise markieren", "schluesselmarken"],
  // Labor, Studio, Playbooks
  ["Strategie in Worten schreiben", "strategie-studio"],
  ["Strategie als Text", "strategie-studio"],
  ["Strategie verbessern lassen", "hintergrund-optimierer"],
  ["Muster finden in meinen Trades", "muster-entdecker"],
  ["Was haben meine Gewinner gemeinsam", "muster-entdecker"],
  ["Pine Script", "pine-export"],
  ["Strategie live testen ohne Geld", "forward-test"],
  ["Papiertrading", "forward-test"],
  ["Playbook teilen", ["playbook-austausch", "teilen"]],
  // Demo, Hilfe, Belege, Community
  ["Demo ausprobieren", "produktdemo"],
  ["Beispieldaten", "produktdemo"],
  ["App ausprobieren ohne eigene Daten", "produktdemo"],
  ["Ergebnisbeleg", "ergebnisbeleg"],
  ["Beleg teilen", "ergebnisbeleg"],
  ["Track Record", "ergebnisbeleg"],
  ["Gruppe beitreten", "gruppen"],
  ["Mentor", "mentor"],
  ["Link teilen", "teilen"],
  ["Einführung wiederholen", "einfuehrung"],
  ["Tastenkombinationen", "tastenkuerzel"],
  ["Shortcuts", "tastenkuerzel"],
  ["Sprachsteuerung", "assistent"],
  ["Transaktionsbuch", "transaktionsbuch"],
  ["Bericht als PDF", "export"],
  ["Daten sichern", "backup"],
  // slips of the keys and spoken forms
  ["Handlsplan", ["handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse", "handelsplan-risiko", "handelsplan-ticket"]],
  ["Zeitmaschiene", "zeitmaschine"],
  ["Kongres Trades", "aktien-kongress"],
  ["Datenarchiev", "datenarchiv"],
  ["Beispieldaten ausprobiern", "produktdemo"],
  ["Ergebnisbeleg teilen", "ergebnisbeleg"],
];

const ok = (got: readonly string[], want: Want): boolean => (typeof want === "string" ? got.slice(0, 3).includes(want) : want.some((w) => got.slice(0, 3).includes(w)));

describe("finder: the late areas are found in the words of a trader", () => {
  it("has a long list of asks and every id in it exists", () => {
    expect(ASK.length).toBeGreaterThanOrEqual(80);
    for (const [, want] of ASK) for (const id of typeof want === "string" ? [want] : want) expect(featureById(id), id).toBeTruthy();
  });

  it("the finder holds the right function among the first three hits", () => {
    const misses: string[] = [];
    for (const [q, want] of ASK) {
      const got = searchFeatures(q).map((h) => h.entry.id);
      if (!ok(got, want)) misses.push(`${q} → wanted ${String(want)}, got ${got.slice(0, 4).join(", ") || "nothing"}`);
    }
    expect(misses).toEqual([]);
  });

  it("the global search shows it among the first three function hits too", () => {
    const items = buildSearchIndex({ trades: [], settings: defaultSettings(), days: {}, pages: ["overview", "labor", "coach", "plan", "aktien"], now: Date.now(), features: FEATURE_REGISTRY });
    const misses: string[] = [];
    for (const [q, want] of ASK) {
      const feats = searchIndex(items, q)
        .filter((g) => g.kind === "feature")
        .flatMap((g) => g.hits.map((h) => h.item.id.replace("feature:", "")));
      if (!ok(feats, want)) misses.push(`${q} → wanted ${String(want)}, got ${feats.slice(0, 4).join(", ") || "nothing"}`);
    }
    expect(misses).toEqual([]);
  });

  it("answers the assistant's place question for the new areas", () => {
    for (const [q, want] of [
      ["Wo finde ich die Zeitmaschine?", "zeitmaschine"],
      ["Wo finde ich den Kongress-Tracker?", "aktien-kongress"],
      ["Wo finde ich den Branchen-Trend?", "branchen-trend"],
      ["Wo kann ich die Demo starten?", "produktdemo"],
      ["Wie komme ich zum Datenarchiv?", "datenarchiv"],
      ["Wo ist der Handelsplan?", ["handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse", "handelsplan-risiko", "handelsplan-ticket"]],
      ["Wo finde ich den Ergebnisbeleg?", "ergebnisbeleg"],
    ] as const) {
      const got = whereIs(q).hits.map((h) => h.entry.id);
      expect(ok(got, want), `${q}: ${got.join(", ")}`).toBe(true);
    }
  });
});

describe("finder: no noise, no promise the app does not keep", () => {
  /** words that mean nothing here: no function may answer with confidence */
  const NOISE = ["Pizza bestellen", "Katze", "Fußball", "xyzabc", "asdf", "Danke", "Immobilien", "Kreditkarte", "Tesla", "Wetter morgen", "Auto kaufen", "Hallo"];

  it("nonsense finds nothing sure", () => {
    for (const q of NOISE) {
      const strong = searchFeatures(q).filter((h) => h.score >= STRONG_HIT);
      expect(strong.map((h) => h.entry.id), q).toEqual([]);
    }
  });

  it("'Was kann die App' is no function-name hit: every function is in the app", () => {
    const top = searchFeatures("Was kann die App")[0];
    expect(!top || top.score < STRONG_HIT || top.entry.id === "produktdemo", top?.entry.id).toBe(true);
  });

  it("a wish to send an order leads to the ticket – which says in the register that nothing is ever sent – and no function claims to act", () => {
    const top = searchFeatures("Order senden").filter((h) => h.score >= STRONG_HIT)[0];
    expect(top?.entry.id).toBe("handelsplan-ticket");
    const ticket = featureById("handelsplan-ticket")!;
    expect(`${ticket.benefit} ${ticket.note}`).toMatch(/nie zum Senden|sendet nie eine Order/);
    // no entry of the register promises to trade for you
    for (const f of FEATURE_REGISTRY) expect(`${f.name} ${f.task} ${f.benefit}`, f.id).not.toMatch(/handelt für dich|automatisch handeln|sendet (die )?Orders? an/i);
  });
});
