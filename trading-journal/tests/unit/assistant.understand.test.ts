/**
 * F74 assistant – local understanding: typo repair, colloquial phrases, tools, follow-ups, honest fallback and the
 * memory writers. Every canonical question of the phrase table must be one the journal parser really understands.
 */
import { describe, expect, it, vi } from "vitest";
import { parseQuestion, type Intent } from "@/domain/coach/nlq";
import { EMPTY_MEMORY, addFact, byInterest, learnInterest, memoryOf, removeFact, setStyle, topInterests, withMemory } from "@/assistant/memory";
import { runTool, type ToolEnv } from "@/assistant/tools";
import { closestQuestions, editDistance, mergeFollowUp, repairTypos, squeeze, understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const ctx = (prev: Intent | null = null, closed = 20) => ({ parse: PARSE, prev, closed });
const u = (q: string, prev: Intent | null = null, closed = 20): Plan => understand(q, ctx(prev, closed));

describe("typo repair", () => {
  it("measures transpositions as one edit", () => {
    expect(editDistance("setup", "setpu", 2)).toBe(1);
    expect(editDistance("montag", "montag", 1)).toBe(0);
    expect(editDistance("abc", "xyzuvw", 2)).toBeGreaterThan(2);
  });
  it("squeezes stretched letters", () => {
    expect(squeeze("guuuut")).toBe("gut");
    expect(squeeze("aaber")).toBe("aaber");
  });
  it("repairs a unique near match and leaves the rest alone", () => {
    const r = repairTypos("Wie ist meine Winrtae am Montgg");
    expect(r.fixes.map(([, to]) => to)).toContain("montag");
    expect(r.text).toContain("winrate");
  });
  it("does not touch known words or numbers", () => {
    const r = repairTypos("Win-Rate bei Hebel 10 am Montag");
    expect(r.fixes).toEqual([]);
  });
});

describe("journal questions (typos, follow-ups)", () => {
  it("understands a plain question exactly as the parser does", () => {
    const plan = u("Wie ist meine Win-Rate am Montag?");
    expect(plan.kind).toBe("journal");
    if (plan.kind === "journal") expect(plan.intents[0]!.metric).toBe("winRate");
  });
  it("repairs typos in a question", () => {
    const plan = u("wie ist mein bestes Setpu");
    expect(plan.kind).toBe("journal");
    if (plan.kind === "journal") {
      expect(plan.intents[0]!.groupBy).toBe("setup");
      expect(plan.via.join(" ")).toContain("setup");
    }
  });
  it("merges a follow-up into the last intent", () => {
    const prev = parseQuestion("Wie ist meine Win-Rate am Montag?", PARSE);
    const plan = u("und im Long?", prev);
    expect(plan.kind).toBe("journal");
    if (plan.kind !== "journal") return;
    const i = plan.intents[0]!;
    expect(i.metric).toBe("winRate");
    expect(i.filters.map((f) => `${f.dim}:${f.value}`).sort()).toEqual(["side:long", "weekday:0"]);
  });
  it("replaces the period of the last question in a follow-up", () => {
    const prev = parseQuestion("Wie viel habe ich diesen Monat verdient?", PARSE);
    const plan = u("und letzte Woche?", prev);
    expect(plan.kind).toBe("journal");
    if (plan.kind === "journal") {
      expect(plan.intents[0]!.period?.kind).toBe("lastWeek");
      expect(plan.intents[0]!.metric).toBe("net");
    }
  });
  it("mergeFollowUp keeps a group-by unless its dimension is filtered", () => {
    const prev = parseQuestion("Ø R pro Setup", PARSE);
    const m = mergeFollowUp(prev, parseQuestion("nur Long", PARSE));
    expect(m.groupBy).toBe("setup");
    expect(m.filters.some((f) => f.dim === "side")).toBe(true);
  });
});

describe("colloquial phrases", () => {
  it.each(["was lief gut", "Was läuft gut?", "was lief guuut", "wo bin ich stark", "was klappt richtig gut"])("%s → positive aspects", (q) => {
    const plan = u(q);
    expect(plan.kind).toBe("journal");
    if (plan.kind === "journal") {
      expect(plan.intents.length).toBe(3);
      expect(plan.intents.every((i) => i.type !== "unknown")).toBe(true);
      expect(plan.topic).toBe("good");
    }
  });
  it("asks only one question without enough trades", () => {
    const plan = u("was lief gut", null, 0);
    expect(plan.kind === "journal" && plan.intents.length).toBe(1);
  });
  it.each(["was lief schlecht", "was läuft nicht gut", "wo sind meine schwächen"])("%s → negative aspects", (q) => {
    const plan = u(q);
    expect(plan.kind === "journal" && plan.topic).toBe("bad");
  });
  it("answers 'wie läuft's' with a status", () => {
    const plan = u("wie läuft's bei mir?");
    expect(plan.kind === "journal" && plan.topic).toBe("status");
  });
  it("every canonical question is parsed", () => {
    for (const q of ["Was ist mein bestes Setup?", "Welcher Wochentag ist am profitabelsten?", "Mein größter Gewinn", "Was ist mein schlechtestes Setup?", "An welchem Wochentag verliere ich am meisten?", "Mein größter Verlust", "Wie war diese Woche?", "Win-Rate diesen Monat", "Wie viel habe ich diesen Monat verdient?", "Wie viel habe ich insgesamt verdient?", "Win-Rate insgesamt"])
      expect(parseQuestion(q, PARSE).type, q).not.toBe("unknown");
  });
});

describe("tools", () => {
  const tool = (q: string) => {
    const p = u(q);
    return p.kind === "tool" ? p.tool : p.kind;
  };
  it("routes lab diagnosis, entry, improve, explain, hello, help", () => {
    expect(tool("warum ist der backtest so kacke")).toBe("lab");
    expect(tool("Warum ist mein Backtest so schlecht?")).toBe("lab");
    expect(tool("Was fehlt für meinen Einstieg?")).toBe("entry");
    expect(tool("kann ich jetzt long gehen")).toBe("entry");
    expect(tool("wie kann ich besser werden")).toBe("improve");
    expect(tool("warum?")).toBe("explain");
    expect(tool("hallo")).toBe("hello");
    expect(tool("was kannst du")).toBe("help");
    expect(tool("neuen Trade eintragen")).toBe("newTrade");
  });
  it("routes practice requests to the training tool – and only those", () => {
    for (const q of ["Ich will üben", "ich will ueben", "Training starten", "öffne das Training", "lernmodus", "kann ich was trainieren?", "Übung bitte"]) expect(tool(q), q).toBe("train");
    // a journal question or a plain improvement question is not a training request
    expect(tool("wie kann ich besser werden")).toBe("improve");
    expect(tool("Win-Rate diesen Monat")).toBe("journal");
    expect(tool("öffne das Labor")).toBe("navigate");
  });
  it("the training tool only opens: it calls the callback, saves nothing and closes the sheet; without it, it says so", () => {
    const train = vi.fn();
    const setMem = vi.fn();
    const env = { train, setMem, now: NOW } as unknown as ToolEnv;
    const r = runTool("train", "Ich will üben", env);
    expect(train).toHaveBeenCalledTimes(1);
    expect(setMem).not.toHaveBeenCalled();
    expect(r).toMatchObject({ title: "Training geöffnet", close: true });
    const none = runTool("train", "Ich will üben", { now: NOW } as unknown as ToolEnv);
    expect(none.close).toBe(false);
    expect(none.text).toContain("nicht verfügbar");
  });
  it("memory commands", () => {
    expect(tool("merk dir: ich handle nur nach dem Londoner Open")).toBe("memory");
    expect(tool("fass dich kürzer")).toBe("memory");
    expect(tool("was weißt du über mich")).toBe("memory");
  });
  it("navigates to pages named in an open request", () => {
    const p = u("öffne das Labor");
    expect(p.kind === "tool" && p.tool).toBe("navigate");
    expect(p.kind === "tool" && p.arg).toBe("labor");
    const q = u("zeig mir den Markt");
    expect(q.kind === "tool" && q.arg).toBe("markt");
  });
  it("a journal question that contains tool words stays a journal question", () => {
    const p = u("Win-Rate wenn ich mich verbessert habe diesen Monat");
    expect(p.kind).toBe("journal");
    const l = u("zeig mir meine Shorts von gestern");
    expect(l.kind === "journal" && l.intents[0]!.type).toBe("list");
  });
});

describe("honest fallback", () => {
  it("never dead-ends: unknown text gets close suggestions", () => {
    const p = u("blubb xyzzy plugh");
    expect(p.kind).toBe("clarify");
    if (p.kind === "clarify") expect(p.suggestions.length).toBe(3);
  });
  it("closestQuestions ranks by shared words", () => {
    expect(closestQuestions("revenge trades kosten")[0]).toContain("Revenge");
  });
});

describe("memory", () => {
  it("round-trips through settings and keeps other keys", () => {
    const m0 = learnInterest(setStyle(EMPTY_MEMORY, "kurz"), "setup");
    const s = withMemory({ ...COACH_SETTINGS, coach: { x: 1 } } as never, addFact(m0, "Ich handle nur London", 1));
    const back = memoryOf(s);
    expect(back.style).toBe("kurz");
    expect(back.facts[0]!.text).toBe("Ich handle nur London");
    expect(back.interests.setup).toBe(1);
    expect((s as { coach?: unknown }).coach).toEqual({ x: 1 });
  });
  it("sanitises broken stored values", () => {
    const m = memoryOf({ assistant: { style: "x", interests: { a: -1, b: "z", c: 3 }, facts: [{ id: 1 }, { id: "a", text: "  " }, { id: "b", text: "ok" }], voice: { speak: "yes" }, asked: -4 } });
    expect(m.style).toBe("normal");
    expect(m.interests).toEqual({ c: 3 });
    expect(m.facts.map((f) => f.text)).toEqual(["ok"]);
    expect(m.voice.speak).toBe(false);
    expect(m.asked).toBe(0);
  });
  it("ignores duplicate facts, removes by id and orders by interest", () => {
    let m = addFact(EMPTY_MEMORY, "A", 1);
    m = addFact(m, "a", 2);
    expect(m.facts.length).toBe(1);
    expect(removeFact(m, m.facts[0]!.id).facts.length).toBe(0);
    let k = learnInterest(EMPTY_MEMORY, "x");
    k = learnInterest(k, "y");
    k = learnInterest(k, "y");
    expect(topInterests(k, 1)).toEqual(["y"]);
    expect(byInterest(k, ["a", "b", "c"], (v) => (v === "c" ? "y" : v === "b" ? "x" : null))).toEqual(["c", "b", "a"]);
  });
});
