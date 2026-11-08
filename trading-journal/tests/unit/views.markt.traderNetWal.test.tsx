/**
 * "Top-Trader: Netto Long/Short" (C3, the complete Wal-Karte): the model that puts the live series, the stored history and the
 * alert rule together (`buildWal`: states, gaps, the view of the newest gap-free run, marks, provenance, the archive line) and the
 * card on top of it – the series switch (Positionen / Konten), the range switch with disabled ranges, the three provenance lines, the
 * stored history in front of the live series, the stored-only state (Binance gives nothing), gaps and marks in the plot (painter,
 * crosshair and arrow keys stop at a gap), the archive row (switch, CSV, two-step delete). jsdom, no network (fapi answers 451 from
 * the sandbox); IndexedDB is replaced by a plain object.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTraderNet, type NetPriceBar, type NetRatioPoint } from "@/domain/signals";
import { findNetGaps, type ArchivedNetPoint } from "@/domain/signals/netSeries";
import type { LiveTraderNet } from "@/market";
import type { NetArchiveState } from "@/market/netArchive";
import { installDomPolyfills } from "./views.overview.harness";

const live = vi.hoisted(() => ({ net: null as unknown as LiveTraderNet, series: [] as string[] }));
const arch = vi.hoisted(() => ({
  state: { status: "ready", recording: true, rows: [], clear: async () => undefined } as unknown as NetArchiveState,
  setOn: vi.fn(),
  save: vi.fn(async () => true),
}));
vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  return {
    ...actual,
    useTraderNet: (series?: string) => {
      live.series.push(series ?? "position");
      return live.net;
    },
    useProvider: () => ({ symbolInfo: { base: "BTC", binance: "BTCUSDT" } }),
  };
});
vi.mock("@/market/netArchive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/netArchive")>();
  return { ...actual, useNetArchive: () => arch.state, setNetArchiveOn: arch.setOn };
});
vi.mock("@/store/download", () => ({ download: arch.save }));

import { MotionRoot } from "@/motion/MotionRoot";
import { netGeometry } from "@/views/overview/traderNetChart";
import TraderNetCard from "@/views/markt/TraderNetCard";
import { paintPlot } from "@/views/markt/TraderNetPlot";
import { gapAt, gapReadout, gapsInWindow, plotPad, plotStops, rangeChoices, splitRuns } from "@/views/markt/traderNetCardModel";
import { agoText, archiveLine, buildWal, marksByTime, marksRuleText, marksSummary, markText, provenanceOf, walLine } from "@/views/markt/traderNetWal";

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 1);
const pts = (longs: number[], t0 = T0): NetRatioPoint[] => longs.map((l, i) => ({ time: t0 + i * H, longPct: l, shortPct: 100 - l }));
const bars = (n: number, t0 = T0): NetPriceBar[] => Array.from({ length: n }, (_, i) => ({ time: t0 + i * H, open: 70_000 + i * 20, close: 70_010 + i * 20 }));
/** 20 points green (55 %), a slide down to 44 % in 11 steps, then 20 points red: a Vorwarnung and a Bestätigung on the way */
const SLIDE = [...Array.from({ length: 20 }, () => 55), 54, 53, 52, 51, 50, 49, 48, 47, 46, 45, 44, ...Array.from({ length: 20 }, () => 44)];
const liveNet = (longs: number[], t0 = T0, extra: Partial<LiveTraderNet> = {}): LiveTraderNet => {
  const last = t0 + (longs.length - 1) * H;
  return { view: buildTraderNet(pts(longs, t0), bars(longs.length, t0), last + 5 * 60_000, H), status: "live", stepMs: H, source: "binance", ...extra };
};
const none = (detail: string, status: LiveTraderNet["status"] = "none"): LiveTraderNet => ({ view: null, status, detail, stepMs: null, source: null });
const stored = (from: number, n: number, long = 56): ArchivedNetPoint[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * H, long, price: 69_000 + i, s: H }));
const NOW = T0 + SLIDE.length * H + 10 * 60_000;

