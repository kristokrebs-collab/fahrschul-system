/**
 * F14 views: the adapter status card (honest limits) and the import of the TradingView strategy-tester export, read in the
 * browser, with line-numbered read errors and the comparison against the shown lab run.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LabResult } from "@/domain/backtest/index";
import { MotionRoot } from "@/motion/MotionRoot";
import { __resetLabor, useLabor } from "@/views/labor";
import { AdapterStatusCard, TvCompareCard } from "@/views/labor/TvSection";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const H4 = 14_400_000;
const T0 = Date.UTC(2025, 2, 3, 8, 0);
const CSV = [
  "Trade #,Type,Date/Time,Signal,Price USDT,Position size (qty),Net P&L USDT",
  "3,Exit long,2025-03-06 08:00,Open,66000,1,100",
  "3,Entry long,2025-03-05 08:00,Long,65500,1,100",
  "2,Exit short,2025-03-04 08:00,Close,64000,1,1500",
  "2,Entry short,2025-03-03 16:00,Short,65500,1,1500",
  "1,Exit long,2025-03-03 16:00,TP,65700,1,200",
  "1,Entry long,2025-03-03 08:00,Long,65500,1,200",
].join("\n");

const lt = (side: "long" | "short", entryMs: number, exitMs: number, entry: number, exit: number, pnl: number) => ({
  id: `bt-${entryMs}`, side, tag: "", entryIndex: 0, exitIndex: 1, entryTime: entryMs, exitTime: exitMs, entry, exit, stop: entry, target: null, qty: 2, notional: 1, pnl, fees: 4, funding: 0, slippage: 1, r: 1, move: (side === "long" ? 1 : -1) * ((exit - entry) / entry), bars: 2, reason: "target" as const,
});
const RESULT = {
  strategy: "custom", name: "Meine Idee", symbol: "BTCUSDT", interval: "1h", from: T0 - 10 * H4, to: T0 + 100 * H4,
  trades: [lt("long", T0, T0 + 2 * H4, 65500, 65700, 150), lt("short", T0 + 2 * H4, T0 + 6 * H4 + 2 * H4, 65500, 64000, 1400), lt("long", T0 + 50 * H4, T0 + 52 * H4, 100, 101, 1)],
} as unknown as LabResult;

const csvFile = (text: string, name = "trades.csv") => new File([text], name, { type: "text/csv" });

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetLabor();
});
afterEach(() => __resetLabor());

const mount = (ui: React.ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
async function pick(text: string) {
  const input = screen.getByTestId("labor-tv-file") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [csvFile(text)] } });
  });
  await waitFor(() => expect(screen.getByTestId("labor-tv-read")).toBeTruthy());
}

describe("Adapterstatus", () => {
  it("zeigt jeden Weg mit Status und Grenzen; ehrlich zu Login und fremdem Code", () => {
    mount(<AdapterStatusCard />);
    const rows = screen.getAllByTestId("labor-tv-adapter");
    expect(rows.map((r) => [r.getAttribute("data-adapter"), r.getAttribute("data-status")])).toEqual([
      ["pine-export", "supported"],
      ["tester-export", "supported"],
      ["alert-webhook", "forward"],
      ["pine-strategy", "unsupported"],
      ["pine-indicator", "unsupported"],
      ["indicator-series", "unsupported"],
      ["account", "unsupported"],
    ]);
    expect(within(rows[0]!).getByText("unterstützt")).toBeTruthy();
    expect(within(rows[1]!).getByText("unterstützt")).toBeTruthy();
    expect(within(rows[2]!).getByText("nur Forwardtest über Alert")).toBeTruthy();
    expect(within(rows[6]!).getByText("nicht unterstützt")).toBeTruthy();
    expect(within(rows[0]!).getByText(/kein Login/)).toBeTruthy();
    expect(screen.getByText(/Bewusst ausgeschlossen: kein Login/)).toBeTruthy();
    expect(screen.getByText(/führt keinen fremden Code aus/)).toBeTruthy();
  });
});

describe("Export-Import und Vergleich", () => {
  it("liest die Datei im Browser; ohne Labor-Lauf nennt sie, was fehlt, und vergleicht nichts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount(<TvCompareCard />);
    await pick(CSV);
    expect(screen.getByTestId("labor-tv-summary").textContent).toMatch(/3 Trades gelesen, davon 1 offen · Kopfzeile englisch · USDT/);
    expect(screen.getByTestId("labor-tv-norun")).toBeTruthy();
    expect(screen.queryByTestId("labor-tv-result")).toBeNull();
    expect(screen.getByTestId("labor-tv-name").textContent).toBe("trades.csv");
    // nothing left the browser
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("vergleicht mit dem gezeigten Lauf: gepaart, Differenz Netto, Gründe", async () => {
    useLabor.setState({ result: RESULT });
    mount(<TvCompareCard />);
    await pick(CSV);
    const res = await screen.findByTestId("labor-tv-result");
    // trade 3 is open → compared: 2 closed TradingView trades, both paired
    expect(within(res).getByText("2 / 2")).toBeTruthy();
    expect(screen.getAllByTestId("labor-tv-pair")).toHaveLength(2);
    // Netto TradingView 1700, Labor 1550 → difference −150
    expect(screen.getByTestId("labor-tv-diff-all").textContent).toBe("−150 USDT");
    const reasons = screen.getAllByTestId("labor-tv-reason").map((r) => r.getAttribute("data-reason"));
    expect(reasons).toEqual(expect.arrayContaining(["costs", "sizing", "scope"]));
    expect(screen.getByText(/ein Unterschied hier ist eine Beobachtung, kein Beweis/i)).toBeTruthy();
  });

  it("Zeitzone der Datei verschiebt die Zeiten: falscher Versatz → Trades ohne Gegenstück", async () => {
    useLabor.setState({ result: RESULT });
    mount(<TvCompareCard />);
    await pick(CSV);
    await screen.findByTestId("labor-tv-result");
    fireEvent.click(screen.getByRole("radio", { name: "UTC+3" }));
    await waitFor(() => expect(within(screen.getByTestId("labor-tv-result")).getByText("0 / 2")).toBeTruthy());
    expect(screen.getAllByTestId("labor-tv-reason").some((r) => r.getAttribute("data-reason") === "unpaired")).toBe(true);
  });

  it("Fehler nennen die Zeile der Datei; lesbare Zeilen werden trotzdem verglichen", async () => {
    mount(<TvCompareCard />);
    await pick(["Trade #,Type,Date/Time,Signal,Price USDT,Net P&L USDT", "1,Entry long,2025-03-03 08:00,L,100,5", "1,Exit long,2025-03-03 12:00,X,abc,5", "2,Entry sideways,2025-03-04 08:00,L,100,5"].join("\n"));
    const errs = screen.getByTestId("labor-tv-errors");
    expect(within(errs).getByText("Zeile 3")).toBeTruthy();
    expect(within(errs).getByText("Zeile 4")).toBeTruthy();
    expect(within(errs).getByText(/Preis „abc“ ist keine Zahl/)).toBeTruthy();
    expect(screen.getByTestId("labor-tv-summary").textContent).toMatch(/2 Zeilen nicht lesbar/);
  });

  it("eine Datei ohne passende Kopfzeile ergibt eine Meldung, keinen Absturz", async () => {
    mount(<TvCompareCard />);
    await pick("foo,bar\n1,2");
    expect(screen.getByTestId("labor-tv-errors").textContent).toMatch(/Zeile 1.*fehlt: Trade-Nummer/);
    expect(screen.queryByTestId("labor-tv-result")).toBeNull();
  });
});
