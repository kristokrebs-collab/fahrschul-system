/**
 * Lage-Ampel in the Einstiegs-Check UI (decision 23): a long entry held back by a red / amber Lage is shown faded
 * (desaturated ring + label, outlined dots with the would-be strength, `zählt nicht (Lage rot)`), the label says
 * `Kaufsignal · Lage rot – zählt nicht (fällt noch)`; `nur Warnung` keeps the entry and adds the warning line; a long
 * without an entry names the Lage; green / off show nothing extra. Real BTC Lage of the lab's examples.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import { computeLage, type Lage, type LageSettings } from "@/domain/lage";
import { bestVerdict, gradeSignals, type Bar, type TfCheck } from "@/domain/signals";
import type { LiveSignals, SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";
import { UI_CFG, v2check } from "./views.overview.signalFixtures";

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
import { lageBlocked, lageLine, PROV_COLOR, PROV_TEXT, SIDE_COLOR, strengthView, verdictColor, verdictText } from "@/views/overview/signalView";

interface Series {
  sec: number;
  t0: number;
  h: number[];
  l: number[];
  c: number[];
}
const bars = (s: Series): Bar[] => s.c.map((c, i) => ({ t: s.t0 + i * s.sec, o: i ? s.c[i - 1]! : c, h: s.h[i]!, l: s.l[i]!, c }));
const FX = fixture as unknown as Record<"1D" | "4h", Series>;
const D = bars(FX["1D"]);
const H4 = bars(FX["4h"]);
const RED: Lage = computeLage(D, H4, 70_000, Date.parse("2026-06-01T12:00:00Z"));
const AMBER: Lage = computeLage(D, H4, RED.ema21_1d! + 100, Date.parse("2026-06-01T12:00:00Z"));
const BLOCK: LageSettings = { on: true, mode: "block" };
const WARN: LageSettings = { on: true, mode: "warn" };

const bottom = (barsAgo = 0) => ({ kind: "bottom" as const, barsAgo });
const ENTRY: TfCheck[] = [v2check("30m", { long: bottom(1), rsi: 28 }), v2check("45m", { long: bottom(1), rsi: 33 }), v2check("1h", { long: bottom(1), rsi: 36 }), v2check("4h", { rsi: 44 })];
const NONE: TfCheck[] = [v2check("30m", { rsi: 50 }), v2check("45m", { rsi: 50 }), v2check("1h", { rsi: 50 }), v2check("4h", { rsi: 50 })];

function snapshot(checks: TfCheck[], lage?: { lage: Lage | null; cfg: LageSettings }): LiveSignals {
  const zone = checks.find((c) => c.tf === UI_CFG.zoneTf) ?? null;
  const base = { checks, zone, at: 1_760_000_000_000, ...bestVerdict(checks, UI_CFG, zone), symbol: "BTCUSDT", source: "binance" as const, cfg: UI_CFG, price: 81_200 };
  return gradeSignals(base, UI_CFG, null, lage);
}
const wrap = (node: React.ReactNode) =>
  render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
const show = (snap: LiveSignals) => (live.state = { state: "ok", snapshot: snap, updatedAt: 1, message: null });

beforeAll(() => installDomPolyfills());
beforeEach(() => live.listeners.clear());

describe("view model", () => {
  it("a held-back long: faded colour, the would-be strength outlined, `zählt nicht (Lage rot)`; no extra line", () => {
    const plain = snapshot(ENTRY).long;
    expect(plain.valid).toBe(true);
    const v = snapshot(ENTRY, { lage: RED, cfg: BLOCK }).long;
    expect(v).toMatchObject({ valid: false, strength: 0, label: "Kaufsignal · Lage rot – zählt nicht (fällt noch)" });
    expect(lageBlocked(v)).toBe(true);
    expect(verdictColor(v)).toBe(PROV_COLOR.long);
    expect(verdictText(v)).toBe(PROV_TEXT.long);
    const st = strengthView(v, 4);
    expect(st).toMatchObject({ dots: plain.strength, outlined: true, aria: `Stärke 0 von 4, gesperrt (sonst ${plain.strength})` });
    expect(st.line).toMatch(/ · zählt nicht \(Lage rot\) · 3 von 4 Timeframes$/);
    expect(lageLine(v)).toBeNull();
    const a = snapshot(ENTRY, { lage: AMBER, cfg: BLOCK }).long;
    expect(a.label).toBe(`Kaufsignal · Lage gelb – Umkehr bildet sich (${AMBER.signsMet}/4)`);
    expect(strengthView(a, 4).line).toContain("zählt nicht (Lage gelb)");
  });

  it("nur Warnung counts with the warning line; no entry names the Lage; shorts / green untouched", () => {
    const w = snapshot(ENTRY, { lage: RED, cfg: WARN }).long;
    expect(w.valid).toBe(true);
    expect(lageBlocked(w)).toBe(false);
    expect(verdictColor(w)).toBe(SIDE_COLOR.long);
    expect(lageLine(w)).toEqual({ text: "Lage rot – nur Warnung (fällt noch)", tone: "loss", blocked: false });
    const n = snapshot(NONE, { lage: RED, cfg: BLOCK });
    expect(lageBlocked(n.long)).toBe(false);
    expect(lageLine(n.long)).toEqual({ text: "Lage rot – Kaufsignale zählen nicht (fällt noch)", tone: "loss", blocked: true });
    expect(lageLine(snapshot(NONE, { lage: AMBER, cfg: BLOCK }).long)).toMatchObject({ text: `Lage gelb – Umkehr bildet sich (${AMBER.signsMet}/4) · Kaufsignale zählen erst bei Grün`, tone: "warn" });
    expect(lageLine(n.short)).toBeNull();
    expect(lageLine(snapshot(ENTRY, { lage: RED, cfg: { on: false, mode: "block" } }).long)).toBeNull();
  });
});

describe("SignalCard / SignalStrip", () => {
  it("the card shows the held-back long faded with its label and the outlined dots, marked on the row", () => {
    show(snapshot(ENTRY, { lage: RED, cfg: BLOCK }));
    wrap(<SignalCard />);
    const row = screen.getAllByTestId("signal-verdict").find((r) => r.textContent?.includes("Kaufsignal"))!;
    expect(row).toHaveAttribute("data-lage", "red");
    expect(row).toHaveAttribute("data-blocked");
    expect(within(row).getByTestId("signal-label")).toHaveTextContent("Kaufsignal · Lage rot – zählt nicht (fällt noch)");
    expect(within(row).getByTestId("signal-label").className).toContain(PROV_TEXT.long);
    expect(within(row).getByRole("img", { name: /^Stärke 0 von 4, gesperrt \(sonst \d\)$/ })).toBeInTheDocument();
    expect(within(row).queryByTestId("signal-lage")).toBeNull();
  });

  it("nur Warnung: the entry counts, the warning line sits under it", () => {
    show(snapshot(ENTRY, { lage: AMBER, cfg: WARN }));
    wrap(<SignalCard />);
    const row = screen.getAllByTestId("signal-verdict").find((r) => r.hasAttribute("data-lage"))!;
    expect(row).not.toHaveAttribute("data-blocked");
    expect(within(row).getByTestId("signal-lage")).toHaveTextContent(`Lage gelb – nur Warnung (${AMBER.signsMet}/4)`);
    expect(within(row).getByTestId("signal-lage").className).toContain("text-warn");
  });

  it("the hero strip shows the faded label (the accessible name says it does not count)", () => {
    show(snapshot(ENTRY, { lage: RED, cfg: BLOCK }));
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    expect(strip).toHaveAccessibleName(/^Einstiegs-Check: Kaufsignal · Lage rot – zählt nicht \(fällt noch\), Score \d+ von 100\. Details ansehen$/);
    expect(within(strip).getByText("Kaufsignal · Lage rot – zählt nicht (fällt noch)").className).toContain(PROV_TEXT.long);
  });
});