describe("buildWal: live series + stored history + rule", () => {
  it("only the live series: the live view itself, no gap, marks from the rule", () => {
    const ln = liveNet(SLIDE);
    const w = buildWal({ live: ln, archive: [], symbol: "BTCUSDT", now: NOW });
    expect(w.state).toBe("ok");
    expect(w.view).toBe(ln.view);
    expect(w.points).toHaveLength(SLIDE.length);
    expect(w.gaps).toEqual([]);
    expect(w.storedCount).toBe(0);
    expect(w.marks.map((m) => m.event)).toEqual(["red_warn", "red_confirm"]);
    expect(w.liveFrom).toBe(T0);
    expect(w.measuredAt).toBe(T0 + (SLIDE.length - 1) * H);
  });

  it("stored history in front of the live series (no gap): one run, the headline sees the longer history", () => {
    const liveFrom = T0 + 40 * H;
    const w = buildWal({ live: liveNet(SLIDE, liveFrom), archive: stored(0, 40), symbol: "BTCUSDT", now: liveFrom + SLIDE.length * H });
    expect(w.state).toBe("ok");
    expect(w.storedCount).toBe(40);
    expect(w.gaps).toEqual([]);
    expect(w.points).toHaveLength(40 + SLIDE.length);
    expect(w.view!.count).toBe(40 + SLIDE.length);
    expect(w.view!.flip).toMatchObject({ from: "long", to: "short" });
    expect(w.view!.previousFlip).toBeNull();
  });

  it("a gap between the stored history and the live series: the headline sees only the newest run; the marks start again after it", () => {
    const liveFrom = T0 + 100 * H;
    const w = buildWal({ live: liveNet(SLIDE, liveFrom), archive: stored(0, 40, 44), symbol: "BTCUSDT", now: liveFrom + SLIDE.length * H });
    expect(w.state).toBe("ok");
    expect(w.gaps).toHaveLength(1);
    expect(w.gaps[0]).toMatchObject({ from: T0 + 39 * H, to: liveFrom });
    // 40 red stored points, a gap, then green → red: the flip of the headline is the one INSIDE the live run – the change over the gap was never seen
    expect(w.view!.count).toBe(SLIDE.length);
    expect(w.view!.points[0]!.t).toBe(liveFrom);
    expect(w.view!.flip!.at).toBeGreaterThan(liveFrom);
    // the points of the plot are all of them
    expect(w.points).toHaveLength(40 + SLIDE.length);
    expect(w.marks.every((m) => m.t >= liveFrom)).toBe(true);
    expect(w.marks.map((m) => m.event)).toEqual(["red_warn", "red_confirm"]);
  });

  it("a flip across a gap is not dated: a green stored run and a red live run give no flip at all", () => {
    const liveFrom = T0 + 100 * H;
    const w = buildWal({ live: liveNet(Array.from({ length: 30 }, () => 44), liveFrom), archive: stored(0, 40, 56), symbol: "BTCUSDT", now: liveFrom + 30 * H });
    expect(w.gaps).toHaveLength(1);
    expect(w.view!.flip).toBeNull();
    expect(w.view!.side).toBe("short");
    expect(w.marks).toEqual([]);
  });

  it("Binance gives nothing but history is stored: the stored-only state (marked, with its own newest time)", () => {
    const w = buildWal({ live: none("Binance blockiert (Region)"), archive: stored(0, 50), symbol: "BTCUSDT", now: T0 + 60 * H });
    expect(w.state).toBe("archive");
    expect(w.points).toHaveLength(50);
    expect(w.liveFrom).toBeNull();
    expect(w.view!.status).toBe("ok");
    expect(w.measuredAt).toBe(T0 + 49 * H);
    // the price of the stored points is what the card showed then
    expect(w.view!.priceNow).toBe(69_049);
  });

  it("loading wins over the stored history (the card waits for the live answer), too little history is 'short', nothing is 'none'", () => {
    expect(buildWal({ live: none("lädt", "loading"), archive: stored(0, 50), symbol: "BTCUSDT", now: NOW }).state).toBe("loading");
    expect(buildWal({ live: none("kein Binance"), archive: stored(0, 5), symbol: "BTCUSDT", now: NOW }).state).toBe("short");
    expect(buildWal({ live: none("kein Binance"), archive: [], symbol: "BTCUSDT", now: NOW }).state).toBe("none");
    const short = buildWal({ live: { ...none("x"), view: buildTraderNet(pts([55, 55, 55]), [], NOW, H) }, archive: [], symbol: "BTCUSDT", now: NOW });
    expect(short.state).toBe("short");
    expect(short.points).toEqual([]);
    expect(short.marks).toEqual([]);
  });

  it("a stale live series is stale (the stored history does not hide it)", () => {
    const w = buildWal({ live: liveNet(SLIDE, T0, { status: "stale", detail: "Top-Trader-Daten veraltet" }), archive: [], symbol: "BTCUSDT", now: NOW });
    expect(w.state).toBe("stale");
  });
});

