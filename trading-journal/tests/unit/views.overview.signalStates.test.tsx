/**
 * Candle-close states in the Einstiegs-Check UI (decisions 6 + 9): the verdict's state line (`⚠ vorläufig · schließt in
 * mm:ss` on the shared clock, `bestätigt`, `stark bestätigt`), desaturated ring / label and dashed strength dots of a
 * provisional entry, the rung tiles' states, the hero strip and the bias bar (provisional part of the fill, tag,
 * explainer rows + legend). Countdowns never re-render the card.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBias } from "@/domain/signals/bias";
import type { SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";
import { gradedSnapshot, UI_CFG, v2check } from "./views.overview.signalFixtures";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState, listeners: new Set<() => void>() }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    live.listeners.add(cb);
    return () => void live.listeners.delete(cb);
  };
  return { ...actual, useSignalCheck: () => useSyncExternalStore(subscribe, () => live.state, () => live.state) };
});

import { nowMv } from "@/motion/clock";
import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { firmScore } from "@/views/overview/BiasBar";
import { SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { labelParts, PROV_COLOR, rungViews, stateLineText, strengthView, verdictColor, verdictStateLine } from "@/views/overview/signalView";

const MIN = 60_000;
const bottom = (barsAgo = 0) => ({ kind: "bottom" as const, barsAgo });

/** 30m Bottom on the forming candle (closes in 12:04), 45m / 1h confirmed. */
function provisionalEntry(closesAt: number) {
  return gradedSnapshot([
    v2check("30m", { long: bottom(0), state: "provisional", closesAt, rsi: 28 }),
    v2check("45m", { long: bottom(1), rsi: 33 }),
    v2check("1h", { long: bottom(1), rsi: 36 }),
    v2check("4h", { rsi: 44 }),
  ]);
}
function confirmedEntry(state: "confirmed" | "strong" = "confirmed") {
  return gradedSnapshot([
    v2check("30m", { long: bottom(state === "strong" ? 2 : 1), state, closes: state === "strong" ? 3 : 1, rsi: 28 }),
    v2check("45m", { long: bottom(1), rsi: 33 }),
    v2check("1h", { long: bottom(0), state: "provisional", closesAt: Date.now() + 40 * MIN, rsi: 36 }),
    v2check("4h", { rsi: 44 }),
  ]);
}

function publish(s: Partial<SignalCheckState>): void {
  live.state = { state: "ok", snapshot: null, updatedAt: 1, message: null, ...s };
  for (const l of [...live.listeners]) l();
}
const wrap = (node: React.ReactNode) =>
  render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(() => live.listeners.clear());

describe("state view model", () => {
  it("provisional entry: desaturated colour, the strength it gets on the close (dashed), prefix split off, countdown text", () => {
    const now = Date.now();
    const snap = provisionalEntry(now + 12 * MIN + 4_000);
    const v = snap.long;
    expect(v).toMatchObject({ state: "provisional", valid: false, strength: 0 });
    expect(verdictColor(v)).toBe(PROV_COLOR.long);
    expect(labelParts(v.label)).toEqual({ prefix: "Vorläufig: ", text: v.label.slice("Vorläufig: ".length) });
    const st = strengthView(v, 4);
    expect(st).toMatchObject({ dots: v.provStrength, outlined: true, aria: `Stärke 0 von 4, vorläufig ${v.provStrength}` });
    expect(st.line).toMatch(/ ab Kerzenschluss · 3 von 4 Timeframes$/);
    const line = verdictStateLine(snap, v, UI_CFG);
    expect(line).toMatchObject({ state: "provisional", tf: "30m" });
    expect(stateLineText(line, now)).toBe("vorläufig · schließt in 12:04");
    expect(stateLineText(line, now + 12 * MIN)).toBe("vorläufig · schließt in 0:04");
  });

  it("confirmed / strong / none lines and the rung states", () => {
    const c = confirmedEntry();
    expect(stateLineText(verdictStateLine(c, c.long, UI_CFG), 0)).toBe("bestätigt · 30m-Kerze geschlossen");
    const s = confirmedEntry("strong");
    expect(stateLineText(verdictStateLine(s, s.long, UI_CFG), 0)).toBe("stark bestätigt · 3 Schlüsse gehalten");
    // the short side has no entry: the base candle's countdown when it forms
    const p = provisionalEntry(Date.now() + 5 * MIN);
    expect(stateLineText(verdictStateLine(p, p.short, UI_CFG), Date.now())).toMatch(/^30m-Kerze schließt in [45]:\d\d$/);
    const rungs = rungViews(c, c.long, "long", UI_CFG);
    expect(rungs.map((r) => r.state)).toEqual(["confirmed", "confirmed", "provisional", "none"]);
    expect(rungs[2]!.closesAt).toBeGreaterThan(Date.now());
    expect(rungs[0]!.closesAt).toBeNull();
  });
});

