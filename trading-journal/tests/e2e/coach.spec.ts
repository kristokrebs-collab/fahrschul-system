/**
 * P04 Coach + Berichte end to end, on a seeded journal relative to "now": ~80 closed trades over ten weeks on three
 * setups (a strong breakout, a neutral sweep and a losing neckline short traded with FOMO), revenge re-entries ten
 * minutes after losses with double size, and one loss closed today. No cloud, no API key – the coach must be fully
 * useful without either and never show an AI button.
 *
 * Coach: `h1 Coach`, hero (wordmark, lesson, score), German questions with typed answers, evidence and confidence (a
 * suggestion chip, the best setup, the honest fallback), Heute, Leaks & Edges, "Plan übernehmen" (settings.coach.plan),
 * the timeline (filter, opens the trade detail), the profile, the live watcher (a revenge save → toast + live alert)
 * and the trade panel in the trade detail (P14 mounts it there; a timeline row opens it).
 * Berichte: "Bericht bereit" (full-screen wipe once, "Bericht öffnen"), `h1 Berichte`, the newest finished week, the
 * period stepper (split flap), month / focus switches, the archive, the seen marker, Markdown export (download) and the
 * PDF print view (print stubbed: the light print document is mounted while printing).
 * Both: the empty journal, no horizontal scroll at 390 px, no console errors.
 *
 * Runs on the routed pages `/#coach` and `/#berichte` of the production build (P14; `PW_COACH_URL` / `PW_BERICHTE_URL`
 * override them, e.g. the dev harnesses under `npm run dev`). `P04_SHOTS=<dir>` writes review screenshots.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed, toast } from "./helpers";

const COACH_URL = process.env.PW_COACH_URL ?? "/#coach";
const BERICHTE_URL = process.env.PW_BERICHTE_URL ?? "/#berichte";
const SHOTS = process.env.P04_SHOTS;
const PROJECTS = ["mobile", "desktop"];
const DAY = 86_400_000;
const MIN = 60_000;

/** The journal's local wall clock ("YYYY-MM-DDTHH:mm") in the BROWSER's zone (playwright.config: Europe/Berlin). */
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = (p: Record<string, unknown>): Record<string, unknown> => ({
  account: "scalp",
  timeframe: "1h",
  target: null,
  fees: 1,
  pnlManual: null,
  setups: ["s_bo"],
  checks: {},
  conviction: 3,
  followedPlan: true,
  emotion: "Ruhig",
  reason: "",
  notes: "",
  chart: "",
  pnl: null,
  r: null,
  mistakes: [],
  ...p,
});

const GLOBAL_CHECKS = ["g:trigger", "g:topdown", "g:spx", "g:stop", "g:lev"];
const SETUP_CHECKS = { s_bo: ["c1", "c2", "c3"], s_sweep: ["c1", "c2"], s_short: ["c1", "c2"] } as const;
/** Every rule and setup check ticked (`full`) or the top-down check skipped. */
const checksFor = (setup: keyof typeof SETUP_CHECKS, full: boolean): Record<string, boolean> =>
  Object.fromEntries([...GLOBAL_CHECKS.filter((g) => full || g !== "g:topdown"), ...SETUP_CHECKS[setup].map((c) => `${setup}:${c}`)].map((k) => [k, true]));

const SETUP = {
  s_bo: { win: 0.66, up: [1.6, 2.6], down: [-1, -0.9] },
  s_sweep: { win: 0.5, up: [1.1, 1.7], down: [-1, -0.85] },
  s_short: { win: 0.28, up: [0.9, 1.4], down: [-1.25, -1] },
} as const;

/** One trade closing `r` R with ~50 USDT risk (1 % of the 5 000 scalp account). */
function trade(id: string, at: number, holdMin: number, setup: keyof typeof SETUP, r: number, extra: Record<string, unknown> = {}, sizeK = 1): Record<string, unknown> {
  const entry = 60_000;
  const d = entry * 0.01;
  const qty = (50 * sizeK) / d;
  return base({
    id,
    side: "long",
    status: "closed",
    date: local(at),
    exitDate: local(at + holdMin * MIN),
    pair: "BTC/USDT",
    entry,
    stop: entry - d,
    exit: Math.round(entry + r * d),
    size: Math.round(qty * entry),
    leverage: 3,
    setups: [setup],
    checks: checksFor(setup, true),
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at + holdMin * MIN).toISOString(),
    ...extra,
  });
}

