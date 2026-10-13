/**
 * P08 Wachstum page end to end on a seeded journal (relative to "now", Berlin wall clock): 5 weeks of reviewed trades
 * with a few revenge entries, daily check-ins, a pre-market plan on some days, goals, a running challenge and habits in
 * `settings.growth`.
 *
 * Covered: `h1 Wachstum`, all sections; the check-in sheet (mood glyph, elastic sliders by keyboard, words) writing the
 * day journal; the pre-trade check (checklist → "Bereit", two losses closed just now → the P05 pause → "Pause");
 * streaks; goals (template → card → remove; a reached goal → "Ziel erreicht" wipe + status done); the challenge deck
 * (draw → flip → accept); habits (add, tick today → day journal); the post-trade review ("Jetzt reviewen" and the
 * automatic prompt after closing a trade); trackers / mood / diary / skills / bests / progress; no horizontal scroll at
 * 390 px; no console errors.
 *
 * Runs on the routed page `/#wachstum` of the production build (P14; `PW_WACHSTUM_URL` overrides it, e.g. the dev
 * harness `/dev/wachstum.html` under `npm run dev`). `P08_SHOTS=<dir>` writes review screenshots.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, fixture, openRoute, seed, settledBox, stored, toast } from "./helpers";

const URL_ = process.env.PW_WACHSTUM_URL ?? "/#wachstum";
const SHOTS = process.env.P08_SHOTS;
const PROJECTS = ["mobile", "desktop"];
const DAY = 86_400_000;
const MIN = 60_000;

/** The journal's local wall clock in the BROWSER's zone (playwright.config: Europe/Berlin). */
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");
const dayKey = (ms: number): string => local(ms).slice(0, 10);

const trade = (p: Record<string, unknown>): Record<string, unknown> => ({
  account: "scalp",
  side: "long",
  status: "closed",
  pair: "BTC/USDT",
  timeframe: "1h",
  entry: 100,
  stop: 99,
  target: 103,
  size: 10_000,
  leverage: 3,
  fees: 0,
  pnlManual: null,
  setups: ["s_bo"],
  checks: {},
  conviction: 3,
  followedPlan: true,
  emotion: "Ruhig",
  reason: "Plan",
  notes: "Sauber nach Plan.",
  chart: "",
  pnl: null,
  r: null,
  mistakes: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...p,
});

