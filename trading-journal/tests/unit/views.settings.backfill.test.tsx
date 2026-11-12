/**
 * „Börsenhistorie nachladen“ section of the Datenarchiv card (F26/F07): what it says before the click (what is loaded, that it
 * is stored apart and labelled, the 30-day limit, no server), the preview that follows the choice, a run from the click to the
 * result with the loaded rows in the overview marked „nachgeladen“, progress and cancel, a failure with its reason, and the
 * pure texts. The exchange is a fake (the harness), the pause between requests is skipped, the clock is fixed (Date only).
 */
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKFILL_SERIES_ORDER, planBackfill, type BackfillRun } from "@/domain/archive";
import { __resetBackfillLog, getBackfillLog } from "@/market/archive/backfillLog";
import { __resetBackfill } from "@/market/archive/backfillStore";
import { openArchiveDb } from "@/market/archive/db";
import { __resetArchiveStore } from "@/market/archive/store";
import { ddmmHHmm } from "@/market/format";
import { ArchiveCard } from "@/views/settings/ArchiveCard";
import { BACKFILL_STRINGS as S, DAYS_LABEL, previewText, problemLines, progressFraction, progressText, reasonText, resultText, runSummary } from "@/views/settings/backfillModel";
import { host, net, type Net } from "./archive.backfill.harness";

const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock("@/market/archive/backfill", async (orig) => {
  const m = await orig<typeof import("@/market/archive/backfill")>();
  return {
    ...m,
    // the real route and requests, but no pause between them and no storage estimate; a test can hold the run at the pause
    defaultBackfillDeps: (db: Parameters<typeof m.defaultBackfillDeps>[0], signal?: AbortSignal) => ({ ...m.defaultBackfillDeps(db, signal), sleep: async () => gate.wait ?? undefined, estimate: async () => null }),
  };
});

const MIN = 60_000;
/** 2026-10-26 12:03:00 UTC */
const NOW = Date.UTC(2026, 9, 26, 12, 3, 0);
let exchange: Net;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  __resetArchiveStore();
  __resetBackfill();
  __resetBackfillLog();
  gate.wait = null;
  exchange = net();
  const h = host(exchange, "direct", NOW);
  vi.stubGlobal("fetch", (input: string) => h(String(input)));
  const db = await openArchiveDb();
  await db.deleteAll();
  db.close();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const run = (over: Partial<BackfillRun> = {}): BackfillRun => ({ t: NOW, end: "done", days: 7, from: NOW - 7 * 24 * 60 * MIN, to: NOW, route: "direct", symbols: ["BTCUSDT"], points: 12_345, res: { BTCUSDT: Object.fromEntries(BACKFILL_SERIES_ORDER.map((s) => [s, "ok"])) }, ...over });