/** The seeded journal (deterministic, relative to `now`). */
export function coachTrades(now: number): Record<string, unknown>[] {
  const rand = rng(20261012);
  const out: Record<string, unknown>[] = [];
  const keys = Object.keys(SETUP) as (keyof typeof SETUP)[];
  let i = 0;
  for (let d = 68; d >= 1; d--) {
    const n = rand() < 0.2 ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const setup = keys[i % 3]!;
      const s = SETUP[setup];
      const win = rand() < s.win;
      const r = win ? s.up[0] + rand() * (s.up[1] - s.up[0]) : s.down[0] + rand() * (s.down[1] - s.down[0]);
      const at = now - d * DAY - (7 - j * 3) * 3_600_000;
      const fomo = setup === "s_short" && rand() < 0.65;
      out.push(trade(`e_co_${i}`, at, 90, setup, r, { emotion: fomo ? "FOMO" : "Ruhig", mistakes: fomo && !win ? ["Zu früh rein"] : [], followedPlan: !fomo, checks: checksFor(setup, !fomo) }));
      // a loss on the short is followed by a doubled revenge re-entry ten minutes after the close – which loses too
      if (setup === "s_short" && !win && i % 2 === 0) out.push(trade(`e_co_rv_${i}`, at + 100 * MIN, 45, "s_short", -1.1, { emotion: "Revenge", followedPlan: false, checks: {} }, 2));
      i++;
    }
  }
  // today: one loss closed 25 minutes ago
  out.push(trade("e_co_today", now - 85 * MIN, 60, "s_sweep", -1, { emotion: "Unsicher" }));
  return out;
}

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  if (fullPage) {
    await page.addStyleTag({ content: "header{position:static!important}" });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(140);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/P04-coach-reports-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

/** Opens the page once its `h1` is in the DOM (a full-screen dialog may hide it from the a11y tree). */
async function open(page: Page, url: string, h1: string): Promise<void> {
  await openRoute(page, url, h1, { attached: true });
}

test.describe("Coach", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P04 runs on mobile + desktop");
  });

  test("Hero, Fragen mit Belegen, Heute, Leaks & Edges, Plan, Timeline, Profil, Live-Wächter, Trade-Panel – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    const now = Date.now();
    await seed(page, { extra: { "tj2-trades": coachTrades(now) } });
    await open(page, COACH_URL, "Coach");
    const view = page.getByTestId("coach-view");
    await expect(view).toBeVisible();
    await expect(page.getByTestId("coach-hero")).toBeVisible();
    await expect(page.getByTestId("coach-lesson")).toContainText(/\w/);
    await expect(page.getByTestId("coach-score")).toContainText("/ 100");
    await expect(page.getByTestId("coach-score")).not.toContainText("Zu wenig Daten");
    await shot(page, info, "coach-top");

    // no key, no cloud: never an AI button
    await expect(page.getByTestId("coach-ai")).toHaveCount(0);

    // a suggestion chip → a typed answer with confidence
    const chat = page.getByTestId("coach-chat");
    await chat.getByTestId("coach-chip").first().click();
    const answer = chat.getByTestId("coach-answer").first();
    await expect(answer).toBeVisible();
    await expect(answer.getByRole("meter", { name: "Konfidenz" })).toBeVisible({ timeout: 15_000 });
    await expect(answer).toContainText(/klar|Tendenz|zu wenig Daten/);

    // the best setup – named, with evidence trades
    await chat.getByTestId("coach-input").fill("Was ist mein bestes Setup?");
    await chat.getByTestId("coach-ask").click();
    const best = chat.getByTestId("coach-answer").first();
    await expect(best).toContainText("4H-Breakout", { timeout: 15_000 });
    await expect(best.getByText("Belege")).toBeVisible({ timeout: 15_000 });
    await shot(page, info, "coach-chat");

    // the honest fallback – no guessing
    await chat.getByTestId("coach-input").fill("Wie wird das Wetter morgen in Berlin?");
    await chat.getByTestId("coach-input").press("Enter");
    await expect(chat.getByTestId("coach-answer").first()).toHaveAttribute("data-kind", "unknown");
    await expect(chat.getByTestId("coach-answer").first()).toContainText("nicht verstanden", { timeout: 15_000 });

    // today: the loss of today
    await expect(page.getByTestId("coach-today")).toContainText("Trades");

    // leaks & edges: the neckline short (FOMO, revenge) shows up as a leak
    const edges = page.getByTestId("coach-edges");
    await edges.scrollIntoViewIfNeeded();
    await expect(edges.getByTestId("coach-leak").first()).toBeVisible();
    await expect(edges).toContainText(/klar|Tendenz/);
    await shot(page, info, "coach-edges");

    // plan: pin it → stored in settings.coach.plan
    const plan = page.getByTestId("coach-plan");
    await plan.scrollIntoViewIfNeeded();
    await plan.getByTestId("coach-plan-accept").click();
    await expect(toast(page)).toContainText("Plan gepinnt");
    await expect(plan).toHaveAttribute("data-pinned", "1");
    await expect
      .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { coach?: { plan?: { goals?: unknown[] } } }).coach?.plan?.goals?.length ?? 0))
      .toBeGreaterThan(0);

    // timeline: revenge rows, filter, a row opens the trade detail
    const tl = page.getByTestId("coach-timeline");
    await tl.scrollIntoViewIfNeeded();
    await expect(tl.getByTestId("coach-timeline-row").first()).toBeVisible();
    await tl.getByRole("button", { name: /^Revenge/ }).click();
    await expect(tl.getByTestId("coach-timeline-row").first()).toContainText("Revenge");
    await shot(page, info, "coach-plan-timeline");
    await tl.getByTestId("coach-timeline-row").first().click();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await expect(detail).toBeVisible();
    // the trade panel (P14 mounts it in the trade detail once the detail settled)
    const panel = detail.getByTestId("trade-coach-panel");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText("Coach");
    await expect(panel).toContainText(/Plan & Ausführung|Verhalten|Regeln/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // profile
    const profile = page.getByTestId("coach-profile");
    await profile.scrollIntoViewIfNeeded();
    await expect(profile).toContainText(/Stil|Stärkstes Setup|Schwächster Tag/);
    await shot(page, info, "coach-profile");

    await expectNoHorizontalScroll(page);
    await shot(page, info, "coach-full", true);

    // live watcher: a doubled re-entry right after today's loss → toast + live alert in "Heute"
    await page.evaluate(
      (t) => {
        const j = (window as unknown as { __tjJournal: { getState(): { saveTrade(t: unknown): Promise<void> } } }).__tjJournal;
        void j.getState().saveTrade(t);
      },
      base({ side: "long", status: "closed", date: local(now - 12 * MIN), exitDate: local(now - 2 * MIN), pair: "BTC/USDT", entry: 60_000, stop: 59_400, exit: 59_300, size: 10_000, leverage: 5, setups: ["s_short"], emotion: "Revenge", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    );
    await expect(toast(page)).toContainText("Coach:");
    const today = page.getByTestId("coach-today");
    await today.scrollIntoViewIfNeeded();
    await expect(today.getByTestId("coach-live-alert")).toBeVisible();
    await shot(page, info, "coach-live");
    expect(errors).toEqual([]);
  });

  test("leeres Journal: ehrliche Leerzustände, Fragen ohne Raten, keine Fehler", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await open(page, COACH_URL, "Coach");
    await expect(page.getByTestId("coach-score")).toContainText("Zu wenig Daten");
    await expect(page.getByTestId("coach-chat")).toContainText("nichts wird geraten");
    await page.getByTestId("coach-input").fill("Wie ist meine Win-Rate?");
    await page.getByTestId("coach-ask").click();
    await expect(page.getByTestId("coach-answer").first()).toBeVisible();
    await expect(page.getByTestId("coach-ai")).toHaveCount(0);
    await expect(page.getByTestId("coach-timeline")).toContainText("Keine Muster");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});

