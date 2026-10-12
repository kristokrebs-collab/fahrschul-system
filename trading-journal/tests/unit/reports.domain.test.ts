/**
 * P04 reports: periods (keys, round trip, ISO week at the year boundary, shifting), the builder (numbers agree with
 * `aggregate`, sections, previous period, goals from the coach plan), the automatic archive with seen markers and the
 * "Bericht bereit" rule, and the exports (Markdown snapshot, CSV dialect, JSON without full trades).
 */
import { describe, expect, it } from "vitest";
import { aggregate } from "@/domain/agg";
import { detectBehaviors } from "@/domain/coach/events";
import { coachPrefsOf, withCoachPlan, withReportSeen } from "@/domain/coach/prefs";
import { buildReport, pendingReport, periodFromKey, periodOf, reportArchive, reportFilename, reportToCsv, reportToJson, reportToMarkdown, shiftPeriod, type ReportPeriod } from "@/domain/reports";
import type { Settings, Trade } from "@/domain/types";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";

describe("Zeiträume", () => {
  it("builds stable keys and labels", () => {
    const d = new Date(2026, 9, 12, 15);
    expect(periodOf("day", d)).toMatchObject({ key: "2026-10-12", short: "12.10.", label: "Mo, 12. Oktober 2026" });
    expect(periodOf("week", d)).toMatchObject({ key: "2026-W42", short: "KW 42", range: "12.10. – 18.10.2026" });
    expect(periodOf("month", d)).toMatchObject({ key: "2026-10", label: "Oktober 2026", short: "OKT 26" });
    expect(periodOf("quarter", d)).toMatchObject({ key: "2026-Q4", label: "Q4 2026" });
    expect(periodOf("year", d)).toMatchObject({ key: "2026", label: "2026" });
  });

  it("round-trips every key and rejects garbage", () => {
    for (const kind of ["day", "week", "month", "quarter", "year"] as const) {
      const p = periodOf(kind, new Date(2027, 0, 2));
      expect(periodFromKey(p.key)).toEqual(p);
    }
    for (const bad of ["", "2026-13", "2026-02-30", "2026-W60", "2026-Q5", "x", null, undefined]) expect(periodFromKey(bad)).toBeNull();
  });

  it("uses the ISO week year at the year boundary", () => {
    // Fri 2027-01-01 belongs to ISO week 53 of 2026
    expect(periodOf("week", new Date(2027, 0, 1)).key).toBe("2026-W53");
    expect(periodFromKey("2026-W53")!.from).toBe(new Date(2026, 11, 28).getTime());
  });

  it("shifts by whole periods", () => {
    const m = periodOf("month", new Date(2026, 0, 15));
    expect(shiftPeriod(m, -1).key).toBe("2025-12");
    expect(shiftPeriod(periodOf("quarter", new Date(2026, 0, 15)), -1).key).toBe("2025-Q4");
    expect(shiftPeriod(periodOf("week", new Date(2026, 0, 1)), 1).key).toBe("2026-W02");
  });
});

/** Two weeks: week A (Mar 2–8 2026) and week B (Mar 9–15). */
function journal(): Trade[] {
  return [
    ct(at(0, 600), { id: "a1", p: 200, notes: "sauber" }),
    ct(at(0, 640), { id: "a2", p: -100 }),
    ct(at(2, 600), { id: "a3", p: 150, side: "short" }),
    ct(at(7, 600), { id: "b1", p: -100, setups: ["s_bad"] }),
    ct(at(7, 610), { id: "b2", p: -180, risk: 180, emotion: "Revenge", setups: ["s_bad"], followedPlan: false }),
    ct(at(8, 600), { id: "b3", p: 300, mistakes: ["Zu früh rein"] }),
    ct(at(9, 600), { id: "open", status: "open", exit: null, pnlManual: null }),
  ];
}

