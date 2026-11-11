/**
 * The assistant's tool „Wo finde ich …?“: answered from the function register only, the best clear hit is opened (page
 * scrolled to the card, or its sheet), several close hits are offered as buttons and nothing opens, nothing found says so
 * and points to the full list. The journal questions around it keep their meaning ("wo sind meine Schwächen" is no place question).
 */
import { describe, expect, it, vi } from "vitest";
import { respond, type EngineEnv } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string): Plan => understand(q, { parse: PARSE, prev: null, closed: 20 });

function env(withOpener = true) {
  const spies = { go: vi.fn(), openFeature: vi.fn(), setMem: vi.fn() };
  const e: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    go: spies.go,
    ...(withOpener ? { openFeature: spies.openFeature } : {}),
    newTrade: () => undefined,
    setMem: spies.setMem,
    now: NOW,
  };
  return { e, spies };
}

const tool = (q: string, e: EngineEnv) => {
  const r = respond(q, e).replies[0]!;
  if (r.kind !== "tool") throw new Error(`not a tool reply: ${r.kind}`);
  return r.reply;
};

describe("understanding", () => {
  it.each(["Wo finde ich den Belastungstest?", "wo finde ich das Labor", "Wie komme ich zum Positionsrechner?", "Wo kann ich ein Backup machen?", "Wo ist der Tagesplan?", "wo steht die Rangliste", "Welche Funktionen gibt es?"])("%s → the place tool", (q) => {
    const plan = u(q);
    expect(plan.kind === "tool" && plan.tool).toBe("where");
  });

  it("wins over the tools whose words are named in the question (Einstiegs-Check, Üben, Experiment, Labor)", () => {
    for (const q of ["Wo finde ich den Einstiegs-Check?", "Wo finde ich das Üben?", "Wo finde ich das Wochenexperiment?", "Wo finde ich den Backtest?"]) {
      const plan = u(q);
      expect(plan.kind === "tool" && plan.tool, q).toBe("where");
    }
    // and the tools keep their own phrasing
    expect(u("Was fehlt für meinen Einstieg?")).toMatchObject({ kind: "tool", tool: "entry" });
    expect(u("Ich will üben")).toMatchObject({ kind: "tool", tool: "train" });
  });

  it("leaves journal questions alone", () => {
    for (const q of ["wo sind meine schwächen", "Wo verliere ich am meisten?", "Wo ist mein bestes Setup?", "Was lief gut?"]) {
      const plan = u(q);
      expect(plan.kind === "tool" && plan.tool, q).not.toBe("where");
    }
    expect(u("wo sind meine schwächen")).toMatchObject({ kind: "journal", topic: "bad" });
  });
});

describe("the answer", () => {
  it("opens a clear hit, names its benefit, plan and limits, and keeps the sheet's close flag", () => {
    const { e, spies } = env();
    const r = tool("Wo finde ich den Belastungstest?", e);
    expect(spies.openFeature).toHaveBeenCalledWith("belastungstest");
    expect(spies.go).not.toHaveBeenCalled();
    expect(r.title).toBe("Kosten- und Belastungstest geöffnet");
    expect(r.text).toMatch(/Gebühren, Slippage, Funding/);
    expect(r.text).toMatch(/Tarif: ab Premium/);
    expect(r.text).toMatch(/auf der Seite Labor/);
    expect(r.close).toBe(true);
    expect(r.facts.map((f) => f.label)).toEqual(["Stand", "Tarif"]);
  });

  it("is honest about what is missing in a partial function", () => {
    const { e } = env();
    const r = tool("Wo finde ich das Zustellprotokoll?", e);
    expect(r.text).toMatch(/Noch nicht vollständig: .*App offen/);
  });

  it("opens a sheet function (Üben) and says it is a window over the current page", () => {
    const { e, spies } = env();
    const r = tool("Wo finde ich das Training?", e);
    expect(spies.openFeature).toHaveBeenCalledWith("ueben");
    expect(r.text).toMatch(/als Fenster über der aktuellen Seite/);
  });

  it("falls back to the page when the host passes no opener", () => {
    const { e, spies } = env(false);
    tool("Wo finde ich den Positionsrechner?", e);
    expect(spies.go).toHaveBeenCalledWith("risiko");
  });

  it("offers the best three as buttons and opens nothing when the question is ambiguous", () => {
    const { e, spies } = env();
    const r = tool("Wo finde ich Filter?", e);
    expect(spies.openFeature).not.toHaveBeenCalled();
    expect(r.close).toBeFalsy();
    expect(r.title).toBe("Das kommt infrage");
    expect(r.actions.length).toBeGreaterThan(1);
    expect(r.actions.at(-1)!.label).toBe("Alle Funktionen");
    r.actions[0]!.run();
    expect(spies.openFeature).toHaveBeenCalledTimes(1);
  });

  it("says so when nothing matches, and points to the full list", () => {
    const { e, spies } = env();
    const r = tool("Wo finde ich zzzqqq?", e);
    expect(r.title).toBe("Dazu finde ich keine Funktion");
    expect(r.tone).toBe("mute");
    expect(spies.openFeature).not.toHaveBeenCalled();
    r.actions[0]!.run();
    expect(spies.go).toHaveBeenCalledWith("funktionen");
  });

  it("opens the whole list for a question without a subject", () => {
    const { e, spies } = env();
    const r = tool("Welche Funktionen gibt es?", e);
    expect(spies.go).toHaveBeenCalledWith("funktionen");
    expect(r.close).toBe(true);
    expect(spies.openFeature).not.toHaveBeenCalled();
  });

  it("learns nothing but the topic (the turn reports `where`)", () => {
    const { e } = env();
    expect(respond("Wo finde ich den Belastungstest?", e).topic).toBe("where");
  });
});
