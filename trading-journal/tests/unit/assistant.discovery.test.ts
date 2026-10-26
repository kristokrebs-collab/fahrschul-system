/**
 * „Was haben meine Gewinner gemeinsam?“ → the assistant quotes the last finished search of the Muster-Entdecker (it never starts
 * one): routing with typos and without false hits, the answer on a fixture search with hand-counted figures, the honest answer
 * when nothing was computed (journal count against the minimum), the open button, and the learned topic.
 */
import { describe, expect, it, vi } from "vitest";
import { respond, settled, type EngineEnv, type Reply } from "@/assistant/engine";
import type { InsightInputs } from "@/assistant/insights/types";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { INTEREST_QUESTION, topicLabel, type ToolReply } from "@/assistant/tools";
import { understand, type Plan } from "@/assistant/understand";
import type { DiscoveryMemory } from "@/views/discovery/lastResult";
import { LIMITS, type CellStats, type Cond, type DiscoveryResult, type Finding } from "@/domain/discovery/types";
import { COACH_SETTINGS, at } from "./coach.fixtures";

const NOW = new Date(at(3, 720)).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const route = (q: string): string => {
  const p: Plan = understand(q, { parse: PARSE, prev: null, closed: 20 });
  return p.kind === "tool" ? p.tool : p.kind;
};

const cell = (n: number, win: number, base: number): CellStats => ({ n, total: 200, wins: Math.round(n * win), winRate: win, winCi: { lo: win - 0.1, hi: win + 0.1 }, avgR: 0.4, rCi: null, baseWinRate: base, baseAvgR: 0.1, diffWinRate: win - base, diffR: 0.3 });
const finding = (side: "win" | "loss", tier: Finding["tier"], conds: Cond[], n: number, win: number): Finding => ({
  id: conds.map((c) => c.f).join("&"),
  conds,
  side,
  tier,
  reasons: tier === "confirmed" ? [] : ["confirmWeak"],
  all: cell(n, win, 0.48),
  disc: cell(Math.round(n * 0.6), win, 0.48),
  conf: cell(Math.round(n * 0.4), win, 0.48),
  z: side === "win" ? 4 : -4,
  p: 1e-4,
  q: 0.01,
  parentP: 0.01,
  confP: 0.01,
  confQ: 0.02,
  blocks: [1, 1, 1, 1],
  shareWinners: 0.7,
  shareLosers: 0.3,
  nonObvious: false,
  obscure: false,
  postEntry: false,
});
const rsiHi: Cond = { f: "rsi", k: "num", lo: 55, hi: null };
const volLo: Cond = { f: "volRegime", k: "num", lo: null, hi: 1 };
const fomo: Cond = { f: "emotion", k: "cat", v: "FOMO" };

const result = (findings: Finding[], counts: Partial<DiscoveryResult["counts"]> = {}): DiscoveryResult => ({
  status: "ok",
  note: null,
  seed: 1,
  label: "BTCUSDT 4h · Test",
  source: "backtest",
  n: 200,
  nDisc: 120,
  nConf: 80,
  droppedNoR: 0,
  droppedCap: 0,
  featuresUsed: ["rsi", "volRegime"],
  featuresEmpty: [],
  permutations: 400,
  confPermutations: 3000,
  base: { n: 200, winRate: 0.48, avgR: 0.1 },
  counts: { tested: 412, singles: 60, pairs: 352, triples: 0, confirmed: findings.filter((f) => f.tier === "confirmed").length, hint: 2, rejected: 400, redundant: 0, skippedSmall: 0, ...counts },
  findings,
  ms: 0,
});
const mem = (r: DiscoveryResult): DiscoveryMemory => ({ result: r, at: new Date(2026, 2, 5, 9, 30).getTime(), source: "backtest", label: "BTCUSDT 4h · Test" });

function mk(insight: InsightInputs = {}, over: Partial<EngineEnv> = {}) {
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
    ...over,
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
  it.each(["Was haben meine Gewinner gemeinsam?", "Was haben meine Verlierer gemeinsam?", "Welche Gemeinsamkeiten haben meine Gewinntrades?", "Was haben meine Gewinner gemainsam?", "Gibt es Muster bei meinen Verlierern?", "Was unterscheidet meine Gewinner von den Verlierern?", "Zeig mir die Mustersuche", "Was fällt bei meinen Gewinnern auf, das ist ein Zusammenhang?"])("%s → discovery", (q) => {
    expect(route(q)).toBe("discovery");
  });
  it("leaves the journal questions and the neighbouring tools alone", () => {
    for (const q of ["Was lief gut?", "Wie hoch ist meine Trefferquote bei Gewinnern?", "Wie viele Gewinner hatte ich im März?", "Ø Gewinn pro Setup", "Wie ist meine Win-Rate am Montag?", "Was ist mein bestes Setup?"]) expect(route(q), q).toBe("journal");
    expect(route("Zeig mir ähnliche Situationen")).toBe("similar");
    expect(route("Wie ging es nach ähnlichen Situationen weiter?")).toBe("situation");
    expect(route("Wo finde ich den Muster-Entdecker?")).toBe("where");
    expect(route("Passt diese Strategie zu mir?")).toBe("fit");
  });
  it("carries a learned topic and a question the chips can offer", () => {
    const p = understand("Was haben meine Gewinner gemeinsam?", { parse: PARSE, prev: null, closed: 20 });
    expect(p).toMatchObject({ kind: "tool", tool: "discovery", topic: "discovery" });
    expect(INTEREST_QUESTION.discovery).toBe("Was haben meine Gewinner gemeinsam?");
    expect(topicLabel("discovery")).toBe("Muster der Gewinner und Verlierer");
  });
});

