/**
 * P04 NLQ: table tests of German phrases → intent (metric, filters, group-by, period, comparison, behaviour), the
 * answer engine over a fixture journal (numbers agree with `aggregate`, evidence, chart, confidence) and the honest
 * fallback.
 */
import { describe, expect, it } from "vitest";
import { accountView } from "@/domain/account";
import { aggregate } from "@/domain/agg";
import { detectBehaviors } from "@/domain/coach/events";
import { answerIntent, askJournal, normalize, parseContextOf, parseQuestion, selectTrades, suggestQuestions, type AnswerData, type Intent } from "@/domain/coach/nlq";
import { at, COACH_SETTINGS, coachJournal, enrichC } from "./coach.fixtures";

// Wednesday 2026-06-10 12:00 local
const NOW = new Date(2026, 5, 10, 12).getTime();
const CTX = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: ["breakout"], now: NOW };
const p = (q: string): Intent => parseQuestion(q, CTX);

interface Row {
  q: string;
  type: Intent["type"];
  metric?: Intent["metric"];
  filters?: [string, string][];
  period?: string;
  period2?: string;
  groupBy?: Intent["groupBy"];
  sort?: Intent["sort"];
  compare?: [string, string];
  behavior?: Intent["behavior"];
}

const TABLE: Row[] = [
  { q: "Wie ist meine Win-Rate am Montag?", type: "metric", metric: "winRate", filters: [["weekday", "0"]] },
  { q: "Trefferquote bei Shorts letzte Woche", type: "metric", metric: "winRate", filters: [["side", "short"]], period: "lastWeek" },
  { q: "Wie viel habe ich diesen Monat verdient?", type: "metric", metric: "net", period: "thisMonth" },
  { q: "Was ist mein bestes Setup?", type: "group", groupBy: "setup", sort: "best" },
  { q: "Welche Session ist am profitabelsten?", type: "group", groupBy: "session", sort: "best" },
  { q: "An welchem Wochentag verliere ich am meisten?", type: "group", groupBy: "weekday", sort: "worst" },
  { q: "Ø R pro Setup", type: "group", metric: "avgR", groupBy: "setup" },
  { q: "Profit Factor im Makro-Konto", type: "metric", metric: "pf", filters: [["account", "makro"]] },
  { q: "Durchschnittliches R bei BTC", type: "metric", metric: "avgR", filters: [["asset", "BTC"]] },
  { q: "Wie viele Trades hatte ich im September?", type: "metric", metric: "count", period: "month" },
  { q: "Mein größter Verlust", type: "metric", metric: "worst" },
  { q: "Bester Trade dieses Jahr", type: "metric", metric: "best", period: "thisYear" },
  { q: "Vergleiche Long und Short", type: "compare", compare: ["long", "short"] },
  { q: "London oder New York – was ist besser?", type: "compare", compare: ["london", "ny"] },
  { q: "Vergleiche diesen Monat mit letztem Monat", type: "compare", period: "thisMonth", period2: "lastMonth" },
  { q: "Win-Rate Breakout vs Fade", type: "compare", metric: "winRate", compare: ["s_good", "s_bad"] },
  { q: "Wie oft habe ich Revenge-Trades gemacht?", type: "behavior", behavior: "revenge" },
  { q: "Was kosten mich FOMO-Einstiege?", type: "behavior", behavior: "fomo" },
  { q: "Wie oft habe ich den Stop verschoben?", type: "behavior", behavior: "stopMoved" },
  { q: "Bin ich zu früh raus?", type: "behavior", behavior: "earlyProfit" },
  { q: "Tilt in den letzten 30 Tagen", type: "behavior", behavior: "tilt", period: "lastDays" },
  { q: "Wie oft habe ich Regeln gebrochen?", type: "behavior", behavior: "ruleViolation" },
  { q: "Zeig mir meine Shorts von gestern", type: "list", filters: [["side", "short"]], period: "yesterday" },
  { q: "Wie war letzte Woche?", type: "summary", period: "lastWeek" },
  { q: "Win-Rate mit Hebel über 10", type: "metric", metric: "winRate", filters: [["leverage", ">10"]] },
  { q: "Erwartung bei Überzeugung 5", type: "metric", metric: "expectancy", filters: [["conviction", "=5"]] },
  { q: "Gebühren im Q2", type: "metric", metric: "fees", period: "quarter" },
  { q: "Drawdown 2025", type: "metric", metric: "maxDD", period: "year" },
  { q: "Win-Rate der Gewinner? Nein: Verlierer am Freitag", type: "metric", metric: "winRate", filters: [["result", "win"], ["result", "loss"], ["weekday", "4"]] },
  { q: "Wie lange halte ich Verlierer?", type: "metric", metric: "hold", filters: [["result", "loss"]] },
  { q: "Ergebnis in der Asien-Session", type: "metric", metric: "net", filters: [["session", "asia"]] },
  { q: "Trades auf 15m", type: "summary", filters: [["timeframe", "15m"]] },
  { q: "P&L #breakout", type: "metric", metric: "net", filters: [["tag", "breakout"]] },
  { q: "Hallo, wie geht das Wetter?", type: "unknown" },
];

