/**
 * Trade editor / detail summary of a stored check under the Lage-Ampel (decision 23): the held-back label, the
 * falling-knife filter in its Lage layout (Tagestrend + 4H-Umkehrzeichen of 2, the Top-Trader delta as info) — and an
 * older snapshot keeps the former three points.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import { ladderBars, synthBars } from "./signals.fixtures";
import { computeLage } from "@/domain/lage";
import { computeSignals, parseSignalSnapshot, sanitizeSignalCfg, toSignalSnapshot, type Bar, type SignalSnapshot } from "@/domain/signals";
import { knifeRows, SignalSummary } from "@/overlays/SignalSummary";

interface Series {
  sec: number;
  t0: number;
  h: number[];
  l: number[];
  c: number[];
}
const bars = (s: Series): Bar[] => s.c.map((c, i) => ({ t: s.t0 + i * s.sec, o: i ? s.c[i - 1]! : c, h: s.h[i]!, l: s.l[i]!, c }));
const FX = fixture as unknown as Record<"1D" | "4h", Series>;
const RED = computeLage(bars(FX["1D"]), bars(FX["4h"]), 70_000, Date.parse("2026-06-01T12:00:00Z"));
const cfg = sanitizeSignalCfg({ whale: { on: false } });
const MARKET = ladderBars(synthBars(3200, 2).slice(0, 2950));
const stored = (s: ReturnType<typeof computeSignals>): SignalSnapshot => parseSignalSnapshot(JSON.parse(JSON.stringify(toSignalSnapshot(s!, "long", cfg))))!;

describe("SignalSummary – Lage layout", () => {
  it("a held-back long: its label, the knife filter 0 von 2 with Tagestrend, 4H-Umkehrzeichen 0/4 and the delta as info", () => {
    const snap = stored(computeSignals(MARKET, cfg, Date.now(), { lage: { lage: RED, cfg: { on: true, mode: "block" } } }));
    expect(knifeRows(snap).map((r) => [r.label, r.value])).toEqual([
      ["Tagestrend (1D-EMA 21)", "offen"],
      ["4H-Umkehrzeichen 0/4", "offen"],
      ["Top-Trader-Delta (Info)", "keine Daten"],
    ]);
    render(<SignalSummary snap={snap} side="long" />);
    expect(screen.getByText("Kaufsignal · Lage rot – zählt nicht (fällt noch)")).toBeInTheDocument();
    const knife = screen.getByTestId("signal-summary-part-knife");
    expect(knife).toHaveTextContent("0 von 2");
    expect(knife).not.toHaveTextContent(/\blage\b|\bsigns\b/);
  });

  it("an older snapshot (no Lage) keeps the three points", () => {
    const snap = stored(computeSignals(MARKET, cfg));
    expect(knifeRows(snap).map((r) => r.label)).toEqual(["Higher Low / BOS 1H·4H", "RSI bullische Divergenz", "Whale vs. Retail"]);
    render(<SignalSummary snap={snap} side="long" />);
    expect(screen.getByTestId("signal-summary-part-knife")).toHaveTextContent(/\d von 3/);
  });
});
