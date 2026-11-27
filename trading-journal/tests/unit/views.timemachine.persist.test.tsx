/**
 * A3 in the card: a finished run is saved (id, seed, model, data hash, costs, size shown), a "reload" (a new store on the same
 * IndexedDB) serves the SAME simulation without computing, "Neu rechnen" says whether the figures came out equal, the canvas mode
 * "Alle Pfade" titles „berechnet“ apart from „gezeichnet“ (a labelled sample above 2 000), a restored simulation computes its paths
 * on demand, and the trade shows the simulation saved for it – nothing for a trade that has none. The 2D canvas is a fake.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOptions } from "@/domain/timemachine";
import { MotionRoot } from "@/motion/MotionRoot";
import { __forgetTimeMachine } from "@/views/timemachine/lastResult";
import { createSimulationStore, idbSimStorage } from "@/views/timemachine/simStore";
import { setSimulationsForTests } from "@/views/timemachine/simulations";
import type { TimeMachineCandle, TimeMachineProps } from "@/views/timemachine/types";
import { latticeBars, latticePlan, ZERO_COSTS } from "./timemachine.helpers";
import { installDomPolyfills } from "./views.overview.harness";

const { TimeMachineCard } = await import("@/views/timemachine/TimeMachineCard");
const { default: TradeSimulationBlock } = await import("@/views/timemachine/TradeSimulationBlock");

const candles: TimeMachineCandle[] = latticeBars(600, 0.5).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true }));
const plan = latticePlan(5, 10);
const props = (over: Partial<TimeMachineProps> = {}): TimeMachineProps => ({
  symbol: "TESTUSDT",
  side: "long",
  entry: plan.entry,
  stop: plan.stop,
  target: plan.target,
  candles,
  interval: "1d",
  costs: ZERO_COSTS,
  options: { ...defaultOptions("1d"), runs: 400, horizon: 80, method: "single", vol: "history" },
  source: "Testquelle",
  fetchedAt: 1_700_000_000_000,
  ...over,
});
const wrap = (ui: ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
const done = () => waitFor(() => expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
const openStore = () => createSimulationStore(idbSimStorage("tj2-test-persist")!);

/** A recording 2D context: every method is a spy, properties are plain. */
function fakeContext() {
  const ctx: Record<string, unknown> = { lineWidth: 1, strokeStyle: "", globalAlpha: 1, lineJoin: "miter", lineCap: "butt" };
  for (const m of ["setTransform", "clearRect", "save", "restore", "beginPath", "moveTo", "lineTo", "stroke", "rect", "clip"]) ctx[m] = vi.fn();
  return ctx;
}

beforeAll(() => installDomPolyfills());
beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  setSimulationsForTests(openStore());
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeContext() as never);
});
afterEach(() => {
  cleanup();
  __forgetTimeMachine();
  setSimulationsForTests(null);
  vi.restoreAllMocks();
});

