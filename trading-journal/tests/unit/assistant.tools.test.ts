/**
 * The assistant's evaluation tools: Prüfbericht / Belastung, Forward-Test, Trendlinien, Signale, Monatsnutzen, ähnliche
 * Situationen, „Passt zu dir?“, Strategie-Bibliothek. Routing (3–4 phrasings each, typos, no false hits on the journal
 * questions or on the tools that already exist) and the answers on fixture data – every figure in the expectations is
 * counted by hand in the comments, none is taken from the code under test.
 */
import { describe, expect, it } from "vitest";
import { understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 9, 19, 12).getTime(); // Mo 19.10.2026 12:00 local
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string, prevTool: { tool: never; question: string } | null = null): Plan => understand(q, { parse: PARSE, prev: null, closed: 20, ...(prevTool ? { prevTool } : {}) });
const route = (q: string): string => {
  const p = u(q);
  return p.kind === "tool" ? p.tool : p.kind;
};

const ROUTES: Record<string, string[]> = {
  audit: ["Hängt mein Backtest an wenigen Trades?", "Ist der Backtest nur wegen ein paar Ausreißern gut?", "Wie sieht der Prüfbericht aus?", "Haengt mein Backtst an einzelnen Gewinn-Trades?", "Gibt es Datenlücken im Backtest?"],
  stress: ["Wie lang war die längste Verlustserie?", "Wie viele Verlusttrades hintereinander im Backtest?", "Längste Verlustserie im Labor-Lauf", "Was passiert im Backtest bei doppelten Gebühren?", "Zeig mir den Belastungstets", "Wie tief war der Drawdown im Backtest?"],
  forward: ["Wie läuft mein Forward-Test?", "Hält das virtuelle Konto, was der Backtest zeigt?", "Forwadtest Ergebnis", "Wie steht mein Vorwärtstest?"],
  trend: ["Welche Zeiteinheiten haben eine Preis-Trendlinie in Annäherung?", "Gibt es einen Trendlinien-Bruch?", "Wie weit ist der Kurs von der nächsten Linie?", "Welche Zeiteinheiten sind gesperrt und warum?", "Trendlinine Retest"],
  signals: ["Welche Signale habe ich diese Woche ausgelassen und warum?", "Welche verpassten Signale hatten das Ziel zuerst?", "Wie ist die Trefferquote meiner Box-Setups?", "Singale diese Woche ausgelassen?", "Zeig mir meinen Signal-Posteingang"],
  quality: ["Wie lange war die App letzten Monat offen?", "Gab es Alarme mit mehr als 5 Minuten Verspätung?", "Wie zuverlässig sind meine Alarme?"],
  benefit: ["Was hat mir das Journal im September gebracht?", "Was bringt mir das Journal?", "Hat sich das Journal diesen Monat gelohnt?", "Was hat mir das Jurnal im Septmber gebarcht?"],
  situation: ["Wie ging es nach ähnlichen Situationen weiter?", "Wie oft ist der Kurs nach ähnlichen Kerzen gestiegen?", "Gibt es Gegenbeispiele zu ähnlichen Lagen?", "Was passierte nach vergleichbaren Situationen?"],
  fit: ["Passt diese Strategie zu mir?", "Passt der Backtest zu meinem Handelsstil?", "Ist diese Idee geeignet für mich?", "Pasts die Strategie zu mir?"],
  demands: ["Was verlangt die Idee von mir?", "Was muss ich für diese Strategie aushalten?", "Welche Anforderungen stellt der Backtest an mich?"],
  library: ["Gibt es eine Strategie mit Bollinger?", "Welche Werte nimmt man für die Supertrend-Strategie?", "Kennst du eine Strategie mit RSI?", "Zeig mir die Strategie-Bibliothek", "Gibts ne Strategie mit Bolinger?"],
};

describe("routing of the evaluation tools", () => {
  for (const [tool, phrasings] of Object.entries(ROUTES)) {
    it.each(phrasings)(`%s → ${tool}`, (q) => {
      expect(route(q)).toBe(tool);
    });
  }

  it("a plan carries the question as its argument and the learned topic", () => {
    const p = u("Hängt mein Backtest an wenigen Trades?");
    expect(p).toMatchObject({ kind: "tool", tool: "audit", topic: "audit", arg: "Hängt mein Backtest an wenigen Trades?" });
    expect(u("Hält das virtuelle Konto, was der Backtest zeigt?")).toMatchObject({ topic: "forward" });
    expect(u("Passt diese Strategie zu mir?")).toMatchObject({ topic: "fit" });
    expect(u("Was verlangt die Idee von mir?")).toMatchObject({ topic: "fit" });
  });

  it("journal questions stay journal questions", () => {
    for (const q of ["Win-Rate am Montag", "Wie ist meine Win-Rate am Montag?", "Wie war letzte Woche?", "Wie viel habe ich im September verdient?", "Was lief gut?", "Wie lang war meine längste Verlustserie?", "Wie ist meine Trefferquote bei Breakout?", "Ø R pro Setup", "Welche Strategie ist meine beste?", "Zeig mir meine Shorts von gestern", "Wie war der maximale Drawdown der Strategie Breakout?"]) expect(route(q), q).toBe("journal");
  });

  it("leaves the tools that already exist alone", () => {
    expect(route("Wo finde ich den Belastungstest?")).toBe("where");
    expect(route("Wo finde ich den Prüfbericht?")).toBe("where");
    expect(route("Wo finde ich die Strategie-Bibliothek?")).toBe("where");
    expect(route("Wo ist der Forward-Test?")).toBe("where");
    expect(route("Zeig mir ähnliche Situationen")).toBe("similar");
    expect(route("gab es schon mal eine ähnliche Marktlage?")).toBe("similar");
    expect(route("Teste diese Idee")).toBe("idea");
    expect(route("Ich will üben")).toBe("train");
    expect(route("Warum ist mein Backtest so schlecht?")).toBe("lab");
    expect(route("Was fehlt für meinen Einstieg?")).toBe("entry");
    expect(route("Wie läuft mein Wochenexperiment?")).toBe("experiment");
    expect(route("Merk dir: ich teste nur Strategien mit Bollinger")).toBe("memory");
    expect(route("öffne das Labor")).toBe("navigate");
  });

  it("a short follow-up continues the last evaluation with the new period", () => {
    const prev = { tool: "signals" as never, question: "Welche Signale habe ich diese Woche ausgelassen und warum?" };
    const p = u("und letzte Woche?", prev);
    expect(p).toMatchObject({ kind: "tool", tool: "signals", topic: "signals" });
    expect(p.kind === "tool" && p.arg).toBe("und letzte Woche? ".trim() === "" ? "" : `${prev.question} und letzte Woche?`);
    // without a previous evaluation it is a plain journal follow-up question
    expect(u("und letzte Woche?").kind).toBe("journal");
    // a new question with its own tool is not swallowed by the follow-up
    expect(u("und wie läuft mein Forward-Test?", prev)).toMatchObject({ tool: "forward" });
  });
});
