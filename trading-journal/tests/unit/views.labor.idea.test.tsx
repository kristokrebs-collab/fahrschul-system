/**
 * F12 views: "Diese Idee testen" fills the lab (store), the origin card names what became a rule and what did not, the button
 * navigates only when a rule exists, and the assistant tool prefills without saving or starting anything.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leavesOf, translateIdea, type IdeaInput } from "@/domain/lab";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ideaTool, type ToolEnv } from "@/assistant/tools";
import { understand } from "@/assistant/understand";
import { __resetLabor, LaborView, useLabor } from "@/views/labor";
import { TestIdeaButton } from "@/views/labor/TestIdeaButton";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const COMBO: IdeaInput = { kind: "combo", label: "Montag · London", factors: [{ dim: "weekday", key: "0", label: "Montag" }, { dim: "session", key: "london", label: "London" }, { dim: "side", key: "short", label: "Short" }, { dim: "asset", key: "ETH/USDT", label: "ETH/USDT" }, { dim: "setup", key: "s1", label: "Box-Breakout" }] };
const NOTHING: IdeaInput = { kind: "combo", label: "Revenge", factors: [{ dim: "behavior", key: "revenge", label: "Revenge" }] };

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetLabor();
  window.location.hash = "#overview";
});
afterEach(() => __resetLabor());

describe("Labor-Store: Idee übernehmen", () => {
  it("füllt Strategie, Markt und Regeln; merkt sich das Vorherige; der Weg zurück stellt es her", () => {
    const before = useLabor.getState().cfg;
    const d = translateIdea(COMBO);
    expect(useLabor.getState().applyIdea(d)).toBe(true);
    const s = useLabor.getState();
    expect(s.cfg.strategy).toBe("custom");
    expect(s.cfg.symbol).toBe("ETHUSDT");
    expect(s.cfg.custom.sides).toBe("short");
    expect(leavesOf(s.cfg.custom.short)[0]!.block).toBe("timeWindow");
    expect(s.idea?.draft.gaps.map((g) => g.what)).toEqual(['Setup „Box-Breakout“']);
    // nothing was saved as a draft and nothing started
    expect(s.drafts).toEqual([]);
    expect(s.status).toBe("idle");
    s.restoreBeforeIdea();
    expect(useLabor.getState().cfg.symbol).toBe(before.symbol);
    expect(useLabor.getState().cfg.strategy).toBe(before.strategy);
    expect(useLabor.getState().cfg.custom).toEqual(before.custom);
    expect(useLabor.getState().idea).toBeNull();
  });

  it("eine zweite Idee behält den ursprünglichen Stand als Rückweg", () => {
    const before = useLabor.getState().cfg;
    useLabor.getState().applyIdea(translateIdea(COMBO));
    useLabor.getState().applyIdea(translateIdea({ kind: "combo", label: "x", factors: [{ dim: "session", key: "asia", label: "Asien" }] }));
    useLabor.getState().restoreBeforeIdea();
    expect(useLabor.getState().cfg.custom).toEqual(before.custom);
  });

  it("eine Idee ohne Regel lässt das Labor unberührt", () => {
    const before = useLabor.getState().cfg;
    expect(useLabor.getState().applyIdea(translateIdea(NOTHING))).toBe(false);
    expect(useLabor.getState().cfg).toEqual(before);
    expect(useLabor.getState().idea).toBeNull();
  });
});

describe("Karte „Idee aus dem Journal“", () => {
  it("zeigt Übernommenes, Nicht-Abgebildetes mit Grund und die Näherungen; ausblenden und zurück gehen", () => {
    useLabor.getState().applyIdea(translateIdea(COMBO));
    render(
      <MotionRoot>
        <MorphDialogProvider>
          <LaborView />
        </MorphDialogProvider>
      </MotionRoot>,
    );
    const card = screen.getByTestId("labor-idea");
    expect(within(screen.getByTestId("labor-idea-mapped")).getByText(/Kerze öffnet am Montag in der Session London \(UTC\)/)).toBeTruthy();
    const gaps = screen.getByTestId("labor-idea-gaps");
    expect(within(gaps).getByText(/Box-Breakout/)).toBeTruthy();
    expect(within(gaps).getByText(/Playbook mit Beschreibung und Checkliste/)).toBeTruthy();
    expect(within(screen.getByTestId("labor-idea-notes")).getByText(/rechnet das Labor in UTC/)).toBeTruthy();
    // the builder below shows the same rule
    expect(screen.getByTestId("labor-builder")).toBeTruthy();
    fireEvent.click(within(card).getByTestId("labor-idea-hide"));
    expect(screen.queryByTestId("labor-idea")).toBeNull();
  });
});

describe("Knopf „Diese Idee testen“", () => {
  it("füllt das Labor und öffnet die Seite", async () => {
    const onOpen = vi.fn();
    render(<TestIdeaButton input={COMBO} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("test-idea"));
    await waitFor(() => expect(window.location.hash).toBe("#labor"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(useLabor.getState().cfg.symbol).toBe("ETHUSDT");
  });

  it("ohne abbildbare Regel bleibt alles beim Alten und der Grund steht unter dem Knopf", async () => {
    const before = useLabor.getState().cfg;
    render(<TestIdeaButton input={NOTHING} />);
    fireEvent.click(screen.getByTestId("test-idea"));
    const msg = await screen.findByTestId("test-idea-problem");
    expect(msg.textContent).toMatch(/keine Regel/);
    expect(window.location.hash).toBe("#overview");
    expect(useLabor.getState().cfg).toEqual(before);
  });
});

describe("Assistent: „Teste diese Idee“", () => {
  const snapshot = (valid: boolean) => ({
    symbol: "BTCUSDT",
    cfg: { ladder: ["30m", "1h", "4h"] },
    best: { side: "long" as const, valid, strength: valid ? 3 : 0, label: valid ? "Sehr starker Long-Einstieg" : "Kein Long-Signal", state: "confirmed" as const, parts: [] },
  });
  const env = (snap: unknown, applyIdea?: ToolEnv["applyIdea"]) => {
    const go = vi.fn();
    return { go, e: { signal: { state: "ok", snapshot: snap, updatedAt: 1, message: null }, go, applyIdea } as unknown as ToolEnv };
  };

  it("erkennt die Bitte", () => {
    for (const q of ["teste diese Idee", "Kannst du diese Idee testen?", "Idee im Labor testen", "diesen Einstieg im Labor prüfen"]) {
      const p = understand(q, { parse: { assets: [], setups: [] } as never, closed: 0 });
      expect(p.kind === "tool" ? p.tool : p.kind, q).toBe("idea");
    }
  });

  it("füllt nur vor, navigiert, nennt Nicht-Abgebildetes und startet/speichert nichts", () => {
    const applied = vi.fn(() => true);
    const { go, e } = env(snapshot(true), applied);
    const r = ideaTool(e);
    expect(applied).toHaveBeenCalledTimes(1);
    const draft = (applied.mock.calls[0] as unknown as [{ testable: boolean; config: { interval: string } }])[0];
    expect(draft.testable).toBe(true);
    expect(go).toHaveBeenCalledWith("labor");
    expect(r.close).toBe(true);
    expect(r.text).toMatch(/Gestartet oder gespeichert habe ich nichts/);
    expect(r.text).toMatch(/Top-Trader-Teil/);
    expect(r.text).toMatch(/Lage-Ampel/);
  });

  it("ohne Live-Check oder wenn das Labor ablehnt: ehrliche Antwort, keine Navigation", () => {
    const none = env(null, vi.fn(() => true));
    expect(ideaTool(none.e).title).toBe("Keine Idee zum Testen");
    expect(none.go).not.toHaveBeenCalledWith("labor");
    const refused = env(snapshot(true), vi.fn(() => false));
    expect(ideaTool(refused.e).title).toBe("Das kann ich nicht ins Labor übernehmen");
    expect(refused.go).not.toHaveBeenCalledWith("labor");
    const noHook = env(snapshot(true), undefined);
    expect(ideaTool(noHook.e).title).toBe("Das kann ich nicht ins Labor übernehmen");
  });
});

void act;
