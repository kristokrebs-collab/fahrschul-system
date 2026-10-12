/**
 * Berichte page (P04, `src/views/berichte`): the empty journal (honest empty states, nothing to export, no "Bericht
 * bereit"), a journal (the newest finished week by default, kind / period / focus switches, the seen marker after a
 * look, Markdown export through `download`, the PDF print view mounted while `window.print()` runs), the "Bericht
 * bereit" host (once per period and device, "Bericht öffnen" selects the report) and the pure helpers (deep-link seam,
 * period bars).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { coachPrefsOf } from "@/domain/coach";
import { buildReport, periodFromKey } from "@/domain/reports";
import type { Trade } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { readRaw } from "@/store/storage";
import { useUi } from "@/store/uiStore";
import { BerichteView, berichteQuery, berichtePeriodFromQuery, openReport, periodBars, PRINT_CLASS, READY_KEY, readAnnounced, ReportReadyHost, resolvePeriod, useBerichteUi } from "@/views/berichte";
import { COACH_SETTINGS, coachJournal, ct, enrichC } from "./coach.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const downloads = vi.hoisted(() => [] as { name: string; data: string; mime?: string }[]);
vi.mock("@/store/download", () => ({
  download: async (name: string, data: string, mime?: string) => {
    downloads.push({ name, data, mime });
    return true;
  },
}));

const DAY = 86_400_000;
const local = (ms: number) => nowLocalInput(new Date(ms));

function reduceMotion() {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduced-motion"),
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderView() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <BerichteView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

async function load(trades: Trade[]) {
  await act(async () => {
    useJournal.setState({ trades, settings: { ...COACH_SETTINGS } });
  });
}

/** Trades every day of the last five weeks, relative to now (the last finished week has trades). */
function recent(now = Date.now()): Trade[] {
  const out: Trade[] = [];
  for (let d = 35; d >= 1; d--) out.push(ct(local(now - d * DAY), { id: `w${d}`, p: d % 3 ? 120 : -100, exitDate: local(now - d * DAY + 3_600_000) }));
  return out;
}

describe("BerichteView", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useBerichteUi.getState().reset();
    downloads.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    useUi.setState({ acc: "all", toasts: [] });
  });

  it("empty journal: h1, honest empty states, export locked", async () => {
    await load([]);
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Berichte" })).toBeInTheDocument();
    expect(screen.getByTestId("report-summary")).toHaveTextContent("Keine abgeschlossenen Trades");
    expect(screen.getByTestId("report-archive")).toHaveTextContent("Noch kein abgeschlossener Zeitraum");
    expect(screen.getByTestId("report-export-md")).toBeDisabled();
    expect(screen.getByTestId("report-export-pdf")).toBeDisabled();
    expect(screen.queryByTestId("report-performance")).toBeNull();
    // no older trades: no walk back through empty periods
    expect(screen.getByTestId("report-prev")).toBeDisabled();
  });

  it("journal: the newest finished week, kind / period / focus switches, the archive", async () => {
    const trades = coachJournal(90, 11);
    await load(trades);
    renderView();
    const view = screen.getByTestId("berichte-view");
    expect(view).toHaveAttribute("data-kind", "week");
    const key = view.getAttribute("data-key")!;
    expect(key).toMatch(/^2026-W\d{2}$/);
    // the newest week with trades of the journal (it ends at the end of May 2026)
    const last = trades.map((t) => t.date).sort().at(-1)!;
    expect(periodFromKey(key)!.from).toBeLessThanOrEqual(new Date(last).getTime());
    expect(screen.getByTestId("report-hero")).toHaveTextContent("abgeschlossen");
    for (const id of ["report-performance", "report-compare", "report-strategy", "report-risk", "report-psych", "report-mistakes", "report-goals"]) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("report-strategy")).toHaveTextContent("Breakout");

    fireEvent.click(screen.getByTestId("report-prev"));
    expect(view.getAttribute("data-key")).not.toBe(key);
    expect(useBerichteUi.getState().dir).toBe("down");
    fireEvent.click(screen.getByTestId("report-newest"));
    expect(view).toHaveAttribute("data-key", key);

    fireEvent.click(screen.getByRole("radio", { name: "Monat" }));
    expect(view).toHaveAttribute("data-kind", "month");
    expect(view.getAttribute("data-key")).toMatch(/^2026-\d{2}$/);
    expect(within(screen.getByTestId("report-archive")).getAllByTestId("report-archive-row").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("report-columns")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("report-focus").find((b) => b.textContent === "Risiko")!);
    expect(screen.getByTestId("report-risk")).toBeInTheDocument();
    expect(screen.queryByTestId("report-strategy")).toBeNull();
    expect(screen.queryByTestId("report-performance")).toBeNull();
    expect(screen.queryByTestId("report-goals")).toBeNull();
  });

  it("marks a finished report seen after a look, exports Markdown and prints the light view", async () => {
    await load(coachJournal(90, 11));
    renderView();
    const key = screen.getByTestId("berichte-view").getAttribute("data-key")!;
    await waitFor(() => expect(coachPrefsOf(useJournal.getState().settings).seen).toContain(key), { timeout: 4000 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("report-export-md"));
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.name).toBe(`bericht-${key}.md`);
    expect(downloads[0]!.data).toMatch(/^# Wochenbericht · KW \d+ · 2026/);
    expect(useUi.getState().toasts.some((t) => t.title === "Markdown gespeichert")).toBe(true);

    const seen: { cls: boolean; doc: boolean }[] = [];
    window.print = () => {
      seen.push({ cls: document.documentElement.classList.contains(PRINT_CLASS), doc: !!document.querySelector(".report-print-root [data-testid=report-print]") });
    };
    fireEvent.click(screen.getByTestId("report-export-pdf"));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ cls: true, doc: true });
    await waitFor(() => expect(document.querySelector(".report-print-root")).toBeNull(), { timeout: 2000 });
    expect(document.documentElement.classList.contains(PRINT_CLASS)).toBe(false);
  });
});

