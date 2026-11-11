import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bestVerdict, DEFAULT_SIGNAL_CFG, type SignalCfg, type TfCheck, type WtEvent, type ZoneInfo } from "@/domain/signals";
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
import { FRESH_ENTRY_TEXT, SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { entryLevels, freshEntry, ladderText, meterPct, rsiBands, rungViews, statusPill, verdictColor, zonePosition } from "@/views/overview/signalView";

const CFG: SignalCfg = DEFAULT_SIGNAL_CFG;

function zone(z: Partial<ZoneInfo> = {}): ZoneInfo {
  return { hi: 86_000, lo: 80_000, pos: 0.2, zone: "discount", deep: false, eq: 83_000, bias: 0, brk: { kind: "CHoCH", dir: 1 }, lux: true, ...z };
}

function check(tf: string, o: { long?: WtEvent; short?: WtEvent; rsi?: number; zone?: Partial<ZoneInfo> } = {}): TfCheck {
  const rsi = o.rsi ?? 35;
  const longEv = o.long ?? null;
  const shortEv = o.short ?? null;
  const latest = longEv ?? shortEv;
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi + 2,
    wt: { kind: latest?.kind ?? null, barsAgo: latest?.barsAgo ?? null, long: longEv, short: shortEv, wt1: -61.2, wt2: -58 },
    zone: zone(o.zone),
    longSignal: !!longEv,
    shortSignal: !!shortEv,
    rsiLong: rsi <= CFG.rsiOs + CFG.rsiNear,
    rsiShort: rsi >= CFG.rsiOb - CFG.rsiNear,
  };
}

function snapshot(checks: (TfCheck | null)[]): LiveSignals {
  const z = checks.find((c) => c?.tf === CFG.zoneTf) ?? null;
  return { ...bestVerdict(checks, CFG, z), checks, zone: z, at: 1_760_000_000_000, symbol: "BTCUSDT", source: "binance", cfg: CFG, price: 81_200 };
}

const NONE = [check("30m"), check("45m"), check("1h"), check("4h")];
const LONG2 = [check("30m", { long: { kind: "bottom", barsAgo: 1 } }), check("45m", { long: { kind: "bull", barsAgo: 0 } }), check("1h"), check("4h")];
const LONG3 = [check("30m", { long: { kind: "bottom", barsAgo: 1 } }), check("45m", { long: { kind: "bull", barsAgo: 0 } }), check("1h", { long: { kind: "buy", barsAgo: 0 } }), check("4h")];

function publish(s: Partial<SignalCheckState>): void {
  live.state = { state: "ok", snapshot: null, updatedAt: 1, message: null, ...s };
  for (const l of [...live.listeners]) l();
}