describe("the answer", () => {
  it("nothing computed: it says so, names the journal count against the minimum, starts nothing and offers the card", async () => {
    const { env, spies } = mk({ discovery: null });
    const r = await ask("Was haben meine Gewinner gemeinsam?", env);
    expect(r.title).toBe("Das habe ich noch nicht gerechnet");
    expect(r.text).toContain(`mindestens ${LIMITS.minTrades} Trades`);
    expect(r.text).toContain("dein Journal hat 0 solche Trades");
    expect(r.text).toContain("Ich starte die Suche nicht von mir aus");
    expect(r.facts.map((f) => f.value)).toEqual(["0", String(LIMITS.minTrades)]);
    r.actions[0]!.run();
    expect(spies.openFeature).toHaveBeenCalledWith("muster-entdecker");
    expect(spies.setMem).not.toHaveBeenCalled();
  });

  it("a finished search: the count line, the confirmed patterns of the asked side with their rates and sample, the stamp, the disclaimer", async () => {
    const r1 = finding("win", "confirmed", [rsiHi, volLo], 64, 0.71);
    const r2 = finding("loss", "confirmed", [fomo], 31, 0.29);
    const { env } = mk({ discovery: mem(result([r1, r2, finding("win", "hint", [rsiHi], 90, 0.6)])) });
    const win = await ask("Was haben meine Gewinner gemeinsam?", env);
    expect(win.title).toBe("Das haben deine Gewinner gemeinsam");
    // 412 checked, 2 held, the stamp of the search
    expect(win.text).toContain("Ich habe 412 Zusammenhänge geprüft, 2 halten stand.");
    expect(win.text).toContain("BTCUSDT 4h · Test · 200 Trades · Stand 05.03. 09:30");
    expect(win.text).toContain("Wenn RSI(14) ab 55 UND Volatilität im Verhältnis zu ihrem 50er-Schnitt unter 1,00×: 71 % Treffer statt 48 % (n=64, bestätigt)");
    expect(win.text).not.toContain("Emotion FOMO"); // the loss pattern belongs to the other question
    expect(win.text).toContain("Keine professionelle Finanzberatung.");
    expect(win.facts.map((f) => [f.label, f.value])).toEqual([["Geprüft", "412"], ["Bestätigt", "2"], ["Hinweise", "2"], ["Trades", "200"]]);
    expect(win.followUps).toEqual(["Was haben meine Verlierer gemeinsam?"]);

    const loss = await ask("Was haben meine Verlierer gemeinsam?", env);
    expect(loss.title).toBe("Das haben deine Verlierer gemeinsam");
    expect(loss.text).toContain("Wenn Emotion FOMO: nur 29 % Treffer statt 48 % (n=31, bestätigt)");
    expect(loss.text).not.toContain("RSI(14)");
  });

  it("no confirmed pattern on the asked side: plain words, the hints are counted as hints, the other side is mentioned", async () => {
    const { env } = mk({ discovery: mem(result([finding("loss", "confirmed", [fomo], 31, 0.29)])) });
    const r = await ask("Was haben meine Gewinner gemeinsam?", env);
    expect(r.title).toBe("Nichts Gemeinsames bei den Gewinnern bestätigt");
    expect(r.text).toContain("Für Gewinner hält kein Muster gegen den Zufall stand");
    expect(r.text).toContain("2 Hinweise gibt es nur im älteren Teil der Trades (nicht bestätigt)");
    expect(r.text).toContain("1 Muster auf der anderen Seite");
    expect(r.tone).toBe("mute");
    const none = await ask("Was haben meine Gewinner gemeinsam?", mk({ discovery: mem(result([], { hint: 0 })) }).env);
    expect(none.text).toContain("Ich habe 412 Zusammenhänge geprüft, keiner hält stand.");
    expect(none.text).not.toContain("Hinweis");
  });

  it("a search that had nothing to check says why", async () => {
    const r = { ...result([]), status: "tooFew" as const, note: "Für eine saubere Prüfung braucht es mindestens 80 Trades mit bekanntem R – hier sind es 50." };
    const a = await ask("Was haben meine Gewinner gemeinsam?", mk({ discovery: mem(r) }).env);
    expect(a.title).toBe("Keine Prüfung möglich");
    expect(a.text).toContain("hier sind es 50");
  });

  it("the default source is the last finished search of the card, in memory only", async () => {
    const { rememberDiscovery, __forgetDiscovery } = await import("@/views/discovery/lastResult");
    __forgetDiscovery();
    const { env } = mk({ ...({} as InsightInputs) });
    delete (env as { insight?: unknown }).insight;
    expect((await ask("Was haben meine Gewinner gemeinsam?", env)).title).toBe("Das habe ich noch nicht gerechnet");
    rememberDiscovery(mem(result([finding("win", "confirmed", [rsiHi], 64, 0.71)])));
    expect((await ask("Was haben meine Gewinner gemeinsam?", env)).title).toBe("Das haben deine Gewinner gemeinsam");
    __forgetDiscovery();
  });
});