describe("Intent-Parser (Tabelle)", () => {
  for (const row of TABLE) {
    it(row.q, () => {
      const i = p(row.q);
      expect(i.type).toBe(row.type);
      if (row.metric) expect(i.metric).toBe(row.metric);
      if (row.filters) expect(i.filters.map((f) => [f.dim, f.op ? `${f.op}${f.num}` : f.value])).toEqual(row.filters);
      if (row.period) expect(i.period?.kind).toBe(row.period);
      if (row.period2) expect(i.period2?.kind).toBe(row.period2);
      if (row.groupBy) expect(i.groupBy).toBe(row.groupBy);
      if (row.sort !== undefined) expect(i.sort).toBe(row.sort);
      if (row.compare) expect(i.compare?.map((f) => f.value)).toEqual(row.compare);
      if (row.behavior) expect(i.behavior).toBe(row.behavior);
      if (row.type !== "unknown") expect(i.understood.length).toBeGreaterThan(0);
    });
  }
});

describe("Normalisierung und Zeiträume", () => {
  it("folds umlauts, ß and punctuation", () => {
    expect(normalize("Größter Verlust?! Überzeugung")).toBe(" groesster verlust ueberzeugung ");
    expect(normalize("Win-Rate")).toBe(" win rate ");
  });

  it("resolves the periods against now", () => {
    const lw = p("letzte Woche").period!;
    expect(new Date(lw.from)).toEqual(new Date(2026, 5, 1));
    expect(new Date(lw.to)).toEqual(new Date(2026, 5, 8));
    const sep = p("im September").period!;
    expect(new Date(sep.from)).toEqual(new Date(2025, 8, 1));
    const may = p("Mai 2026").period!;
    expect(new Date(may.from)).toEqual(new Date(2026, 4, 1));
    const q2 = p("Q2").period!;
    expect(new Date(q2.from)).toEqual(new Date(2026, 3, 1));
    expect(new Date(q2.to)).toEqual(new Date(2026, 6, 1));
    const d30 = p("letzte 30 Tage").period!;
    expect(new Date(d30.to)).toEqual(new Date(2026, 5, 11));
  });
});

describe("Antworten", () => {
  const enriched = enrichC(coachJournal(120));
  const view = accountView(enriched, COACH_SETTINGS, "all", { now: () => NOW });
  const events = detectBehaviors({ trades: enriched, settings: COACH_SETTINGS });
  const data: AnswerData = { closed: view.closed, settings: COACH_SETTINGS, events, now: NOW, currency: "USDT", start: view.start };
  const ask = (q: string) => askJournal(q, data);

  it("numbers agree with aggregate()", () => {
    const a = ask("Win-Rate bei Shorts");
    const shorts = view.closed.filter((t) => t.side === "short");
    const g = aggregate(shorts);
    expect(a.kind).toBe("metric");
    expect(a.facts[0]!.raw).toBeCloseTo(g.winRate!, 9);
    expect(a.text).toContain(`${g.n} Trades`);
    expect(a.confidence.n).toBe(g.n);
    expect(a.trades.length).toBeGreaterThan(0);
  });

  it("group answers name the robust best bucket with a bar chart", () => {
    const a = ask("Was ist mein bestes Setup?");
    expect(a.kind).toBe("group");
    expect(a.facts[0]!.value).toBe("Breakout");
    expect(a.chart?.type).toBe("bars");
    expect(a.chart && a.chart.type === "bars" && a.chart.rows.some((r) => r.highlight && r.label === "Breakout")).toBe(true);
    expect(["klar", "Tendenz"]).toContain(a.confidence.label);
  });

  it("compares two sides with a test", () => {
    const a = ask("Vergleiche Breakout und Fade");
    expect(a.kind).toBe("compare");
    expect(a.text).toContain("Breakout liegt vorn");
    expect(a.confidence.label).toBe("klar");
  });

  it("behaviour answers count, cost and advise", () => {
    const a = ask("Was kosten mich Revenge-Trades?");
    expect(a.kind).toBe("behavior");
    expect(a.facts[0]!.raw).toBeGreaterThan(3);
    expect(a.text).toContain("Pause");
    expect(a.trades.length).toBeGreaterThan(0);
  });

  it("an empty selection says so instead of guessing", () => {
    const a = ask("Win-Rate bei ETH");
    expect(a.kind).toBe("empty");
    expect(a.text).toContain("keine abgeschlossenen Trades");
    expect(a.confidence.label).toBe("zu wenig Daten");
  });

  it("an unknown question gets the honest fallback with chips", () => {
    const a = ask("Wie wird das Wetter morgen?");
    expect(a.kind).toBe("unknown");
    expect(a.text).toContain("nicht verstanden");
    expect(a.followUps.length).toBeGreaterThan(1);
  });

  it("every suggested chip is understood and answered", () => {
    const chips = suggestQuestions(data);
    expect(chips.length).toBeGreaterThanOrEqual(5);
    for (const q of chips) {
      const a = ask(q);
      expect(a.kind, q).not.toBe("unknown");
    }
  });

  it("the parse context knows the journal's assets", () => {
    expect(parseContextOf(view.closed, data).assets).toEqual(["BTC"]);
  });

  it("selectTrades filters by period", () => {
    const i = parseQuestion("Trades gestern", { ...CTX, now: new Date(at(1, 720)).getTime() });
    const sel = selectTrades(view.closed, i.filters, i.period);
    for (const t of sel) expect(t.date.startsWith(at(0).slice(0, 10))).toBe(true);
  });

  it("answers without trades honestly", () => {
    const a = answerIntent(p("Win-Rate"), { ...data, closed: [] });
    expect(a.kind).toBe("empty");
    expect(a.text).toContain("Noch keine abgeschlossenen Trades");
  });
});
