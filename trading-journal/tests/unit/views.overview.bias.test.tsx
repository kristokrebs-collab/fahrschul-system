/**
 * `BiasBar` (Long/Short-Tendenz) in the Einstiegs-Check card and the hero strip: meter semantics and text alternative,
 * label / percent, the explainer (tap; weights add up to 100 %, contributions to the sum, the held-label note),
 * label hysteresis across published evaluations, live bias weights from the settings (no new evaluation needed), the
 * compact strip line, reduced motion (the needle jumps), the needle spring.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bestVerdict, sanitizeSignalCfg, DEFAULT_SIGNAL_CFG, type SignalCfg, type TfCheck, type WtEvent, type ZoneInfo } from "@/domain/signals";
import { computeBias } from "@/domain/signals/bias";
import type { LiveSignals, SignalCheckState } from "@/market";
import { dampingRatio, physicsOf } from "@/motion/physics";
import { spring } from "@/motion/tokens";
import { installDomPolyfills } from "./views.overview.harness";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState, listeners: new Set<() => void>() }));
const fx = vi.hoisted(() => ({ reduced: false }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    live.listeners.add(cb);
    return () => void live.listeners.delete(cb);
  };
  return { ...actual, useSignalCheck: () => useSyncExternalStore(subscribe, () => live.state, () => live.state) };
});
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { BiasBar, biasX, needleSpring, voteWord } from "@/views/overview/BiasBar";
import { SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { useJournal } from "@/store/journalStore";

const CFG: SignalCfg = sanitizeSignalCfg(DEFAULT_SIGNAL_CFG);

function zone(pos: number): ZoneInfo {
  return { hi: 86_000, lo: 80_000, pos, zone: pos > 0.525 ? "premium" : pos >= 0.475 ? "equilibrium" : "discount", deep: false, eq: 83_000, bias: 0, brk: null, lux: true };
}

function check(tf: string, o: { long?: WtEvent; short?: WtEvent; rsi?: number; wt1?: number; pos?: number } = {}): TfCheck {
  const rsi = o.rsi ?? 50;
  const latest = o.long ?? o.short ?? null;
  const wt1 = o.wt1 ?? 0;
  return {
    tf,
    ok: true,
    closeAt: 1_760_000_000,
    rsi,
    rsiMa: rsi,
    wt: { kind: latest?.kind ?? null, barsAgo: latest?.barsAgo ?? null, long: o.long ?? null, short: o.short ?? null, wt1, wt2: wt1 },
    zone: zone(o.pos ?? 0.5),
    longSignal: !!o.long,
    shortSignal: !!o.short,
    rsiLong: rsi <= 40,
    rsiShort: rsi >= 60,
  };
}

function snapshot(checks: (TfCheck | null)[], cfg: SignalCfg = CFG): LiveSignals {
  const z = checks.find((c) => c?.tf === cfg.zoneTf) ?? null;
  return { ...bestVerdict(checks, cfg, z), checks, zone: z, at: 1_760_000_000_000, symbol: "BTCUSDT", source: "binance", cfg, price: 81_200 };
}

const bottom = (barsAgo = 0): WtEvent => ({ kind: "bottom", barsAgo });
const top = (barsAgo = 0): WtEvent => ({ kind: "top", barsAgo });
const LONG = [check("30m", { long: bottom(), rsi: 28, pos: 0.1 }), check("45m", { long: bottom(1), rsi: 33, pos: 0.1 }), check("1h", { long: bottom(), rsi: 36, pos: 0.1 }), check("4h", { rsi: 44, wt1: -40 })];
const SHORT = [check("30m", { short: top(), rsi: 72, pos: 0.9 }), check("45m", { short: top(1), rsi: 67, pos: 0.9 }), check("1h", { short: top(), rsi: 64, pos: 0.9 }), check("4h", { rsi: 56, wt1: 40 })];

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

const SETTINGS = useJournal.getState().settings;
beforeAll(() => installDomPolyfills());
beforeEach(() => {
  live.listeners.clear();
  live.state = { state: "ok", snapshot: snapshot(LONG), updatedAt: 1, message: null };
});
afterEach(() => {
  fx.reduced = false;
  useJournal.setState({ settings: SETTINGS });
});

/** `+0,16` / `−0,05` / `±0,00` → number */
const deNum = (t: string): number => Number(t.replace("±", "").replace("−", "-").replace(",", "."));

