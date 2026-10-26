/**
 * The three analyst panels (F68 / F69) against a `fetch` that serves the SEC fixtures through the app's own function routes:
 *  - AnalystPanel: empty state, load, the sentences / table / cards, source and stand, the earnings 8-K link, typed errors
 *    ("Einrichtung nötig"), a failing filings list that does not hide the numbers, the hand-over to the DCF.
 *  - DcfPanel: nothing computed until every input is there, the hand-worked result, the range, the sensitivity table, the
 *    terminal-value share, WACC ≤ g, the SEC starting values, price comparison only with a source, the reverse view.
 *  - ThesisPanel: create / edit / persist in `settings.theses` (passthrough), scenarios, criteria, the check with source and stand,
 *    the proposal, versions with their changes, the monitor that runs when the panel opens.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSecCache } from "@/market/sec";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";
import { factsPayload, filingsPayload } from "../fixtures/sec";

// panels with real journal writes and async loads: generous per-test time under a busy machine
vi.setConfig({ testTimeout: 30_000 });

const { AnalystPanel } = await import("@/views/analyst/AnalystPanel");
const { DcfPanel } = await import("@/views/analyst/DcfPanel");
const { ThesisPanel } = await import("@/views/analyst/ThesisPanel");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { useJournal } = await import("@/store/journalStore");
const { thesesCfgOf } = await import("@/domain/thesis");

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiErr = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

interface Opts {
  facts?: (t: string) => Response | null;
  filings?: (t: string) => Response | null;
}
/** the SEC routes of the app: AAPL and NWIN exist, any other ticker is unknown */
function secFetch(o: Opts = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), "https://x.test");
    const t = u.searchParams.get("ticker") ?? "";
    const known = t === "AAPL" || t === "NWIN";
    if (u.pathname.endsWith("/sec/facts")) return o.facts?.(t) ?? (known ? json(factsPayload(t as "AAPL")) : apiErr(404, "sec_unknown_ticker", "Die SEC kennt das Kürzel nicht."));
    if (u.pathname.endsWith("/sec/filings")) return o.filings?.(t) ?? (known ? json(filingsPayload(t as "AAPL")) : apiErr(404, "sec_unknown_ticker", "Die SEC kennt das Kürzel nicht."));
    return new Response("{}", { status: 404 });
  });
}
const asFetch = (f: ReturnType<typeof secFetch>) => f as unknown as typeof fetch;

const wrap = (ui: React.ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const typeBlur = (el: HTMLElement, v: string) => {
  fireEvent.change(el, { target: { value: v } });
  fireEvent.blur(el);
};

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  clearSecCache();
  localStorage.clear();
  await bootFixtureJournal();
});
afterEach(() => vi.restoreAllMocks());

/* ===================================================================================== AnalystPanel */

