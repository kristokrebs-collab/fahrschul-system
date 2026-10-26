/**
 * The Congress tracker card in jsdom, on the whole chain: the card ← the client (`@/market/congress`) ← the two Netlify functions
 * (run for real) ← a mocked House Clerk that serves REAL files (`tests/fixtures/congress`). So the rows on screen are the rows of
 * real PTR PDFs: the filters (member, ticker, buy / sell, window), the watchlist mark, "neu seit deinem letzten Besuch", the click on
 * a ticker, "nicht lesbar" lines with the PDF link, and the honest messages when the Clerk or the server cannot be had.
 * The date is fixed (`Date` only); nothing here depends on the real day.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, FUNCTIONS_MISSING } from "@/cloud/api";
import { memoryKV } from "@/market/cache";
import { createCongressData } from "@/market/congress/client";
import { createLimiter } from "@/market/stocks/throttle";
import { storageKey } from "@/store/storage";
import congressIndex from "../../netlify/functions/congress-index.mts";
import congressPtr from "../../netlify/functions/congress-ptr.mts";
import { setCongressForTests } from "../../netlify/functions/_lib/congress/load";
import { resetGuardForTests } from "../../netlify/functions/_lib/stocks/guard";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { clerkMock, FIXTURE_MEMBERS, indexXml, LAST_MODIFIED, reply, SCAN_PDF, zipOf, type IndexMember } from "./congress.harness";

const fake = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/market/congress/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market/congress/client")>();
  return { ...actual, congressData: () => fake.data };
});

const { default: CongressCard } = await import("@/views/aktien/kongress/CongressCard");
const { MotionRoot } = await import("@/motion/MotionRoot");
const { resetCongressForTests } = await import("@/views/aktien/kongress/store");
const { useAktien, resetAktienForTests } = await import("@/views/aktien/aktienStore");

/* ------------------------------------------------------------------ the world */

const MEMBERS: IndexMember[] = [
  ...Object.values(FIXTURE_MEMBERS),
  { last: "Scanner", first: "Sam", district: "NY01", filed: "10/20/2026", docId: "9000001" },
  { last: "Missing", first: "Mia", district: "OH01", filed: "10/21/2026", docId: "20099999" },
  { last: "Annual", first: "Ann", district: "OH02", filed: "5/15/2026", docId: "10000001", type: "O" },
];
const ZIP = zipOf(indexXml(MEMBERS));

const ctx = { ip: "203.0.113.9" } as Parameters<typeof congressIndex>[1];
const world = { calls: [] as { path: string; query: Record<string, string> }[], clerkDown: false, apiDown: null as null | "missing" | "network" };

async function api(path: string, init?: { query?: Record<string, string | number | boolean | null | undefined> }): Promise<unknown> {
  const query = Object.fromEntries(Object.entries(init?.query ?? {}).map(([k, v]) => [k, String(v)]));
  world.calls.push({ path, query });
  if (world.apiDown === "missing") throw new ApiError(0, "functions_missing", FUNCTIONS_MISSING);
  if (world.apiDown === "network") throw new ApiError(0, "unavailable", "Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.");
  const fn = path === "/congress/index" ? congressIndex : congressPtr;
  const res = await fn(new Request(`https://x.test/api/v1${path}?${new URLSearchParams(query)}`), ctx);
  const body = (await res.json()) as { error?: { code: string; message: string } };
  if (!res.ok) throw new ApiError(res.status, body.error!.code, body.error!.message);
  return body;
}

function clerk() {
  return clerkMock({
    zip: ZIP,
    extra: {
      "9000001": () => reply(SCAN_PDF),
      ...(world.clerkDown ? { "2026FD.zip": () => reply("down", 503) } : {}),
    },
  });
}

