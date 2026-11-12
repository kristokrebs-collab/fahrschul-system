/**
 * „Wie stehen die Chancen für meinen Plan?“ → the assistant quotes the last finished run of the Zeitmaschine (it never starts one):
 * routing with typos and without false hits, the answer on a real small run (every figure of the text is one of the result),
 * the honest answer when nothing was played through, the warning passed on, the open button and the learned topic.
 */
import { describe, expect, it, vi } from "vitest";
import { respond, settled, type EngineEnv, type Reply } from "@/assistant/engine";
import type { InsightInputs } from "@/assistant/insights/types";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { INTEREST_QUESTION, topicLabel, type ToolReply } from "@/assistant/tools";
import { understand, type Plan } from "@/assistant/understand";
import { pc, rr, runTimeMachineSync } from "@/domain/timemachine";
import type { TimeMachineMemory } from "@/views/timemachine/lastResult";
import { COACH_SETTINGS, at } from "./coach.fixtures";
import { input } from "./timemachine.helpers";

const NOW = new Date(at(3, 720)).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const route = (q: string): string => {
  const p: Plan = understand(q, { parse: PARSE, prev: null, closed: 20 });
  return p.kind === "tool" ? p.tool : p.kind;
};

const result = runTimeMachineSync(input({ runs: 600, horizon: 80, symbol: "BTCUSDT" }));
const mem = (over: Partial<TimeMachineMemory> = {}): TimeMachineMemory => ({ result, at: new Date(2026, 2, 5, 9, 30).getTime(), source: "Binance USDⓈ-M", ...over });

function mk(insight: InsightInputs = {}) {
  const spies = { go: vi.fn(), openFeature: vi.fn(), openSpot: vi.fn(), setMem: vi.fn() };
  const env: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    newTrade: () => undefined,
    now: NOW,
    insight,
    ...spies,
  };
  return { env, spies };
}
async function ask(q: string, env: EngineEnv): Promise<ToolReply> {
  const turn = respond(q, env);
  expect(turn.later, `${q}: an evaluation tool answers later`).toBeDefined();
  const replies: Reply[] = await settled(turn);
  const r = replies[0];
  if (r?.kind !== "tool") throw new Error(`not a tool reply: ${r?.kind}`);
  return r.reply;
}

describe("routing", () => {
  it.each(["Was sagt die Zeitmaschine zu meinem Plan?", "Zeitmaschine", "Wie oft kommt das Ziel vor dem Stop zuerst?", "Kommt bei meinem Plan das Ziel oder der Stop zuerst?", "Wie stehen die Chancen, wenn ich meinen Plan durchspiele?", "Monte Carlo für meinen Plan", "Was sagt die Zeitmaschiene?"])("%s → timemachine", (q) => {
    expect(route(q)).toBe("timemachine");
  });

  it("leaves the journal questions and the neighbouring tools alone", () => {
    for (const q of ["Was lief gut?", "Wie hoch ist meine Trefferquote?", "Wie oft erreiche ich mein Ziel?", "Wie oft wurde mein Stop vor dem Ziel erreicht?", "Wie ist meine Win-Rate am Montag?", "Monte Carlo meiner Trades"]) expect(route(q), q).not.toBe("timemachine");
    expect(route("Wo finde ich die Zeitmaschine?")).toBe("where");
    expect(route("Wie läuft mein Forward-Test?")).toBe("forward");
    expect(route("Hängt mein Backtest an wenigen Trades?")).toBe("audit");
  });

  it("carries a learned topic and a question the chips can offer", () => {
    const p = understand("Was sagt die Zeitmaschine zu meinem Plan?", { parse: PARSE, prev: null, closed: 20 });
    expect(p).toMatchObject({ kind: "tool", tool: "timemachine", topic: "timemachine" });
    expect(INTEREST_QUESTION.timemachine).toBe("Wie stehen die Chancen für meinen Plan?");
    expect(topicLabel("timemachine")).toBe("Zeitmaschine");
  });
});

