/**
 * F23 view: the Forward-Test section of the lab on REAL BTCUSDT 4h bars served through the lab's own loader – an account is
 * started from the form, its honest "Stand" (nothing processed before a candle has closed), the catch-up of a seeded account
 * to the last closed candle, pause / resume / end / delete (the last two ask first), the note when the draft changed after
 * the start, and the comparison with the backtest of the same rules.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { forwardOfSettings, newAccount, withAccounts, type ForwardAccount } from "@/domain/forward";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { __resetLabor, __setHistoryDeps, LaborView, useLabor } from "@/views/labor";
import { __resetForwardRuntime } from "@/views/labor/forward/forwardStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const read = (n: string): Row[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: Row[] }).bars;
const H4_ROWS = read("binance-btcusdt-4h.json");
const D1_ROWS = read("binance-btcusdt-1d.json");
const LAST_OPEN = H4_ROWS[H4_ROWS.length - 1]![0] * 1000;
const NOW = LAST_OPEN + 14_400_000 + 60_000;

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

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}): Leaf => ({ ...newLeaf(id, block, "exec"), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (level = 50, name = "Test-Idee"): CustomConfig => sanitizeCustom({ ...defaultCustom(), name, interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level })]) });

function renderLabor() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <LaborView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

const accountsInSettings = (): ForwardAccount[] => forwardOfSettings(useJournal.getState().settings).accounts;

async function seedAccount(startIdx: number, over: Partial<ForwardAccount> = {}): Promise<ForwardAccount> {
  const a: ForwardAccount = {
    ...newAccount(
      { id: "f_seed1", name: "Seed-Konto", config: idea(), signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "fixed", bps: 2 }, funding: "none", source: { kind: "editor", label: "Test-Idee" } },
      H4_ROWS[startIdx]![0] * 1000 + 1000,
    ),
    ...over,
  };
  const { settings, saveSettings } = useJournal.getState();
  await saveSettings({ ...settings, forward: withAccounts(settings.forward, [a]) });
  return a;
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

describe("Labor · Forward-Test", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    __resetLabor();
    __resetForwardRuntime();
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    __setHistoryDeps({ rest: () => fixtureRest(), proxy: () => null, store: () => null, now: () => NOW });
    useLabor.getState().setCfg({ strategy: "custom", period: "6m", funding: "none", custom: idea() });
  });
  afterEach(() => {
    __resetLabor();
    __resetForwardRuntime();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("ohne Konto: ehrlicher Leerzustand und das Formular mit den Regeln im Klartext", async () => {
    renderLabor();
    const section = await screen.findByTestId("forward-section", {}, { timeout: 15_000 });
    expect(within(section).getByText("Noch kein virtuelles Konto")).toBeInTheDocument();
    expect(screen.getByTestId("forward-count")).toHaveTextContent("0 von 8");
    expect(screen.getByTestId("forward-rules-text")).toHaveTextContent("Long wenn RSI(14) unter 50");
    expect(screen.getByTestId("forward-costs")).toHaveTextContent("Kosten wie im Labor: Binance");
    expect(screen.getByTestId("forward-start")).toBeEnabled();
  });

  it("starten: das Konto ist da, läuft und sagt, dass noch keine Kerze seit dem Start geschlossen hat", async () => {
    renderLabor();
    await screen.findByTestId("forward-section", {}, { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("forward-start"));
    });
    const card = await screen.findByTestId("forward-account");
    expect(card).toHaveAttribute("data-status", "running");
    expect(within(card).getByTestId("forward-status")).toHaveTextContent("Läuft");
    expect(accountsInSettings()).toHaveLength(1);
    const a = accountsInSettings()[0]!;
    expect(a.startMs).toBe(Math.floor(NOW / 14_400_000) * 14_400_000);
    expect(a.cursor.t).toBeNull();
    await waitFor(() => expect(within(card).getByTestId("forward-runtime")).toHaveAttribute("data-phase", "idle"), { timeout: 20_000 });
    expect(within(card).getByTestId("forward-stand")).toHaveTextContent(/Stand: noch keine Kerze seit dem Start geschlossen\. Die erste zählende 4h-Kerze schließt/);
    expect(within(card).getByTestId("forward-sample")).toHaveTextContent("Erst 0 Trades");
    // the rules are frozen as given
    expect(a.config.long.children).toHaveLength(1);
  });

  it("ein Konto aus der Vergangenheit wird bis zur letzten geschlossenen Kerze nachgerechnet", async () => {
    await seedAccount(1000);
    renderLabor();
    const card = await screen.findByTestId("forward-account", {}, { timeout: 15_000 });
    await waitFor(() => expect(within(card).getByTestId("forward-stand")).toHaveTextContent(/Stand: bis Kerzenschluss/), { timeout: 30_000 });
    const a = accountsInSettings()[0]!;
    expect(a.cursor.t).toBe(H4_ROWS[H4_ROWS.length - 1]![0]);
    expect(a.trades.length).toBeGreaterThan(0);
    expect(within(card).getByTestId("forward-kpis")).toHaveTextContent(String(a.trades.length));
    for (const t of a.trades) expect(t.entryTime).toBeGreaterThanOrEqual(a.startMs);
    // trades list on demand
    fireEvent.click(within(card).getByTestId("forward-trades-toggle"));
    await waitFor(() => expect(within(card).getAllByTestId("forward-trade").length).toBeGreaterThan(0));
  });

  it("Pausieren, Fortsetzen, Beenden (fragt nach) und Löschen (fragt nach)", async () => {
    await seedAccount(1300);
    renderLabor();
    const card = await screen.findByTestId("forward-account", {}, { timeout: 15_000 });
    await waitFor(() => expect(within(card).getByTestId("forward-runtime")).toHaveAttribute("data-phase", "idle"), { timeout: 30_000 });
    await act(async () => {
      fireEvent.click(within(card).getByTestId("forward-pause"));
    });
    await waitFor(() => expect(screen.getByTestId("forward-account")).toHaveAttribute("data-status", "paused"));
    expect(accountsInSettings()[0]!.pauses).toHaveLength(1);
    expect(screen.getByTestId("forward-account")).toHaveTextContent("keine neuen Einstiege");
    await act(async () => {
      fireEvent.click(screen.getByTestId("forward-resume"));
    });
    await waitFor(() => expect(screen.getByTestId("forward-account")).toHaveAttribute("data-status", "running"));
    expect(accountsInSettings()[0]!.pauses[0]!.to).not.toBeNull();

    // ending asks first; "Abbrechen" changes nothing
    fireEvent.click(screen.getByTestId("forward-end"));
    expect(screen.getByTestId("forward-confirm")).toHaveTextContent("schließt eine offene Position");
    fireEvent.click(within(screen.getByTestId("forward-confirm")).getByText("Abbrechen"));
    expect(screen.queryByTestId("forward-confirm")).toBeNull();
    expect(accountsInSettings()[0]!.status).toBe("running");
    fireEvent.click(screen.getByTestId("forward-end"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("forward-confirm-yes"));
    });
    await waitFor(() => expect(screen.getByTestId("forward-account")).toHaveAttribute("data-status", "ended"));
    expect(accountsInSettings()[0]!.endReason).toBe("user");
    // an ended account is wound up by the next run
    await waitFor(() => expect(accountsInSettings()[0]!.cursor.done).toBe(true), { timeout: 30_000 });
    expect(screen.queryByTestId("forward-pause")).toBeNull();

    fireEvent.click(screen.getByTestId("forward-remove"));
    expect(screen.getByTestId("forward-confirm")).toHaveTextContent("lässt sich nicht rückgängig");
    await act(async () => {
      fireEvent.click(screen.getByTestId("forward-confirm-yes"));
    });
    await waitFor(() => expect(screen.queryByTestId("forward-account")).toBeNull());
    expect(accountsInSettings()).toEqual([]);
  });

  it("ändert sich der Entwurf nach dem Start, steht der Hinweis „neue Version = neues Konto“ da und die Regeln des Kontos bleiben", async () => {
    useLabor.getState().setCfg({ custom: idea(50, "Mein Entwurf") });
    useLabor.getState().saveDraft("Mein Entwurf");
    await seedAccount(1300, { source: { kind: "draft", label: "Mein Entwurf", versionNo: 1 }, config: idea(50, "Mein Entwurf") });
    useLabor.getState().setCfg({ custom: idea(40, "Mein Entwurf") });
    useLabor.getState().saveDraft("Mein Entwurf");
    renderLabor();
    const card = await screen.findByTestId("forward-account", {}, { timeout: 15_000 });
    await waitFor(() => expect(within(card).getByTestId("forward-changed")).toHaveTextContent("neue Version"), { timeout: 20_000 });
    expect(accountsInSettings()[0]!.config.long.children[0]).toMatchObject({ params: { level: 50 } });
  });

  it("der Rückblick: derselbe Backtest vor dem Start, daneben der Forward-Test, mit Grund für „zu früh“", async () => {
    await seedAccount(1000);
    renderLabor();
    const card = await screen.findByTestId("forward-account", {}, { timeout: 15_000 });
    await waitFor(() => expect(within(card).getByTestId("forward-stand")).toHaveTextContent(/Stand: bis Kerzenschluss/), { timeout: 30_000 });
    fireEvent.click(within(card).getByTestId("forward-compare-toggle"));
    await act(async () => {
      fireEvent.click(within(card).getByTestId("forward-compare-run"));
    });
    const res = await within(card).findByTestId("forward-compare-result", {}, { timeout: 30_000 });
    expect(["thin", "holds", "differs"]).toContain(res.getAttribute("data-level"));
    const rows = within(res).getByTestId("forward-compare-table").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(6);
    expect(res).toHaveTextContent("nie für beides");
    expect(res).toHaveTextContent(/Rückblick: \d+ Tage vor dem Start/);
  });
});
