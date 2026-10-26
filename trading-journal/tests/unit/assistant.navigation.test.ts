/**
 * The assistant and the navigation say the same thing: one name per page, "Öffne …" / "Starte …" finds a function of the register
 * (not only a page), and the help names the late areas without promising what the app does not do.
 */
import { describe, expect, it, vi } from "vitest";
import { PAGE_LABELS } from "@/app/Dock";
import { respond, type EngineEnv } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { INTEREST_QUESTION } from "@/assistant/tools";
import { PAGE_LABEL, understand, type Plan } from "@/assistant/understand";
import { FALLBACK_PAGE_LABELS } from "@/search/sources";
import { PAGES } from "@/store/uiStore";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string): Plan => understand(q, { parse: PARSE, prev: null, closed: 20 });

function env() {
  const spies = { go: vi.fn(), openFeature: vi.fn(), setMem: vi.fn() };
  const e: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    go: spies.go,
    openFeature: spies.openFeature,
    newTrade: () => undefined,
    setMem: spies.setMem,
    now: NOW,
  };
  return { e, spies };
}

describe("one name per page", () => {
  it("the dock, the search and the assistant call every page the same", () => {
    for (const p of PAGES) {
      expect(PAGE_LABEL[p], `assistant › ${p}`).toBe(PAGE_LABELS[p]);
      expect(FALLBACK_PAGE_LABELS[p], `search › ${p}`).toBe(PAGE_LABELS[p]);
    }
  });
});

describe("'Öffne …', 'Starte …', 'Zeig mir …' reach the functions of the register", () => {
  it.each([
    ["Öffne den Positionsrechner", "positionsrechner"],
    ["Starte die Demo", "produktdemo"],
    ["Zeig mir den Kongress-Tracker", "aktien-kongress"],
    ["Öffne das Datenarchiv", "datenarchiv"],
    ["Geh zum Positionsrechner", "positionsrechner"],
  ])("%s → opens %s", (q, id) => {
    const plan = u(q);
    expect(plan.kind === "tool" && plan.tool, q).toBe("where");
    const { e, spies } = env();
    respond(q, e);
    expect(spies.openFeature).toHaveBeenCalledWith(id);
  });

  it("keeps the page navigation and the journal questions as they were", () => {
    expect(u("Öffne das Labor")).toMatchObject({ kind: "tool", tool: "navigate", arg: "labor" });
    expect(u("Öffne den Handelsplan")).toMatchObject({ kind: "tool" });
    expect(u("Zeig mir meine Verluste im März").kind).toBe("journal");
    expect(u("Zeig mir meine besten Trades diese Woche").kind).toBe("journal");
  });

  it("says so when there is nothing to open", () => {
    const { e, spies } = env();
    const r = respond("Öffne den Zaubertrank", e).replies[0]!;
    expect(spies.openFeature).not.toHaveBeenCalled();
    expect(r.kind === "tool" && r.reply.title).toBe("Dazu finde ich keine Funktion");
  });
});

describe("the help", () => {
  it("names the late areas and the limits: no order, no acting for you", () => {
    const { e } = env();
    const r = respond("Was kannst du?", e).replies[0]!;
    const text = r.kind === "tool" ? r.reply.text : "";
    expect(text).toMatch(/Handelsplan/);
    expect(text).toMatch(/Aktien/);
    expect(text).toMatch(/Demo/);
    expect(text).toMatch(/sende nie eine Order/);
  });
});

describe("the chips for what is asked more than once", () => {
  it("every chip leads to the tool whose topic it belongs to (so a counted topic offers a question that really works)", () => {
    for (const [topic, question] of Object.entries(INTEREST_QUESTION)) {
      if (!["plan", "stocks", "studio", "where"].includes(topic)) continue;
      const plan = u(question);
      expect(plan.kind === "tool" && plan.topic, `${topic}: ${question}`).toBe(topic);
    }
  });
});
