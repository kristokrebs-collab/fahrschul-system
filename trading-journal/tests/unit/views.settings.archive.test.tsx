/**
 * „Datenarchiv“ card (F26): off by default with the honest sentences, the switch writes the device-local configuration,
 * the overview of a seeded store (count, range, gaps with their reason), export of one row, deletion of one row and of
 * everything, and the unavailable state.
 */
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivePoint, TickRecord } from "@/domain/archive";
import { openArchiveDb } from "@/market/archive/db";
import { __resetArchiveStore, getArchiveCfg, getArchiveStatus, patchArchiveStatus } from "@/market/archive/store";
import { ddmmHHmm } from "@/market/format";
import { ArchiveCard, failureText, statusText } from "@/views/settings/ArchiveCard";
import { ARCHIVE_STRINGS as S, bytesText, durationText, gapSummary } from "@/views/settings/archiveModel";

const dl = vi.hoisted(() => ({ calls: [] as Array<{ name: string; data: string; mime?: string }> }));
vi.mock("@/store/download", () => ({
  download: async (name: string, data: string, mime?: string) => {
    dl.calls.push({ name, data, mime });
    return true;
  },
  canDownload: () => true,
  DOWNLOAD_UNAVAILABLE: "x",
}));

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 2, 0, 0);
const prem = (t: number): ArchivePoint => ({ series: "premium", symbol: "BTCUSDT", t, d: { mark: 80000, index: 80001, rate: 0.0001, next: t + 8 * 3_600_000 } });
const tick = (t: number): TickRecord => ({ t, iv: 10, route: "direct", res: { BTCUSDT: "ok" }, states: false });

async function seed(): Promise<void> {
  const db = await openArchiveDb();
  await db.deleteAll();
  // premium at 0, 10 and 190 minutes: the tick log has ticks at 0, 10 and 190 only → a 3 h gap in which no tick ran
  await db.putPoints([prem(T0), prem(T0 + 10 * MIN), prem(T0 + 190 * MIN), { series: "oi", symbol: "BTCUSDT", t: T0, d: { oi: 1 } }, { series: "oi", symbol: "ETHUSDT", t: T0, d: { oi: 2 } }]);
  for (const m of [0, 10, 190]) await db.putTick(tick(T0 + m * MIN));
  db.close();
}

beforeEach(async () => {
  localStorage.clear();
  __resetArchiveStore();
  dl.calls.length = 0;
  const db = await openArchiveDb();
  await db.deleteAll();
  db.close();
});
afterEach(() => vi.unstubAllGlobals());

describe("pure texts", () => {
  it("durations, sizes and the gap summary", () => {
    expect(durationText(35 * MIN)).toBe("35 min");
    expect(durationText(310 * MIN)).toBe("5 h 10 min");
    expect(durationText(120 * MIN)).toBe("2 h");
    expect(durationText((2 * 24 + 3) * 60 * MIN)).toBe("2 Tage 3 h");
    expect(bytesText(412_000)).toBe("412 KB");
    expect(bytesText(1_340_000)).toBe("1,3 MB");
    expect(gapSummary(null)).toBe(S.gapsChecking);
    expect(gapSummary([])).toBe(S.gapsNone);
    expect(gapSummary([{ from: T0, to: T0 + 180 * MIN, cause: "app", detail: null, ticks: 0 }])).toBe("1 Lücke, zusammen 3 h");
  });

  it("status line: off, running with the times and the route, the reasons of a failed tick", () => {
    const cfg = { on: false, everyMin: 10 };
    const base = { ...getArchiveStatus(), state: "idle" as const, lastTickAt: T0, nextTickAt: T0 + 10 * MIN, route: "proxy" as const };
    expect(statusText(cfg, base)).toBe(S.statusOff);
    expect(statusText({ ...cfg, on: true }, base)).toBe(`Läuft · letzter Abruf ${ddmmHHmm(T0)} · nächster ${ddmmHHmm(T0 + 10 * MIN)} · ${S.viaProxy}`);
    expect(statusText({ ...cfg, on: true }, { ...base, state: "quota" })).toBe(S.quota);
    expect(failureText(null)).toBeNull();
    expect(failureText({ BTCUSDT: "ok" })).toBeNull();
    expect(failureText({ BTCUSDT: "blocked_451", ETHUSDT: "partial:network" })).toBe("BTCUSDT: Binance sperrt den Standort (451) · ETHUSDT: teilweise – Netzwerk- oder CORS-Fehler");
  });
});