describe("pure texts", () => {
  it("reasons and results in German", () => {
    expect(reasonText("blocked_451")).toBe("Binance sperrt den Standort (451)");
    expect(reasonText("skipped")).toBe("nicht abgefragt");
    expect(reasonText("cancelled")).toBe("abgebrochen");
    expect(reasonText("weird")).toBe("weird");
    expect(resultText("ok")).toBe("vollständig");
    expect(resultText("partial:network")).toBe("teilweise – Netzwerk- oder CORS-Fehler");
    expect(resultText("rate_limited")).toBe("Binance bremst (429/418/403)");
    expect(DAYS_LABEL(7)).toBe("7 Tage");
    expect(DAYS_LABEL(30)).toBe("bis 30 Tage");
  });

  it("the preview names requests, symbols, entries, size, time and the range", () => {
    const p = planBackfill(["BTCUSDT", "ETHUSDT"], 7, NOW);
    const t = previewText(p);
    expect(t).toContain("46 Abrufe für 2 Symbole (23 je Symbol)");
    expect(t).toContain("rund 20.000 Einträge");
    expect(t).toContain("ca. 2,2 MB (geschätzt)");
    expect(t).toContain("grob 28 Sekunden");
    expect(previewText(planBackfill([], 7, NOW))).toBe(S.none);
    expect(previewText(planBackfill(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"], 30, NOW))).toContain("grob 4 Minuten");
  });

  it("progress line and fraction; the problem lines list only what is not complete", () => {
    expect(progressText(null)).toBe(S.starting);
    expect(progressFraction(null)).toBe(0);
    const p = { state: "running" as const, requestsDone: 5, requestsTotal: 23, symbol: "BTCUSDT", series: "oiHist" as const, points: 1234, route: "proxy" as const, res: {}, stopped: null };
    expect(progressText(p)).toBe("BTCUSDT · Open Interest · 5 von 23 Abrufen · 1.234 Einträge gespeichert · über den EU-Proxy der App");
    expect(progressFraction(p)).toBeCloseTo(5 / 23, 9);
    expect(problemLines(run().res)).toEqual([]);
    expect(problemLines({ BTCUSDT: { oiHist: "partial:network", markHist: "ok", fundingHist: "blocked_451" } })).toEqual([
      { symbol: "BTCUSDT", text: "Funding: Binance sperrt den Standort (451) · Open Interest: teilweise – Netzwerk- oder CORS-Fehler · Long/Short alle Konten: nicht abgefragt · Long/Short Top-Trader-Positionen: nicht abgefragt · Long/Short Top-Trader-Konten: nicht abgefragt" },
    ]);
    expect(runSummary(run({ end: "cancelled" }))).toMatch(/1 Symbol · .+ bis .+ · 12\.345 Einträge · direkt von Binance · abgebrochen$/);
  });
});

describe("the section before a click", () => {
  it("says what is loaded, that it is stored apart and labelled, the 30-day limit and that nothing is uploaded", async () => {
    render(<ArchiveCard />);
    expect(screen.getByTestId("backfill-lead")).toHaveTextContent("Open Interest und die drei Long/Short-Verhältnisse in 5-Minuten-Schritten");
    expect(screen.getByTestId("backfill-lead")).toHaveTextContent("auf deinen Klick");
    expect(screen.getByTestId("backfill-separate")).toHaveTextContent("als „nachgeladen“ gekennzeichnet – nie vermischt, nie geglättet");
    expect(screen.getByTestId("backfill-separate")).toHaveTextContent("bleibt eine Lücke");
    expect(screen.getByTestId("backfill-window")).toHaveTextContent("nur etwa 30 Tage");
    expect(screen.getByTestId("backfill-noserver")).toHaveTextContent("Es wird nichts hochgeladen");
    expect(screen.getByTestId("archive-limit")).toHaveTextContent("Börsenhistorie nachladen");
    expect(screen.getByTestId("backfill-nolog")).toHaveTextContent(S.noLog);
    // the card's closing sentence (Rohdaten, keine Prognose, keine Beratung) covers the section
    expect(screen.getByTestId("settings-archive-card")).toHaveTextContent("Keine professionelle Finanzberatung.");
    // it works with the collector switched off (the default)
    expect(screen.getByRole("switch", { name: "Archiv sammeln" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("backfill-start")).toBeEnabled();
  });

  it("the preview follows the span and the symbols; at least one symbol is needed", async () => {
    render(<ArchiveCard />);
    const sec = within(screen.getByTestId("archive-backfill"));
    const symbols = sec.getAllByRole("button", { pressed: true }).map((b) => b.textContent);
    expect(symbols).toContain("BTCUSDT");
    const full = screen.getByTestId("backfill-preview").textContent!;
    expect(full).toContain(`${planBackfill(symbols as string[], 30, NOW).requests.toLocaleString("de-DE")} Abrufe`);
    fireEvent.click(sec.getByRole("radio", { name: "7 Tage" }));
    expect(screen.getByTestId("backfill-preview").textContent).toContain(`${planBackfill(symbols as string[], 7, NOW).requests.toLocaleString("de-DE")} Abrufe`);
    // taking every symbol away: nothing to load
    for (const s of symbols) fireEvent.click(screen.getByTestId(`backfill-symbol-${s}`));
    expect(screen.getByTestId("backfill-preview")).toHaveTextContent(S.none);
    expect(screen.getByTestId("backfill-start")).toBeDisabled();
  });
});

describe("a run", () => {
  it("from the click to the result: the loaded rows appear marked „nachgeladen“, the log remembers the run, the collected data is untouched", async () => {
    const db = await openArchiveDb();
    await db.putPoints([{ series: "oi", symbol: "BTCUSDT", t: NOW - 10 * MIN, d: { oi: 777 } }]);
    db.close();
    render(<ArchiveCard />);
    const sec = within(screen.getByTestId("archive-backfill"));
    fireEvent.click(sec.getByRole("radio", { name: "7 Tage" }));
    // only BTCUSDT
    for (const b of sec.getAllByRole("button", { pressed: true })) if (b.textContent !== "BTCUSDT") fireEvent.click(b);
    await act(async () => {
      fireEvent.click(screen.getByTestId("backfill-start"));
    });
    const result = await screen.findByTestId("backfill-result", {}, { timeout: 20_000 });
    expect(result).toHaveAttribute("data-state", "done");
    expect(result).toHaveTextContent(S.doneText);
    expect(result).toHaveTextContent("23 von 23 Abrufen");
    expect(screen.queryByTestId("backfill-problems")).not.toBeInTheDocument();
    expect(exchange.calls).toHaveLength(23);
    // the overview: the collected oi row and the six loaded rows, each loaded one marked
    await waitFor(() => expect(screen.getAllByTestId("archive-row")).toHaveLength(7), { timeout: 20_000 });
    const rows = screen.getAllByTestId("archive-row");
    const loaded = rows.filter((r) => r.getAttribute("data-kind") === "backfill");
    expect(loaded).toHaveLength(6);
    for (const r of loaded) expect(within(r).getByTestId("archive-row-badge")).toHaveTextContent("nachgeladen");
    const collected = rows.find((r) => r.getAttribute("data-series") === "oi")!;
    expect(within(collected).queryByTestId("archive-row-badge")).not.toBeInTheDocument();
    expect(collected).toHaveTextContent("1 Eintrag");
    expect(screen.getByTestId("archive-loaded-total")).toHaveTextContent("Davon nachgeladen: 10.100 Einträge");
    expect(screen.getByTestId("archive-loaded-total")).toHaveTextContent("nicht mit dem Gesammelten vermischt");
    // the log
    expect(screen.getByTestId("backfill-last")).toHaveTextContent(`1 Symbol · ${ddmmHHmm(NOW - 7 * 24 * 60 * MIN + 2 * MIN)} bis ${ddmmHHmm(NOW - 3 * MIN)} · 10.100 Einträge · direkt von Binance`);
    expect(getBackfillLog()).toHaveLength(1);
    // a loaded row has no gap here (the fake exchange answered every step)
    await waitFor(() => expect(within(loaded[0]!).getByTestId("archive-gap-summary")).toHaveTextContent("keine Lücke"));
  }, 60_000);

  it("shows the progress while it runs and cancels on request: what was stored stays, the rest is named as not asked", async () => {
    let release: () => void = () => undefined;
    gate.wait = new Promise<void>((r) => (release = r));
    render(<ArchiveCard />);
    const sec = within(screen.getByTestId("archive-backfill"));
    fireEvent.click(sec.getByRole("radio", { name: "7 Tage" }));
    for (const b of sec.getAllByRole("button", { pressed: true })) if (b.textContent !== "BTCUSDT") fireEvent.click(b);
    await act(async () => {
      fireEvent.click(screen.getByTestId("backfill-start"));
    });
    const bar = await screen.findByTestId("backfill-progress");
    expect(bar).toHaveAttribute("role", "progressbar");
    await waitFor(() => expect(screen.getByTestId("backfill-progress-text")).toHaveTextContent("BTCUSDT · Funding · 1 von 23 Abrufen"));
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(screen.queryByTestId("backfill-start")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("backfill-cancel"));
    expect(screen.getByTestId("backfill-cancel")).toBeDisabled();
    release();
    const result = await screen.findByTestId("backfill-result", {}, { timeout: 20_000 });
    expect(result).toHaveAttribute("data-state", "cancelled");
    expect(result).toHaveTextContent(S.cancelledText);
    expect(screen.getByTestId("backfill-problems")).toHaveTextContent("Markpreis: nicht abgefragt");
    expect(screen.getByTestId("backfill-problems")).toHaveTextContent("Open Interest: nicht abgefragt");
    // the one request that came before the cancel is stored (21 funding settlements)
    await waitFor(() => expect(screen.getAllByTestId("archive-row")).toHaveLength(1), { timeout: 20_000 });
    expect(screen.getByTestId("archive-row")).toHaveAttribute("data-series", "fundingHist");
    expect(screen.getByTestId("backfill-last")).toHaveTextContent("abgebrochen");
    expect(screen.getByTestId("backfill-start")).toBeEnabled();
  }, 60_000);

  it("a blocked exchange: the reason is said per dataset, nothing is stored, the run stops early", async () => {
    exchange.all = 451;
    render(<ArchiveCard />);
    const sec = within(screen.getByTestId("archive-backfill"));
    fireEvent.click(sec.getByRole("radio", { name: "7 Tage" }));
    for (const b of sec.getAllByRole("button", { pressed: true })) if (b.textContent !== "BTCUSDT") fireEvent.click(b);
    await act(async () => {
      fireEvent.click(screen.getByTestId("backfill-start"));
    });
    const result = await screen.findByTestId("backfill-result", {}, { timeout: 20_000 });
    expect(result).toHaveAttribute("data-state", "failed");
    expect(result).toHaveTextContent("Binance ist von hier aus nicht erreichbar");
    expect(screen.getByTestId("backfill-problems")).toHaveTextContent("Funding: Binance sperrt den Standort (451)");
    expect(screen.queryAllByTestId("archive-row")).toHaveLength(0);
  }, 60_000);

  it("the log can be cleared", async () => {
    render(<ArchiveCard />);
    const sec = within(screen.getByTestId("archive-backfill"));
    fireEvent.click(sec.getByRole("radio", { name: "7 Tage" }));
    for (const b of sec.getAllByRole("button", { pressed: true })) if (b.textContent !== "BTCUSDT") fireEvent.click(b);
    exchange.all = 451;
    await act(async () => {
      fireEvent.click(screen.getByTestId("backfill-start"));
    });
    await screen.findByTestId("backfill-result", {}, { timeout: 20_000 });
    fireEvent.click(await screen.findByTestId("backfill-clear-log"));
    await waitFor(() => expect(screen.getByTestId("backfill-nolog")).toBeInTheDocument());
    expect(getBackfillLog()).toEqual([]);
  }, 60_000);
});
