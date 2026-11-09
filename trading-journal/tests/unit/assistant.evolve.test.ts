/**
 * The assistant and the background optimiser: „Verbessere meine Strategie im Hintergrund“ and its relatives reach the optimiser
 * tool (and the journal's „Woran soll ich arbeiten?“ does not); the answers come from `settings.evolve` with their sample, say that
 * nothing is applied without a click, never start a run, and end with the advice line.
 */
import { describe, expect, it, vi } from "vitest";
import { withEvolve } from "@/domain/evolve";
import { respond, settled, type EngineEnv, type Reply } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { INTEREST_QUESTION, topicLabel, type ToolReply } from "@/assistant/tools";
import { understand } from "@/assistant/understand";
import { COACH_SETTINGS, at } from "./coach.fixtures";
import { realProposals } from "./evolve.helpers";

const NOW = new Date(at(3, 720)).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const route = (q: string): string => {
  const p = understand(q, { parse: PARSE, prev: null, closed: 20 });
  return p.kind === "tool" ? p.tool : p.kind;
};

function mk(evolve: unknown) {
  const spies = { go: vi.fn(), openFeature: vi.fn(), openSpot: vi.fn(), openReport: vi.fn(), similar: vi.fn(), applyIdea: vi.fn(() => true), openLibrary: vi.fn(), setMem: vi.fn() };
  const env: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    newTrade: () => undefined,
    now: NOW,
    insight: { evolve },
    ...spies,
  };
  return { env, spies };
}

async function ask(q: string, env: EngineEnv): Promise<ToolReply> {
  const replies: Reply[] = await settled(respond(q, env));
  const r = replies[0];
  if (r?.kind !== "tool") throw new Error(`not a tool reply: ${r?.kind}`);
  return r.reply;
}

describe("Routing", () => {
  it.each(["Verbessere meine Strategie im Hintergrund", "Kannst du meine Strategie automatisch verbessern?", "Was hat der Optimierer gefunden?", "Gibt es Vorschläge zu meiner Strategie?", "Strategie optimieren", "Hintergrund-Optimierer öffnen", "Was hat der Optimierer gelernt?", "Verbessre meine Strategie im Hintergrund"])("%s → evolve", (q) => {
    expect(route(q)).toBe("evolve");
  });
  it("die Fragen nach dem Journal und die älteren Werkzeuge bleiben, wie sie waren", () => {
    expect(route("Woran soll ich arbeiten?")).toBe("improve");
    expect(route("Wie kann ich mich verbessern?")).toBe("improve");
    expect(route("Was lief gut?")).toBe("journal");
    expect(route("Teste diese Idee")).toBe("idea");
    expect(route("Warum ist der Backtest so schlecht?")).toBe("lab");
    expect(route("Wie läuft mein Forward-Test?")).toBe("forward");
    expect(route("Gibt es eine Strategie mit Bollinger?")).toBe("library");
    expect(route("Welche Strategie ist meine beste?")).toBe("journal");
  });
  it("lernt das Thema, bietet es als Chip an und nennt es im Gedächtnis", () => {
    expect(understand("Verbessere meine Strategie im Hintergrund", { parse: PARSE, prev: null, closed: 20 })).toMatchObject({ topic: "evolve" });
    expect(topicLabel("evolve")).toBe("Hintergrund-Optimierer");
    expect(INTEREST_QUESTION.evolve).toBe("Was hat der Optimierer gefunden?");
  });
});