export interface GrowthSeed {
  trades: Record<string, unknown>[];
  days: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/** The seeded journal relative to `now` (`reached`: a goal whose hold is already complete → the wipe on load). */
export function growthSeed(now: number, opts: { reached?: boolean; pause?: boolean } = {}): GrowthSeed {
  const trades: Record<string, unknown>[] = [];
  const days: Record<string, unknown> = {};
  const words = [["Fokussiert", "Ruhig"], ["Müde"], ["Ungeduldig", "FOMO"], ["Zuversichtlich"], ["Ruhig"], ["Gereizt"], ["Fokussiert"]];
  for (let d = 36; d >= 1; d--) {
    const base = now - d * DAY;
    const wd = new Date(base).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const at = base - (base % DAY) + 9 * 3_600_000; // ≈ 10–11 Uhr Berlin
    const win = d % 3 !== 0;
    trades.push(trade({ id: `g_t${d}`, date: local(at), exitDate: local(at + 2 * 3_600_000), exit: win ? 102 : 99, psych: { stress: win ? 2 : 4 }, updatedAt: new Date(at).toISOString() }));
    if (wd === 3) {
      // a loss, then a revenge entry 15 minutes after it closed
      trades.push(trade({ id: `g_l${d}`, date: local(at + 3 * 3_600_000), exitDate: local(at + 4 * 3_600_000), exit: 99 }));
      trades.push(trade({ id: `g_r${d}`, date: local(at + 4 * 3_600_000 + 15 * MIN), exitDate: local(at + 5 * 3_600_000), exit: 98.8, emotion: "Revenge", followedPlan: false, notes: "Zu schnell wieder rein." }));
    }
    if (d <= 26) days[dayKey(at)] = { note: "", updatedAt: new Date(at).toISOString(), mood: win ? 4 : 2, plan: d % 2 ? "Nur A-Setups, Stop vor Einstieg." : undefined, checkin: { stress: win ? 2 : 4, energy: win ? 4 : 2, sleep: win ? 7.5 : 5.5, emotions: words[d % words.length], habits: { h_move: d % 3 !== 1 } } };
  }
  // two recent closed trades without a review (yesterday)
  trades.push(trade({ id: "g_open1", date: local(now - 26 * 3_600_000), exitDate: local(now - 25 * 3_600_000), exit: 101.5, notes: "", psych: undefined }));
  trades.push(trade({ id: "g_open2", date: local(now - 24 * 3_600_000), exitDate: local(now - 23 * 3_600_000), exit: 99, notes: "", psych: undefined }));
  // an open position (closed later by the review-prompt test)
  trades.push(trade({ id: "g_live", status: "open", date: local(now - 90 * MIN), exit: null, leverage: 2, notes: "", psych: undefined }));
  if (opts.pause) {
    for (const [k, ago] of [
      [0, 18],
      [1, 6],
    ] as const)
      trades.push(trade({ id: `g_pause${k}`, date: local(now - (ago + 30) * MIN), exitDate: local(now - ago * MIN), exit: 99, size: 2000, notes: "Verlust" }));
  }
  const created = new Date(now - 45 * DAY).toISOString();
  const settings = {
    ...(fixture["tj2-settings"] as Record<string, unknown>),
    growth: {
      goals: [
        { id: "gl_rev", title: "Jeden Trade reviewen", kind: "process", metric: "journalRate", target: 0.6, comparator: "atLeast", period: "week", source: { kind: "coach", ref: "journal" }, why: "Ohne Review kein Lernen.", createdAt: created, status: "active", hold: opts.reached ? 2 : 12 },
        { id: "gl_rules", title: "Kein Revenge-Trade", kind: "process", metric: "behavior", scope: { behavior: "revenge" }, target: 0, comparator: "atMost", period: "week", source: { kind: "user" }, createdAt: created, status: "active" },
        { id: "gl_checkin", title: "Täglicher Check-in", kind: "process", metric: "habit", scope: { habit: "auto:checkin" }, target: 0.7, comparator: "atLeast", period: "week", source: { kind: "user" }, createdAt: created, status: "active" },
      ],
      challenges: [{ id: "ch_calm", template: "stop14", title: "Stop immer", start: dayKey(now - 4 * DAY), createdAt: new Date(now - 4 * DAY).toISOString(), status: "active" }],
      habits: [
        { id: "auto:checkin", title: "Täglicher Check-in", auto: "checkin", createdAt: created },
        { id: "auto:plan", title: "Plan vor dem Markt", auto: "plan", createdAt: created },
        { id: "h_move", title: "Bewegung", createdAt: created },
      ],
    },
  };
  return { trades, days, settings };
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
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${SHOTS}/P08-psych-growth-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

async function open(page: Page, s: GrowthSeed | null, opts: { reviewPrompt?: boolean } = {}): Promise<void> {
  await seed(page, s ? { ...opts, extra: { "tj2-trades": s.trades, "tj2-days": s.days, "tj2-settings": s.settings } } : { ...opts, empty: true });
  await openRoute(page, URL_, "Wachstum");
}

test.describe("Wachstum", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P08 runs on mobile + desktop");
  });