describe("ReportReadyHost", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useBerichteUi.getState().reset();
    localStorage.removeItem(READY_KEY);
  });

  it("announces the period that just ended once per device; 'Bericht öffnen' selects it", async () => {
    await load(recent());
    const onOpen = vi.fn();
    const { unmount } = render(
      <MotionRoot>
        <ReportReadyHost onOpen={onOpen} />
      </MotionRoot>,
    );
    const ready = await screen.findByTestId("report-ready");
    const key = ready.getAttribute("data-key")!;
    expect(ready).toHaveTextContent(/(Wochen|Monats|Quartals|Jahres)bericht/);
    expect(readAnnounced()).toContain(key);
    expect(readRaw(READY_KEY)).toContain(key);
    fireEvent.click(screen.getByTestId("report-ready-open"));
    expect(onOpen).toHaveBeenCalledWith(key);
    expect(useBerichteUi.getState().key).toBe(key);
    unmount();

    // a new mount (reload) does not announce it again
    render(
      <MotionRoot>
        <ReportReadyHost onOpen={onOpen} />
      </MotionRoot>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("report-ready")).toBeNull();
  });

  it("stays silent for an empty journal", async () => {
    await load([]);
    render(
      <MotionRoot>
        <ReportReadyHost />
      </MotionRoot>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("report-ready")).toBeNull();
  });
});

describe("berichte helpers", () => {
  it("deep link seam #berichte?p=<key>", () => {
    expect(berichteQuery("2026-W41")).toBe("p=2026-W41");
    expect(berichtePeriodFromQuery("p=2026-W41")).toBe("2026-W41");
    expect(berichtePeriodFromQuery("?p=2026-Q3")).toBe("2026-Q3");
    expect(berichtePeriodFromQuery("p=kaputt")).toBeNull();
    expect(berichtePeriodFromQuery(null)).toBeNull();
    expect(openReport("2026-10")).toBe(true);
    expect(useBerichteUi.getState()).toMatchObject({ kind: "month", key: "2026-10" });
    expect(openReport("nope")).toBe(false);
  });

  it("resolvePeriod: the chosen key of the kind, else the newest archive entry, else the last finished period", () => {
    const now = new Date(2026, 9, 12, 12).getTime();
    expect(resolvePeriod("week", "2026-W40", [], now).key).toBe("2026-W40");
    expect(resolvePeriod("month", "2026-W40", [], now).key).toBe("2026-09");
  });

  it("periodBars: per trade for a day, per day for a week, per week for a quarter", () => {
    const list = enrichC(coachJournal(30, 3));
    const day = periodFromKey(list[0]!.date.slice(0, 10))!;
    const rDay = buildReport({ list, settings: COACH_SETTINGS, events: [], start: 10_000, currency: "USDT", period: day, now: Date.now() });
    expect(periodBars(rDay)).toHaveLength(rDay.trades.length);
    const week = periodFromKey("2026-W11")!;
    const rWeek = buildReport({ list, settings: COACH_SETTINGS, events: [], start: 10_000, currency: "USDT", period: week, now: Date.now() });
    const bars = periodBars(rWeek);
    expect(bars.length).toBe(rWeek.performance.days.length);
    expect(bars.reduce((s, b) => s + b.value, 0)).toBeCloseTo(rWeek.performance.g.net, 6);
    const q = periodFromKey("2026-Q1")!;
    const rQ = buildReport({ list, settings: COACH_SETTINGS, events: [], start: 10_000, currency: "USDT", period: q, now: Date.now() });
    expect(periodBars(rQ).length).toBeLessThanOrEqual(14);
  });
});