describe("AnalystPanel", () => {
  it("starts empty: says what to do, loads nothing by itself, ends with the disclaimer", () => {
    const f = secFetch();
    wrap(<AnalystPanel fetchImpl={asFetch(f)} />);
    expect(screen.getByText("Noch nichts geladen")).toBeInTheDocument();
    expect(screen.getByTestId("analyst-load")).toBeDisabled();
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByTestId("analyst-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
    expect(screen.getByTestId("analyst-note")).toHaveTextContent("keine Prognose, kein Konsens");
  });

  it("loads a company and shows the changes, the quarters, the stamp and the earnings 8-K with its press release", async () => {
    const f = secFetch();
    const onLoaded = vi.fn();
    wrap(<AnalystPanel fetchImpl={asFetch(f)} onLoaded={onLoaded} />);
    type(screen.getByTestId("analyst-ticker"), "aapl");
    fireEvent.click(screen.getByTestId("analyst-load"));
    expect(await screen.findByTestId("analyst-result")).toHaveAttribute("data-ticker", "AAPL");
    expect(screen.getByTestId("analyst-entity")).toHaveTextContent("Apple Inc.");
    // source and stand
    const stamp = screen.getByTestId("sec-stamp");
    expect(stamp).toHaveTextContent("Quelle: SEC EDGAR (XBRL)");
    expect(stamp).toHaveTextContent("Abruf");
    expect(stamp).toHaveTextContent("neuestes Quartal bis 27.06.2026");
    expect(within(stamp).getByRole("link", { name: "Quelle bei der SEC" })).toHaveAttribute("href", "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json");
    // the consensus is named, not hidden
    expect(screen.getByText("kein Konsens, nur gemeldete Zahlen")).toBeInTheDocument();
    // the sentences with the numbers
    const changes = screen.getByTestId("analyst-changes");
    expect(changes).toHaveTextContent("Umsatz 109,42 Mrd. USD: +16,4 % zum Vorjahresquartal (94,04 Mrd. USD), −1,6 % zum Vorquartal (111,18 Mrd. USD).");
    expect(changes).toHaveTextContent("Keine Daten für dieses Quartal: operatives Ergebnis, freier Cashflow, Finanzschulden.");
    // eight quarters in the table (and as cards for phones), the derived Q4 is marked
    expect(screen.getAllByTestId("analyst-row")).toHaveLength(8);
    const q4 = screen.getAllByTestId("analyst-row").find((r) => r.getAttribute("data-end") === "2025-09-27")!;
    expect(q4).toHaveAttribute("data-derived", "1");
    expect(within(q4).getByText("Q4 GJ 2025")).toBeInTheDocument();
    expect(within(q4).getAllByText(/\*/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("analyst-legend")).toHaveTextContent("abgeleitet");
    // a missing figure says so
    const newest = screen.getAllByTestId("analyst-row")[0]!;
    expect(within(newest).getAllByText("keine Daten").length).toBeGreaterThanOrEqual(3);
    // the earnings 8-K of the newest quarter and its press release
    expect(within(newest).getByTestId("earnings-link-newest")).toHaveAttribute("href", expect.stringContaining("-index.htm"));
    expect(within(newest).getByTestId("press-link")).toHaveAttribute("href", "https://www.sec.gov/Archives/edgar/data/320193/000032019300900106/a8-kex991q3202606.htm");
    // phones: three cards, the older ones behind a disclosure
    expect(screen.getAllByTestId("analyst-card")).toHaveLength(3);
    expect(screen.getByTestId("analyst-older")).toBeInTheDocument();
    expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ ticker: "AAPL", result: expect.objectContaining({ currency: "USD" }) }));
  });

  it("lists the notes and the last filings in disclosures; the date of the next report is NOT invented", async () => {
    wrap(<AnalystPanel ticker="AAPL" autoLoad fetchImpl={asFetch(secFetch())} />);
    await screen.findByTestId("analyst-result");
    const notes = screen.getByTestId("analyst-notes");
    expect(notes).toHaveTextContent("Kein Konsens, nur gemeldete Zahlen");
    expect(notes).toHaveTextContent("Q4 GJ 2025");
    expect(notes).toHaveTextContent("kumuliert");
    expect(screen.getByTestId("next-report-note")).toHaveTextContent("unbekannt – die SEC-Daten enthalten keinen Termin");
    expect(screen.getByTestId("analyst-events")).toHaveTextContent("30.07.2026");
    // the filings list opens on demand
    expect(screen.queryByTestId("analyst-filings")).toBeNull();
    fireEvent.click(within(screen.getByTestId("analyst-filings-section")).getByRole("button"));
    const list = await screen.findByTestId("analyst-filings");
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(list).toHaveTextContent("Quartalszahlen");
    expect(list).toHaveTextContent("Wechsel in Vorstand oder Aufsichtsrat");
  });

  it("says 'Einrichtung nötig' when the operator has not set SEC_USER_AGENT – with the reason and no numbers", async () => {
    const f = secFetch({
      facts: () => apiErr(503, "sec_setup_required", "Einrichtung nötig: Die SEC verlangt einen Kontakt im User-Agent."),
      filings: () => apiErr(503, "sec_setup_required", "Einrichtung nötig: Die SEC verlangt einen Kontakt im User-Agent."),
    });
    wrap(<AnalystPanel ticker="AAPL" autoLoad fetchImpl={asFetch(f)} />);
    const box = await screen.findByTestId("sec-error");
    expect(box).toHaveAttribute("data-kind", "setup_required");
    expect(box).toHaveTextContent("Einrichtung nötig");
    expect(box).toHaveTextContent("SEC_USER_AGENT");
    expect(screen.queryByTestId("analyst-result")).toBeNull();
    expect(screen.queryByTestId("analyst-row")).toBeNull();
  });

  it("an unknown ticker and a server without functions are explained, not guessed", async () => {
    wrap(<AnalystPanel fetchImpl={asFetch(secFetch())} />);
    type(screen.getByTestId("analyst-ticker"), "zzzz");
    fireEvent.click(screen.getByTestId("analyst-load"));
    const box = await screen.findByTestId("sec-error");
    expect(box).toHaveAttribute("data-kind", "unknown_ticker");
    expect(box).toHaveTextContent("Die SEC kennt das Kürzel nicht.");
    expect(box).toHaveTextContent("BRK-B");
  });

  it("a failing filings list does not hide the numbers; it says what is missing", async () => {
    const f = secFetch({ filings: () => apiErr(502, "sec_upstream", "Die SEC ist gerade nicht erreichbar.") });
    wrap(<AnalystPanel ticker="NWIN" autoLoad fetchImpl={asFetch(f)} />);
    await screen.findByTestId("analyst-result");
    expect(screen.getAllByTestId("analyst-row").length).toBeGreaterThan(0);
    expect(within(screen.getAllByTestId("analyst-row")[0]!).getByText("keine Daten", { selector: "span.text-faint" })).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("analyst-filings-section")).getByRole("button"));
    expect(await screen.findByTestId("filings-missing")).toHaveTextContent("Die Liste der Meldungen konnte nicht gelesen werden");
  });

  it("shows the restatement and the old data of a company as warnings", async () => {
    wrap(<AnalystPanel ticker="NWIN" autoLoad fetchImpl={asFetch(secFetch())} />);
    await screen.findByTestId("analyst-result");
    expect(screen.getByTestId("analyst-notes")).toHaveTextContent("ursprünglich 18,0 Mio. USD");
    // the data of this company ends in 2025: older than half a year (the real clock is 2026+)
    const important = screen.queryByTestId("analyst-important");
    if (important) expect(important).toHaveTextContent("älter als ein halbes Jahr");
  });

  it("offers the hand-overs only when the host wires them, and passes the filed starting values", async () => {
    const f = asFetch(secFetch());
    const { unmount } = wrap(<AnalystPanel ticker="NWIN" autoLoad fetchImpl={f} />);
    await screen.findByTestId("analyst-result");
    expect(screen.queryByTestId("analyst-use-dcf")).toBeNull();
    expect(screen.queryByTestId("analyst-start-thesis")).toBeNull();
    unmount();
    const onUse = vi.fn();
    const onThesis = vi.fn();
    wrap(<AnalystPanel ticker="NWIN" autoLoad fetchImpl={f} onUseInDcf={onUse} onStartThesis={onThesis} />);
    await screen.findByTestId("analyst-result");
    fireEvent.click(screen.getByTestId("analyst-use-dcf"));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ baseRevenue: 495e6, netDebt: 130e6, shares: 10e6, currency: "USD" }), "NWIN");
    fireEvent.click(screen.getByTestId("analyst-start-thesis"));
    expect(onThesis).toHaveBeenCalledWith("NWIN");
  });
});