  test("Seite: Heute, Serien, Ziele, Challenges, Gewohnheiten, Psyche, Fortschritt – keine Fehler, kein horizontaler Scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, growthSeed(Date.now()));
    const view = page.getByTestId("wachstum-view");
    await expect(view).toBeVisible();
    for (const t of ["Heute", "Serien", "Ziele", "Challenges & Gewohnheiten", "Psyche", "Fortschritt"]) await expect(page.getByRole("heading", { level: 2, name: t, exact: true })).toBeAttached();

    // Heute: no check-in yet today, two trades without review
    await expect(page.getByTestId("growth-checkin")).toHaveAttribute("data-has", "0");
    await expect(page.getByTestId("growth-reviews")).toHaveAttribute("data-open", "2");
    await expect(page.getByTestId("growth-ready")).toHaveAttribute("data-state", /caution|ready/);
    await shot(page, info, "top");

    // streaks: four badges, the journal streak runs
    const streaks = page.getByTestId("growth-streaks");
    await streaks.scrollIntoViewIfNeeded();
    for (const k of ["journal", "checkin", "green", "discipline"]) await expect(streaks.getByTestId(`streak-${k}`)).toBeVisible();
    expect(Number(await streaks.getByTestId("streak-journal").getAttribute("data-best"))).toBeGreaterThan(3);

    // goals: three cards, the revenge goal reads the coach events
    const goals = page.getByTestId("growth-goals");
    await goals.scrollIntoViewIfNeeded();
    await expect(goals.getByTestId("goal-card")).toHaveCount(3);
    await shot(page, info, "goals");

    // challenge running + deck; habits with three rows
    const ch = page.getByTestId("growth-challenges");
    await ch.scrollIntoViewIfNeeded();
    await expect(ch.getByTestId("challenge-running")).toHaveCount(1);
    await expect(ch.getByTestId("challenge-deck")).toBeVisible();
    const habits = page.getByTestId("growth-habits");
    await expect(habits.getByTestId("habit-row")).toHaveCount(3);
    await shot(page, info, "routines");

    // psyche: revenge is the top tracker, the mood factor has enough days, the diary has entries
    const trackers = page.getByTestId("growth-trackers");
    await trackers.scrollIntoViewIfNeeded();
    await expect(trackers).toHaveAttribute("data-top", "revenge");
    await expect(page.getByTestId("growth-mood")).not.toHaveAttribute("data-factor", "");
    const diary = page.getByTestId("growth-diary");
    await diary.scrollIntoViewIfNeeded();
    await expect(diary.getByTestId("diary-entry")).toBeVisible();
    await shot(page, info, "psyche");

    // progress: skills with a level, bests, weekly series
    const skills = page.getByTestId("growth-skills");
    await skills.scrollIntoViewIfNeeded();
    await expect(skills).not.toHaveAttribute("data-level", "0");
    await expect(page.getByTestId("growth-bests").getByTestId("best").first()).toBeVisible();
    await expect(page.getByTestId("progress-discipline")).toBeVisible();
    await shot(page, info, "progress");

    await expectNoHorizontalScroll(page);
    if (SHOTS) await shot(page, info, "full", true);
    expect(errors).toEqual([]);
  });

  test("Check-in: Stimmung, Regler per Tastatur, Wörter → Tagesjournal; Checkliste → Bereit", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, growthSeed(Date.now()));
    await page.getByTestId("wachstum-checkin").click();
    const sheet = page.getByTestId("checkin-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: "Gut", exact: true }).click();
    await expect(sheet.getByTestId("checkin-mood-glyph")).toHaveAttribute("data-mood", "4");
    const stress = sheet.getByTestId("ci-stress");
    await stress.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect(stress).toHaveAttribute("aria-valuenow", "2");
    await sheet.getByTestId("ci-energy").focus();
    await page.keyboard.press("End");
    await sheet.getByTestId("ci-sleep").focus();
    await page.keyboard.press("End");
    await page.keyboard.press("PageDown");
    await expect(sheet.getByTestId("ci-sleep")).toHaveAttribute("aria-valuenow", "11");
    await sheet.getByTestId("checkin-emotions").getByRole("button", { name: "Fokussiert" }).click();
    await shot(page, info, "checkin");
    await page.getByTestId("checkin-save").click();
    await expect(toast(page)).toContainText("Check-in gespeichert");
    await expect(page.getByTestId("growth-checkin")).toHaveAttribute("data-has", "1");
    const days = await stored<Record<string, { mood?: number; checkin?: { stress?: number; energy?: number; sleep?: number; emotions?: string[] } }>>(page, "tj2-days");
    const today = days![dayKey(Date.now())]!;
    expect(today.mood).toBe(4);
    expect(today.checkin).toMatchObject({ stress: 2, energy: 5, sleep: 11, emotions: ["Fokussiert"] });

    // pre-trade check: tick every point → ready. Ticked from a still page (the sheet gone, the card's reveal – it
    // only starts once the list scrolls into view on a phone – done), each tick confirmed before the next
    await expect(sheet).toHaveCount(0);
    const ready = page.getByTestId("growth-ready");
    const list = ready.getByTestId("growth-ready-checklist");
    const boxes = list.getByRole("checkbox");
    await list.scrollIntoViewIfNeeded();
    await settledBox(list);
    const n = await boxes.count();
    expect(n, "checklist points").toBeGreaterThan(0);
    await expect(ready.getByTestId("growth-ready-count")).toHaveText(`0/${n}`);
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).click();
      await expect(boxes.nth(i), `point ${i + 1} ticked`).toHaveAttribute("aria-checked", "true");
      await expect(ready.getByTestId("growth-ready-count")).toHaveText(`${i + 1}/${n}`);
    }
    await expect(ready).toHaveAttribute("data-state", "ready");
    await expect(ready.getByTestId("growth-ready-label")).toHaveText("Bereit");
    await shot(page, info, "ready");
    expect(errors).toEqual([]);
  });

  test("Pause: zwei Verluste gerade geschlossen → P05-Pause im Bereitschafts-Check", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, growthSeed(Date.now(), { pause: true }));
    const ready = page.getByTestId("growth-ready");
    await expect(ready).toHaveAttribute("data-state", "pause");
    await expect(ready).toContainText(/Pause · \d+:\d\d/);
    await expect(ready.getByTestId("growth-ready-reasons")).toContainText("Verluste in Folge");
    expect(errors).toEqual([]);
  });

  test("Ziele: Vorlage anlegen, entfernen; erreichtes Ziel → Wipe „Ziel erreicht“", async ({ page }, info) => {
    const errors = collectErrors(page);
    // the wipe opens with the first render and closes itself after a few seconds: record it the moment it appears
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const el = document.querySelector("[data-testid=goal-wipe]");
        if (el) (window as unknown as { __wipe?: string }).__wipe = el.textContent ?? "";
      }).observe(document, { childList: true, subtree: true });
    });
    await open(page, growthSeed(Date.now(), { reached: true }));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wipe?: string }).__wipe ?? ""), { timeout: 15_000 }).toContain("Jeden Trade reviewen");
    const wipe = page.getByTestId("goal-wipe");
    if (await wipe.isVisible()) {
      await shot(page, info, "wipe");
      await page.getByRole("dialog", { name: "Ziel erreicht" }).getByRole("button", { name: "Schließen" }).click();
    }
    await expect(wipe).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => ((await stored<{ growth: { goals: { id: string; status: string }[] } }>(page, "tj2-settings"))?.growth.goals.find((g) => g.id === "gl_rev")?.status) ?? "")
      .toBe("done");
    const goals = page.getByTestId("growth-goals");
    await expect(goals.getByTestId("goal-card")).toHaveCount(2);

    // a template goal
    await goals.getByTestId("goal-add").click();
    const sheet = page.getByTestId("goal-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("goal-templates").getByRole("button", { name: /Kein Regelverstoß/ }).click();
    await expect(sheet.getByTestId("goal-title")).toHaveValue("Kein Regelverstoß");
    await shot(page, info, "goal-sheet");
    await page.getByTestId("goal-save").click();
    await expect(toast(page)).toContainText("Ziel gespeichert");
    await expect(goals.getByTestId("goal-card")).toHaveCount(3);
    // remove it again
    const card = goals.locator('[data-testid=goal-card]', { hasText: "Kein Regelverstoß" });
    await card.getByTestId("goal-drop").click();
    await card.getByTestId("goal-drop-yes").click();
    await expect(goals.getByTestId("goal-card")).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("Challenge ziehen und annehmen, Gewohnheit anlegen und abhaken", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, growthSeed(Date.now()));
    const ch = page.getByTestId("growth-challenges");
    await ch.scrollIntoViewIfNeeded();
    await ch.getByTestId("challenge-draw").click();
    const drawn = ch.getByTestId("challenge-drawn");
    await expect(drawn).toBeVisible();
    // revenge is the most frequent pattern → "Ruhige Hand" is dealt first
    await expect(drawn).toContainText("Ruhige Hand");
    await shot(page, info, "challenge-drawn");
    await ch.getByTestId("challenge-other").click();
    await expect(ch.getByTestId("challenge-drawn")).not.toContainText("Ruhige Hand");
    await ch.getByTestId("challenge-accept").click();
    await expect(toast(page)).toContainText("Challenge gestartet");
    await expect(ch.getByTestId("challenge-running")).toHaveCount(2);

    const habits = page.getByTestId("growth-habits");
    await habits.getByTestId("habit-add").click();
    await habits.getByTestId("habit-input").fill("Atemübung");
    await habits.getByTestId("habit-save").click();
    await expect(habits.getByTestId("habit-row")).toHaveCount(4);
    const row = habits.locator('[data-testid=habit-row]', { hasText: "Atemübung" });
    await row.getByTestId("habit-today").click();
    await expect(row).toHaveAttribute("data-done", "1");
    const days = await stored<Record<string, { checkin?: { habits?: Record<string, boolean> } }>>(page, "tj2-days");
    expect(Object.values(days![dayKey(Date.now())]!.checkin!.habits!)).toContain(true);
    expect(errors).toEqual([]);
  });

  test("Post-Trade-Review: offene Reviews und automatische Frage nach dem Schließen", async ({ page }, info) => {
    const errors = collectErrors(page);
    // this test is about the automatic prompt: it stays on (the seed switches it off for every other spec)
    await open(page, growthSeed(Date.now()), { reviewPrompt: true });
    await page.getByTestId("growth-review-open").click();
    const review = page.getByTestId("post-trade-review");
    await expect(review).toBeVisible();
    await review.getByRole("radio", { name: "Ja" }).click();
    await review.getByTestId("post-trade-note").fill("Geduldig gewartet, Ziel erreicht.");
    await shot(page, info, "review");
    await page.getByTestId("post-trade-save").click();
    await expect(toast(page)).toContainText("Review gespeichert");
    await expect(page.getByTestId("growth-reviews")).toHaveAttribute("data-open", "1");

    // closing the open trade by a real save → the review asks by itself
    await page.evaluate(() => {
      const j = (window as unknown as { __tjJournal: { getState(): { trades: { id: string }[]; saveTrade(t: unknown): Promise<void> } } }).__tjJournal;
      const t = j.getState().trades.find((x) => x.id === "g_live")!;
      void j.getState().saveTrade({ ...t, status: "closed", exit: 102, updatedAt: new Date().toISOString() });
    });
    await expect(page.getByTestId("post-trade-review")).toHaveAttribute("data-trade", "g_live", { timeout: 10_000 });
    await page.getByTestId("post-trade-later").click();
    await expect(page.getByTestId("post-trade-review")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("leeres Journal: ehrliche Leerzustände, keine Fehler, kein horizontaler Scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, null);
    await expect(page.getByTestId("growth-goals")).toHaveAttribute("data-n", "0");
    await expect(page.getByTestId("tracker-quiet")).toBeVisible();
    await expect(page.getByTestId("mood-empty")).toBeVisible();
    await expect(page.getByTestId("growth-skills")).toHaveAttribute("data-level", "0");
    await expect(page.getByTestId("growth-reviews")).toHaveAttribute("data-open", "0");
    await expectNoHorizontalScroll(page);
    if (SHOTS) await shot(page, info, "empty", true);
    expect(errors).toEqual([]);
  });
});