describe("BiasBar in the card", () => {
  it("is a meter with value, range and a German text alternative; label and percent show the lean", () => {
    wrap(<SignalCard />);
    const bias = screen.getByTestId("signal-bias");
    const meter = within(bias).getByRole("meter", { name: "Long/Short-Tendenz" });
    expect(meter).toHaveAttribute("aria-valuemin", "-100");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    const now = Number(meter.getAttribute("aria-valuenow"));
    expect(now).toBeGreaterThan(50);
    const model = computeBias(snapshot(LONG), CFG)!;
    expect(now).toBe(Math.round(model.score * 100));
    expect(meter).toHaveAttribute("aria-valuetext", `Stark Long, ${model.pct} %`);
    expect(bias).toHaveAttribute("data-level", "2");
    expect(within(bias).getByTestId("bias-label")).toHaveTextContent("Stark Long");
    expect(within(bias).getByTestId("bias-percent")).toHaveTextContent(/\d+\s*%\s*Long/);
    // the bar sits above the ladder (top of the card's content)
    const card = screen.getByTestId("signal-card");
    const firstRung = within(card).getAllByTestId("signal-rung")[0]!;
    expect(bias.compareDocumentPosition(firstRung) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the explainer with a diverging bar per condition", () => {
    wrap(<SignalCard />);
    const btn = screen.getByRole("button", { name: /^Long\/Short-Tendenz: Stark Long, \d+ %\. Bedingungen ansehen$/ });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(btn);
    const dialog = screen.getByRole("dialog", { name: "Long/Short-Tendenz" });
    const list = within(dialog).getByRole("list", { name: "Beiträge der Bedingungen" });
    const rows = within(list).getAllByTestId("bias-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["mcb-30m", "mcb-45m", "mcb-1h", "mcb-4h", "rsi", "zone", "whale"]);
    expect(rows.find((r) => r.getAttribute("data-id") === "mcb-30m")).toHaveAttribute("data-vote", "1.00");
    // no top-trader reading in this snapshot: shown as "keine Daten", not counted
    const whale = rows.find((r) => r.getAttribute("data-id") === "whale")!;
    expect(whale).toHaveAttribute("data-vote", "none");
    expect(within(whale).getAllByText("keine Daten").length).toBeGreaterThan(0);
    expect(within(whale).getByText("zählt nicht")).toBeInTheDocument();
    expect(within(whale).getByText("Top-Trader vs. Retail")).toBeInTheDocument(); // no reading: neutral title
    expect(within(dialog).getByText(/6 von 7 Bedingungen mit Daten/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Gewichte wie die Score-Punkte des Checks/)).toBeInTheDocument();
    // "Gewicht 16 % → +0,16": the shares add up to exactly 100 %, the contributions to exactly the shown sum
    const parts = within(list)
      .getAllByTestId("bias-row-weight")
      .map((el) => el.textContent ?? "")
      .filter((t) => t.startsWith("Gewicht"))
      .map((t) => /^Gewicht (\d+) % → ([+−±][\d,]+)$/.exec(t)!);
    expect(parts).toHaveLength(6);
    expect(parts.reduce((a, m) => a + Number(m[1]), 0)).toBe(100);
    const sumLine = within(dialog).getByTestId("bias-sum").textContent ?? "";
    const sum = deNum(/^Summe ([+−±][\d,]+)/.exec(sumLine)![1]!);
    expect(parts.reduce((a, m) => a + Math.round(deNum(m[2]!) * 100), 0)).toBe(Math.round(sum * 100));
    expect(sumLine).toMatch(/→ Stark Long · \d+ % Long · 6 von 7/);
    expect(sumLine).not.toMatch(/begrenzt|gehalten/);
  });

  it("short setup: a Short label and a negative value", () => {
    live.state = { state: "ok", snapshot: snapshot(SHORT), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const meter = screen.getByRole("meter", { name: "Long/Short-Tendenz" });
    expect(Number(meter.getAttribute("aria-valuenow"))).toBeLessThan(-50);
    expect(meter.getAttribute("aria-valuetext")).toMatch(/^Stark Short, \d+ %$/);
    expect(screen.getByTestId("bias-percent")).toHaveTextContent(/Short/);
  });

  it("keeps its label while the score hovers at a boundary (hysteresis), changes it on a clear move", () => {
    // zone-only weights: score = zone vote = (0.475 − pos) / 0.475
    const cfg = sanitizeSignalCfg({ whale: { on: false }, bias: { mcb: 0, rsi: 0, zone: 100 } });
    const at = (score: number) => snapshot([check("30m"), check("45m"), check("1h", { pos: 0.475 - score * 0.475 }), check("4h")], cfg);
    live.state = { state: "ok", snapshot: at(0.2), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const meter = () => screen.getByRole("meter", { name: "Long/Short-Tendenz" });
    expect(meter()).toHaveAttribute("aria-valuetext", "Eher Long, 60 %");
    act(() => publish({ snapshot: at(0.13), updatedAt: 2 })); // below 0.15, within the 0.05 band
    expect(meter()).toHaveAttribute("aria-valuetext", "Eher Long, 57 %");
    act(() => publish({ snapshot: at(0.06), updatedAt: 3 }));
    expect(meter()).toHaveAttribute("aria-valuetext", "Neutral, 53 % Long");
    act(() => publish({ snapshot: at(0.18), updatedAt: 4 })); // back above 0.15, still within Neutral's band
    expect(meter()).toHaveAttribute("aria-valuetext", "Neutral, 59 % Long");
    // the explainer continues the card's level and says why the label holds
    fireEvent.click(screen.getByRole("button", { name: /^Long\/Short-Tendenz: Neutral, 59 % Long\. Bedingungen ansehen$/ }));
    const dialog = screen.getByRole("dialog", { name: "Long/Short-Tendenz" });
    expect(within(dialog).getByTestId("bias-sum")).toHaveTextContent(/→ Neutral \(gehalten: wechselt erst ab 60 %\) · 59 % Long/);
    expect(within(dialog).getByText(/Die Stufe wechselt erst 2,5 % hinter der Grenze\./)).toBeInTheDocument();
  });

  it("reads the bias weights live from the settings (an override applies without a new evaluation)", () => {
    wrap(<SignalCard />);
    const meter = () => screen.getByRole("meter", { name: "Long/Short-Tendenz" });
    const before = Number(meter().getAttribute("aria-valuenow"));
    expect(before).toBe(Math.round(computeBias(snapshot(LONG), CFG)!.score * 100));
    // RSI only: the head rungs (30m · 45m · 1h) are all near oversold → fully long
    act(() => useJournal.setState({ settings: { ...SETTINGS, signals: { bias: { mcb: 0, rsi: 100, zone: 0 } } } }));
    expect(meter()).toHaveAttribute("aria-valuenow", "100");
    expect(meter()).toHaveAttribute("aria-valuetext", "Stark Long, 100 %");
    fireEvent.click(screen.getByRole("button", { name: /Bedingungen ansehen$/ }));
    expect(within(screen.getByRole("dialog", { name: "Long/Short-Tendenz" })).getByText(/MCB 0 \(zu gleichen Teilen auf 30m · 45m · 1h · 4h\), RSI 100, Zone 0/)).toBeInTheDocument();
    // the override removed again → back to the check's points
    act(() => useJournal.setState({ settings: { ...SETTINGS, signals: {} } }));
    expect(Number(meter().getAttribute("aria-valuenow"))).toBe(before);
  });

  it("reduced motion: the needle sits at the value at once (no spring from the centre)", () => {
    fx.reduced = true;
    wrap(<BiasBar sig={snapshot(LONG)} cfg={CFG} />);
    const needle = screen.getByTestId("bias-needle");
    const score = Number(screen.getByTestId("signal-bias").getAttribute("data-score"));
    const m = /translateX\(([\d.]+)%\)/.exec(needle.style.transform);
    expect(m, needle.style.transform).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(biasX(score), 1);
  });
});

describe("compact line in the hero strip", () => {
  it("shows the lean visually and leaves the strip's accessible name unchanged", () => {
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    const line = within(strip).getByTestId("signal-strip-bias");
    expect(line).toHaveAttribute("aria-hidden", "true");
    expect(line).toHaveAttribute("data-level", "2");
    expect(line).toHaveTextContent(/Stark Long/);
    expect(strip).toHaveAccessibleName(/^Einstiegs-Check: .+, Score \d+ von 100\. Details ansehen$/);
    expect(within(strip).queryByRole("meter")).toBeNull();
    expect(within(strip).queryAllByRole("button")).toHaveLength(0); // no button nested in the strip button
  });
});

describe("view helpers", () => {
  it("needle spring: spring.smooth for a drift, a livelier (bouncier, shorter) spring for a swing", () => {
    expect(needleSpring(0.02)).toBe(spring.smooth);
    const fast = physicsOf(needleSpring(1.2))!;
    const base = physicsOf(spring.smooth)!;
    expect(dampingRatio(fast)).toBeLessThan(dampingRatio(base));
    expect(fast.stiffness).toBeGreaterThan(base.stiffness);
  });

  it("score → bar position and vote words", () => {
    // Long left, Short right
    expect(biasX(1)).toBe(0);
    expect(biasX(-1)).toBe(100);
    expect(biasX(0)).toBe(50);
    expect(biasX(0.5)).toBe(25);
    expect(biasX(3)).toBe(0);
    expect(biasX(-3)).toBe(100);
    expect(voteWord(null)).toBe("keine Daten");
    expect(voteWord(0.02)).toBe("neutral");
    expect(voteWord(0.4)).toBe("Long");
    expect(voteWord(-0.4)).toBe("Short");
  });
});
