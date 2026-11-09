/**
 * Lage panel (views/overview/LagePanel.tsx) on real BTCUSDT bars (tests/fixtures/lage): states, chips, signs, the
 * ladder split at the price, the feed line, the settings (Aus / nur Warnung), the Details morph, no render per tick;
 * plus the pure view helpers (lageView.ts).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import { installDomPolyfills, bootFixtureJournal } from "./views.overview.harness";
import type { LageFeedStatus, LageView } from "@/market";

const view = vi.hoisted(() => ({ current: null as LageView | null }));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  return { ...actual, useLage: () => view.current ?? { lage: null, status: { state: "idle", fetchedAt: null, closedAt: null, nextAt: null, source: null, detail: null } } };
});

import { computeLage, LAGE_METHOD, LAGE_NO_DATA, LAGE_OFF_TEXT, withLageSettings, type Lage } from "@/domain/lage";
import type { Bar } from "@/domain/signals";
import { priceMv } from "@/market";
import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { useJournal } from "@/store/journalStore";
import { LagePanel } from "@/views/overview/LagePanel";
import { alignPad, closeInText, emaColumn, feedText, keepTogether, levelColumn, meaningText } from "@/views/overview/lageView";

interface Series {
  sec: number;
  t0: number;
  h: number[];
  l: number[];
  c: number[];
}
const bars = (s: Series): Bar[] => s.c.map((c, i) => ({ t: s.t0 + i * s.sec, o: i ? s.c[i - 1]! : c, h: s.h[i]!, l: s.l[i]!, c }));
const F = fixture as unknown as Record<"1D" | "4h" | "1h_jun" | "1h_oct", Series>;
const D = bars(F["1D"]);
const H4 = bars(F["4h"]);
const NOW = Date.parse("2026-10-08T15:30:00Z");
const GREEN = computeLage(D, H4, 81_356.2, NOW, { h1: bars(F["1h_oct"]) });
const RED = computeLage(D, H4, 70_000, Date.parse("2026-06-01T12:00:00Z"), { h1: bars(F["1h_jun"]) });
const OK: LageFeedStatus = { state: "ok", fetchedAt: NOW, closedAt: Date.parse("2026-10-08T00:00:00Z"), nextAt: NOW + 3_600_000, source: "binance", detail: null };

function wrap(node: React.ReactNode) {
  return render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
}
const setLageSettings = (patch: { on?: boolean; mode?: "block" | "warn" }) =>
  act(() => {
    useJournal.setState((s) => ({ settings: { ...s.settings, signals: withLageSettings(s.settings.signals, patch) } }));
  });

describe("LagePanel", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    view.current = { lage: GREEN, status: OK };
    priceMv.jump(81_356.2);
  });

  it("green with the wobble chip, reasons, the ladder split at the price and the feed line", () => {
    wrap(<LagePanel />);
    const p = screen.getByTestId("lage-panel");
    expect(p).toHaveAttribute("data-state", "green");
    expect(p).toHaveAttribute("data-gate", "on");
    expect(within(p).getByTestId("lage-word")).toHaveTextContent("Grün");
    expect(within(p).getByTestId("lage-title")).toHaveTextContent("Aufwärtstrend intakt");
    expect(within(p).getByTestId("lage-meaning")).toHaveTextContent(/^Tagestrend intakt – Kaufsignale zählen\. Grün seit 19\.09\.$/);
    const chips = within(p).getByTestId("lage-chips");
    expect(chips.querySelector('[data-chip="wobble"]')).toHaveTextContent(/^Trend wackelt: 1\. Tagesschluss unter EMA 21 · rot, wenn der nächste auch darunter schließt/);
    expect([...chips.querySelectorAll("[data-chip]")].map((c) => c.getAttribute("data-chip"))).toEqual(["wobble", "h4-below", "h4-cross", "h4-trend", "h1-low", "ema200"]);
    // no reversal signs in a green phase
    expect(within(p).queryByTestId("lage-signs")).toBeNull();
    // EMA ladder: four above the price (4H-EMA 200 81.663 too), the price row, two below
    const ladder = within(p).getByTestId("lage-ladder");
    const rows = [...ladder.querySelectorAll("ul")[0]!.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row"));
    expect(rows).toEqual(["4H-50", "4H-21", "1D-21", "4H-200", "price", "1D-50", "1D-200"]);
    expect(ladder.querySelector('[data-row="1D-21"]')).toHaveTextContent(/1D-EMA 2183\.381−2,4 %/);
    expect(ladder.querySelector('[data-row="price"]')).toHaveTextContent("81.356");
    // levels: as many as the EMA column has rows per side (4 above, 2 below)
    const lv = [...ladder.querySelectorAll("ul")[1]!.querySelectorAll("[data-side]")].map((r) => `${r.getAttribute("data-side")}:${r.textContent}`);
    expect(lv).toEqual([
      "resistance:1D Internes Hoch87.220+7,2 %",
      "resistance:4H Supply-OB86.000+5,7 %",
      "resistance:4H Supply-OB85.721+5,4 %",
      "resistance:1D Internes Tief82.563+1,5 %",
      "support:4H Demand-OB81.330−0,0 %",
      "support:4H Internes Tief80.126−1,5 %",
    ]);
    // a fresh feed: `Stand hh:mm` under the countdown, no extra feed line
    expect(within(p).queryByTestId("lage-feed")).toBeNull();
    expect(within(p).getByTestId("lage-close")).toHaveTextContent(/^Tagesschluss \d\d:\d\din (\d+:\d\d h|\d+ min|< 1 min)Stand \d\d:\d\d$/);
  });

  it("red names the reasons and shows the 4 reversal signs (0/4)", () => {
    view.current = { lage: RED, status: OK };
    wrap(<LagePanel />);
    const p = screen.getByTestId("lage-panel");
    expect(p).toHaveAttribute("data-state", "red");
    expect(within(p).getByTestId("lage-title")).toHaveTextContent("Fällt noch · abwarten");
    expect(within(p).getByTestId("lage-meaning")).toHaveTextContent("Tagestrend abwärts – Kaufsignale zählen nicht. Abwärtstrend seit 17.05.");
    // (jest-dom folds the no-break spaces that keep the values together)
    expect(within(p).getByTestId("lage-chips")).toHaveTextContent("17 Tagesschlüsse unter 1D-EMA 21 (76.213, −8,2 %)");
    expect(within(p).getByTestId("lage-chips").querySelector('[data-chip="daily"]')?.textContent).toContain("(76.213,\u00a0−8,2\u00a0%)");
    const signs = within(p).getByTestId("lage-signs");
    expect(signs).toHaveAttribute("data-met", "0");
    expect([...signs.querySelectorAll("[data-sign]")].map((s) => `${s.getAttribute("data-sign")}:${s.getAttribute("data-met")}`)).toEqual(["U1:false", "U2:false", "U3:false", "U4:false"]);
  });

  it("follows the settings: Aus keeps the information without a light, nur Warnung says the signals count", () => {
    setLageSettings({ on: false });
    const { unmount } = wrap(<LagePanel />);
    let p = screen.getByTestId("lage-panel");
    expect(p).toHaveAttribute("data-gate", "off");
    expect(within(p).getByTestId("lage-word")).toHaveTextContent("Aus");
    expect(within(p).getByTestId("lage-meaning")).toHaveTextContent(LAGE_OFF_TEXT);
    expect(within(p).getByTestId("lage-ladder")).toBeInTheDocument();
    unmount();
    setLageSettings({ on: true, mode: "warn" });
    view.current = { lage: RED, status: OK };
    wrap(<LagePanel />);
    p = screen.getByTestId("lage-panel");
    expect(p).toHaveAttribute("data-mode", "warn");
    expect(within(p).getByTestId("lage-meaning")).toHaveTextContent(/^Tagestrend abwärts – Kaufsignale zählen trotzdem \(nur Warnung\)\./);
  });

  it("loading keeps the geometry with placeholders; no data says it blocks nothing, with the failure", () => {
    view.current = { lage: null, status: { ...OK, state: "loading", fetchedAt: null } };
    const { unmount } = wrap(<LagePanel />);
    expect(screen.getByTestId("lage-title")).toHaveTextContent("Wird ermittelt …");
    expect(screen.getByText("Tageskerzen werden geladen …")).toBeInTheDocument();
    expect(screen.queryByTestId("lage-feed")).toBeNull();
    unmount();
    view.current = { lage: null, status: { ...OK, state: "error", fetchedAt: null, detail: "Netzwerk/CORS-Fehler · 2× in Folge" } };
    wrap(<LagePanel />);
    expect(screen.getByTestId("lage-panel")).toHaveAttribute("data-state", "none");
    expect(screen.getByText(LAGE_NO_DATA)).toBeInTheDocument();
    expect(screen.getByTestId("lage-feed")).toHaveTextContent(/^Netzwerk\/CORS-Fehler · 2× in Folge · nächster Versuch \d\d:\d\d$/);
  });

  it("hero band, falling market: the reversal signs sit under the ladder (not beside the chips); the price leaf is its own contained layer", () => {
    view.current = { lage: RED, status: OK };
    wrap(<LagePanel band />);
    const p = screen.getByTestId("lage-panel");
    const ladder = within(p).getByTestId("lage-ladder");
    expect(within(ladder).getByTestId("lage-signs")).toHaveAttribute("data-met", "0");
    expect(within(p).getAllByTestId("lage-signs")).toHaveLength(1);
    const price = ladder.querySelector('[data-row="price"] .num')!;
    expect(price.className).toContain("[contain:layout_paint]");
    expect(price.className).toContain("will-change-transform");
    // the countdown's narrow / wide variants follow the state column, not the whole band
    expect(within(p).getByTestId("lage-close").className).toContain("@min-[400px]/lagehead:grid");
    expect(within(p).getByTestId("lage-close-narrow").textContent).not.toMatch(/·/);
  });

  it("price ticks never re-render the panel (the price row is a MotionValue leaf)", async () => {
    let commits = 0;
    wrap(
      <Profiler id="lage" onRender={() => commits++}>
        <LagePanel />
      </Profiler>,
    );
    const mounted = commits;
    await act(async () => {
      for (let i = 0; i < 20; i++) priceMv.set(81_356 + i * 3);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(commits).toBe(mounted);
    expect(screen.getByTestId("lage-ladder").querySelector('[data-row="price"]')).toHaveTextContent("81.413");
  });

  it("Details opens the method with the backtest and its limits", () => {
    wrap(<LagePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Lage-Ampel: Details" }));
    const dialog = screen.getByRole("dialog");
    const d = within(dialog).getByTestId("lage-details");
    expect(d).toHaveTextContent("Aufwärtstrend intakt");
    expect(d).toHaveTextContent("Wirkung: Sperre (Signale zählen nur bei Grün)");
    expect(d).toHaveTextContent(LAGE_METHOD.fixed);
    expect(d).toHaveTextContent("Grün: 109 Einstiege · 17 % Messer");
    expect(within(d).getAllByText(/^U[1-4] · /)).toHaveLength(4);
  });
});

describe("lageView helpers", () => {
  it("countdown reads as a duration", () => {
    expect(closeInText(8 * 3_600_000 + 29 * 60_000 + 5_000)).toBe("8:29 h");
    expect(closeInText(12 * 60_000 + 59_000)).toBe("12 min");
    expect(closeInText(30_000)).toBe("< 1 min");
    expect(closeInText(-5)).toBe("< 1 min");
  });
  it("columns split at the price and their price rows line up", () => {
    const e = emaColumn(GREEN as Lage);
    expect([e.above.length, e.below.length]).toEqual([4, 2]);
    expect(levelColumn(GREEN as Lage).above.map((x) => Math.round(x.price))).toEqual([85_721, 82_563]);
    const l = levelColumn(GREEN as Lage, e);
    expect(l.above.map((x) => Math.round(x.price))).toEqual([87_220, 86_000, 85_721, 82_563]);
    expect(l.below.map((x) => Math.round(x.price))).toEqual([81_330, 80_126]);
    expect(alignPad(e, l)).toEqual({ aTop: 0, bTop: 0, aBottom: 0, bBottom: 0 });
    // price above every EMA: one resistance anyway, the EMA column gets one spacer
    const top = { above: [], below: e.below.concat(e.above) };
    const lt = levelColumn(GREEN as Lage, top);
    expect([lt.above.length, lt.below.length]).toEqual([1, 3]);
    expect(alignPad(top, lt)).toEqual({ aTop: 1, bTop: 0, aBottom: 0, bBottom: 3 });
    expect(emaColumn({ emaLadder: GREEN.emaLadder, price: null }).below).toEqual([]);
  });
  it("texts: values stay together, meaning per setting, feed states", () => {
    expect(keepTogether("2 Tagesschlüsse unter 1D-EMA 21 (83.381, −2,4 %)")).toBe("2 Tagesschlüsse unter 1D-EMA 21 (83.381,\u00a0−2,4\u00a0%)");
    expect(meaningText(GREEN, { on: true, mode: "block" }, "UTC")).toBe("Tagestrend intakt – Kaufsignale zählen. Grün seit 19.09.");
    expect(meaningText(GREEN, { on: false, mode: "block" })).toBe(LAGE_OFF_TEXT);
    expect(feedText({ ...OK, source: "proxy" }, "UTC")).toEqual({ text: "Tageskerzen Binance (EU-Proxy) · Stand 15:30", tone: "mute" });
    expect(feedText({ ...OK, state: "stale", detail: "Tagesschluss noch nicht geladen" }, "UTC")).toEqual({ text: "Tagesschluss noch nicht geladen · Stand 15:30", tone: "warn" });
    expect(feedText({ ...OK, state: "offline" }, "UTC").text).toBe("Offline · Stand 15:30");
    expect(feedText({ ...OK, state: "idle" }).text).toBe("Marktdaten aus");
  });
});