/** An IntersectionObserver the test controls: it reports "on screen" at once, unless `hold` is set. */
const io = { hold: false, pending: [] as (() => void)[] };
class StubIO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(el: Element): void {
    const fire = (): void => this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    if (io.hold) io.pending.push(fire);
    else queueMicrotask(fire);
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeAll(() => {
  globalThis.IntersectionObserver = StubIO as unknown as typeof IntersectionObserver;
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
  world.calls = [];
  world.clerkDown = false;
  world.apiDown = null;
  io.hold = false;
  io.pending = [];
  const admin = { rpc: vi.fn(async () => ({ data: 1, error: null })), auth: { getClaims: vi.fn(async () => ({ data: null, error: { message: "none" } })) } };
  setSupabaseAdminForTests(admin as unknown as SupabaseClient);
  resetGuardForTests();
  setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
  fake.data = createCongressData({ api: api as never, kv: memoryKV(), limiter: createLimiter({ capacity: 10_000, concurrency: 4 }), online: () => true });
  Element.prototype.scrollIntoView = vi.fn();
  resetCongressForTests();
  resetAktienForTests();
  // the window "dieses Jahr" holds every report of the world above
  localStorage.setItem(storageKey("aktien-kongress"), JSON.stringify({ window: "year" }));
});
afterEach(() => {
  cleanup(); // unmount first: the stores are reset below, and a mounted card would re-render outside act
  resetCongressForTests();
  resetAktienForTests();
  setCongressForTests(null);
  setSupabaseAdminForTests(null);
  vi.useRealTimers();
});

const watchItem = (symbol: string) => ({ id: `stock:${symbol}`, kind: "stock" as const, symbol, name: null, addedAt: 0, note: "" });
function wrap(props: { watchlist?: ReturnType<typeof watchItem>[]; symbol?: string | null } = {}) {
  const el = (p: typeof props) => (
    <MotionRoot>
      <CongressCard watchlist={p.watchlist ?? []} symbol={p.symbol ?? null} data={{} as never} />
    </MotionRoot>
  );
  const r = render(el(props));
  return { ...r, rerenderWith: (p: typeof props) => r.rerender(el(p)) };
}

/** waits until the card has read all `n` reports it was asked for */
async function readAll(n: number): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("kongress-progress")).toHaveTextContent(new RegExp(`gelesen: ${n} von ${n}`)), { timeout: 20_000 });
  await waitFor(() => expect(screen.getByTestId("kongress-refresh")).not.toBeDisabled(), { timeout: 20_000 });
}
const rows = (): HTMLElement[] => screen.queryAllByTestId("kongress-row");
const type = (id: string, value: string): void => void fireEvent.change(screen.getByTestId(id), { target: { value } });

/* ------------------------------------------------------------------ specs */

describe("Kongress-Tracker – what is always on screen", () => {
  it("shows the caveats, the Senate route, the source and the closing sentence before anything is read", async () => {
    io.hold = true; // the section is not on screen yet
    wrap();
    const card = screen.getByTestId("aktien-kongress");
    expect(within(card).getByRole("heading", { name: "Kongress-Tracker" })).toBeInTheDocument();
    const cav = screen.getByTestId("kongress-caveats");
    expect(cav).toHaveTextContent("bis zu 45 Tage");
    expect(cav).toHaveTextContent("Die Daten kommen zu spät");
    expect(cav).toHaveTextContent("Beträge sind Spannen");
    expect(cav).toHaveTextContent("Mitglied ist nicht gleich Absicht");
    expect(cav).toHaveTextContent("Kein Signal");
    expect(cav).toHaveTextContent("Die App sendet nie Orders");
    const senate = screen.getByTestId("kongress-senate");
    expect(senate).toHaveTextContent("keinen automatischen Abruf");
    expect(within(senate).getByRole("link", { name: /efdsearch\.senate\.gov/ })).toHaveAttribute("href", "https://efdsearch.senate.gov/search/");
    expect(within(card).getByTestId("aktien-note")).toHaveTextContent("Keine professionelle Finanzberatung.");
    expect(card).toHaveTextContent("Offene Finanzoffenlegung des House Clerk");
    // nothing was asked for before the section came on screen, and the card has no way to place an order
    expect(world.calls).toEqual([]);
    expect(within(card).queryByRole("button", { name: /order|kaufen|verkaufen/i })).toBeNull();
  });

  it("asks the server once the section is on screen – the index first, then the reports newest first", async () => {
    io.hold = true;
    wrap();
    expect(world.calls).toEqual([]);
    await act(async () => {
      io.pending.forEach((f) => f());
    });
    await readAll(7);
    expect(world.calls[0]).toEqual({ path: "/congress/index", query: { year: "2026" } });
    expect(world.calls.slice(1).map((c) => c.path)).toEqual(["/congress/ptr", "/congress/ptr"]);
    expect(world.calls[1]!.query["docs"]).toBe("20099999,9000001,20035408,20035143"); // newest filing first, four at a time
    expect(world.calls[2]!.query["docs"]).toBe("20034694,20035024,20034999");
  });

  it("shows the stand of the source: where, which file, when read", async () => {
    wrap();
    await readAll(7);
    const stand = screen.getByTestId("kongress-stand");
    expect(stand).toHaveTextContent("Quelle: House Clerk (disclosures-clerk.house.gov)");
    expect(stand).toHaveTextContent(/Index vom \d{2}\.\d{2}\.\d{2,4} \d{2}:\d{2}/);
    expect(stand).toHaveTextContent(/Abruf \d{2}\.\d{2}\. \d{2}:\d{2}/);
    expect(Date.parse(LAST_MODIFIED)).toBeGreaterThan(0);
  });
});

