/**
 * F37 in the assistant: the tool „Wochenexperiment“ shows the stored experiment and its automatic reading (or the
 * proposal the report would make) – and changes NOTHING: no settings write, no memory write; opening the report is the
 * only side effect and only on the user's click on the action.
 */
import { describe, expect, it, vi } from "vitest";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { respond, type EngineEnv } from "@/assistant/engine";
import { detectBehaviors } from "@/domain/coach/events";
import type { Recommendation } from "@/domain/coach/recommendations";
import { experimentOverview, withExperiment, type Experiment } from "@/domain/reports";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";

const NOW = new Date(2026, 2, 18, 12).getTime(); // Wed in KW 12
const week = (day0: number, n = 6, extra: Parameters<typeof ct>[1][] = []) => [...Array.from({ length: n }, (_, i) => ct(at(day0 + (i % 5), 600 + 20 * i), { id: `t${day0}_${i}`, p: i % 2 ? -50 : 120, notes: "ok" })), ...extra.map((x, i) => ct(at(day0 + 1, 900 + i * 5), { id: `x${day0}_${i}`, ...x }))];

const REC: Recommendation = {
  id: "behavior:revenge",
  kind: "stop",
  title: "Revenge-Trades vermeiden",
  why: "Revenge-Trade: 4 Trades, −300 USDT gegenüber deinen sauberen Trades.",
  impact: -300,
  unit: "money",
  confidence: 70,
  verdict: "Tendenz",
  evidence: ["a"],
  whatIf: null,
  behavior: "revenge",
  goal: { title: "Kein Revenge", kind: "process", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior: "revenge" }, source: { kind: "coach", ref: "x" } },
};

const EXP: Experiment = {
  id: "2026-W12|behavior:revenge",
  v: 1,
  recId: "behavior:revenge",
  title: "Revenge-Trades vermeiden",
  hypothesis: "Ich kann Revenge-Trade in einer Woche ganz vermeiden.",
  why: "x",
  measure: { kind: "behavior", behavior: "revenge" },
  comparator: "atMost",
  target: 0,
  minTrades: 5,
  weekKey: "2026-W12",
  sourceWeek: "2026-W11",
  acc: "all",
  baseline: { n: 7, value: 1 },
  evidence: [],
  acceptedAt: "2026-03-15T10:00:00.000Z",
};

function env(trades: ReturnType<typeof week>, settings = COACH_SETTINGS) {
  const list = enrichC(trades);
  const events = detectBehaviors({ trades: list, settings });
  const spies = { go: vi.fn(), setMem: vi.fn(), openReport: vi.fn(), recs: vi.fn(() => [REC]) };
  const e: EngineEnv = {
    data: { closed: list.filter((t) => t.result !== "open"), settings, events, now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: spies.recs,
    experiment: () => experimentOverview({ settings, events, now: NOW, list, acc: "all", recs: spies.recs, listOf: () => list }),
    openReport: spies.openReport,
    lab: null,
    go: spies.go,
    newTrade: () => undefined,
    setMem: spies.setMem,
    now: NOW,
  };
  return { e, spies };
}

const reply = (q: string, e: EngineEnv) => {
  const r = respond(q, e).replies[0]!;
  if (r.kind !== "tool") throw new Error(`not a tool reply: ${r.kind}`);
  return r.reply;
};

describe("Werkzeug „Wochenexperiment“", () => {
  it("shows the accepted experiment of the running week with its reading – and changes nothing", () => {
    const settings = withExperiment(COACH_SETTINGS, EXP);
    const { e, spies } = env(week(14, 4), settings);
    const r = reply("Wie läuft mein Wochenexperiment?", e);
    expect(r.title).toBe("Dein Wochenexperiment");
    expect(r.text).toContain("KW 12 (läuft): Revenge-Trades vermeiden.");
    expect(r.text).toContain("Sollwert: Revenge-Trade 0, mindestens 5 Trades.");
    expect(r.text).toContain("Die Woche läuft noch");
    expect(r.facts.map((f) => f.label)).toEqual(["Status", "Ist", "Trades"]);
    expect(r.facts[0]!.value).toBe("läuft");
    // read-only: no memory write, no navigation until the action is clicked
    expect(spies.setMem).not.toHaveBeenCalled();
    expect(spies.go).not.toHaveBeenCalled();
    r.actions[0]!.run();
    expect(spies.openReport).toHaveBeenCalledWith("2026-W12");
    expect(spies.go).toHaveBeenCalledWith("berichte");
  });

  it("shows the proposal of the report when nothing is accepted – naming that it is not taken over", () => {
    const { e, spies } = env([...week(7, 6), ...week(0, 3)]);
    const r = reply("Was ist mein Experiment?", e);
    expect(r.title).toBe("Vorschlag für ein Wochenexperiment");
    expect(r.text).toContain("Noch nicht angenommen: Revenge-Trades vermeiden.");
    expect(r.text).toContain("Nächste Woche: Revenge-Trade: 0");
    expect(r.text).toContain("ich ändere daran nichts");
    r.actions[0]!.run();
    expect(spies.openReport).toHaveBeenCalledWith("2026-W11");
  });

  it("says plainly when there is neither an experiment nor a measurable proposal", () => {
    const { e } = env(week(7, 6));
    e.recs = () => [];
    e.experiment = () => experimentOverview({ settings: COACH_SETTINGS, events: [], now: NOW, list: [], acc: "all", recs: () => [], listOf: () => [] });
    const r = reply("Hypothese der Woche", e);
    expect(r.title).toBe("Kein Wochenexperiment");
    expect(r.text).toContain("keine Hypothese");
  });

  it("reads a finished experiment: zu wenig Daten under the minimum sample", () => {
    const settings = withExperiment(COACH_SETTINGS, { ...EXP, weekKey: "2026-W11", id: "2026-W11|behavior:revenge" });
    const { e } = env(week(7, 3), settings);
    const r = reply("Wochenexperiment", e);
    expect(r.text).toContain("KW 11 (beendet)");
    expect(r.text).toContain("Nur 3 Trades");
    expect(r.facts[0]!.value).toBe("zu wenig Daten");
  });
});
