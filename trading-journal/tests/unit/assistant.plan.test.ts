/**
 * The assistant opens the Handelsplan on "Handelsplan" / "Wie groß soll die Position sein?" – it only opens the page (nothing is
 * computed, nothing is saved, no order, no model is asked) and says what the page does; the neighbouring questions keep their
 * meaning ("Wo finde ich den Positionsrechner?" is still the place tool, "öffne das Labor" still navigates).
 */
import { describe, expect, it, vi } from "vitest";
import { respond, type EngineEnv } from "@/assistant/engine";
import { EMPTY_MEMORY } from "@/assistant/memory";
import { understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const PARSE = { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW };
const u = (q: string): Plan => understand(q, { parse: PARSE, prev: null, closed: 20 });

function env() {
  const go = vi.fn();
  const e: EngineEnv = {
    data: { closed: [], settings: COACH_SETTINGS, events: [], now: NOW, currency: "USDT", start: 20_000 },
    prev: null,
    mem: EMPTY_MEMORY,
    signal: { state: "loading", snapshot: null, message: null, updatedAt: null } as unknown as EngineEnv["signal"],
    recs: () => [],
    lab: null,
    go,
    newTrade: () => undefined,
    setMem: () => undefined,
    now: NOW,
  };
  return { e, go };
}

describe("Handelsplan · assistant", () => {
  it.each(["Handelsplan", "Öffne den Handelsplan", "Wie groß soll die Position sein?", "Wie groß soll meine Position sein", "Wie viel darf ich kaufen", "Positionsgröße berechnen", "Stop und Ziel planen", "Ich will einen Trade planen", "Plan für diesen Trade"])("%s → the plan tool or the page", (q) => {
    const plan = u(q);
    const ok = (plan.kind === "tool" && plan.tool === "plan") || (plan.kind === "tool" && plan.tool === "navigate" && plan.arg === "plan");
    expect(ok, JSON.stringify(plan)).toBe(true);
  });

  it("opens #plan and says what it does – and that nothing is sent", () => {
    const { e, go } = env();
    const r = respond("Handelsplan", e).replies[0]!;
    expect(r.kind).toBe("tool");
    expect(go).toHaveBeenCalledWith("plan");
    if (r.kind !== "tool") return;
    expect(r.reply.title).toBe("Handelsplan geöffnet");
    expect(r.reply.text).toContain("fünf Schritten");
    expect(r.reply.text).toContain("sendet nie eine Order");
    expect(r.reply.text).toContain("Keine professionelle Finanzberatung.");
  });

  it("the position size question opens the same page", () => {
    const { e, go } = env();
    respond("Wie groß soll die Position sein?", e);
    expect(go).toHaveBeenCalledWith("plan");
  });

  it("does not take over the neighbouring questions", () => {
    const where = u("Wo finde ich den Positionsrechner?");
    expect(where.kind === "tool" && where.tool).toBe("where");
    const labor = u("Öffne das Labor");
    expect(labor.kind === "tool" && labor.tool === "navigate" && labor.arg).toBe("labor");
    const studio = u("Neue Strategie");
    expect(studio.kind === "tool" && studio.tool).toBe("studio");
    const risk = u("Öffne die Risiko-Seite");
    expect(risk.kind === "tool" && risk.tool === "navigate" && risk.arg).toBe("risiko");
  });
});
