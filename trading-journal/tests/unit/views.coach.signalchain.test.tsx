/**
 * The signal chain cards on the Coach page and the month benefit card in the reports: F28 Posteingang (status, filters, ansehen,
 * ausgelassen mit Grund, im Journal verknüpfen, einklappen), F25 Bilanz (Ausgänge evaluated automatically – no click –, „Neu
 * berechnen“, rows with sample and interval, the comparison with the selection note), F27 Qualität (the banner, the open-share,
 * delays, the log, the candle check) and F60 Monatsnutzen (counts, flagged traces, the limits text).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountView } from "@/domain/account";
import { detectBehaviors } from "@/domain/coach/events";
import { buildReport, periodOf } from "@/domain/reports";
import { __resetDeliveryLog, DELIVERY_LOG_KEY, logExternalDelivery, recordDelivery } from "@/market/keylevels/deliveryLog";
import { PRESENCE_KEY } from "@/market/presence";
import { __resetSignalArchive, recordSignalEvent, SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { MotionRoot } from "@/motion/MotionRoot";
import { MonthBenefitCard } from "@/views/berichte/MonthBenefitCard";
import type { ReportPage } from "@/views/berichte/hooks";
import { DataQualityCard } from "@/views/coach/DataQualityCard";
import { SignalBalanceCard } from "@/views/coach/SignalBalanceCard";
import { INBOX_STRINGS, SignalInboxCard } from "@/views/coach/SignalInboxCard";
import { __resetAuto, __setAutoDeps } from "@/views/coach/signalAuto";
import { __resetOutcomes, OUTCOME_CACHE_KEY } from "@/views/coach/signalOutcomes";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";
import { H, signalInput } from "./missed.fixtures";
import { installDomPolyfills } from "./views.overview.harness";

const NOW = new Date(2026, 2, 8, 12).getTime();
const when = (day: number, min: number) => new Date(at(day, min)).getTime();

const loadLabData = vi.fn();
vi.mock("@/views/labor/historySource", () => ({
  loadLabData: (req: unknown) => loadLabData(req),
  loadErrorKind: () => "failed",
}));

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

const trades = enrichC([ct(at(0, 600), { id: "a", p: 100, pair: "BTC/USDT" }), ct(at(1, 600), { id: "b", p: -50, side: "short", pair: "ETH/USDT" })], COACH_SETTINGS);
const signal = (key: string, ms: number, over: Partial<ReturnType<typeof signalInput>> = {}) => recordSignalEvent(signalInput({ key, at: ms, label: `Signal ${key}`, ...over }));
const M15 = 900_000;
const bar15 = (t0: number, i: number, o: number, h: number, l: number) => ({ t: (t0 + (i + 1) * M15) / 1000, o, h, l, c: o });
const wrap = (node: React.ReactNode) => <MotionRoot>{node}</MotionRoot>;

beforeAll(() => {
  installDomPolyfills();
  reduceMotion();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const k of [SIGNAL_ARCHIVE_KEY, DELIVERY_LOG_KEY, PRESENCE_KEY, OUTCOME_CACHE_KEY]) localStorage.removeItem(k);
  localStorage.removeItem("tj2-signal-inbox-open");
  __resetSignalArchive();
  __resetDeliveryLog();
  __resetOutcomes();
  loadLabData.mockReset();
  // the automatic evaluation without its idle wait: the next macrotask (the scheduler itself is tested in views.coach.signalAuto)
  __setAutoDeps({
    later: (cb) => {
      const t = setTimeout(cb, 0);
      return () => clearTimeout(t);
    },
  });
  window.location.hash = "";
});
afterEach(() => {
  __resetAuto();
  vi.useRealTimers();
});

describe("SignalInboxCard (F28)", () => {
  it("an empty archive says what is stored from now on – and that the past cannot be added", () => {
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    const card = screen.getByTestId("inbox-card");
    expect(card).toHaveAttribute("data-total", "0");
    expect(card).toHaveTextContent(INBOX_STRINGS.emptyTitle);
    expect(card).toHaveTextContent("lässt sich nicht nachtragen");
    expect(screen.queryByTestId("inbox-row")).toBeNull();
  });

  it("lists the signals by relevance with their status, and filters by status, entries and own markets", () => {
    signal("traded", when(0, 600) + 10 * 60_000);
    signal("fresh", NOW - H, { symbol: "BTCUSDT" });
    signal("other", NOW - 2 * H, { symbol: "SOLUSDT", strength: 4 });
    signal("ctx", NOW - 3 * H, { entry: false, source: "box", kind: "breakout", strength: null, symbol: "BTCUSDT" });
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    const rows = screen.getAllByTestId("inbox-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["neu", "neu", "neu", "gehandelt"]);
    expect(within(rows[0]!).getByText("Signal fresh")).toBeInTheDocument(); // my market beats the stronger signal on a market I do not trade
    expect(rows[3]).toHaveTextContent("Gehandelt:");
    expect(screen.getByTestId("inbox-order")).toHaveTextContent("Reihenfolge");
    // the source line: where the list comes from, how many, from which to which time (F27)
    const basis = screen.getByTestId("inbox-basis");
    expect(basis).toHaveTextContent("Quelle: Signalarchiv dieses Geräts (nur bei offener App gesammelt) · 4 Ereignisse");
    expect(basis).toHaveTextContent("ältestes Signal");
    expect(basis).toHaveTextContent("neuestes Signal");

    fireEvent.click(screen.getByTestId("inbox-filter-gehandelt"));
    expect(screen.getAllByTestId("inbox-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("inbox-filter-alle"));
    fireEvent.click(screen.getByTestId("inbox-filter-entries"));
    expect(screen.getAllByTestId("inbox-row")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("inbox-filter-mine"));
    expect(screen.getAllByTestId("inbox-row").map((r) => r.getAttribute("data-status")).sort()).toEqual(["gehandelt", "neu"]);
    fireEvent.click(screen.getByTestId("inbox-filter-abgelaufen"));
    expect(screen.getByTestId("inbox-empty-filter")).toBeInTheDocument();
  });

  it("ansehen marks it seen (stored); the detail shows the marks", async () => {
    signal("s", NOW - H, { price: 100, stop: 95, target: 110 });
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    const row = screen.getByTestId("inbox-row");
    expect(row).toHaveAttribute("data-status", "neu");
    await act(async () => {
      fireEvent.click(within(row).getByTestId("inbox-view"));
    });
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "angesehen");
    expect(screen.getByTestId("inbox-detail")).toHaveTextContent("Einstieg 100 · Stopp 95 · Ziel 110");
    expect(JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!).items[0].seenAt).toBe(NOW);
  });

  it("the detail of an entry shows its outcome once it is evaluated – opening the inbox is a trigger, too", async () => {
    const t0 = NOW - 2 * 24 * H;
    signal("s", t0, { price: 100, stop: 95, target: 110 });
    loadLabData.mockResolvedValue({ data: { "15m": [bar15(t0, 0, 100, 111, 99)] }, funding: null, pages: 1, viaProxy: false });
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-view"));
    });
    // no click on a „berechnen“ button: the outcome arrives by itself
    await waitFor(() => expect(within(screen.getByTestId("inbox-detail")).getByTestId("outcome")).toHaveAttribute("data-kind", "target"));
    expect(screen.getByTestId("inbox-detail")).toHaveTextContent("Ziel zuerst");
    expect(loadLabData).toHaveBeenCalledTimes(1);
  });

  it("„Ausgelassen – Grund“: a short list, the reason stays on the signal and can be taken back", async () => {
    signal("s", NOW - H);
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip"));
    });
    expect(screen.getByTestId("inbox-skip-panel")).toHaveTextContent(INBOX_STRINGS.skipTitle);
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip-doubt"));
    });
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "ausgelassen");
    expect(screen.getByTestId("inbox-skip-text")).toHaveTextContent("Ausgelassen: Zweifel am Signal");
    expect(JSON.parse(localStorage.getItem(SIGNAL_ARCHIVE_KEY)!).items[0]).toMatchObject({ skip: "doubt" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-skip-undo"));
    });
    // taking the reason back leaves it open again – it stays „angesehen“, the trader did look at it
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "angesehen");
  });

  it("im Journal verknüpfen: offers the trades nearby, links one, and lets go again", async () => {
    // a long BTC trade the window rule does not catch (a day after the signal)
    const near = enrichC([ct(at(2, 600), { id: "late", p: 10, pair: "BTC/USDT" })], COACH_SETTINGS);
    signal("s", when(1, 700), { side: "long", symbol: "BTCUSDT" });
    render(wrap(<SignalInboxCard list={near} now={when(5, 600)} />));
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "abgelaufen");
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-link"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-link-pick"));
    });
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "gehandelt");
    expect(screen.getByTestId("inbox-trades")).toHaveTextContent("von dir verknüpft");
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-link"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-link-undo"));
    });
    expect(screen.getByTestId("inbox-row")).toHaveAttribute("data-status", "abgelaufen");
  });

  it("without a trade nearby it says so", async () => {
    signal("s", NOW - H);
    render(wrap(<SignalInboxCard list={[]} now={NOW} />));
    await act(async () => {
      fireEvent.click(screen.getByTestId("inbox-link"));
    });
    expect(screen.getByTestId("inbox-link-panel")).toHaveTextContent(INBOX_STRINGS.linkNone);
  });

  it("collapses to a line with the counts and remembers it", () => {
    signal("a", NOW - H);
    signal("b", NOW - 2 * H);
    const { unmount } = render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    fireEvent.click(screen.getByTestId("inbox-toggle"));
    expect(screen.getByTestId("inbox-card")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("inbox-summary")).toHaveTextContent("2 neu");
    expect(screen.queryByTestId("inbox-row")).toBeNull();
    unmount();
    render(wrap(<SignalInboxCard list={trades} now={NOW} />));
    expect(screen.getByTestId("inbox-card")).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByTestId("inbox-toggle"));
    expect(screen.getAllByTestId("inbox-row")).toHaveLength(2);
  });
});

describe("SignalBalanceCard (F25)", () => {
  it("is empty without signals", () => {
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    expect(screen.getByTestId("balance-card")).toHaveAttribute("data-signals", "0");
    expect(screen.queryByTestId("outcome-run")).toBeNull();
  });

  it("shows the counts at once and the outcomes by themselves – no click – with the status line; „Neu berechnen“ reads the open ones again", async () => {
    const t0 = NOW - 2 * 24 * H;
    signal("w", t0, { stop: 95, target: 110 });
    signal("l", t0 + H, { stop: 95, target: 110 });
    signal("tr", when(0, 600) + 10 * 60_000, { stop: 95, target: 110 });
    signal("op", t0 + 2 * H, { stop: 80, target: 130, symbol: "ETHUSDT" });
    loadLabData.mockImplementation(async (req: { symbol: string }) => ({
      data: {
        "15m": req.symbol === "ETHUSDT" ? [bar15(t0 + 2 * H, 0, 100, 102, 99)] : [bar15(when(0, 600) + 10 * 60_000, 0, 100, 111, 99), bar15(t0, 0, 100, 111, 99), bar15(t0 + H, 0, 100, 101, 94)],
      },
      funding: null,
      pages: 1,
      viaProxy: false,
    }));
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    expect(loadLabData).not.toHaveBeenCalled(); // nothing is fetched while rendering
    const total = screen.getAllByTestId("balance-row").find((r) => r.getAttribute("data-key") === "alle")!;
    expect(total).toHaveAttribute("data-n", "4");
    expect(screen.getByTestId("balance-basis-line")).toHaveTextContent("Quelle: Signalarchiv dieses Geräts (nur bei offener App gesammelt) · 4 Ereignisse");
    expect(total).toHaveTextContent("Ausgang noch nicht ausgewertet");
    expect(screen.getByTestId("outcome-auto")).toHaveTextContent("Wird automatisch ausgewertet.");
    expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Noch nicht berechnet.");
    // no click: the evaluation starts by itself
    await waitFor(() => expect(screen.getByTestId("outcome-control")).toHaveAttribute("data-status", "done"));
    expect(loadLabData).toHaveBeenCalledTimes(2); // one load per market
    const row = screen.getAllByTestId("balance-row").find((r) => r.getAttribute("data-key") === "Einstiegs-Check")!;
    expect(row).toHaveAttribute("data-decided", "3");
    expect(row).toHaveTextContent("Ziel zuerst");
    expect(row.querySelector("[data-testid=balance-unc]")).toHaveTextContent("n 3 entschieden · Stichprobe zu wenig");
    // 2 targets (+2 R each), 1 stop (−1 R): the hit rate 67 %, Ø R +1,0 R; the open one does not count
    expect(row).toHaveTextContent("67 %");
    expect(row).toHaveTextContent("+1,00 R");
    // the status line: when, by whom, and the source
    expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Zuletzt berechnet: 08.03. 12:00 (automatisch) · Quelle: Binance USDⓈ-M, Kerzen 15 Minuten");
    expect(screen.getByTestId("outcome-control")).toHaveTextContent("3 von 4 mit Ausgang");
    expect(screen.getByTestId("outcome-run")).toHaveTextContent("Neu berechnen");
    expect(screen.queryByText("Ausgänge berechnen")).toBeNull();
    // the comparison: the journal booked the traded signal; the selection effect is named
    const cmp = screen.getByTestId("balance-compare");
    expect(cmp).toHaveTextContent("Deine Trades gegen alle Signale");
    expect(cmp).toHaveTextContent("Alle Signale (Ausgang am Kurs)");
    expect(screen.getByTestId("balance-selection")).toHaveTextContent("Auswahl");
    // the grouping and the basis can be switched
    fireEvent.click(screen.getByTestId("balance-by-tf"));
    expect(screen.getAllByTestId("balance-row").some((r) => r.getAttribute("data-key") === "1h")).toBe(true);
    fireEvent.click(screen.getByTestId("balance-basis-standard"));
    const total2 = screen.getAllByTestId("balance-row").find((r) => r.getAttribute("data-key") === "alle")!;
    expect(total2).toHaveAttribute("data-decided", "0");

    // „Neu berechnen“: only the open signal needs candles again (the three decided ones are final)
    loadLabData.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("outcome-run"));
    });
    await waitFor(() => expect(screen.getByTestId("outcome-stand")).toHaveTextContent("(von dir gestartet)"));
    expect(loadLabData).toHaveBeenCalledTimes(1);
    expect(loadLabData.mock.calls[0]![0]).toMatchObject({ symbol: "ETHUSDT" });
  });

  it("a market that cannot be loaded stays „nicht auswertbar“ with its reason and never counts as a result", async () => {
    signal("w", NOW - 2 * 24 * H, { stop: 95, target: 110 });
    loadLabData.mockRejectedValue(Object.assign(new Error("x"), { kind: "failed" }));
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    await waitFor(() => expect(screen.getByTestId("outcome-control")).toHaveAttribute("data-status", "done"));
    expect(screen.getByTestId("outcome-error")).toHaveTextContent("1 Signal ohne Marktdaten");
    const row = screen.getAllByTestId("balance-row").find((r) => r.getAttribute("data-key") === "Einstiegs-Check")!;
    expect(row).toHaveAttribute("data-decided", "0");
    expect(row).toHaveTextContent("Nicht auswertbar");
    expect(screen.getByTestId("outcome-control")).toHaveTextContent("0 von 1 mit Ausgang");
  });

  it("with data saving on it holds back, says so, and „Neu berechnen“ still works", async () => {
    signal("w", NOW - 2 * 24 * H, { stop: 95, target: 110 });
    loadLabData.mockResolvedValue({ data: { "15m": [bar15(NOW - 2 * 24 * H, 0, 100, 111, 99)] }, funding: null, pages: 1, viaProxy: false });
    __setAutoDeps({ env: () => ({ hidden: false, saveData: true, batteryLow: false, offline: false }) });
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    expect(screen.getByTestId("outcome-control")).toHaveAttribute("data-auto", "paused");
    expect(screen.getByTestId("outcome-auto")).toHaveTextContent("Automatische Auswertung pausiert: der Datensparmodus ist an.");
    await new Promise((r) => setTimeout(r, 20));
    expect(loadLabData).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("outcome-run"));
    });
    await waitFor(() => expect(screen.getByTestId("outcome-control")).toHaveAttribute("data-status", "done"));
    expect(loadLabData).toHaveBeenCalledTimes(1);
  });

  it("shows the cached final outcomes after a reload without a request", async () => {
    const t0 = NOW - 2 * 24 * H;
    signal("w", t0, { stop: 95, target: 110 });
    loadLabData.mockResolvedValue({ data: { "15m": [bar15(t0, 0, 100, 111, 99)] }, funding: null, pages: 1, viaProxy: false });
    const first = render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    await waitFor(() => expect(screen.getByTestId("outcome-control")).toHaveAttribute("data-status", "done"));
    first.unmount();
    __resetOutcomes();
    loadLabData.mockClear();
    render(wrap(<SignalBalanceCard list={trades} now={NOW} />));
    await waitFor(() => expect(screen.getAllByTestId("balance-row")[0]).toHaveAttribute("data-decided", "1"));
    // the stored last run is shown, too – and nothing is requested for a final result
    await waitFor(() => expect(screen.getByTestId("outcome-stand")).toHaveTextContent("Zuletzt berechnet:"));
    await new Promise((r) => setTimeout(r, 20));
    expect(loadLabData).not.toHaveBeenCalled();
  });
});

describe("DataQualityCard (F27)", () => {
  it("always shows that alerts run only while the app is open; without a trace the open share is unknown", () => {
    render(wrap(<DataQualityCard now={NOW} />));
    expect(screen.getByTestId("quality-banner")).toHaveTextContent("Alarme laufen nur bei offener App");
    expect(screen.getByTestId("quality-presence-unknown")).toHaveTextContent("unbekannt");
    expect(screen.getByTestId("quality-nodelay")).toBeInTheDocument();
    expect(screen.getByTestId("quality-nolog")).toBeInTheDocument();
  });

  it("reads the open share and the breaks from the presence trace, the delay from the archive, the counts from the log", () => {
    const start = NOW - 10 * H;
    localStorage.setItem(PRESENCE_KEY, JSON.stringify({ v: 1, segs: [{ id: "x", a: start, b: start + 4 * H }, { id: "x", a: start + 6 * H, b: NOW }] }));
    const close = NOW - 3 * H;
    signal("d1", close + 60_000, { barClose: close });
    signal("d2", close + 80_000 + H, { barClose: close + H });
    recordDelivery({ source: "key", levelId: "l", title: "A", detail: "", stage: "confirm", basis: "close", channels: ["toast"], outcome: "sent", dedupeKey: "k1", at: NOW - H });
    recordDelivery({ source: "key", levelId: "l", title: "A", detail: "", stage: "confirm", basis: "close", channels: [], outcome: "hours", dedupeKey: "k2", at: NOW - 2 * H });
    recordDelivery({ source: "key", levelId: "l", title: "A", detail: "", stage: "confirm", basis: "close", channels: [], outcome: "duplicate", dedupeKey: "k3", at: NOW - 3 * H });
    render(wrap(<DataQualityCard now={NOW} />));
    const p = screen.getByTestId("quality-presence");
    expect(p).toHaveTextContent("80 %"); // 8 h open of 10 h
    expect(p).toHaveTextContent("1 · zusammen 2 Std");
    expect(screen.getAllByTestId("quality-outage")).toHaveLength(1);
    expect(screen.getByTestId("quality-delays")).toHaveTextContent("Median 1 Min 10 s");
    const d = screen.getByTestId("quality-delivery");
    expect(d).toHaveAttribute("data-sent", "1");
    expect(d).toHaveAttribute("data-duplicate", "1");
    expect(d).toHaveAttribute("data-hours", "1");
  });

  it("the sent lines say which alarm they came from – the entry check and the box evaluation are in the log as sent lines", () => {
    recordDelivery({ source: "key", levelId: "l", title: "A", detail: "", stage: "confirm", basis: "close", channels: ["toast"], outcome: "sent", dedupeKey: "k1", at: NOW - H });
    logExternalDelivery("signal", "Einstiegs-Check BTCUSDT", "Long, 4 von 5 Bedingungen");
    logExternalDelivery("signal", "Einstiegs-Check ETHUSDT", "Short");
    logExternalDelivery("box", "Box 4h BTCUSDT", "Ausbruch");
    render(wrap(<DataQualityCard now={NOW} />));
    expect(screen.getByTestId("quality-delivery")).toHaveAttribute("data-sent", "4");
    const s = screen.getByTestId("quality-delivery-sources");
    expect(s).toHaveAttribute("data-key", "1");
    expect(s).toHaveAttribute("data-signal", "2");
    expect(s).toHaveAttribute("data-box", "1");
    expect(s).toHaveTextContent("davon Schlüsselmarken 1 · Einstiegs-Check 2 · Box-zu-Box 1");
  });

  it("checks the candles only on request and lists the holes", async () => {
    signal("m", NOW - H, { symbol: "ETHUSDT" });
    const to = Math.floor(NOW / H) * H - H;
    // hours 0..4 and 8..: 3 hours missing
    const hours = [0, 1, 2, 3, 4, 8, 9, 10].map((i) => ({ t: (to - 14 * 24 * H + i * H) / 1000, o: 1, h: 1, l: 1, c: 1 }));
    hours.push({ t: to / 1000, o: 1, h: 1, l: 1, c: 1 });
    loadLabData.mockResolvedValue({ data: { "1h": hours }, funding: null, pages: 1, viaProxy: false });
    render(wrap(<DataQualityCard now={NOW} />));
    expect(loadLabData).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("quality-check"));
    });
    await screen.findAllByTestId("quality-gap");
    const gap = screen.getAllByTestId("quality-gap").find((g) => g.getAttribute("data-symbol") === "ETHUSDT")!;
    expect(gap).toHaveTextContent("Lücke");
    expect(Number(gap.getAttribute("data-missing"))).toBeGreaterThanOrEqual(3);
    expect(loadLabData.mock.calls.map((c) => (c[0] as { symbol: string }).symbol)).toContain("ETHUSDT");
    expect(loadLabData.mock.calls[0]![0]).toMatchObject({ intervals: ["1h"], funding: false });
  });
});

describe("MonthBenefitCard (F60)", () => {
  function page(over: { trades?: ReturnType<typeof enrichC>; days?: Record<string, unknown> } = {}): ReportPage {
    const list = over.trades ?? enrichC([ct(at(1, 600), { id: "a", p: 100, notes: "ok", followedPlan: true }), ct(at(2, 600), { id: "b", p: -80, followedPlan: false })], COACH_SETTINGS);
    const view = accountView(list, COACH_SETTINGS, "all", { now: () => NOW });
    const events = detectBehaviors({ trades: list, settings: COACH_SETTINGS });
    const report = buildReport({ list: view.list, settings: COACH_SETTINGS, days: over.days as never, events, start: view.start, currency: "USDT", period: periodOf("month", new Date(2026, 2, 8)), now: NOW });
    return { report, settings: COACH_SETTINGS, events, days: over.days, now: NOW, view } as unknown as ReportPage;
  }

  it("counts what is recorded and flags a trace that does not reach the month's start", () => {
    signal("e", when(3, 600));
    render(wrap(<MonthBenefitCard page={page()} />));
    const card = screen.getByTestId("benefit-card");
    expect(card).toHaveTextContent("Was hat dir das Journal diesen Monat gebracht?");
    expect(screen.getByTestId("benefit-entries")).toHaveTextContent("Trades im Monat");
    expect(screen.getByTestId("benefit-review")).toHaveTextContent("1 von 2 (50 %)");
    expect(screen.getByTestId("benefit-rules")).toHaveTextContent("1 von 2 (50 %)");
    expect(screen.getByTestId("benefit-alerts")).toHaveTextContent("Das Signalarchiv reicht nur bis");
    expect(screen.getByTestId("benefit-experiments")).toHaveTextContent("Kein angenommenes Wochenexperiment");
    // what it never claims
    expect(screen.getByTestId("benefit-limits-text")).toHaveTextContent("Regelverstöße, die du vermieden hast, lassen sich nicht zählen");
    expect(card.textContent).not.toMatch(/gespart:|Ersparnis/);
  });

  it("an empty month says so", () => {
    render(wrap(<MonthBenefitCard page={page({ trades: [] })} />));
    expect(screen.getByTestId("benefit-card")).toHaveAttribute("data-empty", "true");
    expect(screen.getByTestId("benefit-card")).toHaveTextContent("Für diesen Monat ist nichts protokolliert");
  });
});