describe("texts: provenance, archive line, marks", () => {
  it("three lines in every state: Quelle · Kohorte · Messzeit, from the series table", () => {
    const at = T0 + 49 * H;
    const p = provenanceOf({ series: "position", state: "ok", source: "binance", measuredAt: at, now: at + 12 * 60_000, stepMs: H });
    expect(p.map((l) => l.id)).toEqual(["source", "cohort", "time"]);
    expect(p[0]!.value).toBe("Binance Futures, öffentliche Statistik (topLongShortPositionRatio), direkt");
    expect(p[1]!.value).toBe("Obere 20 % der Konten nach Einsatz · Long-Anteil der Positionsgrößen");
    expect(p[2]!.value).toBe("03.10. 01:00 UTC (vor 12 Min.) · neuer Wert alle 1 Std.");
    const acc = provenanceOf({ series: "account", state: "stale", source: "proxy", measuredAt: at, now: at + 3 * H, stepMs: H });
    expect(acc[0]!.value).toContain("topLongShortAccountRatio");
    expect(acc[0]!.value).toContain("über den EU-Proxy der App");
    expect(acc[1]!.value).toBe("Obere 20 % der Konten nach Einsatz · Anteil der Konten mit Long-Position");
    expect(acc[2]!.value).toContain("vor 3 Std.");
    const arc = provenanceOf({ series: "position", state: "archive", source: null, measuredAt: at, now: at + 2 * DAY, stepMs: null });
    expect(arc[0]!.value).toBe("Gespeicherter Verlauf auf diesem Gerät – Binance liefert gerade nichts");
    expect(arc[2]!.value).toBe("03.10. 01:00 UTC (vor 2 Tagen)");
    const empty = provenanceOf({ series: "position", state: "none", source: null, measuredAt: null, now: at, stepMs: null });
    expect(empty).toHaveLength(3);
    expect(empty[0]!.value).toBe("–");
    expect(empty[2]!.value).toBe("–");
    expect(empty[1]!.value).toContain("Obere 20 %");
    expect(JSON.stringify([p, acc, arc, empty])).not.toMatch(/Wal(e|s)\b|Glassnode/);
  });

  it("ages in plain words, rounded down", () => {
    expect(agoText(2 * 60_000)).toBe("gerade eben");
    expect(agoText(12 * 60_000)).toBe("vor 12 Min.");
    expect(agoText(5 * H)).toBe("vor 5 Std.");
    expect(agoText(3 * DAY)).toBe("vor 3 Tagen");
    expect(agoText(-5)).toBe("gerade eben");
  });

  it("the archive line says how much, how many gaps, and whether it grows – or why it cannot", () => {
    const base = { status: "ready" as const, recording: true, storedCount: 480, firstT: T0, lastT: T0 + 20 * DAY, gaps: 0 };
    expect(archiveLine(base)).toBe("Gespeichert auf diesem Gerät: 20 Tage (480 Punkte), keine Lücke · wächst mit jedem Besuch.");
    expect(archiveLine({ ...base, gaps: 1 })).toContain("1 Lücke ·");
    expect(archiveLine({ ...base, gaps: 3, recording: false })).toBe("Gespeichert auf diesem Gerät: 20 Tage (480 Punkte), 3 Lücken · Speichern ist aus.");
    expect(archiveLine({ ...base, storedCount: 0, firstT: null, lastT: null })).toBe("Gespeichert: noch nichts – der Verlauf wächst mit jedem Besuch.");
    expect(archiveLine({ ...base, storedCount: 0, firstT: null, lastT: null, recording: false })).toBe("Speichern ist aus – nichts gespeichert.");
    expect(archiveLine({ ...base, status: "unavailable" })).toContain("geht in diesem Browser nicht");
    expect(archiveLine({ ...base, status: "error" })).toContain("ließ sich nicht lesen");
    expect(archiveLine({ ...base, status: "loading" })).toContain("wird gelesen");
  });

  it("the history line counts the stored points and the gaps", () => {
    const w = buildWal({ live: liveNet(SLIDE, T0 + 100 * H), archive: stored(0, 40), symbol: "BTCUSDT", now: NOW });
    expect(walLine(w, H)).toBe(`Verlauf: ${Math.floor((100 + SLIDE.length - 1) / 24)} Tage (${40 + SLIDE.length} Punkte, davon 40 aus dem Speicher), 1 Lücke · neue Werte im Abstand 1 Std. · Zeiten in UTC`);
    const noGap = buildWal({ live: liveNet(SLIDE, T0 + 40 * H), archive: stored(0, 40), symbol: "BTCUSDT", now: NOW });
    expect(walLine(noGap, H)).toContain("ohne Lücke");
  });

  it("marks: label with time, the rule in words from the engine's defaults, a short summary", () => {
    const w = buildWal({ live: liveNet(SLIDE), archive: [], symbol: "BTCUSDT", now: NOW });
    expect(markText(w.marks[0]!)).toMatch(/^Rot-Vorwarnung \d\d\.\d\d\. \d\d:\d\d$/);
    expect(marksSummary(w.marks)).toMatch(/^2 Marken \(Rot-Vorwarnung \d\d\.\d\d\., Rot-Bestätigung \d\d\.\d\d\.\)$/);
    expect(marksSummary([])).toBe("keine Marken");
    expect(marksRuleText()).toBe("Vorwarnung: der Long-Anteil läuft auf die Linie 50 % ± 2 Punkte zu und ist höchstens 3 Punkte davon entfernt. Bestätigung: er liegt mindestens 2 Punkte jenseits der 50 %-Linie.");
    expect(marksByTime(w.marks).size).toBe(2);
    expect(markText({ ...w.marks[0]!, suppressed: true })).toContain("(Wiederholungssperre)");
  });
});