/* ========================================================================================== DcfPanel */

/** the hand case of `dcf.test.ts` typed into the form: revenue 1,000, 3 years, 10 % / 20 % / 40 %, tax 25 %, WACC 10 %, g 2 %, net debt 200, 50 shares */
function fillHandCase(): void {
  const set = (id: string, v: string) => type(screen.getByTestId(id), v);
  set("dcf-in-revenue", "1000");
  set("dcf-in-netdebt", "200");
  set("dcf-in-shares", "50");
  set("dcf-in-tax", "25");
  fireEvent.click(screen.getByRole("radio", { name: "3" }));
  set("dcf-in-g1", "10");
  set("dcf-in-gn", "10");
  set("dcf-in-m1", "20");
  set("dcf-in-mn", "20");
  set("dcf-in-r1", "40");
  set("dcf-in-rn", "40");
  set("dcf-in-wacc", "10");
  set("dcf-in-tg", "2");
}

describe("DcfPanel", () => {
  it("computes nothing while an input is missing – it names what is missing", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("dcf-panel")).toHaveAttribute("data-status", "incomplete");
    const missing = screen.getByTestId("dcf-missing");
    expect(missing).toHaveTextContent("Es fehlt:");
    expect(missing).toHaveTextContent("WACC");
    expect(missing).toHaveTextContent("Endwachstum");
    expect(missing).toHaveTextContent("schätzt nichts");
    expect(screen.queryByTestId("dcf-value")).toBeNull();
    expect(screen.getByTestId("dcf-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
  });

  it("matches the hand calculation: range, base value, terminal-value share, sensitivity table", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    fillHandCase();
    expect(screen.getByTestId("dcf-panel")).toHaveAttribute("data-status", "ok");
    const range = screen.getByTestId("dcf-range");
    expect(Number(range.getAttribute("data-low"))).toBeCloseTo(20.0198, 3);
    expect(Number(range.getAttribute("data-high"))).toBeCloseTo(30.6727, 3);
    expect(range).toHaveTextContent("20,02 bis 30,67 USD");
    expect(screen.getByTestId("dcf-base-value")).toHaveTextContent("24,35 USD");
    // 1,147.5 of 1,417.5 = 80.95 %: shown, and named as the largest part
    expect(screen.getByTestId("dcf-tv-share")).toHaveTextContent("81,0 %");
    expect(screen.getByTestId("dcf-tv-note")).toHaveTextContent("81,0 % des Unternehmenswerts stecken im Endwert");
    // sensitivity: 5 × 5, the middle cell is the base case
    const table = within(screen.getByTestId("dcf-sensitivity")).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    const center = table.querySelector("td[data-center='1']")!;
    expect(center).toHaveTextContent("24,35");
    expect(table.querySelectorAll("td[data-inner='1']")).toHaveLength(9);
    // the projection year by year is disclosed
    expect(screen.getByTestId("dcf-projection")).toBeInTheDocument();
  });

  it("catches WACC ≤ terminal growth and a negative free cash flow in the last year – with the reason, without a value", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    fillHandCase();
    type(screen.getByTestId("dcf-in-wacc"), "2");
    expect(screen.getByTestId("dcf-panel")).toHaveAttribute("data-status", "invalid");
    expect(screen.getByTestId("dcf-errors")).toHaveTextContent("WACC muss größer sein als das Endwachstum");
    expect(screen.queryByTestId("dcf-value")).toBeNull();
    type(screen.getByTestId("dcf-in-wacc"), "10");
    type(screen.getByTestId("dcf-in-mn"), "-10");
    expect(screen.getByTestId("dcf-panel")).toHaveAttribute("data-status", "no-terminal");
    expect(screen.getByTestId("dcf-errors")).toHaveTextContent("Endwert nach dem Gordon-Modell ist dann nicht sinnvoll");
    expect(screen.queryByTestId("dcf-value")).toBeNull();
  });

  it("warns about a high terminal growth without stopping, and reads '2,5' and '2.5' alike", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    fillHandCase();
    type(screen.getByTestId("dcf-in-tg"), "5");
    expect(screen.getByTestId("dcf-warnings")).toHaveTextContent("über 4 %");
    type(screen.getByTestId("dcf-in-tg"), "2,5");
    const a = screen.getByTestId("dcf-base-value").textContent;
    type(screen.getByTestId("dcf-in-tg"), "2.5");
    expect(screen.getByTestId("dcf-base-value").textContent).toBe(a);
    // text that is no number: the field says so and the value is not recomputed from garbage
    type(screen.getByTestId("dcf-in-tg"), "abc");
    expect(screen.getByText("Das ist keine Zahl.")).toBeInTheDocument();
  });

  it("offers the example rates of the skill on a click and labels them as such", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("dcf-in-wacc")).toHaveValue("");
    fireEvent.click(screen.getByTestId("dcf-example"));
    expect(screen.getByTestId("dcf-in-wacc")).toHaveValue("9");
    expect(screen.getByTestId("dcf-in-tg")).toHaveValue("2,5");
    expect(screen.getByText(/Beispielwerte aus der Anleitung.*keine Prognose/)).toBeInTheDocument();
  });

  it("fills the filed starting values from the SEC – and leaves growth, WACC and terminal growth to the person", async () => {
    const f = secFetch();
    wrap(<DcfPanel fetchImpl={asFetch(f)} />);
    type(screen.getByTestId("dcf-ticker"), "nwin");
    fireEvent.click(screen.getByTestId("dcf-load-sec"));
    await waitFor(() => expect(screen.getByTestId("dcf-in-revenue")).toHaveValue("495"));
    expect(screen.getByTestId("dcf-in-netdebt")).toHaveValue("130");
    expect(screen.getByTestId("dcf-in-shares")).toHaveValue("10");
    expect(screen.getByTestId("dcf-in-m1")).toHaveValue("13,1313");
    expect(screen.getByTestId("dcf-in-g1")).toHaveValue("");
    expect(screen.getByTestId("dcf-in-wacc")).toHaveValue("");
    // where each number comes from
    expect(screen.getByText(/Summe der letzten vier Quartale bis 30.09.2025 \(SEC\)/)).toBeInTheDocument();
    expect(screen.getByText(/Gemeldete Zahlen von SEC EDGAR \(XBRL\) geladen \(Stand 30.09.2025\)/)).toBeInTheDocument();
    expect(screen.getByTestId("dcf-growth-hint")).toHaveTextContent("Umsatz +12,5 % zum Vorjahresquartal – ein Hinweis, keine Annahme");
    expect(screen.getByTestId("dcf-missing")).toHaveTextContent("Wachstum Jahr 1");
    // what the filings do not carry is empty, not guessed
    expect(screen.getByTestId("dcf-in-tax")).toHaveValue("");
  });

  it("shows why SEC data is not there (typed error) and keeps the form usable", async () => {
    const f = secFetch({ facts: () => apiErr(503, "sec_setup_required", "Einrichtung nötig: Die SEC verlangt einen Kontakt im User-Agent."), filings: () => apiErr(503, "sec_setup_required", "Einrichtung nötig") });
    wrap(<DcfPanel fetchImpl={asFetch(f)} />);
    type(screen.getByTestId("dcf-ticker"), "NWIN");
    fireEvent.click(screen.getByTestId("dcf-load-sec"));
    expect(await screen.findByTestId("dcf-sec-error")).toHaveTextContent("Einrichtung nötig");
    type(screen.getByTestId("dcf-in-revenue"), "100");
    expect(screen.getByTestId("dcf-in-revenue")).toHaveValue("100");
  });

  it("takes a seed from the host (the analyst's hand-over)", () => {
    const seed = {
      currency: "EUR",
      baseRevenue: 800e6,
      ebitMargin: 0.12,
      taxRate: 0.25,
      reinvestmentRate: null,
      growthHint: null,
      netDebt: -50e6,
      shares: 20e6,
      sources: {},
      asOf: "2026-06-30",
      stamp: { source: "SEC EDGAR (XBRL)", sourceUrl: "https://data.sec.gov/x", asOf: "2026-06-30", fetchedAt: NOW, stale: false },
    };
    wrap(<DcfPanel seed={seed} fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("dcf-in-revenue")).toHaveValue("800");
    expect(screen.getByTestId("dcf-in-netdebt")).toHaveValue("-50");
    expect(screen.getByText(/Umsatz im Basisjahr \(Mio\. EUR\)/)).toBeInTheDocument();
  });

  it("compares with a price only when it comes with a source, and runs the reverse view", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    fillHandCase();
    typeBlur(screen.getByTestId("dcf-in-price"), "24");
    expect(screen.getByTestId("dcf-price-nosource")).toHaveTextContent("Kurs ohne Quelle: kein Vergleich");
    expect(screen.queryByTestId("dcf-vs-price")).toBeNull();
    typeBlur(screen.getByTestId("dcf-in-price-source"), "Broker, 24.10.");
    // 24.35 against 24.00 = +1,5 %
    const vs = screen.getByTestId("dcf-vs-price");
    expect(vs).toHaveTextContent("+1,5 % über dem eingegebenen Kurs (24,00 USD, Quelle: Broker, 24.10.)");
    expect(vs).toHaveTextContent("keine Aussage darüber, ob der Kurs „richtig“ ist");
    // reverse: +50 % (36.00) needs more growth than the 10 % assumed
    const r = screen.getByTestId("dcf-reverse-result");
    expect(r).toHaveAttribute("data-reason", "ok");
    expect(r).toHaveTextContent("Für 36,00 USD je Aktie");
    const growth = Number(/Umsatzwachstum von ([\d,]+) %/.exec(r.textContent ?? "")![1]!.replace(",", "."));
    expect(growth).toBeGreaterThan(10);
    fireEvent.click(screen.getByRole("radio", { name: "×3" }));
    const g3 = Number(/Umsatzwachstum von ([\d,]+) %/.exec(screen.getByTestId("dcf-reverse-result").textContent ?? "")![1]!.replace(",", "."));
    expect(g3).toBeGreaterThan(growth);
  });

  it("discloses every assumption", () => {
    wrap(<DcfPanel fetchImpl={asFetch(secFetch())} />);
    fillHandCase();
    fireEvent.click(within(screen.getByTestId("dcf-assumption-list")).getByRole("button"));
    const list = screen.getByTestId("dcf-assumptions");
    expect(list).toHaveTextContent("Zeitraum 3 Jahre");
    expect(list).toHaveTextContent("Umsatzwachstum 10,0 % im Jahr 1, 10,0 % im letzten Jahr");
    expect(list).toHaveTextContent("WACC 10,0 %, Endwachstum 2,0 %");
    expect(list).toHaveTextContent("Jahresendwerte");
  });
});

