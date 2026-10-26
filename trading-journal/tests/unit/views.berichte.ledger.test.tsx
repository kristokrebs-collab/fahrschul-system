/**
 * F70 – the Transaktionsbuch section of the Berichte page: summary per year, the rows with their FIFO matching, the visible
 * Abgleich (flags with counts, the list of open questions), the zone, the scope, CSV and print. The device zone is fixed to UTC, so
 * every time on screen is a hand-computed instant (the journal's wall clock is read as UTC).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LEDGER_NOTE } from "@/domain/ledger";
import type { Fill } from "@/domain/types";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { mkTrade } from "./domain.fixtures";

vi.mock("@/domain/events/zone", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/domain/events/zone")>()), deviceTimeZone: () => "UTC" }));
const saved = vi.hoisted(() => ({ calls: [] as { name: string; data: string }[] }));
vi.mock("@/store/download", () => ({
  download: async (name: string, data: string) => {
    saved.calls.push({ name, data });
    return true;
  },
}));

const { default: LedgerSection } = await import("@/views/berichte/ledger/LedgerSection");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { useLedgerPrefs } = await import("@/views/berichte/ledger/prefs");

const f = (id: string, at: string, side: Fill["side"], price: number, qty: number, extra: Partial<Fill> = {}): Fill => ({ id, at, side, price, qty, kind: side === "open" ? "entry" : "partial", ...extra });

// the hand-computed trade of ledger.domain.test: closing 1,5 @ 130 in 2026 (35), 0,5 @ 90 in 2027 (−15), every fill pays 0,10
const A = mkTrade({
  id: "A",
  pair: "BTCUSDT",
  date: "2026-01-10T10:00",
  exitDate: "2027-01-02T09:00",
  entry: 110,
  exit: 90,
  size: 220,
  fundingFees: 0,
  fills: [f("a1", "2026-01-10T10:00", "open", 100, 1, { fee: 0.1 }), f("a2", "2026-01-10T11:00", "open", 120, 1, { fee: 0.1, kind: "add" }), f("a3", "2026-01-11T09:00", "close", 130, 1.5, { fee: 0.1 }), f("a4", "2027-01-02T09:00", "close", 90, 0.5, { fee: 0.1, kind: "exit" })],
});
// short, no fee and no funding recorded: +5 and −5
const B = mkTrade({
  id: "B",
  side: "short",
  pair: "ETHUSDT",
  date: "2026-03-01T08:00",
  exitDate: "2026-03-03T08:00",
  entry: 50,
  exit: 55,
  size: 100,
  fills: [f("b1", "2026-03-01T08:00", "open", 50, 2), f("b2", "2026-03-02T08:00", "close", 45, 1), f("b3", "2026-03-03T08:00", "close", 55, 1, { kind: "exit" })],
});
const U = mkTrade({ id: "U", pair: "XRPUSDT", date: "gestern", entry: 1, exit: 2, size: 10 });

const wrap = (acc: "all" | "makro" | "scalp" = "all") =>
  render(
    <MotionRoot>
      <LedgerSection acc={acc} />
    </MotionRoot>,
  );

const pick = async (listName: string, option: string): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: listName }));
  fireEvent.click(within(await screen.findByRole("listbox", { name: listName })).getByRole("option", { name: option }));
};

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  saved.calls.length = 0;
  localStorage.clear();
  await bootFixtureJournal();
  useJournal.setState({ trades: [A, B, U] });
  useLedgerPrefs.setState({ tz: null, scope: "position" });
});
afterEach(() => vi.restoreAllMocks());

describe("Transaktionsbuch", () => {
  it("opens on the newest year: 2027 holds only the closing of 0,5 @ 90 (−15 gross, 0,10 fee), the head says it is no tax advice", () => {
    wrap();
    const card = screen.getByTestId("ledger-card");
    expect(card).toHaveTextContent("Hilfsrechnung ohne Steuerberatung; Steuerregeln prüft eine Fachperson.");
    const years = within(card).getAllByTestId("ledger-year");
    expect(years.map((y) => y.getAttribute("data-year"))).toEqual(["2027"]);
    expect(years[0]).toHaveTextContent("−15,00");
    expect(years[0]).toHaveTextContent("0,10"); // fee
    expect(years[0]).toHaveTextContent("−15,10"); // after fees and funding
    const rows = within(card).getAllByTestId("ledger-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["A:f3"]);
  });

  it("shows all years with gains, losses, fees and the result after costs (2026: gains 35 + 5, losses −5, fees 0,30)", async () => {
    wrap();
    await pick("Jahr", "Alle Jahre");
    const years = screen.getAllByTestId("ledger-year");
    expect(years.map((y) => y.getAttribute("data-year"))).toEqual(["2026", "2027"]);
    const y26 = years[0]!;
    // 35 (first closing) + 5 (short, 50 → 45) = 40; −5 (short, 50 → 55); gross 35; fees 0,30; net 34,70
    expect(y26).toHaveTextContent("40,00");
    expect(y26).toHaveTextContent("−5,00");
    expect(y26).toHaveTextContent("35,00");
    expect(y26).toHaveTextContent("0,30");
    expect(y26).toHaveTextContent("34,70");
    // the short has no fee and no funding recorded: its three rows carry a hint (counted per row, not per hint)
    expect(within(y26).getByTestId("ledger-year-flags")).toHaveTextContent("3 Zeilen mit Hinweis");
  });

  it("lists the closing with date, kind, quantity, price, result and its FIFO matches", async () => {
    wrap();
    await pick("Jahr", "Alle Jahre");
    const row = screen.getAllByTestId("ledger-row").find((r) => r.getAttribute("data-id") === "A:f2")!;
    expect(row).toHaveTextContent("11.01.2026 09:00");
    expect(row).toHaveTextContent("Scalp · BTCUSDT");
    expect(row).toHaveTextContent("Schließen · Verkauf · Long");
    expect(row).toHaveTextContent("1,5");
    expect(row).toHaveTextContent("130,00");
    expect(row).toHaveTextContent("35,00");
    const m = within(row).getByTestId("ledger-matches");
    fireEvent.click(within(m).getByText(/FIFO-Zuordnung \(2\)/));
    expect(m).toHaveTextContent("1 aus 10.01.2026 zu 100,00 → 130,00: 30,00");
    expect(m).toHaveTextContent("0,5 aus 10.01.2026 zu 120,00 → 130,00: 5,00");
  });

  it("makes the gaps visible: flags with counts, a filter, and what could not be turned into rows on the list of open questions", async () => {
    wrap();
    await pick("Jahr", "Alle Jahre");
    const fee = screen.getByTestId("ledger-flag-fee-missing");
    expect(fee).toHaveTextContent("Gebühr fehlt · 3");
    expect(screen.getByTestId("ledger-flag-funding-missing")).toHaveTextContent("Funding fehlt · 2");
    fireEvent.click(fee);
    expect(screen.getAllByTestId("ledger-row").map((r) => r.getAttribute("data-id"))).toEqual(["B:f0", "B:f1", "B:f2"]);
    expect(screen.getAllByTestId("ledger-row")[0]).toHaveTextContent("Gebühr nicht erfasst – das Buch schätzt sie nicht.");
    fireEvent.click(screen.getByRole("button", { name: "Alle Zeilen" }));
    const open = screen.getByTestId("ledger-unresolved");
    expect(open).toHaveTextContent("Klärliste: Einträge ohne Zeilen (1)");
    expect(open).toHaveTextContent("XRPUSDT: Die Zeit des Eintrags ist nicht lesbar.");
  });

  it("reads the book in another zone: 11.01.2026 09:00 UTC is 04:00 in New York", async () => {
    wrap();
    await pick("Jahr", "Alle Jahre");
    await pick("Zeitzone des Buchs", "New York");
    const row = screen.getAllByTestId("ledger-row").find((r) => r.getAttribute("data-id") === "A:f2")!;
    expect(row).toHaveTextContent("11.01.2026 04:00");
    expect(useLedgerPrefs.getState().tz).toBe("America/New_York");
  });

  it("switches the matching scope and says what it means", () => {
    wrap();
    expect(screen.getByTestId("ledger-scope-help")).toHaveTextContent("innerhalb eines Journal-Eintrags");
    fireEvent.click(screen.getByRole("radio", { name: "Je Markt" }));
    expect(useLedgerPrefs.getState().scope).toBe("market");
    expect(screen.getByTestId("ledger-scope-help")).toHaveTextContent("Alle Einträge eines Marktes teilen sich eine Reihe");
  });

  it("exports the book and the matching as CSV with the head 'Hilfsrechnung ohne Steuerberatung'", async () => {
    wrap();
    await pick("Jahr", "Alle Jahre");
    fireEvent.click(screen.getByTestId("ledger-csv"));
    await waitFor(() => expect(saved.calls).toHaveLength(1));
    expect(saved.calls[0]!.name).toBe("transaktionsbuch-alle-jahre.csv");
    expect(saved.calls[0]!.data.startsWith("\uFEFF")).toBe(true);
    expect(saved.calls[0]!.data.split("\n")[0]).toBe(`\uFEFF"${LEDGER_NOTE}"`);
    expect(saved.calls[0]!.data).toContain("11.01.2026 09:00;2026-01-11T09:00:00Z;Scalp;;BTCUSDT;Schließen;Verkauf;Long;1,5;130,00;0,10;;35,00;10.01.2026;11.01.2026;USDT;Ausführung;A;");
    fireEvent.click(screen.getByTestId("ledger-csv-match"));
    await waitFor(() => expect(saved.calls).toHaveLength(2));
    expect(saved.calls[1]!.name).toBe("fifo-zuordnung-alle-jahre.csv");
    expect(saved.calls[1]!.data).toContain("11.01.2026 09:00;10.01.2026 10:00;Scalp;BTCUSDT;Long;1;100,00;130,00;30,00;USDT;A;A:f2");
  });

  it("prints a white document with the same head, the year summary and what is not in it", async () => {
    const print = vi.fn();
    window.print = print;
    wrap();
    fireEvent.click(screen.getByTestId("ledger-print-btn"));
    await waitFor(() => expect(print).toHaveBeenCalled());
    const doc = screen.getByTestId("ledger-print");
    expect(within(doc).getByTestId("ledger-print-note")).toHaveTextContent(LEDGER_NOTE);
    expect(doc).toHaveTextContent("Transaktionsbuch 2027");
    expect(doc).toHaveTextContent("Nicht enthalten: Ein- und Auszahlungen");
    expect(document.documentElement.classList.contains("tj-report-printing")).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(screen.queryByTestId("ledger-print")).toBeNull());
    expect(document.documentElement.classList.contains("tj-report-printing")).toBe(false);
  });

  it("says plainly when the account has no trade, and still names what the book does not hold", () => {
    wrap("makro");
    expect(screen.getByTestId("ledger-empty")).toHaveTextContent("Im Journal liegt noch kein Trade");
    expect(screen.getByTestId("ledger-scope-note")).toHaveTextContent("Staking, Rewards, Airdrops");
  });
});