describe("plot helpers: gaps in a window, runs, stops, the readout of a gap", () => {
  const liveFrom = T0 + 100 * H;
  const w = buildWal({ live: liveNet(SLIDE, liveFrom), archive: stored(0, 40), symbol: "BTCUSDT", now: NOW });

  it("only the gaps with both ends inside the shown points count", () => {
    expect(gapsInWindow(w.gaps, w.points)).toHaveLength(1);
    expect(gapsInWindow(w.gaps, w.points.slice(45))).toEqual([]);
    expect(gapsInWindow(w.gaps, w.points.slice(0, 20))).toEqual([]);
    expect(gapsInWindow(w.gaps, w.points.slice(0, 1))).toEqual([]);
  });

  it("runs split at the gap, stops include the gap between two points, a time inside the gap finds it", () => {
    const runs = splitRuns(w.points, w.gaps);
    expect(runs.map((r) => r.length)).toEqual([40, SLIDE.length]);
    const stops = plotStops(w.points, w.gaps);
    expect(stops).toHaveLength(w.points.length + 1);
    expect(stops[40]).toEqual({ kind: "gap", gap: w.gaps[0] });
    expect(stops[39]).toEqual({ kind: "point", i: 39 });
    expect(gapAt(w.gaps, T0 + 70 * H)).toBe(w.gaps[0]);
    expect(gapAt(w.gaps, T0 + 39 * H)).toBeNull();
    expect(gapAt(w.gaps, liveFrom)).toBeNull();
    expect(splitRuns(w.points, [])).toHaveLength(1);
  });

  it("the readout of a gap names both ends and invents nothing", () => {
    const r = gapReadout(w.gaps[0]!);
    expect(r.stamp).toBe("Lücke");
    expect(r.net).toMatch(/^\d\d\.\d\d\. \d\d:\d\d – \d\d\.\d\d\. \d\d:\d\d UTC · \d+ (Std\.|Tage) ohne Messwerte$/);
    expect(r.price).toBe("nichts ergänzt");
    expect(r.speak).toMatch(/^Lücke .* Nichts ergänzt\.$/);
  });

  it("rangeChoices: 7 / 30 / 90 only enabled when the whole history is clearly longer", () => {
    expect(rangeChoices(130 * DAY).filter((c) => c.disabled)).toEqual([]);
    expect(rangeChoices(20 * DAY).filter((c) => c.disabled).map((c) => c.id)).toEqual(["30", "90"]);
  });
});