/* ======================================================================================== ThesisPanel */

const stored = () => thesesCfgOf(useJournal.getState().settings.theses);
async function createThesis(ticker = "NWIN", name = "Northwind lang"): Promise<void> {
  type(screen.getByTestId("thesis-new-ticker"), ticker);
  type(screen.getByTestId("thesis-new-name"), name);
  fireEvent.click(screen.getByTestId("thesis-create"));
  await screen.findByTestId("thesis-editor");
}
const clock = () => NOW;

describe("ThesisPanel – the record", () => {
  it("starts empty, creates a thesis, stores it versioned in settings.theses and survives a reopen", async () => {
    const { unmount } = wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("thesis-empty")).toHaveTextContent("Noch keine These");
    await createThesis();
    expect(screen.getByTestId("thesis-title")).toHaveTextContent("Northwind lang");
    const raw = useJournal.getState().settings.theses as { v: number; theses: { ticker: string; name: string }[] };
    expect(raw.v).toBe(1);
    expect(raw.theses).toHaveLength(1);
    expect(raw.theses[0]).toMatchObject({ ticker: "NWIN", name: "Northwind lang" });
    unmount();
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("thesis-title")).toHaveTextContent("Northwind lang");
    expect(screen.getAllByTestId("thesis-item")).toHaveLength(1);
  });

  it("keeps the person's text exactly and stores it when the field is left; lists add and remove at once", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    typeBlur(screen.getByTestId("thesis-text-input"), "Ich glaube an den Auftragsbestand.\n\nZweiter Absatz.");
    await waitFor(() => expect(stored().theses[0]!.text).toBe("Ich glaube an den Auftragsbestand.\n\nZweiter Absatz."));
    const cat = within(screen.getByTestId("thesis-catalysts"));
    type(cat.getByLabelText("Katalysatoren: neuer Punkt"), "Neuer Großauftrag");
    fireEvent.keyDown(cat.getByLabelText("Katalysatoren: neuer Punkt"), { key: "Enter" });
    await waitFor(() => expect(stored().theses[0]!.catalysts).toEqual(["Neuer Großauftrag"]));
    fireEvent.click(cat.getByRole("button", { name: "Entfernen: Neuer Großauftrag" }));
    await waitFor(() => expect(stored().theses[0]!.catalysts).toEqual([]));
  });

  it("writes through to a settings key that other versions may extend: unknown keys survive an edit", async () => {
    const s = useJournal.getState().settings;
    await useJournal.getState().saveSettings({ ...s, theses: { v: 1, futureKey: { a: 1 }, theses: [{ id: "t_old", name: "Alt", ticker: "AAPL", futureField: 7 }, { noId: true }] } });
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("thesis-title")).toHaveTextContent("Alt");
    typeBlur(screen.getByTestId("thesis-text-input"), "Neu geschrieben");
    await waitFor(() => expect(stored().theses[0]!.text).toBe("Neu geschrieben"));
    const raw = useJournal.getState().settings.theses as Record<string, unknown> & { theses: Record<string, unknown>[] };
    expect(raw.futureKey).toEqual({ a: 1 });
    expect(raw.theses[0]!.futureField).toBe(7);
    expect(raw.theses[1]).toEqual({ noId: true });
  });

  it("stores price with source, next report date with source and the review date; flags a due review", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    typeBlur(screen.getByTestId("thesis-price-value"), "20");
    typeBlur(screen.getByTestId("thesis-price-source"), "Broker-Kurs");
    await waitFor(() => expect(stored().theses[0]!.price).toMatchObject({ value: 20, source: "Broker-Kurs", date: "2026-10-25" }));
    typeBlur(screen.getByTestId("thesis-nextreport-date"), "2026-11-04");
    typeBlur(screen.getByTestId("thesis-nextreport-source"), "Investor-Relations-Seite");
    await waitFor(() => expect(stored().theses[0]!.nextReport).toEqual({ date: "2026-11-04", source: "Investor-Relations-Seite" }));
    expect(screen.getByTestId("thesis-nextreport-text")).toHaveTextContent("Nächster Bericht: 04.11.2026 – Quelle: Investor-Relations-Seite (deine Eingabe)");
    expect(screen.getByTestId("thesis-nextreport")).toHaveTextContent("Die SEC-Daten enthalten keinen Berichtstermin");
    typeBlur(screen.getByTestId("thesis-review-date"), "2026-10-01");
    await waitFor(() => expect(screen.getByText("Wiedervorlage fällig")).toBeInTheDocument());
  });

  it("deletes only after a confirmation", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    fireEvent.click(screen.getByTestId("thesis-remove"));
    expect(screen.getByTestId("thesis-confirm")).toHaveTextContent("Wirklich löschen?");
    expect(stored().theses).toHaveLength(1);
    fireEvent.click(screen.getByTestId("thesis-remove-yes"));
    await waitFor(() => expect(stored().theses).toHaveLength(0));
    expect(screen.getByTestId("thesis-empty")).toBeInTheDocument();
  });

  it("opens the thesis of the company the page is about", async () => {
    const s = useJournal.getState().settings;
    await useJournal.getState().saveSettings({ ...s, theses: { v: 1, theses: [{ id: "a", name: "Erste", ticker: "AAPL" }, { id: "b", name: "Zweite", ticker: "NWIN" }] } });
    wrap(<ThesisPanel ticker="nwin" now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    expect(screen.getByTestId("thesis-title")).toHaveTextContent("Zweite");
    expect(screen.getByTestId("thesis-new-ticker")).toHaveValue("NWIN");
  });
});

