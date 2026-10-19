/**
 * F06 / F14 / F15 / F64 views: the strategy library (search, filter, details, load as a DRAFT without starting anything), the
 * Pine card (script, honest gaps, copy, link) and the parameter grid under a run on REAL BTCUSDT 4h + 1D bars.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, __setHistoryDeps, LaborView, useLabor } from "@/views/labor";
import { __resetExtras } from "@/views/labor/extrasStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const NOW = H4_ROWS[H4_ROWS.length - 1]![0] * 1000 + 14_400_000 + 60_000;

function fixtureRest(): BinanceRest {
  return {
    klines: vi.fn(async (_s: string, interval: string, p: { startTime?: number; limit?: number } = {}) => {
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

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetLabor();
  __resetExtras();
  __setHistoryDeps(null);
});
afterEach(() => {
  __resetLabor();
  __resetExtras();
  __setHistoryDeps(null);
  vi.useRealTimers();
});

describe("Labor · Strategie-Bibliothek", () => {
  async function openLibrary() {
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    fireEvent.click(await screen.findByTestId("labor-lib-open"));
    return screen.findByTestId("labor-lib", {}, { timeout: 15_000 });
  }

  it("öffnet als eigener Chunk, zeigt über 25 Karten und sagt ehrlich, dass sie keine Ergebnisse tragen", async () => {
    const lib = await openLibrary();
    expect(within(lib).getAllByTestId("labor-lib-card").length).toBeGreaterThanOrEqual(25);
    expect(within(lib).getByTestId("labor-lib-honest")).toHaveTextContent("Bekannt heißt nicht wirksam");
    expect(within(lib).getByTestId("labor-lib-honest")).toHaveTextContent("keine Ergebnisse und keine Erfolgsaussagen");
    expect(within(lib).getByTestId("labor-lib-count")).toHaveTextContent(/\d+ Strategien/);
    // nothing was started or changed by opening it
    expect(useLabor.getState().status).toBe("idle");
  }, 40_000);

  it("Suche und Typ-Filter; keine Treffer sagen es und nennen den Ausweg", async () => {
    const lib = await openLibrary();
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "turtle" } });
    expect(within(lib).getAllByTestId("labor-lib-card").map((c) => c.getAttribute("data-card"))).toEqual(["turtle-20", "turtle-55"]);
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "" } });
    fireEvent.click(within(lib).getByRole("radio", { name: "Volatilität" }));
    const kinds = within(lib).getAllByTestId("labor-lib-card").map((c) => c.getAttribute("data-kind"));
    expect(kinds.length).toBeGreaterThan(1);
    expect(new Set(kinds)).toEqual(new Set(["volatility"]));
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "zzzz" } });
    expect(within(lib).getByTestId("labor-lib-empty")).toHaveTextContent("Keine Strategie passt zu „zzzz“");
  }, 40_000);

  it("Details: Herkunft, Marktphase, Schwächen und typische Werte in drei Einstellungen mit Erklärung", async () => {
    const lib = await openLibrary();
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "Bollinger-Reversion" } });
    const card = within(lib).getByTestId("labor-lib-card");
    expect(card).toHaveAttribute("data-card", "bollinger-reversion");
    expect(within(card).queryByTestId("labor-lib-details")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /Details zeigen/ }));
    const details = await within(card).findByTestId("labor-lib-details");
    expect(details).toHaveTextContent("John Bollinger");
    expect(details).toHaveTextContent("Gedacht für");
    expect(details).toHaveTextContent("Typische Schwächen");
    const mult = details.querySelector('[data-param="mult"]')!;
    expect(mult.textContent).toContain("Breite der Bänder");
    expect(Array.from(mult.querySelectorAll("dd")).map((d) => d.textContent)).toEqual(["2,5 σ", "2 σ", "1,5 σ"]);
    // no claim about results anywhere on the card
    expect(card.textContent).not.toMatch(/Gewinnrate|garantiert|profitabel/i);
  }, 40_000);

  it("Klick lädt die Vorlage als Entwurf in „Eigene Idee“ – ohne einen Lauf zu starten", async () => {
    const lib = await openLibrary();
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "Supertrend" } });
    fireEvent.click(within(lib).getByTestId("labor-lib-load-supertrend-aggressive"));
    const cfg = useLabor.getState().cfg;
    expect(cfg.strategy).toBe("custom");
    expect(cfg.custom.name).toBe("Supertrend-Wechsel");
    expect(cfg.custom.interval).toBe("4h");
    const leaf = cfg.custom.long.children[0]!;
    expect(leaf).toMatchObject({ block: "supertrend", params: { atrLen: 7, factor: 2, mode: "flipUp" } });
    expect(useLabor.getState().status).toBe("idle");
    expect(useLabor.getState().result).toBeNull();
    // the builder shows the draft in plain language; the library closes
    await waitFor(() => expect(screen.queryByTestId("labor-lib")).toBeNull());
    expect(screen.getByTestId("labor-idea-summary")).toHaveTextContent("Supertrend(7, 2): Wechsel auf Aufwärtstrend");
  }, 40_000);

  it("Funding-Karte: sagt, dass sie die Funding-Historie braucht, und der Baustein bleibt dann gesperrt", async () => {
    useLabor.getState().setCfg({ strategy: "custom", funding: "flat" });
    renderLabor();
    fireEvent.click(await screen.findByTestId("labor-lib-open"));
    const lib = await screen.findByTestId("labor-lib", {}, { timeout: 15_000 });
    fireEvent.change(within(lib).getByTestId("labor-lib-search"), { target: { value: "Funding" } });
    const card = within(lib).getByTestId("labor-lib-card");
    expect(card).toHaveTextContent("braucht Funding-Historie");
    expect(card).toHaveTextContent("bleibt gesperrt");
    fireEvent.click(within(card).getByTestId("labor-lib-load-funding-contrarian-standard"));
    await waitFor(() => expect(screen.queryByTestId("labor-lib")).toBeNull());
    // the check names the lock reason and the run cannot start
    expect(screen.getByTestId("labor-check")).toHaveTextContent("braucht die echte Funding-Historie");
    expect(screen.getByTestId("labor-start")).toBeDisabled();
  }, 40_000);

  it("Funding-Baustein in der Auswahl: gesperrt mit Grund bei flachem Funding, frei bei Historie", async () => {
    useLabor.getState().setCfg({ strategy: "custom", funding: "flat" });
    renderLabor();
    fireEvent.click(await screen.findByTestId("labor-add-cond"));
    const block = await screen.findByTestId("labor-block-funding");
    expect(block).toBeDisabled();
    expect(block).toHaveTextContent("Gesperrt: Funding-Extrem braucht die echte Funding-Historie");
    act(() => useLabor.getState().setCfg({ funding: "history" }));
    expect(await screen.findByTestId("labor-block-funding")).toBeEnabled();
  }, 40_000);
});

describe("Labor · Pine → TradingView", () => {
  it("Skript erzeugen: lesbarer Text, Kopieren, Datei, Link auf den Chart; kein Konto", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useLabor.getState().setCfg({ strategy: "custom" });
    renderLabor();
    const card = await screen.findByTestId("labor-pine", {}, { timeout: 15_000 });
    expect(within(card).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(within(card).getByTestId("labor-pine-noaccess")).toHaveTextContent("Kein Login und kein Zugriff auf dein TradingView-Konto");
    expect(within(card).queryByTestId("labor-pine-code")).toBeNull();
    fireEvent.click(within(card).getByTestId("labor-pine-make"));
    const code = (await within(card).findByTestId("labor-pine-code")) as HTMLTextAreaElement;
    expect(code.value.startsWith("//@version=6")).toBe(true);
    expect(code.value).toContain("ta.rsi(close");
    expect(code.value).toContain("Ergebnisse in TradingView weichen vom Labor ab");
    expect(within(card).getByTestId("labor-pine-summary")).toHaveTextContent("Alle 2 Bausteine sind übersetzt");
    expect(within(card).queryByTestId("labor-pine-gaps")).toBeNull();
    // the link opens the chart of the same market, nothing else
    const link = within(card).getByTestId("labor-pine-open") as HTMLAnchorElement;
    expect(link.href).toBe("https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT.P&interval=240");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(within(card).getByTestId("labor-pine-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code.value));
    // a tick size turns the lab's slippage into TradingView ticks
    fireEvent.change(within(card).getByTestId("labor-pine-tick"), { target: { value: "0,1" } });
    expect(code.value).toContain("slippage = 0"); // no reference price before a run
    // notes open on demand
    fireEvent.click(within(card).getByTestId("labor-pine-notes-toggle"));
    expect(await within(card).findByTestId("labor-pine-notes")).toHaveTextContent("Reihenfolge in einer Kerze");
  }, 40_000);

  it("nicht übersetzbare Bausteine stehen namentlich da – das Skript lässt sie nicht still weg", async () => {
    const idea = sanitizeCustom({ ...defaultCustom(), long: newGroup("g1", "and", [newLeaf("n1", "rsi"), newLeaf("n2", "zone")]) });
    useLabor.getState().setCfg({ strategy: "custom", custom: idea });
    renderLabor();
    const card = await screen.findByTestId("labor-pine", {}, { timeout: 15_000 });
    fireEvent.click(within(card).getByTestId("labor-pine-make"));
    const gaps = await within(card).findByTestId("labor-pine-gaps");
    expect(gaps).toHaveTextContent("Premium / Discount");
    expect(gaps).toHaveTextContent("Standard aus");
    expect(within(card).getByTestId("labor-pine-summary")).toHaveTextContent("1 von 2 Bausteinen sind übersetzt");
    const code = within(card).getByTestId("labor-pine-code") as HTMLTextAreaElement;
    expect(code.value).toContain("allow_n2 = input.bool(false");
  }, 40_000);

  it("ohne „Eigene Idee“ erklärt die Karte, warum es keinen Export gibt; eine Idee mit Fehlern wird nicht exportiert", async () => {
    renderLabor();
    const card = await screen.findByTestId("labor-pine", {}, { timeout: 15_000 });
    expect(within(card).getByTestId("labor-pine-notcustom")).toHaveTextContent("Den Pine-Export gibt es für „Eigene Idee“");
    expect(within(card).queryByTestId("labor-pine-make")).toBeNull();
    act(() => useLabor.getState().setCfg({ strategy: "custom", custom: sanitizeCustom({ ...defaultCustom(), long: newGroup("g1") }) }));
    expect(await within(card).findByTestId("labor-pine-errors")).toHaveTextContent("noch Fehler");
    expect(within(card).queryByTestId("labor-pine-make")).toBeNull();
  }, 40_000);

  it("der Rückweg bleibt: der Vergleichs-Export liegt direkt darunter", async () => {
    renderLabor();
    expect(await screen.findByTestId("labor-tv-compare", {}, { timeout: 15_000 })).toBeInTheDocument();
    expect(screen.getByTestId("labor-pine-steps")).toHaveTextContent("Export hier vergleichen");
  }, 40_000);
});

describe("Labor · Parameter-Raster", () => {
  async function finishedRun(): Promise<void> {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
    const idea = sanitizeCustom({ ...defaultCustom(), name: "Raster-Idee", long: newGroup("g1", "and", [{ ...newLeaf("n1", "rsi"), params: { len: 14, mode: "below", level: 45, within: 1 } }, { ...newLeaf("n2", "maPrice", "1d"), params: { type: "sma", len: 5, mode: "above", within: 1 } }]) });
    useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "flat", custom: idea });
    renderLabor();
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-start"));
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 45_000 });
  }

  it("zugeklappt bis zum Öffnen; ein Klick rechnet 3 × 3 um die gewählten Zahlen – die Mitte ist der Lauf", async () => {
    await finishedRun();
    const toggle = await screen.findByTestId("labor-extra-toggle-params", {}, { timeout: 15_000 });
    expect(screen.getByTestId("labor-extra-params")).toHaveAttribute("data-open", "false");
    fireEvent.click(toggle);
    const grid = await screen.findByTestId("labor-grid", {}, { timeout: 15_000 });
    expect(grid).toHaveTextContent("nur zwei Zahlen der Regeln um ±25 % verschoben");
    expect(within(grid).queryByTestId("labor-grid-table")).toBeNull();
    await act(async () => {
      fireEvent.click(within(grid).getByTestId("labor-grid-run"));
    });
    await waitFor(() => expect(within(grid).getByTestId("labor-grid-runbar")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    const cells = within(grid).getAllByTestId("labor-grid-cell");
    expect(cells).toHaveLength(9);
    const base = cells.filter((c) => c.getAttribute("data-base") === "true");
    expect(base).toHaveLength(1);
    expect(base[0]).toHaveAttribute("data-n", String(useLabor.getState().result!.stats.n));
    expect(base[0]).toHaveTextContent("Deine Einstellung");
    expect(within(grid).getByTestId("labor-grid-summary")).toHaveTextContent(/In \d+ von 9 Kombinationen/);
    expect(grid).toHaveTextContent("Neun Zellen sind neun Versuche");
    expect(grid).toHaveTextContent("nicht den besten Wert");
  }, 120_000);

  it("für die Vorlagen-Strategien erklärt die Karte, warum es das Raster dort nicht gibt", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
    useLabor.getState().setCfg({ strategy: "rules", period: "6m", funding: "flat" });
    renderLabor();
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-start"));
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 60_000 });
    fireEvent.click(await screen.findByTestId("labor-extra-toggle-params", {}, { timeout: 15_000 }));
    expect(await screen.findByTestId("labor-grid-notcustom", {}, { timeout: 15_000 })).toHaveTextContent("Für die Vorlagen zeigt „Robustheit“");
  }, 120_000);
});
