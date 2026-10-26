/**
 * Zeitmaschine · the card and its surroundings: the props → input model, the pure geometry of the two pictures, the trade → plan
 * bridge with its reasons, the form model of the Labor section, and the card itself (invalid plan, waiting for the button,
 * running with a progress bar and abort, the finished result with every block, an outdated result after a changed plan, the
 * warning when simulation and history disagree, the empty history). The domain is tested in `timemachine.*.test.ts`.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultOptions, runTimeMachineSync, type TmResult } from "@/domain/timemachine";
import { MotionRoot } from "@/motion/MotionRoot";
import { histGeometry, fanGeometry, niceTicks } from "@/views/timemachine/geometry";
import { DEFAULT_FORM, costsOfLab, missingPrices, optionsOfForm, readPrices, sanitizeForm } from "@/views/timemachine/formModel";
import { __forgetTimeMachine, lastTimeMachine } from "@/views/timemachine/lastResult";
import { barsOf, inputOf, runKey } from "@/views/timemachine/model";
import { tmPlanOfTrade, symbolOfPair, costsOfTrade } from "@/views/timemachine/tradePlan";
import type { TimeMachineCandle, TimeMachineProps } from "@/views/timemachine/types";
import type { Trade } from "@/domain/types";
import { input as domainInput, latticeBars, latticePlan, ZERO_COSTS } from "./timemachine.helpers";
import { installDomPolyfills } from "./views.overview.harness";

const { TimeMachineCard } = await import("@/views/timemachine/TimeMachineCard");

const candlesOf = (n: number, pUp = 0.5): TimeMachineCandle[] => latticeBars(n, pUp).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true }));
const plan = latticePlan(5, 10);

const props = (over: Partial<TimeMachineProps> = {}): TimeMachineProps => ({
  symbol: "TESTUSDT",
  side: "long",
  entry: plan.entry,
  stop: plan.stop,
  target: plan.target,
  candles: candlesOf(600),
  interval: "1d",
  // without costs the stop fills at −1,00 R exactly (daily candles held for weeks would pay a lot of funding)
  costs: ZERO_COSTS,
  // small and quick: a few hundred sessions of 80 candles
  options: { ...defaultOptions("1d"), runs: 400, horizon: 80, method: "single", vol: "history" },
  source: "Testquelle",
  fetchedAt: 1_700_000_000_000,
  ...over,
});

const wrap = (ui: ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
const done = async () => waitFor(() => expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });

beforeAll(() => installDomPolyfills());
afterEach(() => {
  __forgetTimeMachine();
  vi.restoreAllMocks();
});

describe("Modell der Karte", () => {
  it("Kerzen → Bars: nur geschlossene, endliche; Zeit in Sekunden", () => {
    const c: TimeMachineCandle[] = [
      { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, closed: true },
      { time: 2000, open: 1, high: 2, low: 0.5, close: 1.5, closed: false },
      { time: 3000, open: NaN, high: 2, low: 0.5, close: 1.5 },
      { time: 4000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 },
    ];
    expect(barsOf(c)).toEqual([
      { t: 1, o: 1, h: 2, l: 0.5, c: 1.5 },
      { t: 4, o: 1, h: 2, l: 0.5, c: 1.5, v: 7 },
    ]);
  });

  it("inputOf: Standardwerte, Seed 19, Kosten der Lab-Standards; Gründe statt Absturz", () => {
    const ok = inputOf({ ...props(), options: undefined, costs: undefined });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.input.seed).toBe(19);
      expect(ok.input.runs).toBe(10_000);
      expect(ok.input.horizon).toBe(30);
      expect(ok.input.costs.fees.takerBps).toBe(5);
      expect(ok.input.startMs).toBeNull();
    }
    const withSeed = inputOf({ ...props(), seed: 5 });
    expect(withSeed.ok && withSeed.input.seed).toBe(5);
    expect(inputOf({ ...props(), stop: plan.entry + 1 })).toMatchObject({ ok: false });
    const few = inputOf({ ...props(), candles: candlesOf(40) });
    expect(few.ok).toBe(false);
    if (!few.ok) expect(few.why).toMatch(/Nur 40 Kerzen/);
    const bad = inputOf({ ...props(), interval: "7m" as never });
    expect(bad.ok).toBe(false);
  });

  it("runKey ändert sich mit Plan, Optionen und Kerzen – nicht mit einem bloßen Neuzeichnen", () => {
    const a = props();
    expect(runKey(a)).toBe(runKey({ ...a }));
    expect(runKey(a)).not.toBe(runKey({ ...a, stop: a.stop + 1 }));
    expect(runKey(a)).not.toBe(runKey({ ...a, seed: 20 }));
    expect(runKey(a)).not.toBe(runKey({ ...a, candles: candlesOf(601) }));
  });
});

describe("Geometrie der Bilder", () => {
  const res = runTimeMachineSync(domainInput({ runs: 300, horizon: 60 }));

  it("niceTicks: runde Schritte, nie mehr als verlangt", () => {
    expect(niceTicks(-1.3, 2.4, 7)).toEqual([-1, 0, 1, 2]);
    expect(niceTicks(0, 40, 5)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0, 0)).toEqual([0]);
    expect(niceTicks(-2.7, 12.4, 6).length).toBeLessThanOrEqual(6);
  });

  it("Fächer: Stop −1 R unter 0 unter Ziel (y wächst nach unten), Bänder und Pfade im Bild, Ende der Pfade auf der Linie", () => {
    const g = fanGeometry(res.sim.fan, res.targetR, 500, 260)!;
    expect(g.targetY).toBeLessThan(g.zeroY);
    expect(g.zeroY).toBeLessThan(g.stopY);
    expect(g.band90.startsWith("M")).toBe(true);
    expect(g.paths.length).toBe(res.sim.fan.paths.length);
    for (const p of g.paths.filter((x) => x.kind === "target" && x.end)) expect(p.end!.y).toBeCloseTo(g.targetY, 6);
    for (const p of g.paths.filter((x) => x.kind === "stop" && x.end)) expect(p.end!.y).toBeCloseTo(g.stopY, 6);
    // alles liegt im Rahmen
    for (const p of g.paths) if (p.end) expect(p.end.x).toBeLessThanOrEqual(500 - g.box.r + 1e-6);
    expect(g.yTicks.includes(0)).toBe(true);
    expect(fanGeometry(res.sim.fan, res.targetR, 40, 260)).toBeNull();
  });

  it("Histogramm: Säulen am Boden, die höchste gehört der größten Zahl, nichts Leeres hat Höhe, Stop und Ziel liegen auf der Achse", () => {
    const g = histGeometry(res.sim.hist, res.sim.runs, 500, 200, [-1, res.targetR])!;
    const innerBottom = g.box.t + (g.h - g.box.t - g.box.b);
    const tallest = g.bars.reduce((a, b) => (b.share > a.share ? b : a));
    for (const b of g.bars) {
      expect(b.y + b.h).toBeCloseTo(innerBottom, 6);
      if (b.n === 0) expect(b.h).toBe(0);
      expect(b.h).toBeLessThanOrEqual(tallest.h + 1e-9);
    }
    expect(g.x(-1)).toBeLessThan(g.x(0));
    expect(g.x(0)).toBeLessThan(g.x(res.targetR));
    expect(g.xTicks).toContain(-1);
    expect(histGeometry({ bins: [], width: 0.25 }, 100, 500, 200, [])).toBeNull();
  });
});

describe("Trade → Plan", () => {
  const base: Trade = { id: "t1", side: "long", status: "closed", date: "2026-10-01T10:00", pair: "BTC/USDT", timeframe: "1h", entry: 100, stop: 98, target: 104, exit: 102, size: 1000, leverage: 5, fees: 0, pnlManual: null, setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "" };

  it("ein vollständiger Trade ist der Plan, das Ziel kommt aus dem Trade", () => {
    const r = tmPlanOfTrade(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.plan).toEqual({ side: "long", entry: 100, stop: 98, target: 104 });
      expect(r.value.targetAssumed).toBe(false);
      expect(r.value.symbol).toBe("BTCUSDT");
      expect(r.value.entryMs).toBe(new Date("2026-10-01T10:00").getTime());
    }
  });

  it("ohne Ziel: n × R wird angenommen und benannt; Short spiegelt", () => {
    const r = tmPlanOfTrade({ ...base, target: null }, 3);
    expect(r.ok && r.value.plan.target).toBe(106);
    expect(r.ok && r.value.targetAssumed).toBe(true);
    const s = tmPlanOfTrade({ ...base, side: "short", entry: 100, stop: 102, target: null }, 2);
    expect(s.ok && s.value.plan.target).toBe(96);
  });

  it("ehrlich leer mit Grund: kein Stop, kein Einstieg, keine Zeit, kein Paar, Stop auf der falschen Seite", () => {
    expect(tmPlanOfTrade({ ...base, stop: null })).toMatchObject({ ok: false, why: expect.stringMatching(/keinen Stop/) });
    expect(tmPlanOfTrade({ ...base, entry: null })).toMatchObject({ ok: false, why: expect.stringMatching(/Einstiegspreis/) });
    expect(tmPlanOfTrade({ ...base, date: "" })).toMatchObject({ ok: false, why: expect.stringMatching(/Einstiegszeit/) });
    expect(tmPlanOfTrade({ ...base, pair: " " })).toMatchObject({ ok: false, why: expect.stringMatching(/Paar/) });
    expect(tmPlanOfTrade({ ...base, stop: 101 })).toMatchObject({ ok: false, why: expect.stringMatching(/Stop unter dem Einstieg/) });
  });

  it("Symbol und Kosten: Paar in Börsen-Schreibweise, Gebühren der Börse, Spot ohne Funding", () => {
    expect(symbolOfPair("ETH/USDT")).toBe("ETHUSDT");
    expect(costsOfTrade({ exchange: "bitunix", market: "perp" }).fees.takerBps).toBe(6);
    expect(costsOfTrade({ exchange: "bitunix", market: "perp" }).funding.kind).toBe("flat");
    expect(costsOfTrade({ exchange: undefined, market: "spot" }).funding.kind).toBe("none");
  });
});

describe("Formular des Labor-Abschnitts", () => {
  it("Gespeichertes wird geprüft gelesen: Unbekanntes fällt auf den Standard zurück", () => {
    expect(sanitizeForm(null)).toEqual(DEFAULT_FORM);
    const f = sanitizeForm({ symbol: "ETHUSDT", side: "short", entry: "1.234,5", interval: "9m", runs: "99", trigger: "level", breakEven: true, junk: 1 });
    expect(f).toMatchObject({ symbol: "ETHUSDT", side: "short", entry: "1.234,5", interval: "4h", runs: "10000", trigger: "level", breakEven: true });
    expect(sanitizeForm({ symbol: "<script>" }).symbol).toBe("BTCUSDT");
    expect(sanitizeForm({ entry: "x".repeat(500) }).entry.length).toBe(24);
  });

  it("Preise: Komma und Punkt, „85.900“ neben einem Preis dieser Größe heißt 85 900; fehlende Zahlen werden genannt", () => {
    const f = { ...DEFAULT_FORM, entry: "85.900", stop: "84.000,5", target: "" };
    expect(readPrices(f)).toEqual({ entry: 85_900, stop: 84_000.5, target: null });
    expect(missingPrices(f)).toBe("Es fehlt: Ziel (eine Zahl größer 0).");
    expect(missingPrices({ ...f, target: "88000" })).toBeNull();
    expect(readPrices({ ...f, entry: "-5" }).entry).toBeNull();
  });

  it("Optionen: Grenzen werden eingehalten, leer = Standard des Zeitrahmens, Verwaltung nur wenn eingeschaltet", () => {
    const o = optionsOfForm({ ...DEFAULT_FORM, horizon: "", interval: "1h", trigger: "range", lookback: "999", breakEven: true, breakEvenR: "1,5", trail: false });
    expect(o.horizon).toBe(48);
    expect(o.trigger).toEqual({ kind: "range", lookback: 20 });
    expect(o.manage).toMatchObject({ breakEvenR: 1.5, trailAtr: null });
    expect(optionsOfForm({ ...DEFAULT_FORM, horizon: "75" }).horizon).toBe(75);
    expect(optionsOfForm({ ...DEFAULT_FORM, horizon: "1" }).horizon).toBe(42);
    expect(optionsOfForm({ ...DEFAULT_FORM, seed: "abc" }).seed).toBe(19);
  });

  it("Kosten wie im Versuchsaufbau: Gebührenstufe der Börse, Slippage, Funding pauschal oder keins", () => {
    const c = costsOfLab({ exchange: "okx", slippage: { kind: "fixed", bps: 4 }, funding: "history" });
    expect(c.fees).toMatchObject({ exchange: "okx", takerBps: 5 });
    expect(c.slippage).toEqual({ kind: "fixed", bps: 4 });
    expect(c.funding.kind).toBe("flat");
    expect(costsOfLab({ exchange: "binance", slippage: { kind: "none" }, funding: "none" }).funding.kind).toBe("none");
  });
});

describe("Karte", { timeout: 60_000 }, () => {
  it("ungültiger Plan: der Grund steht da, es wird nichts gerechnet, kein Knopf zum Starten", async () => {
    wrap(<TimeMachineCard {...props({ stop: plan.entry + 5 })} />);
    expect(await screen.findByTestId("tm-invalid", {}, { timeout: 30_000 })).toHaveTextContent("Bei Long muss der Stop unter dem Einstieg liegen");
    expect(screen.getByTestId("tm-start")).toBeDisabled();
    expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "invalid");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId("tm-busy")).toBeNull();
    expect(screen.queryByTestId("tm-result")).toBeNull();
  });

  it("zu wenige Kerzen: ehrlich leer mit der Zahl", async () => {
    wrap(<TimeMachineCard {...props({ candles: candlesOf(60) })} />);
    expect(await screen.findByTestId("tm-invalid", {}, { timeout: 30_000 })).toHaveTextContent("Nur 60 Kerzen – mindestens 200");
    wrap(<TimeMachineCard {...props({ candles: [] })} />);
    expect((await screen.findAllByTestId("tm-invalid"))[1]).toHaveTextContent("Keine Kerzen");
  });

  it("ohne autoStart wartet die Karte auf den Knopf; danach: Fortschritt, Ergebnis, Seed, Quelle, Hinweis", async () => {
    wrap(<TimeMachineCard {...props({ autoStart: false })} />);
    expect(screen.getByTestId("tm-idle")).toHaveTextContent("Noch nicht gerechnet");
    expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "idle");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId("tm-result")).toBeNull();
    fireEvent.click(screen.getByTestId("tm-start"));
    await done();
    const res = screen.getByTestId("tm-result");
    expect(res).toHaveAttribute("data-seed", "19");
    expect(res).toHaveAttribute("data-stale", "false");
    expect(screen.getByTestId("tm-source")).toHaveTextContent("Quelle: Testquelle");
    expect(screen.getByTestId("tm-source")).toHaveTextContent("Abruf");
    const note = within(screen.getByTestId("tm-card")).getByTestId("analysis-note");
    expect(note).toHaveTextContent("Keine professionelle Finanzberatung.");
    expect(note).toHaveTextContent("keine Zusage");
    // the three odds add up and the bar carries them as text
    const p = ["tm-p-target", "tm-p-stop", "tm-p-neither"].map((id) => Number(within(screen.getByTestId(id)).getByText(/^\d+,\d %$/).textContent!.replace(/[^\d,]/g, "").replace(",", ".")));
    expect(p[0]! + p[1]! + p[2]!).toBeGreaterThan(99.7);
    expect(p[0]! + p[1]! + p[2]!).toBeLessThan(100.3);
    expect(screen.getByTestId("tm-oddsbar")).toHaveAttribute("aria-label", expect.stringContaining("Ziel zuerst"));
    for (const id of ["tm-odds", "tm-expectancy", "tm-fan-block", "tm-hist-block", "tm-cases", "tm-time", "tm-history", "tm-compare"]) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("tm-case-worst")).toHaveTextContent("−1,00 R");
    expect(screen.getByTestId("tm-verdict")).toHaveAttribute("data-verdict");
    // the pictures are lazy chunks: they arrive, with their number tables behind a disclosure
    expect(await screen.findByTestId("tm-fan", {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(await screen.findByTestId("tm-hist", {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.getByTestId("tm-fan-table")).toBeInTheDocument();
    expect(screen.getByTestId("tm-hist-table")).toBeInTheDocument();
    // the last run is remembered for the assistant (memory only)
    expect(lastTimeMachine()?.result.seed).toBe(19);
    expect(lastTimeMachine()?.source).toBe("Testquelle");
  });

  it("während der Rechnung: Fortschrittsbalken mit Phase und Prozent, „Abbrechen“ hält an und sagt es", async () => {
    wrap(<TimeMachineCard {...props({ autoStart: false, options: { ...defaultOptions("1d"), runs: 20_000, horizon: 300, vol: "history" } })} />);
    fireEvent.click(screen.getByTestId("tm-start"));
    const busy = await screen.findByTestId("tm-busy", {}, { timeout: 30_000 });
    expect(within(busy).getByRole("progressbar")).toHaveAttribute("aria-valuemin", "0");
    expect(within(busy).getByRole("progressbar")).toHaveAttribute("aria-valuemax", "100");
    expect(busy).toHaveTextContent(/Rechnet/);
    expect(screen.queryByTestId("tm-start")).toBeNull();
    fireEvent.click(screen.getByTestId("tm-cancel"));
    expect(await screen.findByTestId("tm-cancelled", {}, { timeout: 30_000 })).toHaveTextContent("Abgebrochen");
    expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "cancelled");
    expect(screen.queryByTestId("tm-result")).toBeNull();
    // and it can be started again
    expect(screen.getByTestId("tm-start")).toBeEnabled();
  });

  it("ein geänderter Plan markiert das Ergebnis als veraltet; mit Knopf rechnet er neu, mit autoStart von selbst", async () => {
    const { rerender } = wrap(<TimeMachineCard {...props({ autoStart: false })} />);
    fireEvent.click(screen.getByTestId("tm-start"));
    await done();
    const before = screen.getByTestId("tm-p-stop").textContent;
    rerender(
      <MotionRoot>
        <TimeMachineCard {...props({ autoStart: false, stop: latticePlan(3, 10).stop })} />
      </MotionRoot>,
    );
    expect(screen.getByTestId("tm-stale")).toHaveTextContent("gehört zum alten Plan");
    expect(screen.getByTestId("tm-result")).toHaveAttribute("data-stale", "true");
    fireEvent.click(screen.getByTestId("tm-start"));
    await waitFor(() => expect(screen.getByTestId("tm-result")).toHaveAttribute("data-stale", "false"), { timeout: 30_000 });
    expect(screen.queryByTestId("tm-stale")).toBeNull();
    // a closer stop is hit more often
    expect(screen.getByTestId("tm-p-stop").textContent).not.toBe(before);
    // with autoStart a changed price starts the next run by itself
    rerender(
      <MotionRoot>
        <TimeMachineCard {...props({ autoStart: true, stop: latticePlan(4, 10).stop })} />
      </MotionRoot>,
    );
    await waitFor(() => expect(screen.getByTestId("tm-result")).toHaveAttribute("data-stale", "false"), { timeout: 30_000 });
    expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "done");
  });

  it("zeigt den Warnhinweis, wenn Simulation und echte Vorfälle stark abweichen – und die leere Vorfälle-Liste ehrlich", async () => {
    const real = runTimeMachineSync(domainInput({ runs: 300, horizon: 60 }));
    const warn: TmResult = {
      ...real,
      compare: { ...real.compare, status: "ok", warn: true, text: "Warnung: Simulation und echte Vorfälle weichen stark voneinander ab (Ziel zuerst).", rows: real.compare.rows.map((r) => (r.id === "target" ? { ...r, off: true, hist: 0.6, diff: 0.3 } : r)) },
      history: { ...real.history, n: 0, events: [], target: { ...real.history.target, k: 0 } },
    };
    const mod = await import("@/domain/timemachine/tmRunner");
    vi.spyOn(mod, "runTimeMachine").mockResolvedValue(warn);
    wrap(<TimeMachineCard {...props()} />);
    await done();
    const text = screen.getByTestId("tm-compare-text");
    expect(text).toHaveAttribute("data-warn", "true");
    expect(text).toHaveAttribute("role", "alert");
    expect(text).toHaveTextContent("Warnung: Simulation und echte Vorfälle weichen stark");
    const row = screen.getAllByTestId("tm-compare-row").find((r) => r.getAttribute("data-row") === "target")!;
    expect(row).toHaveAttribute("data-off", "true");
    expect(row).toHaveTextContent("⚠");
    expect(screen.getByTestId("tm-history-empty")).toHaveTextContent("nie ausgelöst");
    expect(screen.queryByTestId("tm-events")).toBeNull();
  });

  it("onClose: der Schließen-Knopf ruft den Host; framed={false} lässt den Kartenrahmen weg", async () => {
    const onClose = vi.fn();
    wrap(<TimeMachineCard {...props({ onClose, framed: false, autoStart: false })} />);
    fireEvent.click(screen.getByTestId("tm-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tm-card").tagName).toBe("SECTION");
    await act(async () => {});
  });
});
