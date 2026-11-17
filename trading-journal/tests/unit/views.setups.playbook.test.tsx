import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalCheckState } from "@/market";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { useUi } from "@/store/uiStore";
import { explainPlaybook, playbookBySetup, playbookStats, adherenceText, pfText } from "@/views/setups/playbook";
import { SetupCard } from "@/views/setups/SetupCard";
import { MTF_LIVE_STRINGS } from "@/views/setups/MtfLiveStrip";
import { closedOf, enrich, qt, settingsWith, theirSnap } from "./insights.fixtures";

// a tiny external store standing in for the live engine (the strip subscribes like the real hook)
const live: { state: SignalCheckState; subs: Set<() => void> } = { state: { state: "loading", snapshot: null, updatedAt: null, message: "Kerzen werden geladen …" }, subs: new Set() };
function setLive(state: SignalCheckState) {
  live.state = state;
  for (const cb of live.subs) cb();
}
vi.mock("@/market", async (orig) => ({
  ...(await orig<typeof import("@/market")>()),
  useSignalCheck: () =>
    useSyncExternalStore(
      (cb) => {
        live.subs.add(cb);
        return () => void live.subs.delete(cb);
      },
      () => live.state,
    ),
}));

beforeAll(() => {
  window.scrollTo = vi.fn() as never;
  // jsdom has no IntersectionObserver (Motion's whileInView inside the explainer dialog)
  if (typeof globalThis.IntersectionObserver === "undefined") {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  }
});

const SETUP = { id: "s_pb", name: "Playbook-Test", desc: "", color: "#6f9dc9", account: "both" as const, checklist: [{ id: "a", text: "A" }, { id: "b", text: "B" }] };

function fixture() {
  const s = settingsWith({ setups: [SETUP] });
  const trades = [
    qt("2026-03-01T10:00", { p: 300, risk: 100, setups: ["s_pb"], checks: { "s_pb:a": true, "s_pb:b": true }, mistakes: ["FOMO-Einstieg"], signal: theirSnap("long", 3) }),
    qt("2026-03-02T10:00", { p: -100, risk: 100, setups: ["s_pb"], checks: { "s_pb:a": true }, mistakes: ["FOMO-Einstieg", "Kein Stop"], signal: theirSnap("long", 1) }),
    qt("2026-03-03T10:00", { p: 200, setups: ["s_pb"], checks: { "s_pb:a": true, "s_pb:b": true } }),
    qt("2026-03-04T10:00", { p: 999, setups: ["s_other"] }),
  ];
  return { s, closed: closedOf(enrich(trades, s)) };
}

describe("playbookStats", () => {
  it("aggregates only the setup's trades: expectancy, PF, adherence of ITS checklist, top mistake, Ø signal score", () => {
    const { closed } = fixture();
    const pb = playbookStats(SETUP, closed);
    expect(pb.agg.n).toBe(3);
    expect(pb.agg.exp).toBeCloseTo(400 / 3, 6);
    expect(pb.agg.pf).toBeCloseTo(5, 6);
    expect(pb.adherence).toMatchObject({ items: 2, withList: 3, full: 2, fullWinRate: 1, gapsWinRate: 0 });
    expect(pb.adherence.rate).toBeCloseTo(2 / 3, 6);
    expect(pb.adherence.itemRate).toBeCloseTo((1 + 0.5 + 1) / 3, 6);
    expect(pb.topMistake).toEqual({ tag: "FOMO-Einstieg", n: 2 });
    expect(pb.signal).toMatchObject({ n: 2, avgScore: 40, avgStrength: 2, validShare: 1 });
    expect(adherenceText(pb.adherence)).toBe("67 %");
  });

  it("a setup without checklist reports `ohne Checkliste`, no trades → empty figures; PF ∞ and – are spelled out", () => {
    const { closed } = fixture();
    const none = playbookStats({ id: "s_other", checklist: [] }, closed);
    expect(none.adherence.items).toBe(0);
    expect(adherenceText(none.adherence)).toBe("ohne Checkliste");
    expect(pfText(none.agg.pf)).toBe("∞");
    const map = playbookBySetup([SETUP, { id: "s_x", checklist: [] }], closed);
    expect(map.get("s_x")?.agg.n).toBe(0);
    expect(map.get("s_x")?.signal).toBeNull();
    expect(pfText(null)).toBe("–");
  });

  it("explains every figure with its formula and a verdict", () => {
    const { closed } = fixture();
    const pb = playbookStats(SETUP, closed);
    const ex = explainPlaybook({ setup: SETUP }, pb, "USDT");
    expect(ex.sheetTitle).toBe("Playbook · Playbook-Test");
    const rows = Object.fromEntries(ex.rows.map((r) => [r[0], r[1]]));
    expect(rows["Regel-Treue"]).toBe("67 % · 2/3");
    expect(rows["Häufigster Fehler-Tag"]).toBe("FOMO-Einstieg · 2×");
    expect(rows["Ø Signal-Score"]).toBe("40 · 2×");
    expect(rows["Win-Rate regeltreu / mit Lücken"]).toBe("100 % / 0 %");
    expect(ex.verdict.tone).toBe("warn"); // 3 trades → "Erst 3 Trades"
  });
});

