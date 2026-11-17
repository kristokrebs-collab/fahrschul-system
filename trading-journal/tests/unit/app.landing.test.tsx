/**
 * The landing page of a first visit (`src/app/gate/Landing.tsx`, Launch-Audit B3): the claim and the sample journal, the three steps, the
 * plans with the pricing page's own parts, a closing call. Every button does what the pricing page's buttons do; nothing on the page
 * claims a number nobody measured; the sample is labelled as one and its sums are the sums of its rows.
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Landing, { sampleCurve, SAMPLE_DRAW } from "@/app/gate/Landing";
import { formatR, GATE, LANDING } from "@/app/gate/strings";
import { resetBilling, useBilling } from "@/billing/store";
import { setCloudEnabledForTests } from "@/cloud/env";
import { clearReturnTo, peekReturnTo } from "@/store/returnTo";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { installDomPolyfills } from "./views.overview.harness";

const CONFIG = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], coachAi: true, purchaseOpen: true } as never;

const landingCss = readFileSync("src/app/gate/landing.css", "utf8");

const renderIt = () =>
  render(
    <MotionRoot>
      <Landing foot={<footer data-testid="foot" />} />
    </MotionRoot>,
  );

describe("landing page", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearReturnTo();
    setCloudEnabledForTests(true);
    resetCloudSession();
    useCloudSession.setState({ phase: "signedOut" });
    resetBilling();
    useBilling.setState({ config: CONFIG });
  });
  afterEach(() => {
    setCloudEnabledForTests(null);
    resetCloudSession();
  });

  it("one h1 (the claim in two lines), the sample labelled as a sample, three steps, the plans, the closing call, the foot", () => {
    renderIt();
    const page = screen.getByTestId("entry-landing");
    expect(within(page).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent(`${LANDING.title[0]} ${LANDING.title[1]}`);
    const sample = within(page).getByTestId("landing-sample");
    expect(sample).toHaveTextContent(LANDING.sample.label);
    expect(within(sample).getAllByRole("listitem")).toHaveLength(LANDING.sample.rows.length);
    expect(within(sample).getByRole("img", { name: LANDING.sample.curve })).toBeInTheDocument();
    for (const s of LANDING.steps) expect(within(page).getByRole("heading", { level: 3, name: s.title })).toBeInTheDocument();
    const plans = within(page).getByTestId("landing-plans");
    expect(within(plans).getByRole("heading", { level: 2, name: LANDING.plansTitle })).toBeInTheDocument();
    for (const name of ["Free", "Pro", "Premium", "Team"]) expect(within(plans).getAllByText(name, { exact: true }).length).toBeGreaterThan(0);
    expect(within(plans).getByTestId("pricing-faq")).toBeInTheDocument();
    expect(within(page).getByRole("heading", { level: 2, name: LANDING.endTitle })).toBeInTheDocument();
    expect(within(page).getByTestId("foot")).toBeInTheDocument();
    // the price note and „Verträge hier kündigen“ (§ 312k BGB) stand on the page that shows prices
    expect(within(page).getByTestId("legal-cancel")).toBeInTheDocument();
  });

  it("„Kostenlos starten“ (twice) and „Konto erstellen“ open the registration without an order; „Anmelden“ the login", () => {
    renderIt();
    for (const id of ["landing-start", "landing-start-end", "landing-signup"]) {
      resetCloudSession();
      useCloudSession.setState({ phase: "signedOut" });
      fireEvent.click(screen.getByTestId(id));
      expect(useCloudSession.getState().sheet, id).toMatchObject({ open: true, view: "signup", source: "card" });
      expect(peekReturnTo(), id).toBeNull();
    }
    resetCloudSession();
    useCloudSession.setState({ phase: "signedOut" });
    fireEvent.click(screen.getByTestId("landing-signin"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signin", source: "card" });
  });

  it("a plan's button notes the order and opens the registration – the pricing page's own way", () => {
    renderIt();
    fireEvent.click(screen.getByTestId("cta-pro"));
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "signup" });
    expect(peekReturnTo()?.target).toMatchObject({ kind: "order" });
  });

  it("„Tarife vergleichen“ brings the plans' heading into view and gives it the focus", () => {
    renderIt();
    const head = screen.getByRole("heading", { level: 2, name: LANDING.plansTitle });
    let scrolled = 0;
    head.scrollIntoView = () => {
      scrolled++;
    };
    fireEvent.click(screen.getByTestId("landing-compare"));
    expect(scrolled).toBe(1);
    expect(head).toHaveFocus();
  });

  it("a window the gate had open is closed when the page takes over; one of another source stays", () => {
    useCloudSession.setState((s) => ({ sheet: { ...s.sheet, open: true, mounted: true, view: "signup", source: "gate" } }));
    const { unmount } = renderIt();
    expect(useCloudSession.getState().sheet.open).toBe(false);
    unmount();
    useCloudSession.setState((s) => ({ sheet: { ...s.sheet, open: true, mounted: true, view: "magic", source: "callback" } }));
    renderIt();
    expect(useCloudSession.getState().sheet).toMatchObject({ open: true, view: "magic", source: "callback" });
  });

  it("a browser that already holds a journal reads next to the first button that nothing is lost", () => {
    const before = useJournal.getState().trades;
    try {
      const { unmount } = renderIt();
      expect(screen.queryByTestId("landing-local-note")).toBeNull();
      unmount();
      useJournal.setState({ trades: [{ id: "t1" }] as never });
      renderIt();
      expect(screen.getByTestId("landing-local-note")).toHaveTextContent(GATE.localNote);
    } finally {
      useJournal.setState({ trades: before });
    }
  });

  it("the sample adds up: the line is the running sum of its rows, the reading lines are the sums by setup", () => {
    const rows = LANDING.sample.rows;
    const curve = sampleCurve();
    expect(curve).toHaveLength(rows.length + 1);
    expect(curve[0]).toBe(0);
    const total = rows.reduce((a, r) => a + r.r, 0);
    expect(curve.at(-1)).toBeCloseTo(total, 5);
    const sum = (pick: (setup: string) => boolean) => Math.round(rows.filter((r) => pick(r.setup)).reduce((a, r) => a + r.r, 0) * 10) / 10;
    expect(LANDING.sample.verdict[0].r).toBe(sum((s) => s === "A+ Setup"));
    expect(LANDING.sample.verdict[1].r).toBe(sum((s) => s !== "A+ Setup"));
    expect(formatR(2.1)).toBe("+2,1 R");
    expect(formatR(-1)).toBe("−1,0 R");
  });

  it("claims nothing nobody measured: no user counts, no promised results, no superlatives", () => {
    const flat = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(flat) : v && typeof v === "object" ? Object.values(v).flatMap(flat) : []);
    const copy = flat({ ...LANDING, sample: { ...LANDING.sample, rows: [] } }).join(" · ");
    expect(copy).not.toMatch(/\d[\d.]*\s*(Trader|Nutzer|Kunden|User)/i);
    expect(copy).not.toMatch(/garantiert|Garantie|sicher(e|er)? Gewinn|profitabel|reich|Nr\. ?1|beste[rsn]? |Marktführer|%/i);
    // the sample says that it is one
    expect(LANDING.sample.label).toBe("Beispielansicht");
  });

  it("motion: opacity and transform only, each piece once and waiting in its start pose; the line draws after the rows", () => {
    const frames = [...landingCss.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const props = [...f.matchAll(/^\s{4}([a-z-]+):/gm)].map((m) => m[1]);
      for (const p of props) expect(["opacity", "transform"]).toContain(p);
    }
    for (const m of landingCss.matchAll(/animation: ([^;]+);/g)) expect(m[1], m[1]).toMatch(/backwards/);
    expect(landingCss).not.toMatch(/infinite/);
    // the last row has landed before the line starts: 520 ms + 4 × 130 ms + 420 ms
    const rowsDone = (520 + (LANDING.sample.rows.length - 1) * 130 + 420) / 1000;
    expect(SAMPLE_DRAW.delay).toBeGreaterThanOrEqual(rowsDone - 0.25);
    expect(SAMPLE_DRAW.delay + SAMPLE_DRAW.duration).toBeLessThanOrEqual(2.4);
  });
});
