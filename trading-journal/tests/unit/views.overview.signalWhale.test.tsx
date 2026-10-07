/** The "Top-Trader kaufen · Retail rot" row of the SignalCard, its line in the SignalStrip and the view model. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyWhale, bestVerdict, sanitizeSignalCfg, whaleReading, type RatioSample, type SignalCfg, type TfCheck, type WtEvent, type ZoneInfo } from "@/domain/signals";
import type { LiveSignals, SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";

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

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { whaleView } from "@/views/overview/signalView";

const CFG: SignalCfg = sanitizeSignalCfg({ whale: { periods: ["30m", "1h"], minRun: 2, weight: 10 } });
const T0 = Date.UTC(2026, 9, 7, 10, 0);
const M30 = 1_800_000;

function zone(z: Partial<ZoneInfo> = {}): ZoneInfo {
  return { hi: 86_000, lo: 80_000, pos: 0.2, zone: "discount", deep: false, eq: 83_000, bias: 0, brk: null, lux: true, ...z };
}
function check(tf: string, long: WtEvent | null = null, rsi = 35): TfCheck {
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi,
    wt: { kind: long?.kind ?? null, barsAgo: long?.barsAgo ?? null, long, short: null, wt1: -60, wt2: -58 },
    zone: zone(),
    longSignal: !!long,
    shortSignal: false,
    rsiLong: rsi <= 40,
    rsiShort: rsi >= 60,
  };
}
const pts = (v: number[]): RatioSample[] => v.map((longPct, i) => ({ time: T0 + i * M30, longPct }));
const AT = T0 + 2 * M30 + 60_000;
const UP = { top: pts([60, 61, 62.4]), retail: pts([50, 49, 47.9]) }; // long run 2: +2,4 pp / −2,1 pp

function snapshot(series: Record<string, { top: RatioSample[]; retail: RatioSample[] }> | null): LiveSignals {
  const checks = [check("30m", { kind: "bottom", barsAgo: 0 }), check("45m", { kind: "bull", barsAgo: 1 }), check("1h"), check("4h")];
  const z = checks[2]!;
  const base = { ...bestVerdict(checks, CFG, z), checks, zone: z, at: AT, symbol: "BTCUSDT", source: "binance" as const, cfg: CFG, price: 81_200 };
  return series ? applyWhale(base, whaleReading(series, CFG, AT), CFG) : base;
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

describe("whaleView", () => {
  it("holds: lit state, both readings, period chips with their runs, points", () => {
    const v = whaleView(snapshot({ "30m": UP }), "long", CFG);
    expect(v).toMatchObject({ on: true, title: "Top-Trader kaufen · Retail rot", state: "ok", run: 2, need: 2, period: "30m", top: "+2,4 pp", retail: "−2,1 pp", topFits: true, retailFits: true, points: 10, missing: ["1h"] });
    expect(v.periods).toEqual([{ period: "30m", run: 2, ok: true }]);
    expect(whaleView(snapshot({ "30m": UP }), "short", CFG)).toMatchObject({ title: "Top-Trader verkaufen · Retail grün", state: "open", run: 0, topFits: false, retailFits: false, points: 0 });
  });

  it("no reading → state none (keine Daten), switched off → on: false", () => {
    expect(whaleView(snapshot(null), "long", CFG)).toMatchObject({ on: true, state: "none", runText: "keine Daten", missing: ["30m", "1h"] });
    expect(whaleView(snapshot(null), "long", sanitizeSignalCfg({ whale: { on: false } })).on).toBe(false);
  });
});

describe("SignalCard row", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => live.listeners.clear());

  it("lights the row with both readings when it holds, adds the reason and the strength", () => {
    live.state = { state: "ok", snapshot: snapshot({ "30m": UP }), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const row = screen.getByTestId("signal-whale");
    expect(row).toHaveAttribute("data-lit", "true");
    expect(within(row).getByText("Top-Trader kaufen · Retail rot")).toBeInTheDocument();
    expect(within(row).getByText("erfüllt:", { exact: false })).toBeInTheDocument();
    expect(within(row).getByText("+2,4 pp")).toBeInTheDocument();
    expect(within(row).getByText("−2,1 pp")).toBeInTheDocument();
    expect(within(row).getByText("30m · 2×")).toBeInTheDocument();
    expect(within(row).getByText("1h · –")).toBeInTheDocument();
    expect(within(row).getByText("+10 Score · +1 Stärke")).toBeInTheDocument();
    expect(screen.getByTestId("signal-label")).toHaveTextContent("Sehr starker Long-Einstieg");
    const reasons = screen.getByRole("list", { name: "Bedingungen" });
    expect(within(reasons).getByText("Top-Trader kaufen · Retail rot (2× 30m/1h)")).toBeInTheDocument();
  });

  it("mirrors for the short side and shows keine Daten without a reading (never a fail)", () => {
    live.state = { state: "ok", snapshot: snapshot({ "30m": UP }), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    fireEvent.click(screen.getByRole("radio", { name: "Short" }));
    const row = screen.getByTestId("signal-whale");
    expect(row).not.toHaveAttribute("data-lit");
    expect(within(row).getByText("Top-Trader verkaufen · Retail grün")).toBeInTheDocument();
    expect(within(row).getByText("mind. 2× in Folge")).toBeInTheDocument();
    act(() => publish({ snapshot: snapshot(null), updatedAt: 2 }));
    expect(screen.getByTestId("signal-whale")).toHaveAttribute("data-state", "none");
    expect(within(screen.getByTestId("signal-whale")).getByText("keine Daten · 30m, 1h")).toBeInTheDocument();
  });

  it("is hidden when the condition is switched off", () => {
    const off = sanitizeSignalCfg({ whale: { on: false } });
    live.state = { state: "ok", snapshot: { ...snapshot(null), cfg: off }, updatedAt: 1, message: null };
    wrap(<SignalCard />);
    expect(screen.queryByTestId("signal-whale")).toBeNull();
  });
});

describe("SignalStrip line", () => {
  beforeAll(() => installDomPolyfills());

  it("one slim lit line and the condition in the accessible name while it holds", () => {
    live.state = { state: "ok", snapshot: snapshot({ "30m": UP }), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    expect(within(strip).getByTestId("signal-strip-whale")).toHaveAttribute("data-lit", "true");
    expect(within(strip).getByText("2/2× 30m")).toBeInTheDocument();
    expect(strip).toHaveAccessibleName(/Score \d+ von 100\. Top-Trader kaufen · Retail rot\. Details ansehen$/);
  });

  it("keine Daten when there is no reading", () => {
    live.state = { state: "ok", snapshot: snapshot(null), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    expect(within(screen.getByTestId("signal-strip-whale")).getByText("keine Daten")).toBeInTheDocument();
  });
});