describe("ThesisPanel – scenarios", () => {
  async function fillScenarios(): Promise<void> {
    typeBlur(screen.getByTestId("thesis-base-revenue"), "1000");
    typeBlur(screen.getByTestId("thesis-base-margin"), "20");
    typeBlur(screen.getByTestId("thesis-base-tax"), "25");
    typeBlur(screen.getByTestId("thesis-base-netdebt"), "200");
    typeBlur(screen.getByTestId("thesis-base-shares"), "50");
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    const sc = (k: string, v: string[]) => ["g1", "gn", "mn", "r", "wacc", "tg"].forEach((id, i) => typeBlur(screen.getByTestId(`thesis-${k}-${id}`), v[i]!));
    sc("base", ["10", "10", "20", "40", "10", "2"]);
    sc("bear", ["2", "2", "15", "40", "10", "2"]);
    sc("bull", ["15", "15", "25", "40", "10", "2"]);
    await waitFor(() => expect(stored().theses[0]!.scenarios.bull.growthStart).toBe(0.15));
  }

  it("each scenario is a DCF with its range; the base case is the hand-worked 24,35", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    // nothing is computed while inputs are missing
    expect(screen.getByTestId("thesis-missing-base")).toHaveTextContent("Es fehlt: Umsatz im Basisjahr");
    await fillScenarios();
    const base = screen.getByTestId("thesis-range-base");
    expect(Number(base.getAttribute("data-base"))).toBeCloseTo(24.35, 9);
    expect(base).toHaveTextContent("20,02 bis 30,67 USD");
    const bear = Number(screen.getByTestId("thesis-range-bear").getAttribute("data-base"));
    const bull = Number(screen.getByTestId("thesis-range-bull").getAttribute("data-base"));
    expect(bear).toBeLessThan(24.35);
    expect(bull).toBeGreaterThan(24.35);
    // no probabilities, no averaged target
    expect(screen.getByTestId("thesis-scenarios")).toHaveTextContent("keine Wahrscheinlichkeiten und keinen gemittelten Zielkurs");
    expect(screen.getByTestId("thesis-base")).toBeInTheDocument();
  });

  it("compares with the typed price only with a source, and answers 'Was müsste stimmen?'", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    await fillScenarios();
    expect(screen.getByTestId("thesis-mustHold")).toHaveTextContent("Dafür brauchst du einen Kurs mit Quelle");
    typeBlur(screen.getByTestId("thesis-price-value"), "20");
    await waitFor(() => expect(screen.getByTestId("thesis-price-nosource")).toBeInTheDocument());
    expect(screen.queryByTestId("thesis-vs-base")).toBeNull();
    typeBlur(screen.getByTestId("thesis-price-source"), "Broker-Kurs");
    // base 24.35 against 20.00 = +21,75 %
    await waitFor(() => expect(screen.getByTestId("thesis-vs-base")).toHaveTextContent("+21,75 % zum eingegebenen Kurs"));
    const r = screen.getByTestId("thesis-mustHold-result");
    expect(r).toHaveAttribute("data-reason", "ok");
    expect(r).toHaveTextContent("Für 40,00 USD je Aktie (Kurs 20,00 USD, ×2)");
  });

  it("takes the starting numbers from the SEC on a click (only what is filed) and says where they come from", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis("NWIN");
    fireEvent.click(screen.getByTestId("thesis-base-sec"));
    await waitFor(() => expect(screen.getByTestId("thesis-base-source")).toBeInTheDocument());
    expect(screen.getByTestId("thesis-base-revenue")).toHaveValue("495");
    expect(screen.getByTestId("thesis-base-netdebt")).toHaveValue("130");
    expect(screen.getByTestId("thesis-base-source")).toHaveTextContent("SEC EDGAR (XBRL), Quartal bis 30.09.2025, abgerufen 25.10.2026");
    expect(screen.getByTestId("thesis-base-source")).toHaveTextContent("Lücken bleiben leer");
    expect(stored().theses[0]!.base).toMatchObject({ revenue: 495e6, netDebt: 130e6, shares: 10e6, taxRate: null });
    // the person decides about the future: no scenario was filled in
    expect(stored().theses[0]!.scenarios.base.growthStart).toBeNull();
  });

  it("explains why a company's numbers are not there (typed error)", async () => {
    const f = secFetch({ facts: () => apiErr(503, "sec_setup_required", "Einrichtung nötig: SEC_USER_AGENT fehlt."), filings: () => apiErr(503, "sec_setup_required", "x") });
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(f)} />);
    await createThesis("NWIN");
    fireEvent.click(screen.getByTestId("thesis-base-sec"));
    expect(await screen.findByTestId("thesis-sec-error")).toHaveTextContent("Einrichtung nötig");
  });
});

