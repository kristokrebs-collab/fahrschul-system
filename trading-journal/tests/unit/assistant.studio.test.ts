/**
 * The assistant opens the Strategie-Studio on "Strategie als Text" / "Neue Strategie" – it only opens the page (nothing is
 * computed, nothing is saved, no model is asked), says what the page does, and the neighbouring questions keep their meaning
 * (a bad backtest is still the lab diagnosis, "Wo finde ich …" still the place tool, "öffne das Labor" still navigates).
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

describe("Strategie-Studio · assistant", () => {
  it.each(["Strategie als Text", "Neue Strategie", "Ich will eine neue Strategie schreiben", "Strategie aufschreiben", "Regeln aus einem Text machen", "Strategien vergleichen", "Öffne das Strategie-Studio"])("%s → the studio tool or the page", (q) => {
    const plan = u(q);
    const ok = (plan.kind === "tool" && plan.tool === "studio") || (plan.kind === "tool" && plan.tool === "navigate" && plan.arg === "studio");
    expect(ok, JSON.stringify(plan)).toBe(true);
  });

  it("opens #studio and says what it does – the honest sentences included", () => {
    const { e, go } = env();
    const r = respond("Neue Strategie", e).replies[0]!;
    expect(r.kind).toBe("tool");
    expect(go).toHaveBeenCalledWith("studio");
    if (r.kind !== "tool") return;
    expect(r.reply.title).toBe("Strategie-Studio geöffnet");
    expect(r.reply.text).toContain("statt zu raten");
    expect(r.reply.text).toContain("keine Prognose");
    expect(r.reply.text).toContain("Keine professionelle Finanzberatung.");
  });

  it("does not take over the neighbouring questions", () => {
    const lab = u("Warum ist meine neue Strategie im Backtest so schlecht?");
    expect(lab.kind === "tool" && lab.tool).toBe("lab");
    const where = u("Wo finde ich das Strategie-Studio?");
    expect(where.kind === "tool" && where.tool).toBe("where");
    const labor = u("Öffne das Labor");
    expect(labor.kind === "tool" && labor.tool === "navigate" && labor.arg).toBe("labor");
  });
});