describe("Bericht", () => {
  const list = enrichC(journal());
  const events = detectBehaviors({ trades: list, settings: COACH_SETTINGS });
  const weekB = periodOf("week", new Date(at(7)));
  const now = new Date(2026, 2, 20).getTime();
  const rep = buildReport({ list, settings: COACH_SETTINGS, events, start: 20_000, currency: "USDT", period: weekB, now });

  it("numbers agree with aggregate() over the period's closed trades", () => {
    const g = aggregate(list.filter((t) => ["b1", "b2", "b3"].includes(t.id)));
    expect(rep.performance.g.net).toBe(g.net);
    expect(rep.performance.g.n).toBe(3);
    expect(rep.performance.equity).toEqual([0, -100, -280, 20]);
    expect(rep.performance.tradingDays).toBe(2);
    expect(rep.performance.worstDay).toMatchObject({ net: -280 });
    expect(rep.complete).toBe(true);
    expect(rep.title).toBe(`Wochenbericht · ${weekB.label}`);
  });

  it("has every section", () => {
    expect(rep.strategy.setups.map((s) => s.label).sort()).toEqual(["Breakout", "Fade"]);
    expect(rep.strategy.best?.label).toBe("Breakout");
    expect(rep.risk.maxRiskPct).toBeCloseTo(0.018, 6);
    expect(rep.psychology.behaviors.map((b) => b.key)).toEqual(expect.arrayContaining(["revenge"]));
    expect(rep.psychology.planRate).toBe(0);
    expect(rep.mistakes.rows.map((r) => r.tag)).toEqual(expect.arrayContaining(["Zu früh rein", "Revenge-Trade"]));
    expect(rep.compare.prev).toMatchObject({ n: 3, net: 250 });
    expect(rep.highlights.length).toBeGreaterThan(0);
    expect(rep.highlights.length).toBeLessThanOrEqual(3);
  });

  it("evaluates the accepted coach plan", () => {
    const s = withCoachPlan(COACH_SETTINGS, [{ title: "Keine Revenge-Trades", kind: "process", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior: "revenge" }, source: { kind: "coach" } }], now);
    const r = buildReport({ list, settings: s, events, start: 20_000, currency: "USDT", period: weekB, now });
    expect(r.goals.rows).toHaveLength(1);
    expect(r.goals.rows[0]).toMatchObject({ source: "coach", met: false, targetText: "≤ 0" });
    expect(r.goals.rows[0]!.actual).toBeGreaterThanOrEqual(1);
  });

  it("an empty period says so", () => {
    const r = buildReport({ list, settings: COACH_SETTINGS, events, start: 20_000, currency: "USDT", period: periodOf("week", new Date(2026, 5, 1)), now });
    expect(r.empty).toBe(true);
    expect(r.summary).toContain("Keine abgeschlossenen Trades");
  });
});

describe("Archiv und Gesehen-Marker", () => {
  const list = enrichC(journal());
  const now = new Date(2026, 2, 17, 9).getTime(); // Tue after week B

  it("lists only completed periods with trades, newest first", () => {
    const weeks = reportArchive(list, COACH_SETTINGS, "week", now);
    expect(weeks.map((w) => w.period.key)).toEqual([periodOf("week", new Date(at(7))).key, periodOf("week", new Date(at(0))).key]);
    expect(weeks[0]!.n).toBe(3);
    expect(reportArchive(list, COACH_SETTINGS, "month", now)).toEqual([]);
  });

  it("announces the last week once, until it is seen", () => {
    const p = pendingReport(list, COACH_SETTINGS, now)!;
    expect(p.period.kind).toBe("week");
    const seen = withReportSeen(COACH_SETTINGS, [p.period.key]);
    expect(coachPrefsOf(seen).seen).toEqual([p.period.key]);
    expect(pendingReport(list, seen, now)).toBeNull();
    expect(withReportSeen(seen, [p.period.key])).toBe(seen);
    // too late: a week report is not announced two weeks later
    expect(pendingReport(list, COACH_SETTINGS, new Date(2026, 2, 30).getTime())).toBeNull();
  });

  it("keeps unknown keys of settings.coach", () => {
    const s = { ...COACH_SETTINGS, coach: { extra: 1, reports: { seen: ["2026-W01"], other: true } } } as unknown as Settings;
    const next = withReportSeen(s, ["2026-W02"]) as unknown as { coach: { extra: number; reports: { seen: string[]; other: boolean } } };
    expect(next.coach.extra).toBe(1);
    expect(next.coach.reports.other).toBe(true);
    expect(next.coach.reports.seen).toEqual(["2026-W02", "2026-W01"]);
  });
});

