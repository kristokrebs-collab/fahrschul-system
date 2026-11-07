/**
 * F73 views: the builder of "Eigene Idee" (first choice, blocks, AND / OR, per-leaf timeframe with disabled options and their
 * reason, live validation, templates, drafts) and the diagnosis card under a run on REAL BTCUSDT 4h + 1D bars served through
 * the lab's own history loader.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, __setHistoryDeps, LaborView, startLab, useLabor } from "@/views/labor";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const NOW = H4_ROWS[H4_ROWS.length - 1]![0] * 1000 + 14_400_000 + 60_000;

function fixtureRest(calls: { interval: string }[]): BinanceRest {
  return {
    klines: vi.fn(async (_s: string, interval: string, p: { startTime?: number; limit?: number } = {}) => {
      calls.push({ interval });
      const src = interval === "4h" ? H4_ROWS : interval === "1d" ? D1_ROWS : [];
      const rows = src.filter((b) => b[0] * 1000 >= (p.startTime ?? 0)).slice(0, p.limit ?? 500);
      return { data: rows.map(([t, o, h, l, c]) => ({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 1, closed: true })), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
    }),
    fundingRate: vi.fn(async () => ({ data: [], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })),
  } as unknown as BinanceRest;
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

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

describe("Labor · Eigene Idee", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    __resetLabor();
    __setHistoryDeps(null);
  });
  afterEach(() => {
    __resetLabor();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("ist die erste und breiteste Wahl; die Vorlagen bleiben dahinter", async () => {
    renderLabor();
    const radios = within(screen.getByRole("radiogroup", { name: "Strategie" })).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("data-testid"))).toEqual(["labor-strategy-custom", "labor-strategy-box", "labor-strategy-mcb", "labor-strategy-rules"]);
    expect(screen.queryByTestId("labor-builder")).toBeNull();
    fireEvent.click(screen.getByTestId("labor-strategy-custom"));
    expect(useLabor.getState().cfg.strategy).toBe("custom");
    expect(await screen.findByTestId("labor-builder")).toBeInTheDocument();
    // the default idea in plain language
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("Long wenn RSI(14) unter 40 UND Schluss über EMA 50 [1D].");
    expect(screen.getByTestId("labor-check")).toHaveTextContent("Keine Fehler");
    expect(screen.getByTestId("labor-start")).toBeEnabled();
  });

  it("Bausteine hinzufügen und entfernen, UND / ODER, Parameter mit Grenzen – der Klartext folgt", async () => {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    fireEvent.click(screen.getByTestId("labor-add-cond"));
    fireEvent.click(await screen.findByTestId("labor-block-volume"));
    expect(screen.getAllByTestId("labor-leaf").map((l) => l.getAttribute("data-block"))).toEqual(["rsi", "maPrice", "volume"]);
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("Volumen über 2× dem Ø der letzten 20 Kerzen");
    // a number is clamped (RSI level 0 → 1) and shown in the text
    const level = screen.getByRole("textbox", { name: "RSI Niveau: Niveau" });
    fireEvent.change(level, { target: { value: "0" } });
    fireEvent.blur(level);
    expect(useLabor.getState().cfg.custom.long.children[0]).toMatchObject({ params: { level: 1 } });
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("RSI(14) unter 1");
    // OR instead of AND
    fireEvent.click(within(screen.getByTestId("labor-tree")).getAllByRole("radio", { name: "ODER" })[0]!);
    expect(useLabor.getState().cfg.custom.long.op).toBe("or");
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent(" ODER ");
    // remove the volume leaf again
    fireEvent.click(screen.getByRole("button", { name: /Bedingung entfernen: Volumen-Spitze/ }));
    expect(screen.getAllByTestId("labor-leaf")).toHaveLength(2);
  });

  it("Gruppen verschachteln: eine Gruppe im Baum, mit eigener ODER-Logik", () => {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    fireEvent.click(within(screen.getByTestId("labor-tree")).getByRole("button", { name: "+ Gruppe" }));
    expect(screen.getAllByTestId("labor-group")).toHaveLength(1);
    // an empty group is an error and blocks the run
    expect(screen.getByTestId("labor-check")).toHaveTextContent("leere Gruppe");
    expect(screen.getByTestId("labor-start")).toBeDisabled();
    expect(useLabor.getState().cfg.custom.long.children.at(-1)).toMatchObject({ type: "group", op: "or" });
  });

  it("Zeitebenen unter der Ausführung sind gesperrt – mit Begründung; die MCB-Leiter nur auf 1h / 4h", async () => {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    const leaf = screen.getAllByTestId("labor-leaf")[0]!;
    const tf = within(leaf).getByRole("radiogroup", { name: /Zeitebene: RSI Niveau/ });
    const locked = within(tf).getAllByRole("radio").filter((r) => (r as HTMLButtonElement).disabled);
    expect(locked.map((r) => r.textContent)).toEqual(["15m", "30m", "1h", "2h"]);
    expect(locked[0]!.getAttribute("title")).toMatch(/niedriger als die Ausführung \(4h\)/);
    expect(within(leaf).getByText(/Zeitebenen unter 4h sind gesperrt/)).toBeInTheDocument();
    // execution 15m: the ladder is offered but disabled, with its reason on the button
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Ausführung" })).getByRole("radio", { name: "15m" }));
    expect(useLabor.getState().cfg.custom.interval).toBe("15m");
    fireEvent.click(screen.getByTestId("labor-add-cond"));
    const ladder = await screen.findByTestId("labor-block-mcbLadder");
    expect(ladder).toBeDisabled();
    expect(ladder).toHaveTextContent(/Gesperrt: .*1h oder 4h/);
    // the 1D leaf stays allowed; changing a leaf's timeframe is remembered and shown in the text
    const first = screen.getAllByTestId("labor-leaf")[0]!;
    fireEvent.click(within(within(first).getByRole("radiogroup", { name: /Zeitebene: RSI Niveau/ })).getByRole("radio", { name: "4h" }));
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("RSI(14) unter 40 [4h]");
  });

  it("Vorlagen laden eine fertige Idee; Entwürfe: speichern, duplizieren, laden, löschen (bleiben im Browser)", async () => {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    fireEvent.click(screen.getByTestId("labor-template-mcb-discount"));
    expect(useLabor.getState().cfg.custom).toMatchObject({ name: "MCB-Punkt in der Discount-Zone", interval: "1h", sides: "both" });
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("Short wenn");
    // drafts
    fireEvent.click(screen.getByTestId("labor-draft-save"));
    await waitFor(() => expect(useLabor.getState().drafts).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem("tj2-labor-drafts")!)).toMatchObject({ v: 1, items: [{ name: "MCB-Punkt in der Discount-Zone" }] });
    const row = await screen.findByTestId("labor-draft");
    fireEvent.click(within(row).getByRole("button", { name: /Duplizieren: / }));
    await waitFor(() => expect(useLabor.getState().drafts.map((d) => d.name)).toEqual(["MCB-Punkt in der Discount-Zone (Kopie)", "MCB-Punkt in der Discount-Zone"]));
    // load the other one after changing the idea
    fireEvent.click(screen.getByTestId("labor-template-volume-breakout"));
    expect(useLabor.getState().cfg.custom.interval).toBe("1h");
    expect(useLabor.getState().cfg.custom.sides).toBe("long");
    fireEvent.click(within(screen.getAllByTestId("labor-draft")[1]!).getByRole("button", { name: /Laden: / }));
    expect(useLabor.getState().cfg.custom.sides).toBe("both");
    fireEvent.click(within(screen.getAllByTestId("labor-draft")[0]!).getByRole("button", { name: /Löschen: / }));
    await waitFor(() => expect(useLabor.getState().drafts).toHaveLength(1));
    // a reload reads them back, versioned; a draft with a foreign version is dropped
    localStorage.setItem("tj2-labor-drafts", JSON.stringify({ v: 1, items: [...JSON.parse(localStorage.getItem("tj2-labor-drafts")!).items, { id: "d9", name: "alt", savedAt: 1, config: { version: 7 } }] }));
    const { readDrafts } = await import("@/views/labor");
    expect(readDrafts().map((d) => d.name)).toEqual(["MCB-Punkt in der Discount-Zone"]);
  });

  it("Short aus Long spiegeln; Gegensignal-Ausstieg ist ohne beide Seiten gesperrt (mit Grund)", () => {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    const box = screen.getByRole("checkbox", { name: /Ausstieg bei neuem Gegensignal/ });
    expect(box).toBeDisabled();
    expect(screen.getByText(/Braucht Long- und Short-Regeln/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("labor-builder")).getByRole("radio", { name: "Beide" }));
    expect(screen.getByRole("checkbox", { name: /Ausstieg bei neuem Gegensignal/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: /Short-Regeln/ }));
    fireEvent.click(screen.getByTestId("labor-mirror"));
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("Short wenn RSI(14) über 60 UND Schluss unter EMA 50 [1D].");
  });

  it("ein Lauf auf echten 4h- und 1D-Kerzen: Diagnose mit Befunden, Trichter und Vergleich", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const calls: { interval: string }[] = [];
    __setHistoryDeps({ rest: () => fixtureRest(calls), proxy: () => null, store: () => null, now: () => NOW });
    const idea = sanitizeCustom({ ...defaultCustom(), name: "Test-Idee", long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } }, { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } }]) });
    useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "flat", custom: idea });
    renderLabor();
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-start"));
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 45_000 });
    // both intervals were loaded through the lab's own pager
    expect(new Set(calls.map((c) => c.interval))).toEqual(new Set(["4h", "1d"]));
    const st = useLabor.getState();
    expect(st.result?.strategy).toBe("custom");
    expect(st.result?.name).toBe("Test-Idee");
    expect(st.runs[0]?.name).toBe("Test-Idee");
    const diag = screen.getByTestId("labor-diagnosis");
    expect(diag).toHaveTextContent("Warum so schwach?");
    const rows = within(diag).getAllByTestId("labor-funnel-row");
    expect(rows[0]).toHaveTextContent("Kerzen im Zeitraum geprüft");
    expect(rows.some((r) => r.getAttribute("data-kind") === "leaf")).toBe(true);
    expect(rows[rows.length - 1]).toHaveTextContent("Ausgeführt und geschlossen");
    // every finding names a number; the comparison table has the base and the no-cost re-run
    for (const f of within(diag).queryAllByTestId("labor-finding")) expect(f.textContent).toMatch(/\d/);
    expect(within(diag).getByTestId("labor-compare-table")).toHaveTextContent("Ohne Kosten");
    expect(within(screen.getByTestId("labor-compare")).getByTestId("labor-run-card")).toHaveTextContent("Test-Idee");
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent("NEUEN Signal");
  }, 60_000);

  it("eine Idee mit Fehlern startet nicht (und sagt warum)", async () => {
    useLabor.getState().setCfg({ strategy: "custom", custom: sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", []) }) });
    renderLabor();
    expect(screen.getByTestId("labor-start")).toBeDisabled();
    await act(async () => {
      await startLab(DEFAULT_SIGNAL_CFG, NOW);
    });
    expect(useLabor.getState().status).toBe("error");
    expect(screen.getByTestId("labor-run")).toHaveTextContent("Die Idee hat noch Fehler");
  });
});