describe("Karte: speichern und wiederfinden", () => {
  it("nach dem Lauf steht fest, welche Simulation das ist: ID, Modell, Seed, Größe, Daten mit Hash, Kosten, Ablage", async () => {
    wrap(<TimeMachineCard {...props()} />);
    await done();
    const sim = await screen.findByTestId("tm-sim");
    expect(within(sim).getByTestId("tm-sim-id").textContent).toMatch(/^sim_[0-9a-f]{32}$/);
    expect(within(sim).getByTestId("tm-sim-model")).toHaveTextContent("zeitmaschine/1");
    expect(within(sim).getByTestId("tm-sim-seed")).toHaveTextContent("19");
    expect(within(sim).getByTestId("tm-sim-size")).toHaveTextContent("400 Läufe × 80 Kerzen");
    expect(within(sim).getByTestId("tm-sim-data")).toHaveTextContent(/600 Kerzen bis .* · Hash [0-9a-f]{12}…/);
    expect(within(sim).getByTestId("tm-sim-costs")).toHaveTextContent("Gebühren");
    await waitFor(() => expect(within(sim).getByTestId("tm-sim-stored")).toHaveTextContent("nur auf diesem Gerät gespeichert"));
    // the same record is on the device
    const saved = await openStore().list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.simulationId).toBe(within(sim).getByTestId("tm-sim-id").textContent);
  });

  it("der Modellumfang steht da: was enthalten ist und was fehlt (Spread, Liquidität, Regime) – und dass es keine Prognose ist", async () => {
    wrap(<TimeMachineCard {...props()} />);
    await done();
    const scope = await screen.findByTestId("tm-scope");
    expect(within(scope).getByTestId("tm-scope-missing")).toHaveTextContent(/Spread/);
    expect(within(scope).getByTestId("tm-scope-missing")).toHaveTextContent(/Liquidität/);
    expect(within(scope).getByTestId("tm-scope-missing")).toHaveTextContent(/regime/i);
    expect(within(scope).getByTestId("tm-scope-included")).toHaveTextContent(/Seed/);
    expect(scope).toHaveTextContent("keine Prognose");
  });

  it("nach einem Neustart (zweiter Store, dieselbe Datenbank) kommt dieselbe Simulation sofort zurück – ohne Rechnung; „Neu rechnen“ prüft die Zahlen", async () => {
    const first = wrap(<TimeMachineCard {...props()} />);
    await done();
    const id = (await screen.findByTestId("tm-sim-id")).textContent;
    const odds = screen.getByTestId("tm-p-target").textContent;
    await waitFor(async () => expect(await openStore().list()).toHaveLength(1));
    first.unmount();

    setSimulationsForTests(openStore()); // "Neustart": a new store over the same IndexedDB
    wrap(<TimeMachineCard {...props()} />);
    await done();
    // restored, not computed: no progress bar, the note says so, same id, same numbers
    expect(screen.queryByTestId("tm-busy")).toBeNull();
    expect(await screen.findByTestId("tm-sim-restored")).toHaveTextContent("nichts neu gerechnet");
    expect(screen.getByTestId("tm-sim-id").textContent).toBe(id);
    expect(screen.getByTestId("tm-p-target").textContent).toBe(odds);
    expect(screen.queryByTestId("tm-sim-check")).toBeNull();

    // „Neu rechnen“ computes again and compares: identical
    fireEvent.click(screen.getByTestId("tm-start"));
    const check = await screen.findByTestId("tm-sim-check", {}, { timeout: 30_000 });
    expect(check).toHaveAttribute("data-check", "same");
    expect(check).toHaveTextContent("identisch");
    expect(screen.queryByTestId("tm-sim-restored")).toBeNull();
  });

  it("ein anderer Preis ist eine andere Simulation (neue ID, es wird gerechnet); zurück zum alten Preis: die erste ist wieder da", async () => {
    wrap(<TimeMachineCard {...props()} />);
    await done();
    const id1 = (await screen.findByTestId("tm-sim-id")).textContent;
    cleanup();
    wrap(<TimeMachineCard {...props({ stop: latticePlan(3, 10).stop })} />);
    await done();
    const id2 = (await screen.findByTestId("tm-sim-id")).textContent;
    expect(id2).not.toBe(id1);
    await waitFor(async () => expect(await openStore().list()).toHaveLength(2));
    cleanup();
    wrap(<TimeMachineCard {...props()} />);
    await done();
    expect((await screen.findByTestId("tm-sim-id")).textContent).toBe(id1);
    expect(screen.getByTestId("tm-sim-restored")).toBeInTheDocument();
  });

  it("persist: false speichert nichts und sucht nichts", async () => {
    wrap(<TimeMachineCard {...props({ persist: false })} />);
    await done();
    expect(await screen.findByTestId("tm-sim-stored")).toHaveTextContent("nicht gespeichert");
    expect(await openStore().list()).toHaveLength(0);
  });

  it("ein Trade-Bezug wird mitgespeichert; das Trade-Detail-Stück zeigt die Simulation nach einem Neustart – für einen anderen Trade nichts", async () => {
    wrap(<TimeMachineCard {...props({ tradeId: "t_demo" })} />);
    await done();
    await waitFor(async () => expect((await openStore().forTrade("t_demo"))?.tradeId).toBe("t_demo"));
    cleanup();

    setSimulationsForTests(openStore());
    const { container, rerender } = wrap(<TradeSimulationBlock tradeId="t_demo" />);
    const block = await screen.findByTestId("trade-simulation");
    expect(block.getAttribute("data-sim-id")).toMatch(/^sim_/);
    expect(within(block).getByTestId("trade-simulation-verdict").textContent).not.toBe("");
    expect(within(block).getByTestId("trade-simulation-target").textContent).toMatch(/\d,\d %/);
    expect(within(block).getByTestId("trade-simulation-meta")).toHaveTextContent(/Seed 19 · zeitmaschine\/1 · 400 Läufe/);
    expect(within(block).getByTestId("trade-simulation-stored")).toHaveTextContent("keine Prognose");
    rerender(
      <MotionRoot>
        <TradeSimulationBlock tradeId="t_andere" />
      </MotionRoot>,
    );
    await waitFor(() => expect(container.querySelector('[data-testid="trade-simulation"]')).toBeNull());
  });
});

