/**
 * The Labor page with a candle source that hangs or fails (the "Lade Kerzen 0 von 2 …" report): the status line says what is
 * going on, "Abbrechen" ends the load at once, a hanging Binance-Futures falls back to the next source and the RESULT names the
 * source that really served the candles ("Quelle: Spot, nicht Futures" + a note, the assumptions say so too), and when
 * everything fails the card says why per source and offers "Erneut versuchen".
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BinanceRest } from "@/market/sources/binance";
import type { SpotRest } from "@/market/sources/binanceSpot";
import { RestError } from "@/market/sources/http";
import type { Candle } from "@/market/types";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, __setHistoryDeps, LaborView, useLabor } from "@/views/labor";
import { forgetRoutes } from "@/views/labor/historySource";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const H4: Row[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: Row[] }).bars;
const H4_MS = 14_400_000;
const NOW = H4[H4.length - 1]![0] * 1000 + H4_MS + 60_000;
const TIMING = { timeoutMs: 80, backoffMs: [4, 8], maxBudgetWaitMs: 100, skipMemoMs: 60_000 };

const candles = (startTime: number, limit: number): Candle[] =>
  H4.filter((b) => b[0] * 1000 >= startTime)
    .slice(0, limit)
    .map(([t, o, h, l, c]) => ({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 1, closed: true }));

const futuresOk = (): BinanceRest => ({ klines: vi.fn(async (_s: string, _i: string, p: { startTime?: number; limit?: number } = {}) => ({ data: candles(p.startTime ?? 0, p.limit ?? 500), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })), fundingRate: vi.fn(async () => ({ data: [], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })) }) as unknown as BinanceRest;
const futuresHangs = (): BinanceRest => ({ klines: vi.fn(() => new Promise(() => {})), fundingRate: vi.fn() }) as unknown as BinanceRest;
const futuresDown = (kind: "network" | "blocked_451" = "network"): BinanceRest => ({ klines: vi.fn(async () => Promise.reject(new RestError(kind, "x"))), fundingRate: vi.fn() }) as unknown as BinanceRest;
const spotOk = (): SpotRest => ({ klines: vi.fn(async (_s: string, _i: string, p: { startTime?: number; limit?: number } = {}) => candles(p.startTime ?? 0, Math.min(1000, p.limit ?? 1000))) }) as unknown as SpotRest;
const spotDown = (): SpotRest => ({ klines: vi.fn(async () => Promise.reject(new RestError("network", "x"))) }) as unknown as SpotRest;

function wire(d: { rest: BinanceRest; spot?: SpotRest | null }): void {
  __setHistoryDeps({ rest: () => d.rest, proxy: () => null, bybit: () => null, spot: () => d.spot ?? null, spotApp: () => null, store: () => null, now: () => NOW, timing: TIMING });
}

function renderLabor() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <LaborView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

async function start(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("labor-start"));
  });
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

describe("Labor: Quelle der Kerzen", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    __resetLabor();
    __setHistoryDeps(null);
    forgetRoutes();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    useLabor.getState().setCfg({ strategy: "rules", period: "6m", funding: "flat", rules: { interval: "4h", side: "long", conds: [{ kind: "rsiBelow", a: 40 }] } });
  });
  afterEach(() => {
    __resetLabor();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("Binance-Futures liefert: die Quelle sagt Futures, kein Hinweis, die Annahmen bleiben wie sie waren", async () => {
    wire({ rest: futuresOk(), spot: spotOk() });
    renderLabor();
    // before any run the plan states the default and the fallback honestly
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent("Echte Kerzen von Binance-Futures");
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent("Ausweichquelle");
    await start();
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    expect(screen.getByTestId("labor-stand")).toHaveTextContent("Quelle: Binance USDⓈ-M, geschlossene Kerzen");
    expect(screen.queryByTestId("labor-source-note")).toBeNull();
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent(/geschlossene 4h-Kerzen BTCUSDT von Binance-Futures, /);
    expect(useLabor.getState().dataSource).toMatchObject({ id: "binance", failed: [] });
    expect(useLabor.getState().runs[0]!.src).toBeUndefined();
  }, 60_000);

  it("Futures hängt → nach dem Zeitlimit kommt Spot: Ergebnis, Quelle „Spot, nicht Futures“, Hinweis und Annahmen sagen es", async () => {
    const rest = futuresHangs();
    wire({ rest, spot: spotOk() });
    renderLabor();
    await start();
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    expect(rest.klines).toHaveBeenCalledTimes(1); // one hang, then the next source
    expect(screen.getByTestId("labor-stand")).toHaveTextContent("Quelle: Spot, nicht Futures");
    const note = screen.getByTestId("labor-source-note");
    expect(note).toHaveTextContent("Binance-Futures war nicht erreichbar");
    expect(note).toHaveTextContent("Binance-Futures: keine Antwort in 1 s"); // the reason is named (the limit is shortened in this test)
    expect(note).toHaveTextContent("nicht 1:1");
    const ass = screen.getByTestId("labor-assumptions");
    expect(ass).toHaveTextContent("von Binance Spot, nicht Futures");
    expect(ass).not.toHaveTextContent("Kerzen BTCUSDT von Binance-Futures");
    expect(useLabor.getState().dataSource).toMatchObject({ id: "spot", failed: [{ source: "binance", kind: "timeout", limitMs: 80 }] });
    // the run in the comparison is marked, the id keeps it apart from a Futures run of the same set-up
    expect(useLabor.getState().runs[0]!.src).toBe("spot");
    expect(screen.getByTestId("labor-run-card")).toHaveTextContent("Spot");
  }, 60_000);

  it("während des Wartens steht da, was passiert; „Abbrechen“ beendet den Abruf sofort", async () => {
    wire({ rest: futuresHangs(), spot: spotOk() });
    __setHistoryDeps({ rest: () => futuresHangs(), proxy: () => null, bybit: () => null, spot: () => null, spotApp: () => null, store: () => null, now: () => NOW, timing: { ...TIMING, timeoutMs: 60_000 } });
    renderLabor();
    await start();
    await waitFor(() => expect(screen.getByTestId("labor-load-note")).toHaveTextContent("Frage Binance-Futures"));
    // not a silent "0 %": the stage has the progressbar, the page counter and the status line
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("labor-busy")).toHaveTextContent(/Lade Kerzen 0 von \d+/);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toContain("Frage Binance-Futures");
    const t0 = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-cancel"));
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "cancelled"), { timeout: 2000 });
    expect(useLabor.getState().loadStatus).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(screen.getByTestId("labor-start")).toBeEnabled();
  }, 30_000);

  it("alles fällt aus → Grund je Quelle, „Erneut versuchen“; beim zweiten Versuch läuft es", async () => {
    wire({ rest: futuresDown("network"), spot: spotDown() });
    renderLabor();
    await start();
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "error"), { timeout: 30_000 });
    const run = screen.getByTestId("labor-run");
    expect(run).toHaveTextContent("Binance ist gerade nicht erreichbar, auch die Ausweichquellen antworten nicht");
    expect(screen.getByTestId("labor-error-detail")).toHaveTextContent("Futures: nicht erreichbar · Spot: nicht erreichbar");
    expect(useLabor.getState().result).toBeNull(); // never a fake result
    const retry = screen.getByTestId("labor-retry");
    expect(retry).toHaveTextContent("Erneut versuchen");
    // the network is back
    wire({ rest: futuresOk(), spot: spotOk() });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    // the status flips before the retry button unmounts (one render later) – wait for it instead of reading it in the same tick
    await waitFor(() => expect(screen.queryByTestId("labor-retry")).toBeNull());
    expect(screen.getByTestId("labor-stand")).toHaveTextContent("Quelle: Binance USDⓈ-M");
  }, 60_000);

  it("ein Tippfehler im Markt bekommt keinen „Erneut versuchen“-Knopf und keinen Marktwechsel", async () => {
    const rest = { klines: vi.fn(async () => Promise.reject(new RestError("bad_symbol", "HTTP 400", 400))), fundingRate: vi.fn() } as unknown as BinanceRest;
    const spot = spotOk();
    wire({ rest, spot });
    renderLabor();
    await start();
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "error"), { timeout: 30_000 });
    expect(screen.getByTestId("labor-run")).toHaveTextContent("Diesen Markt kennt Binance nicht.");
    expect(screen.queryByTestId("labor-retry")).toBeNull();
    expect(spot.klines).not.toHaveBeenCalled();
  }, 60_000);
});