describe("the answer", () => {
  it("nothing played through: it says so, starts nothing, offers the section and ends with the sentence", async () => {
    const { env, spies } = mk({ timemachine: null });
    const r = await ask("Was sagt die Zeitmaschine zu meinem Plan?", env);
    expect(r.title).toBe("Das habe ich noch nicht gerechnet");
    expect(r.text).toContain("noch kein Plan durchgespielt");
    expect(r.text).toContain("Ich rechne nicht von mir aus");
    expect(r.text.endsWith("Keine professionelle Finanzberatung.")).toBe(true);
    r.actions[0]!.run();
    expect(spies.openFeature).toHaveBeenCalledWith("zeitmaschine");
    expect(spies.setMem).not.toHaveBeenCalled();
  });

  it("a finished run: plan, odds with their interval, expectancy, earlier occasions, verdict, seed and stamp – all of them the result's", async () => {
    const { env } = mk({ timemachine: mem() });
    const r = await ask("Was sagt die Zeitmaschine zu meinem Plan?", env);
    const s = result.sim;
    expect(r.title).toBe("Das sagt die Zeitmaschine zu deinem Plan");
    expect(r.text).toContain("BTCUSDT · Long");
    expect(r.text).toContain(`Von ${s.runs.toLocaleString("de-DE")} Sitzungen`);
    expect(r.text).toContain(`${pc(s.target.p)} (95 %: `);
    expect(r.text).toContain(`${pc(s.stop.p)} den Stop zuerst`);
    expect(r.text).toContain(`Der Erwartungswert liegt bei ${rr(s.expectancy.mean)} je Trade nach Kosten`);
    expect(r.text).toContain(result.verdict.text);
    expect(r.text).toContain("Stand 05.03. 09:30 · Seed 19 · 600 Kerzen (Binance USDⓈ-M)");
    expect(r.text).toContain("keine Zusage");
    expect(r.text.endsWith("Keine professionelle Finanzberatung.")).toBe(true);
    expect(r.facts.map((f) => f.label)).toEqual(["Ziel zuerst", "Stop zuerst", "Weder noch", "Ø je Trade", "Echte Vorfälle"]);
    expect(r.facts[0]!.value).toBe(pc(s.target.p));
    expect(r.followUps).toEqual(["Wie läuft mein Forward-Test?"]);
  });

  it("the warning of the comparison is passed on, and too few earlier occasions are named as too few", async () => {
    const warn = { ...result, compare: { ...result.compare, warn: true, text: "Warnung: Simulation und echte Vorfälle weichen stark voneinander ab (Ziel zuerst)." } };
    const a = await ask("Was sagt die Zeitmaschine zu meinem Plan?", mk({ timemachine: mem({ result: warn }) }).env);
    expect(a.text).toContain("Warnung: Simulation und echte Vorfälle weichen stark voneinander ab");
    const few = { ...result, history: { ...result.history, n: 3, target: { ...result.history.target, k: 1 }, stop: { ...result.history.stop, k: 2 } } };
    const b = await ask("Was sagt die Zeitmaschine zu meinem Plan?", mk({ timemachine: mem({ result: few }) }).env);
    expect(b.text).toContain("löste der Aufbau 3-mal aus: 1 Ziel, 2 Stop");
    expect(b.text).toContain("zu wenig, um beides zu vergleichen");
    const none = { ...result, history: { ...result.history, n: 0, expectancy: null } };
    const c = await ask("Was sagt die Zeitmaschine zu meinem Plan?", mk({ timemachine: mem({ result: none }) }).env);
    expect(c.text).toContain("nie ausgelöst");
  });

  it("the default source is the last finished run of the card, in memory only", async () => {
    const { rememberTimeMachine, __forgetTimeMachine } = await import("@/views/timemachine/lastResult");
    __forgetTimeMachine();
    const { env } = mk();
    delete (env as { insight?: unknown }).insight;
    expect((await ask("Was sagt die Zeitmaschine zu meinem Plan?", env)).title).toBe("Das habe ich noch nicht gerechnet");
    rememberTimeMachine(mem());
    expect((await ask("Was sagt die Zeitmaschine zu meinem Plan?", env)).title).toBe("Das sagt die Zeitmaschine zu deinem Plan");
    __forgetTimeMachine();
  });
});