describe("Export", () => {
  const list = enrichC(journal());
  const events = detectBehaviors({ trades: list, settings: COACH_SETTINGS });
  const period: ReportPeriod = periodOf("week", new Date(at(7)));
  const rep = buildReport({ list, settings: COACH_SETTINGS, events, start: 20_000, currency: "USDT", period, now: new Date(2026, 2, 20).getTime() });

  it("Markdown (snapshot without the creation time)", () => {
    // the creation time and the UTC session depend on the machine's time zone
    const md = reportToMarkdown(rep).replace(/erstellt [^·_]+/, "erstellt <zeit> ").replace(/\| (London|New York|Asien|Spät|Wochenende) \|/g, "| <session> |");
    expect(md).toMatchInlineSnapshot(`
      "# Wochenbericht · KW 11 · 2026
      _09.03. – 15.03.2026 · erstellt <zeit> _

      Im Plus: +20 USDT aus 3 Trades, 33 % Win-Rate, +1,00 R gesamt.

      - Stärkstes Setup: Breakout (+300 USDT, 1 Trade).
      - Teuerstes Muster: Revenge-Trade (−280 USDT gegenüber sauberen Trades).
      - Gegenüber der Vorperiode −230 USDT, Win-Rate −33 Pp.

      ## Performance

      | Kennzahl | Wert |
      | --- | --- |
      | Netto | +20 USDT |
      | Rendite | +0,1 % |
      | Trades | 3 |
      | Win-Rate | 33 % |
      | Profit-Faktor | 1,07 |
      | Ø R | +0,33 R |
      | Summe R | +1,00 R |
      | Max. Drawdown | −1,4 % |
      | Handelstage | 2 (50 % grün) |
      | Bester Tag | 2026-03-10 · +300 USDT |
      | Schwächster Tag | 2026-03-09 · −280 USDT |

      ## Strategie

      | Setup | Trades | Netto | Win-Rate | Ø R |
      | --- | --- | --- | --- | --- |
      | Breakout | 1 | +300 USDT | 100 % | +3,00 R |
      | Fade | 2 | −280 USDT | 0 % | −1,00 R |

      | Richtung | Trades | Netto | Win-Rate |
      | --- | --- | --- | --- |
      | Long | 3 | +20 USDT | 33 % |

      | Session | Trades | Netto | Win-Rate |
      | --- | --- | --- | --- |
      | <session> | 3 | +20 USDT | 33 % |

      ## Risiko

      | Kennzahl | Wert |
      | --- | --- |
      | Ø Risiko pro Trade | 1,27 % |
      | Max. Risiko pro Trade | 1,80 % |
      | Über der Grenze | 0 |
      | Ø Hebel | – |
      | Max. Hebel | – |
      | Schlechtester Trade | −1,00 R |
      | Verluste über 1 R | 0 |
      | Tage über dem Tageslimit | 0 |
      | Längste Verlustserie | 2 |

      ## Psychologie

      | Muster | Anzahl | P&L | vs. saubere Trades |
      | --- | --- | --- | --- |
      | Revenge-Trade | 1 | −180 USDT | −280 USDT |
      | Regelverstoß | 1 | −180 USDT | −280 USDT |

      Plan befolgt: 0 % · Ø Stimmung: – · Ø Stress: – · Ø Zuversicht: –

      ## Fehler

      | Fehler | Trades | Kosten vs. saubere Trades |
      | --- | --- | --- |
      | Gegen den Plan (automatisch) | 1 | −80 USDT |
      | Revenge-Trade (automatisch) | 1 | −80 USDT |
      | Zu früh rein | 1 | +400 USDT |

      Saubere Trades: 33 %

      ## Zielerreichung

      Disziplin Ø 85 · Serie 2 Tage · Journaling 0 % · Checkliste – · Regelverstöße 1

      ## Vergleich mit der Vorperiode

      | Kennzahl | KW 11 · 2026 | KW 10 · 2026 |
      | --- | --- | --- |
      | Trades | 3 | 3 |
      | Netto | +20 USDT | +250 USDT |
      | Win-Rate | 33 % | 67 % |
      | Ø R | +0,33 R | +0,83 R |
      | Profit-Faktor | 1,07 | 3,50 |
      | Disziplin | 85 | 83 |
      "
    `);
  });

  it("CSV in the app's dialect, focus limits the sections", () => {
    const csv = reportToCsv(rep);
    expect(csv.startsWith("﻿Abschnitt;Kennzahl;Wert\n")).toBe(true);
    expect(csv).toContain("Performance;Netto;20");
    expect(csv).toContain("Performance;Win-Rate;0,3333333333333333");
    const risk = reportToCsv(rep, "risk");
    expect(risk).toContain("Risiko;");
    expect(risk).not.toContain("Performance;");
  });

  it("JSON carries ids, not trade records", () => {
    const j = JSON.parse(reportToJson(rep, "mistakes"));
    expect(j.format).toBe("trading-journal-report");
    expect(j.tradeIds).toEqual(["b1", "b2", "b3"]);
    expect(j.trades).toBeUndefined();
    expect(j.strategy).toBeUndefined();
    expect(j.mistakes.rows.length).toBeGreaterThan(0);
    expect(typeof j.performance.g.best).toBe("string");
  });

  it("file names", () => {
    expect(reportFilename(rep, "md")).toBe("bericht-2026-W11.md");
    expect(reportFilename(rep, "csv", "risk")).toBe("bericht-2026-W11-risiko.csv");
  });
});
