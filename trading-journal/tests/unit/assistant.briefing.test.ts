/**
 * F43 → F74: „Morgenbriefing“ / „Was ist heute wichtig?“ reach the briefing tool (and the journal questions about today do not);
 * the answer is the briefing of the card „Heute wichtig“ in a few sentences – every sentence with its source and time in brackets,
 * missing data as „keine Daten“ – ends with the advice line, fetches nothing and only OPENS the card when asked.
 */
import { describe, expect, it, vi } from "vitest";
import { respond, settled, type EngineEnv, type Reply } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { INTEREST_QUESTION, topicLabel, type ToolReply } from "@/assistant/tools";
import { understand } from "@/assistant/understand";
import type { BriefingStores } from "@/views/termine/briefingInput";
import { COACH_SETTINGS, at } from "./coach.fixtures";

const NOW = Date.UTC(2026, 9, 28, 7, 30); // Wednesday 28.10.2026, 08:30 in Berlin – an FOMC decision day
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: new Date(at(3, 720)).getTime() };
const route = (q: string): string => {
  const p = understand(q, { parse: PARSE, prev: null, closed: 20 });
  return p.kind === "tool" ? p.tool : p.kind;
};

const stores = (over: Partial<BriefingStores> = {}): BriefingStores => ({
  now: NOW,
  tz: "Europe/Berlin",
  settings: { ...COACH_SETTINGS, events: { v: 1, items: [{ id: "cpi", title: "CPI USA", at: Date.UTC(2026, 9, 28, 12, 30), importance: "hoch", note: "" }] } } as BriefingStores["settings"],
  days: {},
  ticker: undefined,
  liveSymbol: null,
  daily: null,
  keyLevels: null,
  log: [],
  ...over,
});

function mk(briefing: BriefingStores) {
  const spies = { go: vi.fn(), openFeature: vi.fn(), openSpot: vi.fn(), openReport: vi.fn(), similar: vi.fn(), applyIdea: vi.fn(() => true), openLibrary: vi.fn(), setMem: vi.fn() };
  const env: EngineEnv = {
    data: { closed: [], settings: briefing.settings as EngineEnv["data"]["settings"], events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    newTrade: () => undefined,
    now: NOW,
    insight: { briefing },
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
  it.each(["Morgenbriefing", "Gib mir das Morgenbriefing", "Was ist heute wichtig?", "Was steht heute an?", "Termine heute", "Morning note", "Briefing", "Was ist heute wichtik?"])("%s → briefing", (q) => {
    expect(route(q)).toBe("briefing");
  });

  it("leaves the journal questions about today and the older tools alone", () => {
    expect(route("Win-Rate heute")).not.toBe("briefing");
    expect(route("Wie viele Trades hatte ich heute?")).not.toBe("briefing");
    expect(route("Was lief gut?")).toBe("journal");
    expect(route("Was fehlt für meinen Einstieg?")).toBe("entry");
    expect(route("Woran soll ich arbeiten?")).toBe("improve");
    expect(route("Wie läuft mein Forward-Test?")).toBe("forward");
  });

  it("learns the topic, names it in the memory and offers it as a chip", () => {
    expect(understand("Morgenbriefing", { parse: PARSE, prev: null, closed: 20 })).toMatchObject({ topic: "briefing" });
    expect(topicLabel("briefing")).toBe("Morgenbriefing");
    expect(INTEREST_QUESTION.briefing).toBe("Was ist heute wichtig?");
  });
});

describe("The answer", () => {
  it("gives the day's appointments in Berlin time, each sentence with its source and time, and ends with the advice line", async () => {
    const { env } = mk(stores());
    const r = await ask("Was ist heute wichtig?", env);
    expect(r.title).toBe("Heute wichtig");
    // FOMC all day; CPI 12:30Z = 13:30 CET; US open 13:30Z = 14:30 CET; close 20:00Z = 21:00 CET
    expect(r.text).toContain("ganztägig · FOMC-Entscheidung");
    expect(r.text).toContain("13:30 Uhr · CPI USA [Eigener Eintrag 13:30]");
    expect(r.text).toContain("14:30 Uhr · US-Börsen öffnen (NYSE)");
    expect(r.text).toContain("[NYSE 14:30]");
    expect(r.text).toContain("[Federal Reserve 05:00]"); // the all-day entry starts at 00:00 New York time = 05:00 Berlin time
    expect(r.text).toContain("Funding-Abrechnungen um 01:00, 09:00, 17:00 Uhr");
    expect(r.text).toContain("Stand 08:30 Uhr (Europe/Berlin).");
    expect(r.text.endsWith("Keine professionelle Finanzberatung.")).toBe(true);
  });

  it("says 'keine Daten' for what the app does not have and does not invent a market move", async () => {
    const { env } = mk(stores());
    const r = await ask("Morgenbriefing", env);
    // the ten symbols of the default watchlist stand in ONE line
    expect(r.text).toContain("Märkte & Watchlist: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT: keine Daten [Marktdaten]");
    expect(r.text).toContain("Alarme: Heute noch keine Alarm-Meldung im Zustellprotokoll");
    expect(r.text).toContain("Schlüsselmarken: Marken: keine Daten (Der Live-Markt läuft nicht, die Marken sind nicht bewertet) [Schlüsselmarken]");
    expect(r.facts.map((f) => [f.label, f.value])).toEqual([
      ["Termine", "5"], // FOMC, CPI, US open, US close – and the line with the Funding times
      ["Märkte in Bewegung", "0"],
      ["Ohne Daten", "3 Zeilen"], // the overview's market line, the symbols line, the key levels
      ["Check-in", "offen"],
    ]);
  });

  it("only opens the card on the button, with the function of the register", async () => {
    const { env, spies } = mk(stores());
    const r = await ask("Morgenbriefing", env);
    expect(spies.go).not.toHaveBeenCalled();
    expect(spies.openFeature).not.toHaveBeenCalled();
    expect(r.actions.map((a) => a.label)).toEqual(["Briefing mit allen Quellen öffnen"]);
    r.actions[0]!.run();
    expect(spies.openFeature).toHaveBeenCalledWith("morgenbriefing");
  });
});