describe("Karte: alle Pfade", () => {
  it("„berechnet“ und „gezeichnet“ stehen getrennt im Titel; bis 2 000 Läufe wird alles gezeichnet", async () => {
    wrap(<TimeMachineCard {...props()} />);
    await done();
    fireEvent.click(await screen.findByRole("radio", { name: "Alle Pfade (Alpha)" }));
    const title = await screen.findByTestId("tm-paths-title", {}, { timeout: 30_000 });
    expect(title).toHaveTextContent("berechnet: 400 · gezeichnet: 400");
    expect(title).toHaveTextContent("alle berechneten Läufe");
    const box = screen.getByTestId("tm-paths");
    await waitFor(() => expect(box).toHaveAttribute("data-state", "done"), { timeout: 30_000 });
    expect(box).toHaveAttribute("data-engine", "main"); // no OffscreenCanvas in jsdom: the page draws, in slices
    expect(box).toHaveAttribute("data-computed", "400");
    expect(box).toHaveAttribute("data-drawn", "400");
    expect(Number(box.getAttribute("data-batches"))).toBeGreaterThanOrEqual(Math.ceil(400 / 16));
    expect(screen.queryByTestId("tm-paths-sample")).toBeNull();
    expect(screen.getByTestId("tm-paths-done")).toHaveTextContent(/Gezeichnet in \d+ ms/);
    // the labelled lines, the median and the SVG layer are there; the canvas itself is hidden from screen readers (the figure has a label)
    expect(box.querySelector('[data-line="stop"]')).not.toBeNull();
    expect(box.querySelector('[data-line="target"]')).not.toBeNull();
    expect(box.querySelector('[role="img"]')?.getAttribute("aria-label")).toMatch(/400 gezeichneten von 400 berechneten Läufen/);
    // back to the bands
    fireEvent.click(screen.getByRole("radio", { name: "Bänder" }));
    expect(await screen.findByTestId("tm-fan", {}, { timeout: 30_000 })).toBeInTheDocument();
  });

  it("über 2 000 Läufen: die Stichprobe ist beschriftet (jeder 2. Lauf), „Alle“ zeichnet alles; die Wahl bleibt", async () => {
    localStorage.setItem("tj2-tm-paths-mode", JSON.stringify("sample"));
    wrap(<TimeMachineCard {...props({ options: { ...defaultOptions("1d"), runs: 3000, horizon: 40, method: "single", vol: "history" } })} />);
    await done();
    fireEvent.click(await screen.findByRole("radio", { name: "Alle Pfade (Alpha)" }));
    const title = await screen.findByTestId("tm-paths-title", {}, { timeout: 30_000 });
    expect(title).toHaveTextContent("berechnet: 3.000 · gezeichnet: 1.500");
    expect(title).toHaveTextContent("jeder 2. Lauf");
    expect(screen.getByTestId("tm-paths-sample")).toHaveTextContent("Stichprobe: 1.500 von 3.000 berechneten Läufen");
    expect(screen.getByTestId("tm-paths")).toHaveAttribute("data-every", "2");
    fireEvent.click(screen.getByRole("radio", { name: "Alle 3.000" }));
    await waitFor(() => expect(screen.getByTestId("tm-paths-title")).toHaveTextContent("berechnet: 3.000 · gezeichnet: 3.000"));
    expect(screen.queryByTestId("tm-paths-sample")).toBeNull();
    expect(JSON.parse(localStorage.getItem("tj2-tm-paths-mode")!)).toBe("all");
  });

  it("eine wiederhergestellte Simulation hat keine Pfade: sie werden mit demselben Seed nachgerechnet – und mit den gespeicherten Zahlen verglichen", async () => {
    const first = wrap(<TimeMachineCard {...props()} />);
    await done();
    await waitFor(async () => expect(await openStore().list()).toHaveLength(1));
    first.unmount();
    setSimulationsForTests(openStore());
    wrap(<TimeMachineCard {...props()} />);
    await done();
    expect(await screen.findByTestId("tm-sim-restored")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: "Alle Pfade (Alpha)" }));
    // the paths come back by themselves (no click), the figures are compared with the saved ones
    await waitFor(() => expect(screen.getByTestId("tm-paths")).toHaveAttribute("data-state", "done"), { timeout: 30_000 });
    expect(screen.getByTestId("tm-paths-title")).toHaveTextContent("berechnet: 400 · gezeichnet: 400");
    const check = await screen.findByTestId("tm-sim-check");
    expect(check).toHaveAttribute("data-check", "same");
  });

  it("ein Browser ohne 2D-Canvas sagt es und verweist auf die Bänder", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    wrap(<TimeMachineCard {...props()} />);
    await done();
    fireEvent.click(await screen.findByRole("radio", { name: "Alle Pfade (Alpha)" }));
    expect(await screen.findByTestId("tm-paths-error", {}, { timeout: 30_000 })).toBeInTheDocument();
  });
});