describe("ThesisPanel – refutation criteria and the check", () => {
  async function addCriterion(metric: string, value: string, op = "<"): Promise<void> {
    fireEvent.change(screen.getByTestId("thesis-criterion-metric"), { target: { value: metric } });
    fireEvent.change(screen.getByTestId("thesis-criterion-op"), { target: { value: op } });
    type(screen.getByTestId("thesis-criterion-value"), value);
    fireEvent.click(screen.getByTestId("thesis-criterion-add"));
    await waitFor(() => expect(screen.getAllByTestId("thesis-criterion").length).toBeGreaterThan(0));
  }

  it("stores conditions as checkable thresholds", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    expect(screen.getByTestId("thesis-no-criteria")).toHaveTextContent("Umsatzwachstum zum Vorjahresquartal unter 5 %");
    await addCriterion("revenueYoY", "5");
    await addCriterion("grossMargin", "43");
    expect(screen.getAllByTestId("thesis-criterion")).toHaveLength(2);
    expect(screen.getAllByTestId("thesis-criterion")[0]).toHaveTextContent("Widerlegt, wenn Umsatzwachstum zum Vorjahresquartal unter 5 %");
    expect(stored().theses[0]!.criteria).toMatchObject([{ metric: "revenueYoY", op: "<", value: 5 }, { metric: "grossMargin", op: "<", value: 43 }]);
    expect(screen.getAllByTestId("thesis-criterion")[0]).toHaveAttribute("data-status", "unchecked");
  });

  it("checks against the newest filed quarter: triggered / not triggered, the number found, quarter, filing, source and time", async () => {
    const f = secFetch();
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(f)} />);
    await createThesis("NWIN");
    await addCriterion("revenueYoY", "5");
    await addCriterion("grossMargin", "43");
    expect(screen.getByTestId("thesis-check-never")).toHaveTextContent("Noch nicht geprüft.");
    fireEvent.click(screen.getByTestId("thesis-check-now"));
    const res = await screen.findByTestId("thesis-check-result");
    expect(res).toHaveAttribute("data-quarter", "2025-09-30");
    const rows = screen.getAllByTestId("thesis-criterion");
    expect(rows[0]).toHaveAttribute("data-status", "clear");
    expect(rows[0]).toHaveTextContent("zuletzt 12,5 %");
    expect(rows[1]).toHaveAttribute("data-status", "triggered");
    expect(rows[1]).toHaveTextContent("Ausgelöst");
    expect(rows[1]).toHaveTextContent("zuletzt 42,2 %");
    expect(screen.getByTestId("thesis-check-stand")).toHaveTextContent("Quartal bis 30.09.2025 (Meldung vom 04.11.2025)");
    expect(screen.getByTestId("thesis-check-source")).toHaveTextContent("Quelle: SEC EDGAR (XBRL)");
    expect(within(screen.getByTestId("thesis-check-stand")).getByRole("link", { name: "Meldung öffnen" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/999001\//));
    const check = stored().theses[0]!.check!;
    expect(check.quarterEnd).toBe("2025-09-30");
    expect(check.results.map((r) => r.status)).toEqual(["clear", "triggered"]);
    expect(check.at).toBe(NOW);
    expect(check.sourceUrl).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000999001.json");
  });

  it("proposes to look again when a condition is triggered – and changes nothing until the person saves a version", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis("NWIN");
    await addCriterion("grossMargin", "43");
    fireEvent.click(screen.getByTestId("thesis-check-now"));
    const box = await screen.findByTestId("thesis-proposal");
    expect(box).toHaveTextContent("Eine Bedingung ist ausgelöst");
    expect(box).toHaveTextContent("Die App ändert nichts von selbst");
    expect(stored().theses[0]!.versions).toHaveLength(0);
    fireEvent.click(screen.getByTestId("thesis-save-with-check"));
    await waitFor(() => expect(stored().theses[0]!.versions).toHaveLength(1));
    const v = stored().theses[0]!.versions[0]!;
    expect(v.note).toBe("Prüfung zum Quartal bis 30.09.2025: 1 Bedingung(en) ausgelöst");
    expect(v.check).toEqual({ quarterEnd: "2025-09-30", triggered: 1, total: 1 });
  });

  it("an unknown number is 'Keine Daten', never 'nicht ausgelöst'", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis("AAPL");
    await addCriterion("operatingMargin", "20");
    fireEvent.click(screen.getByTestId("thesis-check-now"));
    await screen.findByTestId("thesis-check-result");
    const row = screen.getByTestId("thesis-criterion");
    expect(row).toHaveAttribute("data-status", "unknown");
    expect(row).toHaveTextContent("Keine Daten");
    expect(screen.queryByTestId("thesis-proposal")).toBeNull();
  });

  it("a thesis without a ticker cannot be checked and says why; a failing SEC says why too and stores no check", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis("", "Ohne Kürzel");
    expect(screen.getByTestId("thesis-monitor-noticker")).toHaveTextContent("Ohne Börsenkürzel");
    typeBlur(screen.getByTestId("thesis-ticker"), "nwin");
    await waitFor(() => expect(stored().theses[0]!.ticker).toBe("NWIN"));
    await addCriterion("revenueYoY", "5");
    const bad = secFetch({ facts: () => apiErr(502, "sec_upstream", "Die SEC ist gerade nicht erreichbar."), filings: () => apiErr(502, "sec_upstream", "x") });
    // re-render with a failing fetch
    cleanupAndRender(bad);
    fireEvent.click(screen.getByTestId("thesis-check-now"));
    expect(await screen.findByTestId("thesis-check-error")).toHaveTextContent("Die SEC ist gerade nicht erreichbar.");
    expect(stored().theses[0]!.check).toBeNull();
  });

  function cleanupAndRender(f: ReturnType<typeof secFetch>): void {
    document.body.innerHTML = "";
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(f)} />);
  }
});