describe("SetupCard · playbook + live check", () => {
  beforeEach(() => {
    setLive({ state: "loading", snapshot: null, updatedAt: null, message: "Kerzen werden geladen …" });
  });

  it("shows the playbook block once the setup has trades and opens its explainer", () => {
    const { closed } = fixture();
    const pb = playbookStats(SETUP, closed);
    const stats = { ...pb.agg, setup: SETUP, id: SETUP.id };
    render(
      <MorphDialogProvider>
        <SetupCard stats={stats} index={0} onEdit={() => {}} onTrades={() => {}} playbook={pb} currency="USDT" />
      </MorphDialogProvider>,
    );
    const block = screen.getByRole("button", { name: "Playbook-Werte: Playbook-Test" });
    const values = within(block).getByTestId("setup-playbook");
    expect(values).toHaveTextContent("+133");
    expect(values).toHaveTextContent("5,00");
    expect(values).toHaveTextContent("67 %");
    expect(values).toHaveTextContent("+300");
    expect(values).toHaveTextContent("−100");
    expect(block).toHaveTextContent("FOMO-Einstieg");
    fireEvent.click(block);
    expect(screen.getByRole("dialog")).toHaveTextContent("Regel-Treue");
    // no live strip on an ordinary setup
    expect(screen.queryByTestId("mtf-live")).toBeNull();
  });

  it("no playbook prop / no trades → no block (additive)", () => {
    const stats = { ...playbookStats(SETUP, []).agg, setup: SETUP, id: SETUP.id };
    render(<SetupCard stats={stats} index={0} onEdit={() => {}} onTrades={() => {}} playbook={playbookStats(SETUP, [])} />);
    expect(screen.queryByRole("button", { name: /Playbook-Werte/ })).toBeNull();
  });

  it("the Multi-TF Signal card shows the live check state and links to the overview", () => {
    const mtf = { ...SETUP, id: "s_mtf", name: "Multi-TF Signal (MCB + RSI + Discount)" };
    const stats = { ...playbookStats(mtf, []).agg, setup: mtf, id: mtf.id };
    render(<SetupCard stats={stats} index={0} onEdit={() => {}} onTrades={() => {}} />);
    const strip = screen.getByTestId("mtf-live");
    expect(strip).toHaveAttribute("data-state", "loading");
    expect(strip).toHaveTextContent("Kerzen werden geladen …");

    const best = { side: "short" as const, tiers: 2, strength: 2 as const, label: "Starker Short-Einstieg", valid: true, rsiOk: true, zoneOk: false, strongSignal: true, score: 63, reasons: [] };
    act(() =>
      setLive({
      state: "ok",
      updatedAt: 1,
      message: null,
      snapshot: { checks: [], zone: null, long: { ...best, side: "long", valid: false, strength: 0, label: "Kein Long-Signal", score: 10 }, short: best, best, at: 1, symbol: "BTCUSDT", source: "binance", cfg: { ladder: ["30m", "45m", "1h", "4h"] }, price: 1 } as never,
      }),
    );
    const ok = screen.getByTestId("mtf-live");
    expect(ok).toHaveAttribute("data-state", "ok");
    expect(ok).toHaveTextContent("Starker Short-Einstieg");
    expect(ok).toHaveTextContent(MTF_LIVE_STRINGS.score(63, 2, 4));
    expect(within(ok).getByRole("img", { name: "Stärke 2 von 4" })).toBeInTheDocument();
    expect(ok).toHaveAccessibleName("Einstiegs-Check öffnen: Starker Short-Einstieg · Stark");
    useUi.setState({ page: "setups" });
    fireEvent.click(ok);
    expect(useUi.getState().page).toBe("overview");
  });
});
