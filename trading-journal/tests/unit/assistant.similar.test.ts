/**
 * F19 → F74: the assistant's small tool that only OPENS „Ähnliche Situationen“ (Markt page, card scrolled to). It routes the
 * phrases for similar situations to it – and only those – and it saves nothing, starts no search.
 */
import { describe, expect, it, vi } from "vitest";
import { runTool, type ToolEnv } from "@/assistant/tools";
import { understand, type Plan } from "@/assistant/understand";
import { COACH_SETTINGS } from "./coach.fixtures";

const NOW = new Date(2026, 5, 10, 12).getTime();
const ctx = { parse: { setups: COACH_SETTINGS.setups, assets: ["BTC", "ETH"], tags: [], now: NOW }, prev: null, closed: 20 };
const tool = (q: string): string => {
  const p: Plan = understand(q, ctx);
  return p.kind === "tool" ? p.tool : p.kind;
};

describe("similar situations tool", () => {
  it("routes the phrases for historically similar situations to it", () => {
    for (const q of ["Zeig mir ähnliche Situationen", "gab es schon mal eine ähnliche Marktlage?", "historisch ähnliche Situationen", "ähnliche Muster im Chart", "vergleichbare Situationen finden", "wann war das schon mal so"]) expect(tool(q), q).toBe("similar");
  });

  it("leaves neighbouring requests alone", () => {
    expect(tool("Was fehlt für meinen Einstieg?")).toBe("entry");
    expect(tool("wie ist die Marktlage")).toBe("entry");
    expect(tool("Ich will üben")).toBe("train");
    expect(tool("wie kann ich besser werden")).toBe("improve");
    expect(tool("Win-Rate diesen Monat")).toBe("journal");
  });

  it("only opens: it calls the callback once, saves nothing, closes the sheet; without the callback it says so", () => {
    const similar = vi.fn();
    const setMem = vi.fn();
    const r = runTool("similar", "ähnliche Situationen", { similar, setMem, now: NOW } as unknown as ToolEnv);
    expect(similar).toHaveBeenCalledTimes(1);
    expect(setMem).not.toHaveBeenCalled();
    expect(r).toMatchObject({ title: "Ähnliche Situationen geöffnet", close: true });
    expect(r.text).toMatch(/keine Prognose/);
    const none = runTool("similar", "ähnliche Situationen", { now: NOW } as unknown as ToolEnv);
    expect(none.close).toBe(false);
    expect(none.text).toContain("nicht verfügbar");
  });
});