describe("Kongress-Tracker – the rows", () => {
  it("counts what it read and says what it could not: a scan, a document the Clerk does not have", async () => {
    wrap();
    await readAll(7);
    const sum = screen.getByTestId("kongress-summary");
    expect(sum).toHaveTextContent("Zeilen 100"); // 7 + 78 + 6 + 1 + 8
    expect(sum).toHaveTextContent("aus Meldungen 6 von 7");
    expect(screen.getByTestId("kongress-count-unreadable")).toHaveTextContent("1");
    expect(screen.getByTestId("kongress-failed")).toHaveTextContent("1 Meldung konnte nicht gelesen werden: beim House Clerk nicht vorhanden (1)");
    expect(screen.getByTestId("kongress-progress")).toHaveTextContent("gelesen: 7 von 7");
    // the annual report in the index is no PTR and is not read
    expect(world.calls.some((c) => c.query["docs"]?.includes("10000001"))).toBe(false);
  });

  it("shows a scanned paper filing as 'Nicht lesbar' with the reason and the link to the original", async () => {
    wrap();
    await readAll(7);
    const card = rows().find((r) => r.getAttribute("data-kind") === "unreadable")!;
    expect(card).toHaveTextContent("Nicht lesbar");
    expect(card).toHaveTextContent("Sam Scanner");
    expect(card).toHaveTextContent("Papierformular");
    expect(card).toHaveTextContent("gemeldet 20.10.2026");
    expect(within(card).getByTestId("kongress-pdf")).toHaveAttribute("href", "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/9000001.pdf");
  });

  it("shows the example of the skill row by row: owner, security, ticker, side, strike and expiry, dates, delay, range, link", async () => {
    wrap();
    await readAll(7);
    type("kongress-member", "pelosi");
    await waitFor(() => expect(rows()).toHaveLength(7));
    const calls = rows().filter((r) => r.getAttribute("data-ticker") === "BE" && within(r).queryByTestId("kongress-option"));
    expect(calls).toHaveLength(2);
    const r = calls[0]!;
    expect(r).toHaveAttribute("data-side", "buy");
    expect(within(r).getByTestId("kongress-who")).toHaveTextContent("Nancy Pelosi · CA11 · Ehepartner");
    expect(within(r).getByTestId("kongress-asset")).toHaveTextContent("Bloom Energy Corporation Class A Common Stock");
    expect(within(r).getByTestId("kongress-ticker")).toHaveTextContent("BE");
    expect(within(r).getByText("Kauf")).toBeInTheDocument();
    expect(within(r).getByText("Call-Option")).toBeInTheDocument();
    expect(within(r).getByTestId("kongress-option")).toHaveTextContent("Call · 100 Kontrakte · Strike $100 · Verfall 17.06.2027");
    expect(within(r).getByTestId("kongress-trade-date")).toHaveTextContent("24.07.2026");
    expect(within(r).getByTestId("kongress-filed-date")).toHaveTextContent("21.08.2026");
    expect(within(r).getByTestId("kongress-delay")).toHaveTextContent("28 Tage");
    // the amount is a range, said as one – never a single number
    expect(within(r).getByTestId("kongress-amount")).toHaveTextContent("$1,000,001 – $5,000,000");
    expect(r).toHaveTextContent("Betrag (Spanne)");
    expect(within(r).getByTestId("kongress-description")).toHaveTextContent("Purchased 100 call options with a strike price of $100 and an expiration date of 6/17/27.");
    expect(within(r).getByTestId("kongress-pdf")).toHaveAttribute("href", "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035143.pdf");
    // the private LLC has no ticker – and none is made up
    const llc = rows().find((x) => x.textContent?.includes("REOF XXV, LLC"))!;
    expect(within(llc).queryByTestId("kongress-ticker")).toBeNull();
    expect(within(llc).getByTestId("kongress-noticker")).toHaveTextContent("kein Kürzel");
  });

  it("writes an option whose description names no strike as 'nicht erkannt' and a single printed figure as it is", async () => {
    wrap();
    await readAll(7);
    type("kongress-member", "lee");
    await waitFor(() => expect(rows().length).toBe(6));
    const put = rows().find((r) => within(r).queryByTestId("kongress-description")?.textContent?.includes("Put Option"))!;
    expect(within(put).getByTestId("kongress-option")).toHaveTextContent("Put · Strike nicht erkannt · Verfall nicht erkannt");
    type("kongress-member", "wasserman");
    await waitFor(() => expect(rows().length).toBe(1));
    expect(within(rows()[0]!).getByTestId("kongress-amount")).toHaveTextContent("$2,722.50");
    expect(rows()[0]).toHaveTextContent("Betrag laut Meldung");
    expect(rows()[0]).not.toHaveTextContent("Spanne");
  });

  it("marks a report that came more than 45 days after the trade", async () => {
    wrap();
    await readAll(7);
    type("kongress-member", "delaney");
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    // filed 09.09.2026; a trade from 06.07. or earlier would be late – the report has trades of August only
    expect(rows().every((r) => r.getAttribute("data-late") === "0")).toBe(true);
    type("kongress-member", "crenshaw");
    await waitFor(() => expect(rows().length).toBe(8));
    const late = rows().filter((r) => r.getAttribute("data-late") === "1");
    expect(late.length).toBeGreaterThan(0);
    expect(within(late[0]!).getByText("über 45 Tage")).toBeInTheDocument();
    expect(within(late[0]!).getByTestId("kongress-delay")).toHaveTextContent(/\d+ Tage/);
  });
});