test.describe("Berichte", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P04 runs on mobile + desktop");
  });

  test("Bericht bereit, Woche, Zeitraum-Wechsel, Monat, Fokus, Archiv, gesehen, Export Markdown + PDF – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    const now = Date.now();
    await seed(page, { reportReady: true, extra: { "tj2-trades": coachTrades(now) } });
    // the print dialog: record that the light print document is mounted at the moment print() is called
    await page.addInitScript(() => {
      const w = window as unknown as { __printed?: { n: number; cls: boolean; doc: boolean; html: string } };
      window.print = () => {
        const root = document.querySelector(".report-print-root");
        w.__printed = { n: (w.__printed?.n ?? 0) + 1, cls: document.documentElement.classList.contains("tj-report-printing"), doc: !!root?.querySelector("[data-testid=report-print]"), html: root?.outerHTML ?? "" };
      };
    });
    await open(page, BERICHTE_URL, "Berichte");

    // the period that just ended is announced once (the week – or a month / quarter / year that ended too)
    const ready = page.getByTestId("report-ready");
    await expect(ready).toBeVisible();
    await expect(ready).toContainText(/(Wochen|Monats|Quartals|Jahres)bericht/);
    const readyKey = await ready.getAttribute("data-key");
    await page.waitForTimeout(1400);
    await shot(page, info, "berichte-ready");
    await page.getByTestId("report-ready-open").click();
    await expect(ready).toHaveCount(0);

    // "Bericht öffnen" selected the announced report
    const view = page.getByTestId("berichte-view");
    const hero = page.getByTestId("report-hero");
    await expect(view).toHaveAttribute("data-key", readyKey!);
    // a reload does not announce it again
    await page.reload();
    await page.locator("h1", { hasText: "Berichte" }).first().waitFor({ state: "attached" });
    await page.waitForTimeout(800);
    await expect(ready).toHaveCount(0);

    await page.getByRole("radio", { name: "Woche" }).click();
    await expect(view).toHaveAttribute("data-kind", "week");
    const weekKey = await view.getAttribute("data-key");
    expect(weekKey).toMatch(/^\d{4}-W\d{2}$/);
    await expect(hero).toContainText("abgeschlossen");
    await expect(page.getByTestId("report-summary")).toContainText(/Trades?/);
    await expect(page.getByTestId("report-performance")).toBeVisible();
    await expect(page.getByTestId("report-compare")).toBeVisible();
    await expect(page.getByTestId("report-goals")).toBeVisible();
    await shot(page, info, "berichte-top");

    // seen after a short look: stored, "neu" gone from the row
    await expect
      .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { coach?: { reports?: { seen?: string[] } } }).coach?.reports?.seen ?? []), { timeout: 10_000 })
      .toContain(weekKey);
    const row = page.locator(`[data-testid=report-archive-row][data-key="${weekKey}"]`);
    await expect(row).not.toContainText("neu");

    // stepper: one week back, then the newest again
    await page.getByTestId("report-prev").click();
    await expect(view).not.toHaveAttribute("data-key", weekKey!);
    await page.getByTestId("report-newest").click();
    await expect(view).toHaveAttribute("data-key", weekKey!);

    // month
    await page.getByRole("radio", { name: "Monat" }).click();
    await expect(view).toHaveAttribute("data-kind", "month");
    await expect(view).toHaveAttribute("data-key", /^\d{4}-\d{2}$/);
    expect(await page.getByTestId("report-archive-row").count()).toBeGreaterThanOrEqual(2);
    await shot(page, info, "berichte-month");

    // focus: only the risk section
    await page.getByTestId("report-focus").filter({ hasText: "Risiko" }).click();
    await expect(page.getByTestId("report-risk")).toBeVisible();
    await expect(page.getByTestId("report-strategy")).toHaveCount(0);
    await expect(page.getByTestId("report-performance")).toHaveCount(0);
    await page.getByTestId("report-focus").filter({ hasText: "Alles" }).click();
    await expect(page.getByTestId("report-strategy")).toBeVisible();

    // Markdown export
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-md").click()]);
    expect(dl.suggestedFilename()).toMatch(/^bericht-\d{4}-\d{2}\.md$/);

    // PDF: the light print document is mounted while printing, then removed
    await page.getByTestId("report-export-pdf").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: { n: number } }).__printed?.n ?? 0)).toBe(1);
    const printed = await page.evaluate(() => (window as unknown as { __printed: { cls: boolean; doc: boolean; html: string } }).__printed);
    expect(printed.cls).toBe(true);
    expect(printed.doc).toBe(true);
    await expect(page.locator(".report-print-root")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("tj-report-printing"))).toBe(false);

    await expectNoHorizontalScroll(page);
    await shot(page, info, "berichte-full", true);

    // the print view as the PDF would show it (re-mounted from what print() saw, print media)
    if (SHOTS) {
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML("beforeend", html);
        document.documentElement.classList.add("tj-report-printing");
      }, printed.html);
      await page.emulateMedia({ media: "print" });
      await page.screenshot({ path: `${SHOTS}/P04-coach-reports-print-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage: true, animations: "disabled" });
      await page.emulateMedia({ media: "screen" });
    }
    expect(errors).toEqual([]);
  });

  test("leeres Journal: kein Bericht bereit, ehrliche Leerzustände, Export gesperrt, keine Fehler", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { empty: true });
    await open(page, BERICHTE_URL, "Berichte");
    await expect(page.getByTestId("report-ready")).toHaveCount(0);
    await expect(page.getByTestId("report-summary")).toContainText("Keine abgeschlossenen Trades");
    await expect(page.getByTestId("report-archive")).toContainText("Noch kein abgeschlossener Zeitraum");
    await expect(page.getByTestId("report-export-md")).toBeDisabled();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