function wrap(node: React.ReactNode) {
  return render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("signal view model", () => {
  it("builds rung tiles: role, lit ladder, matching event, RSI near", () => {
    const s = snapshot(LONG2);
    expect(s.long.valid).toBe(true);
    const rungs = rungViews(s, s.long, "long", CFG);
    expect(rungs.map((r) => r.role)).toEqual(["Basis", "Bestätigung", "stärker", "stärker"]);
    expect(rungs.map((r) => r.lit)).toEqual([true, true, false, false]);
    expect(rungs[0]).toMatchObject({ text: "Bottom", match: true, strong: true, longKind: true, rsiNear: true });
    expect(rungs[1]).toMatchObject({ text: "Kreuz", match: true, strong: false });
    expect(rungs[2]).toMatchObject({ text: "kein Signal", event: null, match: false });
    // the short side shows the same long events muted (latest of any direction)
    const short = rungViews(s, s.short, "short", CFG);
    expect(short[0]).toMatchObject({ text: "Bottom", match: false, lit: false });
  });

  it("keeps the configured timeframe of a rung without bars", () => {
    const s = snapshot([check("30m"), null, check("1h"), check("4h")]);
    const rungs = rungViews(s, s.long, "long", CFG);
    expect(rungs[1]).toMatchObject({ tf: "45m", check: null, event: null });
  });

  it("maps meter and zone positions (clamped)", () => {
    expect(meterPct(-100, -100, 100)).toBe(0);
    expect(meterPct(0, -100, 100)).toBe(50);
    expect(meterPct(140, 0, 100)).toBe(100);
    expect(meterPct(Number.NaN, 0, 100)).toBe(50);
    expect(zonePosition(83_000, zone())).toBeCloseTo(0.5);
    expect(zonePosition(70_000, zone())).toBe(0);
    expect(zonePosition(0, zone({ pos: 0.3 }))).toBeCloseTo(0.3);
    expect(rsiBands(CFG)).toEqual({ nearLo: 40, lo: 30, nearHi: 60, hi: 70 });
  });

  it("announces a fresh entry only when a side's level rises, never on the first evaluation", () => {
    const none = entryLevels(snapshot(NONE));
    const two = entryLevels(snapshot(LONG2));
    const three = entryLevels(snapshot(LONG3));
    expect(freshEntry(null, two)).toBeNull();
    expect(freshEntry(none, two)).toBe("long");
    expect(freshEntry(two, three)).toBe("long");
    expect(freshEntry(three, two)).toBeNull();
    expect(freshEntry(two, two)).toBeNull();
  });

  it("status pill, ladder text and verdict colour", () => {
    expect(statusPill("ok")).toEqual({ tone: "live", label: "Live" });
    expect(statusPill("stale")).toEqual({ tone: "warn", label: "Veraltet" });
    expect(statusPill("offline").tone).toBe("error");
    expect(ladderText(CFG.ladder)).toBe("30m → 45m → 1h → 4h");
    expect(verdictColor({ valid: false, side: "long" })).toBe("#9b9b9b");
    expect(verdictColor({ valid: true, side: "short" })).toBe("#ff4d4f");
  });
});

describe("SignalCard", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    live.listeners.clear();
    live.state = { state: "loading", snapshot: null, updatedAt: null, message: "Kerzen werden geladen …" };
  });

  it("shows the loading text with a height-reserving skeleton, then the verdict, ladder, zone and reasons", () => {
    wrap(<SignalCard />);
    const card = screen.getByTestId("signal-card");
    expect(card).toHaveAttribute("data-state", "loading");
    expect(within(card).getByText("Kerzen werden geladen …")).toBeInTheDocument();

    act(() => publish({ snapshot: snapshot(LONG2) }));
    expect(card).toHaveAttribute("data-state", "ok");
    expect(within(card).getByTestId("signal-label")).toHaveTextContent("Long-Einstieg");
    expect(within(card).getByRole("img", { name: "Stärke 2 von 4" })).toBeInTheDocument();
    expect(within(card).getByText("Stark · 2 von 4 Timeframes")).toBeInTheDocument();
    const rungs = within(card).getAllByTestId("signal-rung");
    expect(rungs).toHaveLength(4);
    expect(rungs.filter((r) => r.hasAttribute("data-lit"))).toHaveLength(2);
    expect(within(card).getByText("Zone · 1h")).toBeInTheDocument();
    expect(within(card).getByText("Discount · 20 %")).toBeInTheDocument();
    expect(within(card).getByText("live · 30m → 45m → 1h → 4h")).toBeInTheDocument();
    // reasons: ladder rungs + RSI + zone, with their state for screen readers
    const reasons = within(card).getByRole("list", { name: "Bedingungen" });
    expect(within(reasons).getAllByRole("listitem")).toHaveLength(6);
    expect(within(reasons).getAllByText("erfüllt:", { exact: false }).length).toBe(4);
  });

  it("switches the side and opens the info explainer", () => {
    live.state = { state: "ok", snapshot: snapshot(LONG2), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    fireEvent.click(screen.getByRole("radio", { name: "Short" }));
    // the new label rises in while the old one exits (popLayout keeps it until its exit ends)
    expect(screen.getAllByTestId("signal-label").some((el) => el.textContent === "Kein Short-Signal")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Details zeigen: Einstiegs-Check" }));
    expect(screen.getByText("So prüft das Journal")).toBeInTheDocument();
    expect(screen.getByText("Leiter 55 · RSI 20 · Zone 15 · Bottom/Top 10")).toBeInTheDocument();
  });

  it("marks a NEW valid entry (not on load) and drops the mark when the entry is gone", () => {
    live.state = { state: "ok", snapshot: snapshot(NONE), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    expect(screen.queryByTestId("signal-fresh")).toBeNull();
    act(() => publish({ snapshot: snapshot(LONG2), updatedAt: 2 }));
    expect(screen.getByTestId("signal-fresh")).toHaveTextContent(FRESH_ENTRY_TEXT.long);
    act(() => publish({ snapshot: snapshot(NONE), updatedAt: 3 }));
    // AnimatePresence keeps the leaving nodes for their exit (popLayout may insert the new one first)
    expect(screen.getAllByTestId("signal-label").some((el) => el.textContent === "Kein Long-Signal")).toBe(true);
  });

  it("offers a refresh when offline without data", () => {
    live.state = { state: "offline", snapshot: null, updatedAt: null, message: "Keine Marktdaten (Binance)." };
    wrap(<SignalCard />);
    expect(screen.getByText("Keine Marktdaten (Binance).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jetzt aktualisieren" })).toBeInTheDocument();
  });

  it("re-renders only when the published state changes", () => {
    live.state = { state: "ok", snapshot: snapshot(LONG2), updatedAt: 1, message: null };
    let renders = 0;
    function Probe() {
      renders++;
      return <SignalCard />;
    }
    wrap(<Probe />);
    const base = renders;
    act(() => {
      for (const l of [...live.listeners]) l(); // same object → no render
    });
    expect(renders).toBe(base);
  });
});

describe("SignalStrip", () => {
  beforeAll(() => installDomPolyfills());

  it("summarises the best verdict and scrolls to the card", () => {
    live.state = { state: "ok", snapshot: snapshot(LONG3), updatedAt: 1, message: null };
    const target = document.createElement("div");
    target.id = "signal-card";
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    expect(strip).toHaveAccessibleName(/^Einstiegs-Check: Sehr starker Long-Einstieg, Score \d+ von 100\. Details ansehen$/);
    fireEvent.click(strip);
    expect(scroll).toHaveBeenCalled();
    target.remove();
  });
});