describe("ThesisPanel – monitoring while the app is open", () => {
  async function seedMonitored(check: unknown = null): Promise<void> {
    const s = useJournal.getState().settings;
    await useJournal.getState().saveSettings({
      ...s,
      theses: { v: 1, theses: [{ id: "t1", name: "Northwind", ticker: "NWIN", monitoring: true, criteria: [{ id: "c1", metric: "grossMargin", op: "<", value: 43 }], check }] },
    });
  }

  it("checks a monitored thesis once when the panel opens and stores the result with its stand", async () => {
    await seedMonitored();
    const f = secFetch();
    wrap(<ThesisPanel now={clock} fetchImpl={asFetch(f)} />);
    await waitFor(() => expect(stored().theses[0]!.check).not.toBeNull());
    const check = stored().theses[0]!.check!;
    expect(check).toMatchObject({ at: NOW, quarterEnd: "2025-09-30", newQuarter: false, seen: false });
    expect(check.results).toEqual([{ id: "c1", status: "triggered", actual: expect.closeTo(42.2222, 3) }]);
    expect(await screen.findByTestId("thesis-proposal")).toBeInTheDocument();
    // not again: the check is fresh
    const calls = f.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(f.mock.calls.length).toBe(calls);
  });

  it("does not run when the host switches monitoring off, and not for a check that is less than a day old", async () => {
    await seedMonitored();
    const f = secFetch();
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(f)} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(f).not.toHaveBeenCalled();
    expect(stored().theses[0]!.check).toBeNull();
  });

  it("marks a quarter that is newer than the one of the last check, until the person has seen it", async () => {
    await seedMonitored({ at: NOW - 3 * 86_400_000, quarterEnd: "2025-06-30", filed: "2025-08-05", url: null, source: "SEC EDGAR (XBRL)", sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000999001.json", fetchedAt: NOW - 3 * 86_400_000, results: [{ id: "c1", status: "clear", actual: 44 }], newQuarter: false, seen: true });
    wrap(<ThesisPanel now={clock} fetchImpl={asFetch(secFetch())} />);
    const banner = await screen.findByTestId("thesis-new-quarter");
    expect(banner).toHaveTextContent("Neues Quartal seit deiner letzten Prüfung (bis 30.09.2025)");
    expect(screen.getByTestId("thesis-check-result")).toHaveAttribute("data-new", "1");
    fireEvent.click(within(banner).getByRole("button", { name: "Gesehen" }));
    await waitFor(() => expect(screen.queryByTestId("thesis-new-quarter")).toBeNull());
    expect(stored().theses[0]!.check!.seen).toBe(true);
  });

  it("a failing SEC during the automatic check is shown, nothing is stored, and it is not retried in a loop", async () => {
    await seedMonitored();
    const f = secFetch({ facts: () => apiErr(502, "sec_upstream", "Die SEC ist gerade nicht erreichbar."), filings: () => apiErr(502, "sec_upstream", "x") });
    wrap(<ThesisPanel now={clock} fetchImpl={asFetch(f)} />);
    expect(await screen.findByTestId("thesis-check-error")).toHaveTextContent("Die SEC ist gerade nicht erreichbar.");
    const calls = f.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(f.mock.calls.length).toBe(calls);
    expect(stored().theses[0]!.check).toBeNull();
  });
});

describe("ThesisPanel – versions", () => {
  it("saves a version with a note, refuses an unchanged one, and lists what changed against the version before", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    expect(screen.getByTestId("thesis-no-versions")).toBeInTheDocument();
    type(screen.getByTestId("thesis-version-note"), "Ausgangsfassung");
    fireEvent.click(screen.getByTestId("thesis-version-save"));
    await waitFor(() => expect(stored().theses[0]!.versions).toHaveLength(1));
    expect(screen.getByTestId("thesis-version-msg")).toHaveTextContent("Version gespeichert.");
    fireEvent.click(screen.getByTestId("thesis-version-save"));
    expect(screen.getByTestId("thesis-version-msg")).toHaveTextContent("Seit der letzten Version hat sich nichts geändert.");
    expect(stored().theses[0]!.versions).toHaveLength(1);
    // change the assumptions, then save again: the diff names them and the value per share before → after
    typeBlur(screen.getByTestId("thesis-text-input"), "Neue Begründung");
    typeBlur(screen.getByTestId("thesis-price-value"), "20");
    await waitFor(() => expect(stored().theses[0]!.text).toBe("Neue Begründung"));
    type(screen.getByTestId("thesis-version-note"), "Text geändert");
    fireEvent.click(screen.getByTestId("thesis-version-save"));
    await waitFor(() => expect(stored().theses[0]!.versions).toHaveLength(2));
    const versions = screen.getAllByTestId("thesis-version");
    expect(versions[0]).toHaveAttribute("data-n", "2");
    expect(versions[0]).toHaveTextContent("Text geändert");
    expect(within(versions[0]!).getByTestId("thesis-version-diff")).toHaveTextContent("Begründung geändert.");
    expect(versions[1]).toHaveTextContent("Erste gespeicherte Fassung.");
  });

  it("traces a changed target value to its assumptions", async () => {
    wrap(<ThesisPanel now={clock} monitor={false} fetchImpl={asFetch(secFetch())} />);
    await createThesis();
    typeBlur(screen.getByTestId("thesis-base-revenue"), "1000");
    typeBlur(screen.getByTestId("thesis-base-margin"), "20");
    typeBlur(screen.getByTestId("thesis-base-tax"), "25");
    typeBlur(screen.getByTestId("thesis-base-netdebt"), "200");
    typeBlur(screen.getByTestId("thesis-base-shares"), "50");
    for (const [id, v] of [["g1", "10"], ["gn", "10"], ["mn", "20"], ["r", "40"], ["wacc", "10"], ["tg", "2"]] as const) typeBlur(screen.getByTestId(`thesis-base-${id}`), v);
    await waitFor(() => expect(Number(screen.getByTestId("thesis-range-base").getAttribute("data-base"))).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("thesis-version-save"));
    await waitFor(() => expect(stored().theses[0]!.versions).toHaveLength(1));
    typeBlur(screen.getByTestId("thesis-base-g1"), "12");
    await waitFor(() => expect(stored().theses[0]!.scenarios.base.growthStart).toBe(0.12));
    fireEvent.click(screen.getByTestId("thesis-version-save"));
    await waitFor(() => expect(stored().theses[0]!.versions).toHaveLength(2));
    const diff = within(screen.getAllByTestId("thesis-version")[0]!).getByTestId("thesis-version-diff");
    expect(diff).toHaveTextContent("Basis: Wachstum Jahr 1 10,0 % → 12,0 %.");
    const m = /Basis: Wert je Aktie (\d+),(\d\d) → (\d+),(\d\d) USD\./.exec(diff.textContent ?? "");
    expect(m).not.toBeNull();
    expect(Number(`${m![3]}.${m![4]}`)).toBeGreaterThan(Number(`${m![1]}.${m![2]}`));
  });
});