describe("Kongress-Tracker – the filters", () => {
  it("filters by ticker or name, by buy and sell, and says when nothing matches", async () => {
    wrap();
    await readAll(7);
    type("kongress-query", "INTC");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().every((r) => r.getAttribute("data-ticker") === "INTC")).toBe(true);
    type("kongress-query", "bloom");
    await waitFor(() => expect(rows()).toHaveLength(4));
    type("kongress-query", "");
    type("kongress-member", "pelosi");
    await waitFor(() => expect(rows()).toHaveLength(7));
    fireEvent.click(within(screen.getByTestId("kongress-filters")).getByRole("radio", { name: "Verkauf" }));
    await waitFor(() => expect(screen.getByTestId("kongress-nomatch")).toHaveTextContent("Keine Zeile passt zu deinen Filtern."));
    fireEvent.click(within(screen.getByTestId("kongress-filters")).getByRole("radio", { name: "Kauf" }));
    await waitFor(() => expect(rows()).toHaveLength(7));
    fireEvent.click(screen.getByTestId("kongress-filter-reset"));
    expect((screen.getByTestId("kongress-member") as HTMLInputElement).value).toBe("");
  });

  it("reads only a member's reports when the member field is filled, and says when there are none in the window", async () => {
    wrap();
    await readAll(7);
    type("kongress-member", "delaney");
    await waitFor(() => expect(screen.getByTestId("kongress-progress")).toHaveTextContent("gelesen: 1 von 1"), { timeout: 5000 });
    type("kongress-member", "nobody here");
    await waitFor(() => expect(screen.getByTestId("kongress-none")).toHaveTextContent("Von diesem Mitglied hat der House Clerk im gewählten Zeitraum keine Meldung gelistet."), { timeout: 5000 });
  });

  it("limits the reports to a window of days: the filing day decides, the choice is kept on this device", async () => {
    localStorage.setItem(storageKey("aktien-kongress"), JSON.stringify({ window: "90" }));
    wrap();
    // 90 days before 2026-10-26 = 2026-07-28: the reports of 07/14 – 07/19 are out; scan, missing, Delaney, Pelosi are in
    await readAll(4);
    expect(world.calls.slice(1).flatMap((c) => c.query["docs"]!.split(","))).toEqual(["20099999", "9000001", "20035408", "20035143"]);
    fireEvent.click(within(screen.getByTestId("kongress-filters")).getByRole("radio", { name: "7 Tage" }));
    await waitFor(() => expect(screen.getByTestId("kongress-progress")).toHaveTextContent("gelesen: 2 von 2"));
    expect(JSON.parse(localStorage.getItem(storageKey("aktien-kongress"))!)).toEqual({ window: "7" });
  });

  it("marks the tickers of the watchlist and filters to them", async () => {
    wrap({ watchlist: [watchItem("INTC"), watchItem("BRK.B")] });
    await readAll(7);
    expect(screen.getByTestId("kongress-count-watch")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("kongress-chip-watch"));
    await waitFor(() => expect(rows()).toHaveLength(2));
    for (const r of rows()) {
      expect(r).toHaveAttribute("data-watched", "1");
      expect(within(r).getByText("Auf deiner Watchlist")).toBeInTheDocument();
    }
  });

  it("counts the unreadable rows a content filter keeps out of view instead of dropping them silently", async () => {
    wrap();
    await readAll(7);
    expect(rows().some((r) => r.getAttribute("data-kind") === "unreadable")).toBe(true);
    fireEvent.click(screen.getByTestId("kongress-chip-ticker"));
    await waitFor(() => expect(screen.getByTestId("kongress-hidden-unreadable")).toHaveTextContent("1 nicht lesbare Zeile ist durch deine Filter ausgeblendet"));
    expect(rows().every((r) => r.getAttribute("data-kind") === "trade")).toBe(true);
  });

  it("shows forty lines and offers the rest", async () => {
    wrap();
    await readAll(7);
    expect(rows()).toHaveLength(40);
    fireEvent.click(screen.getByTestId("kongress-more"));
    await waitFor(() => expect(rows().length).toBeGreaterThan(40));
  });
});