describe("ArchiveCard", () => {
  it("is off by default and says what is stored, that nothing leaves the device, and that gaps are never filled", async () => {
    render(<ArchiveCard />);
    expect(getArchiveCfg().on).toBe(false);
    expect(screen.getByRole("switch", { name: S.switch })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("archive-status")).toHaveTextContent(S.statusOff);
    expect(screen.getByTestId("archive-what")).toHaveTextContent("Funding-Rate");
    expect(screen.getByTestId("archive-local")).toHaveTextContent("Nichts verlässt dein Gerät");
    expect(screen.getByTestId("archive-local")).toHaveTextContent("kein Teil von Backup oder Cloud-Sync");
    expect(screen.getByTestId("archive-limit")).toHaveTextContent("Kein Server-Archiv");
    expect(screen.getByTestId("archive-limit")).toHaveTextContent("nie gefüllt oder geschätzt");
    expect(screen.queryByTestId("archive-options")).not.toBeInTheDocument();
    expect(await screen.findByTestId("archive-empty")).toBeInTheDocument();
    expect(screen.getByText(/Keine professionelle Finanzberatung/)).toBeInTheDocument();
  });

  it("the switch writes the device-local configuration and shows the choices", async () => {
    render(<ArchiveCard />);
    fireEvent.click(screen.getByRole("switch", { name: S.switch }));
    expect(getArchiveCfg().on).toBe(true);
    expect(JSON.parse(localStorage.getItem("tj2-archive-cfg")!)).toMatchObject({ v: 1, on: true, everyMin: 10 });
    expect(await screen.findByTestId("archive-options")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.switch })).toHaveAttribute("aria-checked", "true");
    // the symbols: the Markt symbol and the watchlist, the automatic choice pressed
    const btc = screen.getByTestId("archive-symbol-BTCUSDT");
    expect(btc).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btc);
    expect(getArchiveCfg().picked).not.toContain("BTCUSDT");
    expect(screen.getByTestId("archive-symbol-BTCUSDT")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a failed tick with its reason", async () => {
    render(<ArchiveCard />);
    fireEvent.click(screen.getByRole("switch", { name: S.switch }));
    act(() => patchArchiveStatus({ state: "idle", lastTickAt: T0, lastRes: { BTCUSDT: "blocked_451" }, route: "direct" }));
    expect(await screen.findByTestId("archive-failures")).toHaveTextContent("BTCUSDT: Binance sperrt den Standort (451)");
  });

  it("lists what is stored: per symbol and series count, range and the gap with its reason", async () => {
    await seed();
    render(<ArchiveCard />);
    const rows = await screen.findAllByTestId("archive-row");
    expect(rows).toHaveLength(3);
    expect(screen.getAllByTestId("archive-group").map((g) => g.getAttribute("data-symbol"))).toEqual(["BTCUSDT", "ETHUSDT"]);
    const totals = screen.getByTestId("archive-totals");
    expect(totals).toHaveTextContent("5 Einträge");
    expect(totals).toHaveTextContent(`${ddmmHHmm(T0)} bis ${ddmmHHmm(T0 + 190 * MIN)}`);
    const premium = rows.find((r) => r.getAttribute("data-series") === "premium")!;
    expect(within(premium).getByText(/3 Einträge/)).toBeInTheDocument();
    // 10 → 190 minutes = 180 min = 3 h, longer than 2,5 × 10 min; no tick inside → the app was closed
    await waitFor(() => expect(within(premium).getByTestId("archive-gap-summary")).toHaveTextContent("1 Lücke, zusammen 3 h"));
    fireEvent.click(within(premium).getByRole("button", { name: S.gapsShow }));
    const list = within(premium).getByTestId("archive-gap-list");
    expect(list).toHaveTextContent(`${ddmmHHmm(T0 + 10 * MIN)} – ${ddmmHHmm(T0 + 190 * MIN)} · 3 h · App war zu oder pausiert – kein Abruf versucht`);
    const oi = rows.find((r) => r.getAttribute("data-series") === "oi" && r.getAttribute("data-symbol") === "BTCUSDT")!;
    await waitFor(() => expect(within(oi).getByTestId("archive-gap-summary")).toHaveTextContent(S.gapsNone));
  });

  it("exports one row as CSV exactly as stored", async () => {
    await seed();
    render(<ArchiveCard />);
    const premium = (await screen.findAllByTestId("archive-row")).find((r) => r.getAttribute("data-series") === "premium")!;
    fireEvent.click(within(premium).getByRole("button", { name: /als CSV/ }));
    await waitFor(() => expect(dl.calls).toHaveLength(1));
    expect(dl.calls[0]!.name).toMatch(/^tj-archiv-premium-BTCUSDT-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(dl.calls[0]!.mime).toBe("text/csv;charset=utf-8");
    const lines = dl.calls[0]!.data.trim().split("\n");
    expect(lines[0]).toBe("zeit_utc,epoch_ms,symbol,mark,index,rate,next");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(`2026-10-26T02:00:00.000Z,${T0},BTCUSDT,80000,80001,0.0001,${T0 + 8 * 3_600_000}`);
  });

  it("exports one row as JSON with its gaps", async () => {
    await seed();
    render(<ArchiveCard />);
    const premium = (await screen.findAllByTestId("archive-row")).find((r) => r.getAttribute("data-series") === "premium")!;
    await waitFor(() => expect(within(premium).getByTestId("archive-gap-summary")).toHaveTextContent("1 Lücke"));
    fireEvent.click(within(premium).getByRole("button", { name: /als JSON/ }));
    await waitFor(() => expect(dl.calls).toHaveLength(1));
    const json = JSON.parse(dl.calls[0]!.data) as { series: Array<{ count: number; gaps: Array<{ cause: string }> }> };
    expect(json.series[0]!.count).toBe(3);
    expect(json.series[0]!.gaps).toHaveLength(1);
    expect(json.series[0]!.gaps[0]!.cause).toBe("app");
  });

  it("deletes one row after asking, and everything after asking", async () => {
    await seed();
    render(<ArchiveCard />);
    const rows = await screen.findAllByTestId("archive-row");
    const eth = rows.find((r) => r.getAttribute("data-symbol") === "ETHUSDT")!;
    fireEvent.click(within(eth).getByRole("button", { name: /löschen/ }));
    expect(await within(eth).findByText(S.delAsk)).toBeInTheDocument();
    fireEvent.click(within(eth).getByRole("button", { name: S.yes }));
    // the overview reloads on the bumped revision
    act(() => undefined);
    await waitFor(() => expect(screen.getAllByTestId("archive-row")).toHaveLength(2));
    expect(screen.queryByText("ETHUSDT")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: S.delAll }));
    fireEvent.click(await screen.findByRole("button", { name: S.yes }));
    await waitFor(() => expect(screen.queryAllByTestId("archive-row")).toHaveLength(0));
    expect(await screen.findByTestId("archive-empty")).toBeInTheDocument();
    const db = await openArchiveDb();
    expect(await db.overview()).toEqual([]);
    db.close();
  });

  it("says so when the browser has no IndexedDB and does not offer to switch on", async () => {
    vi.stubGlobal("indexedDB", undefined);
    render(<ArchiveCard />);
    expect(await screen.findByTestId("archive-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: S.switch })).toBeDisabled();
  });
});
