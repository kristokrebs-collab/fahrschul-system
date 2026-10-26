/**
 * F43 – the Termine section of the Markt page: the calendar (list, month, kinds, "gleich", sources, own entries), the
 * Morgenbriefing "Heute wichtig" (every line with a source, "keine Daten" where nothing is there) and the Ereignisphasen
 * (sample, verdict, the last backtest). The clock is fixed to Wednesday 28.10.2026 07:30 UTC – the day of an FOMC decision –
 * and the zone to UTC, so every time on screen is a hand-computed instant.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ownEventsOf } from "@/domain/events";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market/multiDaily", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/multiDaily")>();
  // two closed days for ETH: 2400 -> 2460 = +2,5 % (the last closed UTC day is 27.10.2026)
  const day = (iso: string, c: number) => ({ t: Date.parse(iso), c });
  return { ...actual, useMultiDaily: () => ({ state: "ok", series: { ETHUSDT: [day("2026-10-26T00:00:00Z", 2400), day("2026-10-27T00:00:00Z", 2460)] }, failed: [], pending: [], viaProxy: false, detail: null }) };
});

const { TermineSection } = { TermineSection: (await import("@/views/termine/TermineSection")).default };
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { useTermine } = await import("@/views/termine/prefs");

const NOW = Date.UTC(2026, 9, 28, 7, 30);

const wrap = () =>
  render(
    <MotionRoot>
      <TermineSection />
    </MotionRoot>,
  );

beforeAll(() => {
  installDomPolyfills();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  await bootFixtureJournal();
  useTermine.setState({ tz: "UTC", groups: ["expiry", "fomc", "us", "own"], view: "liste" });
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

describe("Termine – the calendar", () => {
  it("lists today first: the FOMC decision all day, the US open at 13:30 UTC (summer time) and the expiry of Friday 30.10. at 08:00", () => {
    wrap();
    const today = screen.getByTestId("termine-list").querySelector('[data-day="2026-10-28"]') as HTMLElement;
    const rows = within(today).getAllByTestId("event-row");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["fomc", "usOpen", "usClose"]);
    expect(within(rows[0]!).getByText("ganztägig")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("FOMC-Entscheidung")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("13:30")).toBeInTheDocument(); // 09:30 EDT
    expect(within(rows[2]!).getByText("20:00")).toBeInTheDocument(); // 16:00 EDT
    const friday = screen.getByTestId("termine-list").querySelector('[data-day="2026-10-30"]') as HTMLElement;
    const expiry = within(friday).getAllByTestId("event-row").find((r) => r.getAttribute("data-kind") === "expiry")!;
    expect(within(expiry).getByText("08:00")).toBeInTheDocument();
    expect(within(expiry).getByText("Monatsverfall (Optionen und Futures)")).toBeInTheDocument();
  });

  it("shows the next Funding with its countdown and 'gleich' within the hour (07:30 -> 08:00 UTC = in 30 min)", () => {
    wrap();
    const f = screen.getByTestId("next-funding");
    expect(f).toHaveTextContent("Nächstes Funding: 08:00 Uhr · in 30 min");
    expect(within(f).getByText("gleich")).toBeInTheDocument();
    expect(f).toHaveTextContent("Standardraster 8 h");
  });

  it("folds the day's Funding settlements into one line when the kind is switched on", () => {
    wrap();
    expect(screen.queryByText("Funding-Abrechnungen")).toBeNull();
    fireEvent.click(screen.getByTestId("termine-chip-funding"));
    expect(screen.getByTestId("termine-chip-funding")).toHaveAttribute("aria-pressed", "true");
    const today = screen.getByTestId("termine-list").querySelector('[data-day="2026-10-28"]') as HTMLElement;
    expect(within(today).getByText("Funding-Abrechnungen")).toBeInTheDocument();
    expect(within(today).getByText("00:00 · 08:00 · 16:00 Uhr")).toBeInTheDocument();
  });

  it("opens the source of an entry: the list, the check date and the link – the FOMC time is honestly missing", () => {
    wrap();
    const today = screen.getByTestId("termine-list").querySelector('[data-day="2026-10-28"]') as HTMLElement;
    const row = within(today).getAllByTestId("event-row")[0]!;
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const src = within(row).getByTestId("event-source");
    expect(src).toHaveTextContent("Federal Reserve – FOMC Meeting calendars and information");
    expect(src).toHaveTextContent("geprüft am: 25.10.2026");
    expect(src).toHaveTextContent("abgerufen am 25.10.2026 (Seitenstand 07.10.2026); ohne Uhrzeit, die Seite nennt keine");
    expect(within(src).getByRole("link", { name: "Quelle öffnen" })).toHaveAttribute("href", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm");
  });

  it("switches to the month: the grid with Monday first, the day's appointments, the next month", () => {
    wrap();
    fireEvent.click(screen.getByRole("radio", { name: "Monat" }));
    expect(screen.getByTestId("month-label")).toHaveTextContent("Oktober 2026");
    const cell = screen.getByTestId("month-grid").querySelector('[data-day="2026-10-28"]') as HTMLElement;
    expect(cell).toHaveAttribute("data-count", "3"); // FOMC, US open, US close
    // the 1st of Oct 2026 is a Thursday: the first row starts with 28 Sep
    expect(screen.getByTestId("month-grid").querySelector("[data-day]")).toHaveAttribute("data-day", "2026-09-28");
    fireEvent.click(screen.getByTestId("month-next"));
    expect(screen.getByTestId("month-label")).toHaveTextContent("November 2026");
    const thanks = screen.getByTestId("month-grid").querySelector('[data-day="2026-11-26"]') as HTMLElement;
    fireEvent.click(thanks);
    expect(within(screen.getByTestId("month-day")).getByText("US-Börsen geschlossen: Thanksgiving")).toBeInTheDocument();
  });

  it("enters, shows and deletes an own appointment (the time is read in the chosen zone) and refuses an empty form", async () => {
    wrap();
    fireEvent.click(screen.getByTestId("own-open"));
    fireEvent.click(screen.getByTestId("own-save"));
    expect(await screen.findByText("Gib dem Termin einen Namen.")).toBeInTheDocument();
    expect(screen.getByText("Wähle Datum und Uhrzeit.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CPI USA" } });
    fireEvent.change(screen.getByLabelText("Zeit"), { target: { value: "2026-10-29T12:30" } });
    fireEvent.click(screen.getByTestId("own-save"));
    await waitFor(() => expect(ownEventsOf(useJournal.getState().settings.events).items).toHaveLength(1));
    const saved = ownEventsOf(useJournal.getState().settings.events).items[0]!;
    expect(saved).toMatchObject({ title: "CPI USA", at: Date.UTC(2026, 9, 29, 12, 30), importance: "mittel" });
    const day = (await waitFor(() => {
      const d = screen.getByTestId("termine-list").querySelector('[data-day="2026-10-29"]');
      expect(d).not.toBeNull();
      return d;
    })) as HTMLElement;
    const row = within(day).getAllByTestId("event-row").find((r) => r.getAttribute("data-kind") === "own")!;
    expect(within(row).getByText("12:30")).toBeInTheDocument();
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    expect(within(row).getByTestId("event-source")).toHaveTextContent("Eigener Eintrag");
    fireEvent.click(within(row).getByRole("button", { name: "Termin „CPI USA“ löschen" }));
    await waitFor(() => expect(ownEventsOf(useJournal.getState().settings.events).items).toHaveLength(0));
  });

  it("names every source with its rule and check date", () => {
    wrap();
    const d = screen.getByTestId("termine-sources");
    fireEvent.click(within(d).getByText("Quellen der Termine"));
    expect(d).toHaveTextContent("Deribit – Verfallstermine (öffentliche API)");
    expect(d).toHaveTextContent("NYSE – Handelszeiten und Feiertage");
    expect(d).toHaveTextContent("Sonderschließungen der Börsen");
  });
});

describe("Heute wichtig – the Morgenbriefing", () => {
  it("has the sections of the morning note; every line names its source and a time or says there is none", () => {
    wrap();
    const card = screen.getByTestId("briefing-card");
    for (const id of ["overview", "events", "markets", "levels", "alerts", "checkin", "watch"]) expect(within(card).getByTestId(`briefing-${id}`)).toBeInTheDocument();
    const lines = within(card).getAllByTestId("briefing-line");
    expect(lines.length).toBeGreaterThan(8);
    for (const l of lines) expect(within(l).getByTestId("briefing-source").textContent).toMatch(/^Quelle: .+ · (\d\d:\d\d Uhr|keine Zeit)$/);
  });

  it("lists today's appointments, the watchlist move from the daily candles and says 'keine Daten' for what the app does not have", () => {
    wrap();
    const events = screen.getByTestId("briefing-events");
    expect(events).toHaveTextContent("ganztägig · FOMC-Entscheidung");
    expect(events).toHaveTextContent("13:30 Uhr · US-Börsen öffnen (NYSE)");
    expect(events).toHaveTextContent("Funding-Abrechnungen um 00:00, 08:00, 16:00 Uhr");
    const markets = screen.getByTestId("briefing-markets");
    // 2460 / 2400 − 1 = +2,5 %, the last closed day: 27.10.2026 24:00 -> 00:00 Uhr of the 28th
    expect(markets).toHaveTextContent("ETHUSDT: +2,5 % (letzter Tagesschluss) · 2.460 · bewegt sich");
    // no live feed in this test: the live symbol and the key levels are not available
    expect(screen.getByTestId("briefing-levels")).toHaveTextContent("Marken: keine Daten (Der Live-Markt läuft nicht, die Marken sind nicht bewertet).");
    expect(screen.getByTestId("briefing-checkin")).toHaveTextContent("Check-in offen: noch nicht beantwortet.");
    const missing = within(screen.getByTestId("briefing-card")).getAllByTestId("briefing-line").filter((l) => l.getAttribute("data-missing") === "true");
    expect(missing.length).toBeGreaterThan(0);
    for (const l of missing) expect(l).toHaveTextContent(/keine Daten|nicht bewertet/);
  });

  it("ends with the stand, the zone and the sentence that it is no advice", () => {
    wrap();
    expect(screen.getByTestId("briefing-stand")).toHaveTextContent("Stand 07:30 Uhr (UTC, UTC+0)");
    expect(screen.getByTestId("briefing-card")).not.toHaveTextContent("Finanzberatung");
  });
});

describe("Ereignisphasen", () => {
  it("shows the six phases with the sample inside and outside, the chance note and the sentence that it is no advice", () => {
    wrap();
    const card = screen.getByTestId("phasen-card");
    const rows = within(card).getAllByTestId("phase-row");
    expect(rows.map((r) => r.getAttribute("data-phase"))).toEqual(["fundingPre", "fundingPost", "expiryDay", "fomcDay", "usOpenHour", "weekend"]);
    for (const r of rows) {
      expect(within(r).getByTestId("phase-inside").textContent).toMatch(/Trade|keine Trades/);
      expect(r.getAttribute("data-verdict")).toMatch(/^(klar|tendenz|offen|wenig)$/);
    }
    expect(within(card).getByTestId("phasen-chance")).toHaveTextContent("Beobachtungen deiner Vergangenheit, keine Ursachen und keine Prognose");
    expect(card).not.toHaveTextContent("Finanzberatung");
    expect(within(card).getByTestId("phasen-total")).toHaveTextContent(/^Alle: \d+ Trades/);
  });

  it("says so without any closed trade", async () => {
    useJournal.setState({ trades: [] });
    wrap();
    expect(await screen.findByTestId("phasen-empty")).toHaveTextContent("Noch keine geschlossenen Trades");
  });

  it("reads the last backtest of the session, or says there is none", async () => {
    wrap();
    fireEvent.click(screen.getByRole("radio", { name: "Letzter Backtest" }));
    await waitFor(() => expect(screen.getByTestId("phasen-empty")).toHaveTextContent("In dieser Sitzung ist kein Backtest gelaufen"));
    const { useLabor } = await import("@/views/labor/laborStore");
    const t = (id: string, iso: string, r: number, pnl: number) => ({ id, entryTime: Date.parse(iso), r, pnl });
    useLabor.setState({
      result: { name: "Meine Idee", strategy: "custom", symbol: "BTCUSDT", interval: "1h", trades: [t("a", "2026-10-27T07:00:00Z", 2, 20), t("b", "2026-10-27T13:00:00Z", -1, -10), t("c", "2026-10-26T13:00:00Z", -1, -10)] },
    } as unknown as Partial<ReturnType<typeof useLabor.getState>>);
    await waitFor(() => expect(screen.getByTestId("phasen-backtest-label")).toHaveTextContent("Meine Idee · BTCUSDT 1h"));
    const pre = screen.getAllByTestId("phase-row").find((r) => r.getAttribute("data-phase") === "fundingPre")!;
    // 07:00 UTC is 1 h before the 08:00 settlement: the first trade is inside
    expect(pre.getAttribute("data-n-inside")).toBe("1");
    expect(within(pre).getByTestId("phase-inside")).toHaveTextContent("1 Trade · Treffer 100 %");
    expect(within(pre).getByTestId("phase-outside")).toHaveTextContent("2 Trades · Treffer 0 %");
    expect(pre.getAttribute("data-verdict")).toBe("wenig");
    useLabor.setState({ result: null } as Partial<ReturnType<typeof useLabor.getState>>);
  });
});