describe("Kongress-Tracker – selecting a ticker and 'neu seit deinem letzten Besuch'", () => {
  it("a click on a ticker selects it on the page (the Analyse sections read it), a second click on the same one keeps it", async () => {
    const { rerenderWith } = wrap();
    await readAll(7);
    type("kongress-query", "INTC");
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(within(rows()[0]!).getByTestId("kongress-ticker"));
    expect(useAktien.getState().selected).toBe("INTC");
    rerenderWith({ symbol: "INTC" });
    expect(within(rows()[0]!).getByTestId("kongress-ticker")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("kongress-selected")).toHaveTextContent("Auf der Seite gewählt: INTC");
    const target = document.body.appendChild(document.createElement("div"));
    target.setAttribute("data-section", "aktien-analyse");
    fireEvent.click(screen.getByTestId("kongress-to-analysis"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });

  it("says it is the first visit at the first visit and marks nothing as new", async () => {
    wrap();
    await readAll(7);
    expect(screen.getByTestId("kongress-visit")).toHaveTextContent("Erster Besuch auf diesem Gerät");
    expect(rows().some((r) => r.getAttribute("data-new") === "1")).toBe(false);
  });

  it("marks what the index did not list at the last visit as new, filters to it and can mark it as seen", async () => {
    const known = ["20035408", "20034694", "20034999", "20035024", "9000001", "20099999"];
    localStorage.setItem(storageKey("aktien-kongress-seen"), JSON.stringify({ at: new Date(2026, 9, 20, 9, 30).getTime(), docIds: known }));
    wrap();
    await readAll(7);
    expect(screen.getByTestId("kongress-visit")).toHaveTextContent("1 Meldung neu seit deinem letzten Besuch (20.10. 09:30)");
    fireEvent.click(screen.getByTestId("kongress-chip-new"));
    await waitFor(() => expect(rows()).toHaveLength(7));
    for (const r of rows()) {
      expect(r).toHaveAttribute("data-new", "1");
      expect(within(r).getByText("Neu")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("kongress-markseen"));
    await waitFor(() => expect(screen.getByTestId("kongress-visit")).toHaveTextContent("Nichts Neues seit deinem letzten Besuch"));
    const stored = JSON.parse(localStorage.getItem(storageKey("aktien-kongress-seen"))!) as { docIds: string[] };
    expect(stored.docIds).toContain("20035143");
  });

  it("writes the visit when the card is left, so the next visit compares with this one", async () => {
    const { unmount } = wrap();
    await readAll(7);
    expect(localStorage.getItem(storageKey("aktien-kongress-seen"))).toBeNull();
    unmount();
    const stored = JSON.parse(localStorage.getItem(storageKey("aktien-kongress-seen"))!) as { at: number; docIds: string[] };
    expect(stored.at).toBe(new Date(2026, 9, 26, 12, 0, 0).getTime());
    expect(stored.docIds).toEqual(expect.arrayContaining(["20035143", "20035408", "9000001"]));
    expect(stored.docIds).not.toContain("10000001"); // an annual report is no PTR
  });
});

describe("Kongress-Tracker – when a source or the server cannot be had", () => {
  it("names a Clerk that is down at the first visit – with the reason, the source and a retry, and no row", async () => {
    world.clerkDown = true;
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    wrap();
    const err = await screen.findByTestId("kongress-error", undefined, { timeout: 10_000 });
    expect(err).toHaveTextContent("Der House Clerk lässt sich gerade nicht lesen");
    expect(err).toHaveTextContent("HTTP 503");
    expect(err).toHaveTextContent("Behördenseite ohne Zusage");
    expect(err).toHaveAttribute("data-reason", "upstream");
    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId("kongress-stand")).toHaveTextContent("Quelle: keine Daten");
    // the Clerk comes back: one click
    world.clerkDown = false;
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    fireEvent.click(screen.getByTestId("kongress-retry"));
    await readAll(7);
    expect(screen.queryByTestId("kongress-error")).toBeNull();
  });

  it("says that the file's shape has changed when the Clerk's index is not the index any more", async () => {
    setCongressForTests({ fetch: clerkMock({ extra: { "2026FD.zip": () => reply("<html>Wartungsarbeiten</html>") } }) as unknown as typeof fetch });
    wrap();
    const err = await screen.findByTestId("kongress-error", undefined, { timeout: 10_000 });
    expect(err).toHaveAttribute("data-reason", "format");
    expect(err).toHaveTextContent("Aufbau");
  });

  it("shows the last good copy when the Clerk fails later – marked as a copy, with its stand", async () => {
    wrap();
    await readAll(7);
    const before = rows().length;
    world.clerkDown = true;
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch }); // a fresh server instance without memory: nothing to serve stale from
    act(() => void vi.setSystemTime(new Date(2026, 9, 26, 13, 0, 0)));
    world.apiDown = "network";
    fireEvent.click(screen.getByTestId("kongress-refresh"));
    await waitFor(() => expect(screen.getByTestId("kongress-stale")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getByTestId("kongress-stale")).toHaveTextContent(/Stand der Kopie: Abruf \d{2}\.\d{2}\. \d{2}:\d{2}/);
    expect(rows().length).toBe(before);
  });

  it("tells a page without server functions in words and shows no rows", async () => {
    world.apiDown = "missing";
    wrap();
    const err = await screen.findByTestId("kongress-error", undefined, { timeout: 10_000 });
    expect(err).toHaveAttribute("data-reason", "no-server");
    expect(err).toHaveTextContent("Die Server-Funktionen für den Kongress-Tracker sind auf dieser Seite nicht eingerichtet.");
    expect(screen.getByTestId("kongress-caveats")).toBeInTheDocument(); // the caveats stay
  });

  it("reports reports that could not be fetched and tries again on request", async () => {
    setCongressForTests({ fetch: clerkMock({ zip: ZIP, extra: { "20035143.pdf": () => reply("down", 503), "9000001": () => reply(SCAN_PDF) } }) as unknown as typeof fetch });
    wrap();
    await readAll(7);
    expect(screen.getByTestId("kongress-failed")).toHaveTextContent("2 Meldungen konnten nicht gelesen werden");
    expect(screen.getByTestId("kongress-failed")).toHaveTextContent("House Clerk nicht erreichbar (1)");
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    fireEvent.click(screen.getByTestId("kongress-retry-reports"));
    await waitFor(() => expect(screen.getByTestId("kongress-failed")).toHaveTextContent("1 Meldung konnte nicht gelesen werden"), { timeout: 15_000 });
    type("kongress-member", "pelosi");
    await waitFor(() => expect(rows()).toHaveLength(7));
  });
});