describe("Antworten", () => {
  it("noch nie gelaufen: sagt, was er tut, dass er nur bei offener App läuft und nichts ohne Klick ändert – und startet nichts", async () => {
    const { env, spies } = mk(undefined);
    const r = await ask("Verbessere meine Strategie im Hintergrund", env);
    expect(r.title).toBe("Der Optimierer ist noch nicht gelaufen");
    expect(r.text).toMatch(/nur, solange die App offen ist/);
    expect(r.text).toMatch(/ändert nichts ohne deinen Klick je Vorschlag/);
    expect(r.text).toMatch(/Ich starte ihn nicht von mir aus/);
    expect(r.text).toMatch(/Keine professionelle Finanzberatung\.$/);
    expect(r.actions.map((a) => a.label)).toEqual(["Hintergrund-Optimierer öffnen"]);
    expect(spies.go).not.toHaveBeenCalled();
    r.actions[0]!.run();
    expect(spies.openFeature).toHaveBeenCalledWith("hintergrund-optimierer");
  });

  it("offene Vorschläge: Änderung, Überanpassungs-Wahrscheinlichkeit und Stichprobe in Zahlen; nichts ist angewendet", async () => {
    const props = realProposals(2);
    const raw = withEvolve(undefined, { proposals: props, lineages: { s: { trials: 150, to: 1, runs: 1 } } });
    const { env } = mk(raw);
    const r = await ask("Was hat der Optimierer gefunden?", env);
    expect(r.title).toBe("Offene Vorschläge des Optimierers");
    expect(r.text).toMatch(/^Offen sind 2 Vorschläge\./);
    expect(r.text).toMatch(/Überanpassungs-Wahrscheinlichkeit \d+ %/);
    expect(r.text).toMatch(/\d+ Trades in den Testfenstern, Ø [+−]?\d,\d\d R gegen [+−]?\d,\d\d R bei der jetzigen Version/);
    expect(r.text).toMatch(/Nichts davon ist angewendet: du entscheidest je Vorschlag/);
    expect(r.text).toMatch(/150 Versuche über 1 Strategie/);
    expect(r.text).toMatch(/Keine professionelle Finanzberatung\.$/);
    expect(r.facts.map((f) => f.label)).toEqual(["Offen", "Versuche", "Entschieden"]);
    expect(r.facts[0]!.value).toBe("2");
    expect(r.facts[1]!.value).toBe("150");
  });

  it("ohne offenen Vorschlag: „nichts gefunden“ ist ein ehrliches Ergebnis", async () => {
    const decided = realProposals(1).map((p) => ({ ...p, decision: "rejected" as const, decidedAt: 5 }));
    const raw = withEvolve(undefined, { proposals: decided, lineages: { s: { trials: 400, to: 1, runs: 2 } } });
    const r = await ask("Gibt es Vorschläge zu meiner Strategie?", mk(raw).env);
    expect(r.title).toBe("Kein offener Vorschlag");
    expect(r.text).toMatch(/„Nichts gefunden“ ist ein ehrliches Ergebnis/);
    expect(r.text).toMatch(/400 Versuche/);
  });

  it("„gelernt“: ohne Entscheidung leer, mit wenigen Entscheidungen keine Quote, mit genug Daten Zahlen und Stichprobe", async () => {
    const none = await ask("Was hat der Optimierer gelernt?", mk(undefined).env);
    expect(none.title).toBe("Noch nichts gelernt");
    expect(none.text).toMatch(/Zahlen nennt er erst ab 5 Entscheidungen bzw. 3 Live-Urteilen/);

    const few = await ask("Was hat der Optimierer gelernt?", mk(withEvolve(undefined, { stats: { proposed: 3, accepted: 2, rejected: 1, confirmed: 0, below: 0, devSum: 0, devN: 0 }, learn: { trail: { acc: 2, rej: 1, good: 0, bad: 0 } } })).env);
    expect(few.text).toMatch(/Bisher 3 Entscheidungen – zu wenig für eine Quote\./);
    expect(few.text).toMatch(/Bisher 0 Live-Urteile – zu wenig/);

    const enough = await ask(
      "Was hat der Optimierer gelernt?",
      mk(withEvolve(undefined, { stats: { proposed: 14, accepted: 6, rejected: 4, confirmed: 3, below: 2, devSum: -7.5, devN: 5 }, learn: { addTrend: { acc: 3, rej: 0, good: 2, bad: 1 } } })).env,
    );
    expect(enough.text).toMatch(/Von 10 entschiedenen Vorschlägen hast du 6 angenommen \(60 %, 80-%-Bereich \d+–\d+ %\)\./);
    expect(enough.text).toMatch(/Von 5 live geprüften Vorschlägen haben sich 3 bestätigt \(60 %\)\./);
    expect(enough.text).toMatch(/im Schnitt 1,5 Prozentpunkte pro 30 Tage unter der Vorhersage/);
    expect(enough.text).toMatch(/Trend-Filter: von 3 Entscheidungen hast du 3 angenommen/);
    expect(enough.text).toMatch(/Keine professionelle Finanzberatung\.$/);
  });
});
