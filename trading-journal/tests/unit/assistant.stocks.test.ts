/**
 * The assistant opens the Aktien page at the scanner or at the news of the watchlist – it only opens (no scan is started,
 * nothing is saved, no model is asked), says what the page does and keeps the disclaimer; the neighbouring questions keep their
 * meaning (the watchlist scanner of the Markt page, a plain "öffne die Aktien" still navigates, "Wo finde ich …" is the place tool).
 */
import { describe, expect, it, vi } from "vitest";
import { respond, type EngineEnv } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string): Plan => understand(q, { parse: PARSE, prev: null, closed: 20 });
const tool = (p: Plan): string | null => (p.kind === "tool" ? p.tool : null);

function env(withFeatureOpener = true) {
  const go = vi.fn();
  const openFeature = vi.fn();
  const e: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    go,
    ...(withFeatureOpener ? { openFeature } : {}),
    newTrade: () => undefined,
    setMem: () => undefined,
    now: NOW,
  };
  return { e, go, openFeature };
}

describe("Aktien · assistant", () => {
  it.each(["Aktien scannen", "Scanne die Aktien", "Aktien durchsuchen", "Aktien Scanner", "Zeig mir eine Opening Range Breakout", "Bull Flag finden", "News zu meiner Watchlist", "Nachrichten zur Watchlist", "Watchlist Schlagzeilen"])("%s → the stocks tool", (q) => {
    expect(tool(u(q)), q).toBe("stocks");
  });

  it("opens the scanner and says what it does – nothing is started, the disclaimer is there", () => {
    const { e, openFeature, go } = env();
    const r = respond("Aktien scannen", e).replies[0]!;
    expect(r.kind).toBe("tool");
    expect(openFeature).toHaveBeenCalledWith("aktien-scanner");
    expect(go).not.toHaveBeenCalled();
    if (r.kind !== "tool") return;
    expect(r.reply.title).toBe("Aktien-Scanner geöffnet");
    expect(r.reply.text).toContain("Ich starte nichts");
    expect(r.reply.text).toContain("veraltet");
    expect(r.reply.text).toContain("Keine professionelle Finanzberatung.");
  });

  it("opens the news of the watchlist with the hint that the rating is only a keyword reading", () => {
    const { e, openFeature } = env();
    const r = respond("News zu meiner Watchlist", e).replies[0]!;
    expect(openFeature).toHaveBeenCalledWith("aktien-news");
    if (r.kind !== "tool") throw new Error("not a tool reply");
    expect(r.reply.title).toBe("News zur Watchlist geöffnet");
    expect(r.reply.text).toContain("Stichwörtern");
    expect(r.reply.text).toContain("kein Handelssignal");
    expect(r.reply.text).toContain("Keine professionelle Finanzberatung.");
  });

  it("falls back to the page when the host has no feature opener", () => {
    const { e, go } = env(false);
    respond("Aktien scannen", e);
    expect(go).toHaveBeenCalledWith("aktien");
  });

  it("does not take over the neighbouring questions", () => {
    const where = u("Wo finde ich den Aktien-Scanner?");
    expect(tool(where)).toBe("where");
    const nav = u("Öffne die Aktien");
    expect(nav.kind === "tool" && nav.tool === "navigate" && nav.arg).toBe("aktien");
    const labor = u("Öffne das Labor");
    expect(labor.kind === "tool" && labor.tool === "navigate" && labor.arg).toBe("labor");
    expect(tool(u("Was lief gut?"))).not.toBe("stocks");
  });
});