describe("the painter draws gaps and marks", () => {
  const liveFrom = T0 + 100 * H;
  const w = buildWal({ live: liveNet(SLIDE, liveFrom), archive: stored(0, 40, 54), symbol: "BTCUSDT", now: NOW });
  const g = netGeometry(w.points, 340, 256, plotPad(340))!;

  function ctx2d() {
    const calls: Array<[string, unknown[]]> = [];
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
      get(t, k: string) {
        if (k in t) return t[k];
        if (k === "createLinearGradient") return () => ({ addColorStop: () => undefined });
        if (k === "measureText") return () => ({ width: 120 });
        return (...a: unknown[]) => void calls.push([k, a]);
      },
      set(t, k: string, v) {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it("the gap is a band with the words 'keine Daten'; the line is two runs, never one across the gap", () => {
    const p = ctx2d();
    paintPlot(p.ctx, g, w.points, w.view!.flip, 1, "BTC", { gaps: w.gaps, marks: w.marks });
    expect(p.calls.some((c) => c[0] === "fillRect"), "the band").toBe(true);
    expect(p.calls.filter((c) => c[0] === "fillText").map((c) => c[1][0])).toContain("keine Daten");
    // curve strokes: one per run and side (clip halves), none joins the runs: no lineTo jumps over the gap
    const xs = p.calls.filter((c) => c[0] === "lineTo" || c[0] === "moveTo").map((c) => c[1][0] as number);
    const gapFrom = g.x(w.gaps[0]!.from);
    const gapTo = g.x(w.gaps[0]!.to);
    let crossing = 0;
    let prev: [number, number] | null = null;
    for (const c of p.calls) {
      if (c[0] === "moveTo") prev = [c[1][0] as number, c[1][1] as number];
      else if (c[0] === "lineTo") {
        const cur: [number, number] = [c[1][0] as number, c[1][1] as number];
        // the grid and the zero line run level across the whole plot: only a sloped step of the curve or the price line counts
        if (prev !== null && prev[1] !== cur[1] && prev[0] <= gapFrom + 0.01 && cur[0] >= gapTo - 0.01 && gapTo - gapFrom > 3) crossing++;
        prev = cur;
      }
    }
    expect(crossing, "a path segment across the gap").toBe(0);
    expect(xs.length).toBeGreaterThan(100);
  });

  it("a Vorwarnung is a ring, a Bestätigung a diamond; a held-back mark is fainter", () => {
    const p = ctx2d();
    const marks = [
      { t: liveFrom + 25 * H, event: "red_warn", side: "red", level: "warn", value: 3, suppressed: false, label: "Rot-Vorwarnung" },
      { t: liveFrom + 29 * H, event: "red_confirm", side: "red", level: "confirm", value: 2, suppressed: true, label: "Rot-Bestätigung" },
    ] as const;
    paintPlot(p.ctx, g, w.points, null, 1, "BTC", { gaps: [], marks });
    const arcs = p.calls.filter((c) => c[0] === "arc" && c[1][2] === 5);
    expect(arcs.length, "the ring").toBe(1);
    // the diamond: a closed path of four points around the mark
    const closes = p.calls.filter((c) => c[0] === "closePath").length;
    expect(closes).toBeGreaterThan(2);
    expect(p.calls.some((c) => c[0] === "moveTo" && Math.abs((c[1][0] as number) - g.x(liveFrom + 29 * H)) < 0.01)).toBe(true);
  });
});

describe("TraderNetCard (C3)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    live.series = [];
    arch.state = { status: "ready", recording: true, rows: [], clear: vi.fn(async () => undefined) } as unknown as NetArchiveState;
    arch.setOn.mockClear();
    arch.save.mockClear();
    const ctx = new Proxy({}, { get: (_t, k: string) => (k === "createLinearGradient" ? () => ({ addColorStop: () => undefined }) : k === "measureText" ? () => ({ width: 120 }) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 340 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 256 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  const wrap = (n: LiveTraderNet, rows: ArchivedNetPoint[] = []) => {
    live.net = n;
    arch.state = { ...arch.state, rows } as NetArchiveState;
    return render(
      <MotionRoot>
        <TraderNetCard />
      </MotionRoot>,
    );
  };

  it("provenance: three lines under the key figures, in every state", () => {
    const { unmount } = wrap(liveNet(SLIDE));
    const prov = screen.getByTestId("trader-net-provenance");
    expect(within(prov).getByText("Quelle")).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-prov-source")).toHaveTextContent("Binance Futures, öffentliche Statistik (topLongShortPositionRatio), direkt");
    expect(screen.getByTestId("trader-net-prov-cohort")).toHaveTextContent("Obere 20 % der Konten nach Einsatz · Long-Anteil der Positionsgrößen");
    expect(screen.getByTestId("trader-net-prov-time")).toHaveTextContent(/UTC \(vor .*\)/);
    unmount();
    wrap(none("Nur mit Binance"));
    expect(screen.getAllByTestId(/^trader-net-prov-/)).toHaveLength(3);
    expect(screen.getByTestId("trader-net-prov-time")).toHaveTextContent("–");
  });

  it("the series switch: Positionen is the default, Konten reads the account feed and names itself in the headline", () => {
    wrap(liveNet(SLIDE));
    const card = screen.getByTestId("markt-trader-net");
    expect(card).toHaveAttribute("data-series", "position");
    const group = screen.getByRole("radiogroup", { name: "Reihe" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Positionen", "Konten"]);
    expect(within(group).getByRole("radio", { name: "Positionen" })).toBeChecked();
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/^Top-Trader \(Binance\) sind seit/);
    live.series = [];
    fireEvent.click(within(group).getByRole("radio", { name: "Konten" }));
    expect(card).toHaveAttribute("data-series", "account");
    expect(live.series.at(-1)).toBe("account");
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/^Top-Trader \(Binance, nach Konten\) sind seit/);
    expect(screen.getByTestId("trader-net-prov-source")).toHaveTextContent("topLongShortAccountRatio");
    expect(screen.getByTestId("trader-net-prov-cohort")).toHaveTextContent("Anteil der Konten mit Long-Position");
  });

  it("the legend and the help name the marks and the gap; the rule behind them is on the card", () => {
    wrap(liveNet(SLIDE));
    const legend = screen.getByTestId("trader-net-legend");
    for (const w of ["Vorwarnung", "Bestätigung", "Lücke (keine Daten)", "Umschlag", "netto Long"]) expect(legend).toHaveTextContent(w);
    const help = screen.getByTestId("trader-net-marks-help");
    expect(help).toHaveTextContent("Vorwarnung: der Long-Anteil läuft auf die Linie 50 % ± 2 Punkte zu");
    expect(help).toHaveTextContent("Rückblick auf eine Regel – keine Empfehlung und keine Prognose");
    expect(help).toHaveTextContent("Nach einer Lücke beginnt die Prüfung neu");
    expect(screen.getByTestId("trader-net-help")).toHaveTextContent("keine On-Chain-Wale");
    expect((screen.getByTestId("markt-trader-net").textContent ?? "").replace(/keine On-Chain-Wale/g, "")).not.toMatch(/Wal(e|s)\b|Glassnode/);
  });

  it("marks in the plot: the count and the accessible name tell them", async () => {
    wrap(liveNet(SLIDE));
    const plot = await screen.findByTestId("trader-net-plot");
    expect(plot).toHaveAttribute("data-marks", "2");
    expect(plot).toHaveAttribute("data-gaps", "0");
    expect(plot).toHaveAccessibleName(/Marken der Alarm-Regel: 2 Marken \(Rot-Vorwarnung \d\d\.\d\d\., Rot-Bestätigung \d\d\.\d\d\.\)\.$/);
  });

  it("the crosshair names a mark where it stands: at a point with a mark the readout says which", async () => {
    wrap(liveNet(SLIDE));
    const plot = await screen.findByTestId("trader-net-plot");
    await waitFor(() => expect(plot.querySelector("canvas")!.width).toBeGreaterThan(0));
    plot.focus();
    const tip = screen.getByTestId("trader-net-tip");
    // the slide runs 54 … 44 % from point 20: Vorwarnung at 51 % (point 23), Bestätigung at 48 % (point 26)
    fireEvent.keyDown(plot, { key: "End" });
    expect(screen.getByTestId("trader-net-tip-mark").textContent).toBe("");
    for (let i = 0; i < SLIDE.length - 1 - 26; i++) fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByTestId("trader-net-tip-mark")).toHaveTextContent(/^Rot-Bestätigung \d\d\.\d\d\. \d\d:\d\d$/);
    expect(plot.querySelector("[aria-live=polite]")).toHaveTextContent(/Rot-Bestätigung/);
    for (let i = 0; i < 3; i++) fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByTestId("trader-net-tip-mark")).toHaveTextContent(/^Rot-Vorwarnung/);
    expect(tip.style.opacity).toBe("1");
  });

  it("with stored history and a gap: the plot shows both, the arrow keys stop AT the gap and say it", async () => {
    const liveFrom = T0 + 100 * H;
    wrap(liveNet(SLIDE, liveFrom), stored(0, 40));
    const card = screen.getByTestId("markt-trader-net");
    expect(card).toHaveAttribute("data-state", "ok");
    const plot = await screen.findByTestId("trader-net-plot");
    expect(plot).toHaveAttribute("data-points", String(40 + SLIDE.length));
    expect(plot).toHaveAttribute("data-gaps", "1");
    expect(plot).toHaveAccessibleName(/1 Lücke ohne Messwerte\.$/);
    expect(screen.getByTestId("trader-net-line")).toHaveTextContent(/^Verlauf: \d+ Tage \(\d+ Punkte, davon 40 aus dem Speicher\), 1 Lücke/);
    await waitFor(() => expect(plot.querySelector("canvas")!.width).toBeGreaterThan(0));
    plot.focus();
    const tip = screen.getByTestId("trader-net-tip");
    fireEvent.keyDown(plot, { key: "Home" });
    for (let i = 0; i < 39; i++) fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(tip).toHaveTextContent("Netto +12,0 Pkt.");
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(tip).toHaveTextContent("Lücke");
    expect(tip).toHaveTextContent(/ohne Messwerte/);
    expect(tip).toHaveTextContent("nichts ergänzt");
    expect(plot.querySelector("[aria-live=polite]")).toHaveTextContent(/Nichts ergänzt\./);
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(tip).toHaveTextContent(/Netto \+10,0 Pkt\./);
    // the card keeps the facts straight: the headline is about the newest run only
    expect(screen.getByTestId("trader-net-title")).toHaveTextContent(/im geladenen Verlauf von \d+ Tagen erstmals\.$/);
  });

  it("the range switch says what is still to come: 30 and 90 Tage are shown but disabled for a short history", () => {
    wrap(liveNet(SLIDE));
    const group = screen.getByRole("radiogroup", { name: "Zeitraum" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["7 Tage", "30 Tage", "90 Tage", "Alles · 2 Tage"]);
    expect(radios.map((r) => (r as HTMLButtonElement).disabled)).toEqual([true, true, true, false]);
  });

  it("Binance gives nothing but this device has history: the stored-only state, marked, with the reason", async () => {
    wrap(none("Binance blockiert (Region)"), stored(0, 60));
    const card = screen.getByTestId("markt-trader-net");
    expect(card).toHaveAttribute("data-state", "archive");
    expect(within(card).getByText("gespeichert", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("trader-net-line")).toHaveTextContent("Binance liefert gerade nichts – gezeigt wird der Verlauf, den dieses Gerät gespeichert hat.");
    expect(screen.getByTestId("trader-net-prov-source")).toHaveTextContent("Gespeicherter Verlauf auf diesem Gerät");
    expect(await screen.findByTestId("trader-net-plot")).toHaveAttribute("data-points", "60");
    expect(screen.getByTestId("trader-net-kpi-net-value")).toHaveTextContent("+12,0 Pkt.");
  });

  it("without data and without history the card says why and shows no plot", () => {
    wrap(none("Binance blockiert (Region)"));
    expect(screen.getByTestId("markt-trader-net")).toHaveAttribute("data-state", "none");
    expect(screen.queryByTestId("trader-net-plot")).toBeNull();
    expect(screen.getByTestId("trader-net-empty")).toHaveTextContent("Binance blockiert (Region)");
    expect(screen.getByTestId("trader-net-kpi-net-value")).toHaveTextContent("–");
  });

  it("loading: the thinking orb stands in the plot's box (no number is shown)", () => {
    wrap(none("lädt", "loading"));
    const box = screen.getByTestId("trader-net-empty");
    expect(box.querySelector("[data-thinking-orb='ring']")).not.toBeNull();
    expect(box).toHaveTextContent("Top-Trader-Daten werden geladen");
    expect(screen.getByTestId("trader-net-kpi-net-value")).toHaveTextContent("–");
  });

  it("the archive row: the line, the switch, CSV, and a two-step delete", async () => {
    const liveFrom = T0 + 100 * H;
    const rows = stored(0, 40);
    wrap(liveNet(SLIDE, liveFrom), rows);
    const row = screen.getByTestId("trader-net-archive");
    expect(row).toHaveAttribute("data-recording", "on");
    expect(screen.getByTestId("trader-net-archive-line")).toHaveTextContent(/^Gespeichert auf diesem Gerät: 39 Std\. \(40 Punkte\), 1 Lücke · wächst mit jedem Besuch\.$/);
    // the switch
    const sw = within(row).getByRole("switch", { name: "Verlauf auf diesem Gerät merken" });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(arch.setOn).toHaveBeenCalledWith(false);
    // CSV: gaps are comments, the file is named for series and symbol
    fireEvent.click(screen.getByTestId("trader-net-archive-csv"));
    expect(arch.save).toHaveBeenCalledTimes(1);
    const [name, data, mime] = arch.save.mock.calls[0] as unknown as [string, string, string];
    expect(name).toBe("top-trader-netto-position-BTCUSDT.csv");
    expect(mime).toMatch(/^text\/csv/);
    expect(data.split("\n")[0]).toBe("zeit_utc,long_prozent,netto_punkte,preis,herkunft");
    expect(data).toContain("# Lücke ohne Messwerte:");
    expect(data.split("\n").filter((l) => l.endsWith(",gespeichert"))).toHaveLength(40);
    // delete needs a second step
    fireEvent.click(screen.getByTestId("trader-net-archive-delete"));
    expect(arch.state.clear).not.toHaveBeenCalled();
    expect(screen.getByTestId("trader-net-archive-sure")).toHaveTextContent("Gespeicherten Verlauf wirklich löschen?");
    fireEvent.click(screen.getByTestId("trader-net-archive-no"));
    expect(arch.state.clear).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trader-net-archive-sure")).toBeNull();
    fireEvent.click(screen.getByTestId("trader-net-archive-delete"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("trader-net-archive-yes"));
    });
    expect(arch.state.clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("trader-net-archive-sure")).toBeNull());
  });

  it("nothing stored: delete is disabled; storing off or impossible is said in the line", () => {
    arch.state = { status: "unavailable", recording: true, rows: [], clear: vi.fn(async () => undefined) } as unknown as NetArchiveState;
    live.net = liveNet(SLIDE);
    render(
      <MotionRoot>
        <TraderNetCard />
      </MotionRoot>,
    );
    expect(screen.getByTestId("trader-net-archive")).toHaveAttribute("data-status", "unavailable");
    expect(screen.getByTestId("trader-net-archive-line")).toHaveTextContent("geht in diesem Browser nicht");
    expect(screen.getByTestId("trader-net-archive-delete")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Verlauf auf diesem Gerät merken" })).toBeDisabled();
  });
});

describe("gaps of the live series itself", () => {
  it("a hole inside the live points is a gap too (the view is then the newest run)", () => {
    const longs = Array.from({ length: 60 }, (_, i) => (i < 30 ? 56 : 44));
    const raw = pts(longs).filter((p) => p.time < T0 + 20 * H || p.time > T0 + 24 * H);
    const ln: LiveTraderNet = { view: buildTraderNet(raw, [], T0 + 61 * H, H), status: "live", stepMs: H, source: "binance" };
    const w = buildWal({ live: ln, archive: [], symbol: "BTCUSDT", now: T0 + 61 * H });
    expect(findNetGaps(w.points, H)).toHaveLength(1);
    expect(w.gaps).toHaveLength(1);
    expect(w.view!.points[0]!.t).toBe(T0 + 25 * H);
    expect(w.view!.flip).not.toBeNull();
  });
});