describe("SignalCard", () => {
  it("provisional entry: the label without the prefix (kept for screen readers), the ⚠ countdown, dashed dots", () => {
    live.state = { state: "ok", snapshot: provisionalEntry(Date.now() + 12 * MIN + 30_000), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const verdict = screen.getByTestId("signal-verdict");
    expect(verdict).toHaveAttribute("data-state", "provisional");
    const label = within(verdict).getByTestId("signal-label");
    expect(label.textContent).toMatch(/^Vorläufig: .*Long-Einstieg$/);
    expect(within(label).getByText("Vorläufig:", { exact: false })).toHaveClass("sr-only");
    const line = within(verdict).getByTestId("signal-state");
    expect(line).toHaveAttribute("data-state", "provisional");
    expect(line).toHaveTextContent(/⚠vorläufig · schließt in 12:[0-3]\d/);
    expect(line.className).toContain("text-warn");
    expect(within(verdict).getByRole("img", { name: /^Stärke 0 von 4, vorläufig \d$/ })).toBeInTheDocument();
    // the base rung: provisional tile with its own countdown
    const rung = screen.getAllByTestId("signal-rung")[0]!;
    expect(rung).toHaveAttribute("data-state", "provisional");
    expect(within(rung).getByTestId("signal-rung-state")).toHaveTextContent(/⚠vorläufig·schließt in12:[0-3]\d/);
    // never a fresh-entry badge for a provisional entry
    expect(screen.queryByTestId("signal-fresh")).toBeNull();
  });

  it("the countdown ticks on the shared clock without a React render; confirmed → bestätigt", async () => {
    const closesAt = Date.now() + 10 * MIN;
    live.state = { state: "ok", snapshot: provisionalEntry(closesAt), updatedAt: 1, message: null };
    let renders = 0;
    function Probe() {
      renders++;
      return <SignalCard />;
    }
    wrap(<Probe />);
    const before = renders;
    // the card holds the real clock, whose next second tick sets nowMv to Date.now(): Date follows each step, so a
    // tick that lands between the step and the assertion (a loaded parallel run) cannot move the countdown back
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(closesAt - 65_000);
      act(() => nowMv.set(closesAt - 65_000));
      await waitFor(() => expect(screen.getByTestId("signal-state")).toHaveTextContent("vorläufig · schließt in 1:05"));
      vi.setSystemTime(closesAt - 64_000);
      act(() => nowMv.set(closesAt - 64_000));
      await waitFor(() => expect(screen.getByTestId("signal-state")).toHaveTextContent("vorläufig · schließt in 1:04"));
    } finally {
      vi.useRealTimers();
    }
    expect(renders).toBe(before);
    act(() => publish({ snapshot: confirmedEntry(), updatedAt: 2 }));
    expect(screen.getByTestId("signal-state")).toHaveAttribute("data-state", "confirmed");
    expect(screen.getByTestId("signal-state")).toHaveTextContent("✓bestätigt · 30m-Kerze geschlossen");
    expect(screen.getAllByTestId("signal-rung").map((r) => r.getAttribute("data-state"))).toEqual(["confirmed", "confirmed", "provisional", "none"]);
    const states = screen.getAllByTestId("signal-rung-state").map((el) => el.textContent);
    expect(states[0]).toBe("✓bestätigt");
    expect(states[3]).toBe("");
  });

  it("strongly confirmed: `stark bestätigt` on the verdict and the base rung", () => {
    live.state = { state: "ok", snapshot: confirmedEntry("strong"), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    expect(screen.getByTestId("signal-state")).toHaveTextContent("✓✓stark bestätigt · 3 Schlüsse gehalten");
    expect(screen.getAllByTestId("signal-rung-state")[0]).toHaveTextContent("✓✓stark bestätigt");
  });
});

describe("SignalStrip", () => {
  it("shows the state line and the provisional chip; the accessible name keeps the label (with Vorläufig:)", () => {
    live.state = { state: "ok", snapshot: provisionalEntry(Date.now() + 8 * MIN), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    expect(strip).toHaveAccessibleName(/^Einstiegs-Check: Vorläufig: .*Long-Einstieg, Score \d+ von 100\. Details ansehen$/);
    expect(within(strip).getByTestId("signal-state")).toHaveTextContent(/vorläufig · schließt in [78]:\d\d/);
    const chip = strip.querySelector("[data-state=provisional]");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("⚠");
  });
});

describe("BiasBar", () => {
  it("a provisional entry: the tag with the countdown, a desaturated part of the fill, tagged rows and the legend", () => {
    const snap = provisionalEntry(Date.now() + 6 * MIN);
    live.state = { state: "ok", snapshot: snap, updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const bias = screen.getByTestId("signal-bias");
    expect(bias).toHaveAttribute("data-state", "provisional");
    expect(bias).toHaveAttribute("data-provisional", "true");
    expect(within(bias).getByTestId("bias-provisional")).toHaveTextContent(/⚠vorläufig · [56]:\d\d/);
    const model = computeBias(snap, UI_CFG)!;
    expect(model.contributions.find((c) => c.id === "mcb-30m")!.provisional).toBe(true);
    const firm = firmScore(model);
    expect(firm).toBeGreaterThan(0);
    expect(firm).toBeLessThan(model.score);
    expect(within(bias).getByTestId("bias-fill-firm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Vorläufig: der Einstieg wartet auf den Kerzenschluss\. Bedingungen ansehen$/ }));
    const dialog = screen.getByRole("dialog", { name: "Long/Short-Tendenz" });
    const row = within(dialog)
      .getAllByTestId("bias-row")
      .find((r) => r.getAttribute("data-id") === "mcb-30m")!;
    expect(row).toHaveAttribute("data-provisional", "true");
    expect(within(row).getByText("vorläufig")).toBeInTheDocument();
    expect(within(dialog).getByTestId("bias-legend")).toHaveTextContent(/vorläufig \(laufende Kerze, zählt halb\) · 1 Bedingung/);
  });

  it("firmScore: no provisional rows = the score; limited scores scale", () => {
    expect(firmScore(null)).toBe(0);
    const b = { score: 0.6, sum: 0.6, contributions: [{ id: "a", share: 0.5, vote: 1, provisional: true }, { id: "b", share: 0.5, vote: 0.2 }] } as unknown as Parameters<typeof firmScore>[0];
    // provisional push 0.5 of a sum 0.6 → 1/6 of the score stays firm
    expect(firmScore(b)).toBeCloseTo(0.1, 9);
    const none = { score: 0.4, sum: 0.4, contributions: [{ id: "a", share: 1, vote: 0.4 }] } as unknown as Parameters<typeof firmScore>[0];
    expect(firmScore(none)).toBe(0.4);
  });
});
