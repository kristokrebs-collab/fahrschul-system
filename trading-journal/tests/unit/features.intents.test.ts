/**
 * The self-check of the function search: what a trader types or says when they want something done – in their own words,
 * with typos, as a question – must bring the right function among the first three hits. Run against the page's finder
 * (`searchFeatures`, also the command navigation's and the assistant's) AND the global search (`searchIndex`, the
 * function hits). Every line is one intent of the user; a miss here is a function nobody finds in ten seconds.
 */
import { describe, expect, it } from "vitest";
import { searchFeatures, whereIs } from "@/app/featureQuery";
import { FEATURE_REGISTRY } from "@/app/features";
import { defaultSettings } from "@/domain/defaults";
import { searchIndex } from "@/search/rank";
import { buildSearchIndex } from "@/search/sources";

/** query → the function that must be among the first three hits (one id, or any of several equal answers) */
const INTENTS: readonly (readonly [string, string | readonly string[]])[] = [
  ["Strategie testen", "labor"],
  ["warum verliere ich?", ["leaks-edges", "fehler-kosten", "coach"]],
  ["TradingView-Skript", "pine-export"],
  ["Screenshot importieren", "screenshot-import"],
  ["Risiko berechnen", "positionsrechner"],
  ["Wochenbericht", "berichte"],
  ["wie groß soll meine Position sein", "positionsrechner"],
  ["Backup erstellen", "backup"],
  ["CSV von Binance importieren", "csv-import"],
  ["ich will einen Alarm setzen", "alarme"],
  ["Tagesplan machen", "tagesplan"],
  ["Verlustlimit festlegen", ["verlustlimits", "disziplin-grenzen", "risiko-einstellungen"]],
  ["Trade nachspielen", "replay"],
  ["was wäre wenn ich den Stop anders gesetzt hätte", "was-waere-wenn"],
  ["trading üben", "ueben"],
  ["Dark Mode einschalten", "darstellung"],
  ["Konto löschen", "konto-cloud"],
  ["Abo kündigen", "abo"],
  ["wie tief war mein Drawdown", "drawdown-verlauf"],
  ["zu welcher Uhrzeit bin ich am besten", ["heatmap", "zeit-session"]],
  ["was kosten mich die Gebühren", "analyse-kosten"],
  ["Ziele setzen", "ziele"],
  ["hängt meine Stimmung mit den Ergebnissen zusammen", ["checkin-auswertung", "stimmung-ergebnis"]],
  ["Revenge Trading erkennen", "verhalten"],
  ["Signale die ich verpasst habe", "verpasste-chancen"],
  ["Chart spiegeln", "bias-test"],
  ["Stresstest für meine Strategie", "belastungstest"],
  ["ist meine Strategie überoptimiert", "robustheit"],
  ["Rangliste", "rangliste"],
  ["Tastenkürzel", "tastenkuerzel"],
  ["Börse verbinden", "boerse-sync"],
  ["Liquidationspreis", "liquidation"],
  ["Korrelation der Märkte", "korrelation"],
  ["Monte Carlo", "monte-carlo"],
  ["Kalender mit meinen Gewinntagen", "pnl-kalender"],
  ["eigenes Dashboard anpassen", "cockpit"],
  ["neuen Trade eintragen", "trade-eintragen"],
  ["Setups vergleichen", "bibliothek"],
  ["Einstieg prüfen", "einstiegs-check"],
  ["Wo bin ich gerade im Minus", ["verlustlimits", "gesamtrisiko", "drawdown-verlauf"]],
  // typos and spoken endings
  ["Strategi testn", "labor"],
  ["Wochenbricht", "berichte"],
  ["Positonsrechner", "positionsrechner"],
  ["Overfiting", "robustheit"],
  ["Belastungstst", "belastungstest"],
  ["uben", "ueben"],
];

const ok = (got: readonly string[], want: string | readonly string[]): boolean => (typeof want === "string" ? got.slice(0, 3).includes(want) : want.some((w) => got.slice(0, 3).includes(w)));

describe("function search: what people type finds the right function", () => {
  it(`has at least 25 intents`, () => {
    expect(INTENTS.length).toBeGreaterThanOrEqual(25);
  });

  it("the finder (page, command navigation, assistant) has the right function among the first three hits", () => {
    const misses: string[] = [];
    for (const [q, want] of INTENTS) {
      const got = searchFeatures(q).map((h) => h.entry.id);
      if (!ok(got, want)) misses.push(`${q} → wanted ${String(want)}, got ${got.slice(0, 4).join(", ") || "nothing"}`);
    }
    expect(misses).toEqual([]);
  });

  it("the global search shows the right function among the first three function hits", () => {
    const items = buildSearchIndex({ trades: [], settings: defaultSettings(), days: {}, pages: ["overview", "labor", "coach"], now: Date.now(), features: FEATURE_REGISTRY });
    const misses: string[] = [];
    for (const [q, want] of INTENTS) {
      const feats = searchIndex(items, q)
        .filter((g) => g.kind === "feature")
        .flatMap((g) => g.hits.map((h) => h.item.id.replace("feature:", "")));
      if (!ok(feats, want)) misses.push(`${q} → wanted ${String(want)}, got ${feats.slice(0, 4).join(", ") || "nothing"}`);
    }
    expect(misses).toEqual([]);
  });

  it("answers the assistant's 'Wo finde ich …?' with the right function too", () => {
    for (const [q, want] of [
      ["Wo finde ich den Positionsrechner?", "positionsrechner"],
      ["Wo kann ich ein Backup machen?", "backup"],
      ["Wie komme ich zu den Wochenberichten?", "berichte"],
    ] as const) {
      expect(whereIs(q).hits.map((h) => h.entry.id), q).toContain(want);
    }
  });
});
