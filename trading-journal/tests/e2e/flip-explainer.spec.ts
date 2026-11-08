/**
 * "Was ist ein Flip?" (Paket W) – the explainer on top of the Top-Trader card on the Markt page, on a KNOWN market: the mocked Binance REST
 * serves a top-trader POSITION series that was net long and flipped to net short 60 periods (hours) ago (`flip-short`, `mocks/synth.ts`,
 * 500 hourly points). The expectation comes from the app's own pure functions on the same rows (`buildTraderNet`, `flipModel`).
 * NOT checked against real Binance values (fapi.binance.com answers 451 from the sandbox network) – fixtures only.
 * Covered (text only since the Rücknahme R4 – no chart and no schema of its own, the card's plot is the picture): the flip sentence
 * (window, flip, caption, provenance), "Wie lese ich das?", no motion of its own, the state without Binance data (same box), no layout
 * jump (CLS ≤ 0,02, the reserved box is the size of the panel), touch targets ≥ 44 px, axe in dark and light, the alert link (opens
 * Einstellungen › Alarme; without an account it says so – nothing is switched on), screenshots (`FLIP_SHOTS_DIR`).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { buildTraderNet, netDayText, type NetPriceBar } from "../../src/domain/signals";
import { FLIP_RESERVE_PX } from "../../src/views/markt/flipExplainerReserve";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, pinClock, seed, utcToday } from "./helpers";
import { blockExternalNetwork, signInViaSheet } from "./cloudSignIn";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockBilling } from "./mocks/billing";
import { mockSupabase } from "./mocks/supabase";
import { synthKlines, synthRatios } from "./mocks/synth";

const HOUR = 3_600_000;
const AT = () => utcToday(6, 3);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const CARD = "markt-trader-net";
const SHOTS = process.env.FLIP_SHOTS_DIR;

interface Opened {
  card: Locator;
  box: Locator;
  now: number;
  anchor: number;
}

async function openMarkt(page: Page, opts: { light?: boolean; cls?: boolean; afterSeed?: () => Promise<unknown> } = {}): Promise<Opened> {
  const at = AT();
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  await page.addInitScript(() => {
    // every WAAPI animation the app starts is counted by the element's test id (the explainer itself starts none)
    const w = window as unknown as { __animated: string[]; __cls: number };
    w.__animated = [];
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      w.__animated.push(this.getAttribute("data-testid") ?? this.tagName);
      return orig.apply(this, args);
    };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await seed(page, { synth: { ratios: "flip-short", anchor }, clock: clock.now, extra: opts.light ? { "tj2-theme": JSON.stringify("light") } : {} });
  await opts.afterSeed?.();
  await page.goto("/#markt");
  await expect(page.locator('[data-page="markt"][data-page-role="current"] h1').first()).toBeAttached({ timeout: 30_000 });
  const card = page.getByTestId(CARD);
  await card.scrollIntoViewIfNeeded();
  await page.getByTestId("flip-explainer").scrollIntoViewIfNeeded();
  return { card, box: page.getByTestId("flip-explainer"), now: at, anchor };
}

/** What the app must derive from the mock's rows (its own pure functions on the same data; the window is the newest 14 days). */
function expected(now: number, anchor: number) {
  const rows = synthRatios("top-position", "1h", { limit: 500 }, "flip-short", now);
  const positions = rows.map((r) => ({ time: Number(r.timestamp), longPct: Number(r.longAccount) * 100, shortPct: Number(r.shortAccount) * 100 }));
  const bars: NetPriceBar[] = synthKlines("1h", { limit: 499 }, anchor, now, "capitulation").map((k) => ({ time: k[0], open: Number(k[1]), close: Number(k[4]) }));
  const view = buildTraderNet(positions, bars, now, HOUR);
  const last = view.points[view.points.length - 1]!.t;
  const inWindow = view.points.filter((p) => p.t >= last - 14 * 24 * HOUR).length;
  const flip = view.flip!;
  const day = netDayText(flip.at).replace(/\./g, "\\.");
  const caption = new RegExp(`^Flip am ${day}: Top-Trader \\(oberste 20 % nach Einsatz, Binance\\) sind im geladenen Verlauf von 20 Tagen erstmals netto Short\\.`);
  return { view, inWindow, flip, caption };
}

const animated = (page: Page) => page.evaluate(() => (window as unknown as { __animated: string[] }).__animated);
const clsOf = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

async function shot(page: Page, info: TestInfo, name: string, target: Locator): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-${info.project.name}.jpg`, type: "jpeg", quality: 55, clip: (await target.boundingBox())! });
}

test.describe("Was ist ein Flip? – on the Top-Trader card", () => {
  test.setTimeout(90_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("visible on top of the card, text only: title and definition, the flip sentence, the hint, Quelle · Kohorte · Messzeit – no chart, no schema of its own", async ({ page }, info) => {
    const errors = collectErrors(page);
    const { card, box, now, anchor } = await openMarkt(page);
    const exp = expected(now, anchor);
    expect(exp.flip, "oracle: one flip to Short inside the window").toMatchObject({ from: "long", to: "short" });
    expect(exp.view.previousFlip, "oracle: no earlier flip in the loaded history").toBeNull();
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("data-kind", "flip");
    await expect(box.getByRole("heading", { name: "Was ist ein Flip?" })).toBeVisible();
    await expect(box.getByTestId("flip-explainer-lead")).toContainText("Top-Trader (oberste 20 % nach Einsatz, Binance)");
    // it sits at the top of the card, above its headline
    const top = (await box.boundingBox())!.y;
    expect(top).toBeLessThan((await card.getByTestId("trader-net-title").boundingBox())!.y);
    // the sentence: the window and the flip are those of the app's own functions on the same rows
    await expect(box).toHaveAttribute("data-points", String(exp.inWindow), { timeout: 15_000 });
    await expect(box).toHaveAttribute("data-flip", String(Math.round(exp.flip.at)));
    await expect(box).toHaveAttribute("data-gaps", "0");
    await expect(box.getByTestId("flip-explainer-caption")).toHaveText(exp.caption);
    await expect(box.getByTestId("flip-explainer-caption")).toContainText("netto Short");
    // Rücknahme R4: the explainer's own chart, the three-panel schema and the legend of that chart are gone – the card's plot is the picture
    await expect(box.locator("svg")).toHaveCount(0);
    for (const id of ["flip-explainer-chart", "flip-explainer-schema", "flip-explainer-legend", "flip-explainer-pill"]) await expect(box.getByTestId(id), id).toHaveCount(0);
    await expect(box).not.toContainText(/Schema, keine Daten|Echte Daten/);
    await expect(card.getByTestId("trader-net-plot")).toBeVisible();
    // the hint is a hint
    await expect(box.getByTestId("flip-explainer-hint")).toContainText("keine Prognose und keine Anlageempfehlung");
    // provenance as the card shows it
    for (const id of ["source", "cohort", "time"]) await expect(box.getByTestId(`flip-explainer-prov-${id}`)).toHaveText(await card.getByTestId(`trader-net-prov-${id}`).innerText());
    // wording
    const text = await box.innerText();
    expect(text).not.toMatch(/\bWal(e|en|s)?\b|Glassnode|Abverkauf (kommt|folgt)|kommt ein Abverkauf/i);
    await shot(page, info, "flip-erklaergrafik-nachher", box);
    expect(errors.filter((e) => !/willReadFrequently/.test(e))).toEqual([]);
  });

  test("'Wie lese ich das?' explains Netto, Nulllinie, Flip and the limits", async ({ page }) => {
    const { box } = await openMarkt(page);
    const how = box.getByTestId("flip-explainer-how");
    await expect(how).toBeVisible({ timeout: 25_000 });
    await expect(how.getByText("Netto", { exact: true })).toBeHidden();
    await how.locator("summary").click();
    await expect(how).toHaveJSProperty("open", true);
    for (const term of ["Netto", "Nulllinie", "Flip", "Grenzen"]) await expect(how.getByText(term, { exact: true })).toBeVisible();
    await expect(how).toContainText("Long-Anteil minus Short-Anteil");
    await expect(how).toContainText("Verzug");
    await expect(how).toContainText("Kein Kursziel");
  });

  test("no motion of its own: nothing of the panel is animated, under reduced motion either", async ({ page }) => {
    const { box } = await openMarkt(page);
    await expect(box).toHaveAttribute("data-kind", "flip", { timeout: 25_000 });
    await page.waitForTimeout(1500);
    expect((await animated(page)).filter((n) => /^flip-/.test(n))).toEqual([]);
    const endless = await box.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);
    expect(endless).toBe(0);
  });

  test("no Binance data: the panel keeps its size and says why", async ({ page }) => {
    const { card, box } = await openMarkt(page, {
      afterSeed: () => page.route("https://fapi.binance.com/futures/data/topLongShortPositionRatio**", (route) => (new URL(route.request().url()).searchParams.get("period") === "1h" ? route.abort("failed") : route.fallback())),
    });
    await expect(card).toHaveAttribute("data-state", /^(none|loading)$/, { timeout: 25_000 });
    await expect(box).toHaveAttribute("data-kind", /^(empty|loading)$/, { timeout: 25_000 });
    await expect(box).toHaveAttribute("data-flip", "none");
    await expect(box.getByTestId("flip-explainer-caption")).not.toBeEmpty();
    const without = (await box.boundingBox())!;
    const page2 = await page.context().newPage();
    const ok = await openMarkt(page2);
    await expect(ok.box).toHaveAttribute("data-kind", "flip", { timeout: 25_000 });
    const withData = (await ok.box.boundingBox())!;
    expect(Math.abs(without.height - withData.height), `${withData.height} px with data, ${without.height} px without`).toBeLessThan(4);
    expect(Math.abs(without.width - withData.width)).toBeLessThan(1.5);
    await page2.close();
  });

  test("no layout jump: CLS ≤ 0,02 while the card and the panel arrive, the reserve is the size of the panel", async ({ page }) => {
    const { card, box } = await openMarkt(page, { cls: true });
    const grow = await page.evaluate(() => document.documentElement.scrollHeight);
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
    await expect(box).toHaveAttribute("data-kind", "flip", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(after - grow, `the page grew from ${grow} to ${after} px`).toBeLessThan(60);
    const cls = await clsOf(page);
    expect(cls, `Layout-Verschiebung ${cls.toFixed(4)}`).toBeLessThanOrEqual(0.02);
    // the box held for the lazy chunk is the size of the finished panel (a plain min-height per breakpoint)
    const w = page.viewportSize()!.width;
    const reserve = w >= 1024 ? FLIP_RESERVE_PX.lg : w >= 640 ? FLIP_RESERVE_PX.sm : FLIP_RESERVE_PX.base;
    const h = (await box.boundingBox())!.height;
    expect(Math.abs(h - reserve), `panel ${h} px, reserve ${reserve} px`).toBeLessThanOrEqual(24);
    expect(h, "the panel does not grow past its reserve").toBeLessThanOrEqual(reserve + 24);
  });

  test("touch targets ≥ 44 px and accessibility (dark): axe finds nothing, nothing scrolls sideways", async ({ page }, info) => {
    const { box } = await openMarkt(page);
    await expect(box).toHaveAttribute("data-kind", "flip", { timeout: 15_000 });
    await box.scrollIntoViewIfNeeded();
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="flip-explainer"]' });
      expect(misses, misses.map((m) => `${m.name} ${m.w}×${m.h} (${m.where})`).join("\n")).toEqual([]);
    }
    const res = await new AxeBuilder({ page }).include('[data-testid="flip-explainer"]').withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    // opened, too
    await box.getByTestId("flip-explainer-how").locator("summary").click();
    const open = await new AxeBuilder({ page }).include('[data-testid="flip-explainer"]').withTags(TAGS).analyze();
    expect(open.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });

  test("light theme: axe finds nothing", async ({ page }, info) => {
    const { box } = await openMarkt(page, { light: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(box).toHaveAttribute("data-kind", "flip", { timeout: 15_000 });
    await box.scrollIntoViewIfNeeded();
    const res = await new AxeBuilder({ page }).include('[data-testid="flip-explainer"]').withTags(TAGS).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await shot(page, info, "flip-erklaergrafik-hell", box);
    await expectNoHorizontalScroll(page);
  });

  test("the card cannot be pushed sideways: its glow is clipped, not scrollable (a taller card has a wider glow – scrolling it under the edge hid buttons and made clicks miss in CI)", async ({ page }) => {
    const { card, box } = await openMarkt(page);
    await expect(box).toHaveAttribute("data-kind", "flip", { timeout: 25_000 });
    const after = await card.evaluate((el) => {
      el.scrollLeft = 600;
      el.scrollIntoView({ block: "center", inline: "center" });
      return { left: el.scrollLeft, overflow: getComputedStyle(el).overflowX };
    });
    expect(after).toEqual({ left: 0, overflow: "clip" });
    // the buttons of the archive row stay where a click finds them after Playwright's own scroll-into-view
    const no = card.getByTestId("trader-net-archive-delete");
    await no.scrollIntoViewIfNeeded();
    expect(await card.evaluate((el) => el.scrollLeft)).toBe(0);
    const b = (await no.boundingBox())!;
    const c = (await card.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(c.x);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 1);
  });

  test("the alert link opens Einstellungen › Alarme and switches nothing on (this build has no account: the card and the note say so)", async ({ page }) => {
    const { box } = await openMarkt(page);
    const btn = box.getByRole("button", { name: "Bei Flip benachrichtigen" });
    await expect(btn).toBeVisible({ timeout: 25_000 });
    await expect(box.getByTestId("flip-explainer-alarm-note")).toContainText("hier wird nichts aktiviert");
    await expect(box.getByTestId("flip-explainer-alarm-note")).toContainText("In dieser Version ohne Konto gibt es die Alarme nicht.");
    // no promise of a quota the app does not have
    await expect(box.getByTestId("flip-explainer-alarm-note")).not.toContainText(/Dein Tarif/);
    await btn.click();
    await expect(page).toHaveURL(/#settings/);
    // the finder lands on the alarm card (its fold is open in the seed), which itself says that an account is needed – nothing is on
    const alarm = page.getByTestId("alerts-settings");
    await expect(alarm).toBeVisible({ timeout: 20_000 });
    await expect(alarm).toHaveAttribute("data-state", "no-cloud");
    await expect(alarm).toContainText("Konto");
    await expect(alarm.locator('[role="switch"], input[type="checkbox"]')).toHaveCount(0);
  });
});

/**
 * The cloud edition against the Supabase and billing mocks (`npm run build:e2e-cloud`, `PW_CLOUD_BASE_URL`): signed in, the note beside the
 * alert button names what the PLAN has (channels, calls) – the same numbers the alarm card gets from its (mocked) server answer – and the
 * link lands on that card. Mocks only: no real account, no real alarm, nothing is switched on.
 */
test.describe("Was ist ein Flip? – alert link in the cloud edition (mocks)", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  const OFF = { green_warn: false, green_confirm: false, red_warn: false, red_confirm: false };
  const prefsView = (plan: "free" | "premium") => ({
    prefs: {
      v: 1,
      lang: "de",
      channels: { browser: OFF, email: OFF, phone: OFF },
      quiet: { on: true, from: "22:00", to: "07:00" },
      cooldownMin: 360,
      sources: {
        industry: { on: false, markets: [], params: { warn: 2, confirm: 0, hyst: 0.5 } },
        whale: { on: false, markets: ["BTCUSDT"], params: { warn: 3, confirm: 2, hyst: 1 } },
        keylevel: { on: false, markets: [], params: { warn: 0, confirm: 0, hyst: 0 } },
      },
    },
    plan,
    limits: plan === "free" ? { alertChannels: 1, phoneCallsPerMonth: 0 } : { alertChannels: 3, phoneCallsPerMonth: 30 },
    tz: "Europe/Berlin",
    email: { configured: true, hasEmail: true, confirmed: true },
    phone: { configured: true, verifyConfigured: true, status: "none", masked: null },
    lastRun: null,
  });

  for (const [plan, note, used] of [
    ["free", "Dein Tarif Free: 1 Alarm-Kanal, Anrufe ab Premium.", "0 von 1 Kanälen"],
    ["premium", "Dein Tarif Premium: 3 Alarm-Kanäle, Anrufe bis 30 im Monat.", "0 von 3 Kanälen"],
  ] as const) {
    test(`${plan}: the note names the plan's channels and calls, the link opens the alarm card with the same numbers`, async ({ page }) => {
      const at = AT();
      const clock = await pinClock(page, at);
      await blockExternalNetwork(page);
      await mockSupabase(page);
      await mockBilling(page, { plan: { plan, status: plan === "free" ? "none" : "active", trialEnd: null } });
      await page.route(/\/api\/v1\/alerts\//, (route) => {
        const path = new URL(route.request().url()).pathname;
        const body = path.endsWith("/alerts/prefs") ? prefsView(plan) : { events: [], other: [], browser: [] };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      await seed(page, { synth: { ratios: "flip-short", anchor: at - 60_000 }, clock: clock.now });
      await openRoute(page, cloudUrl("markt"), "Markt");
      await signInViaSheet(page, { synced: true });
      const box = page.getByTestId("flip-explainer");
      await box.scrollIntoViewIfNeeded();
      const alarmNote = box.getByTestId("flip-explainer-alarm-note");
      await expect(alarmNote).toContainText(note, { timeout: 30_000 });
      await expect(alarmNote).toContainText("hier wird nichts aktiviert");
      // nothing but the plan's own numbers: no invented quota
      await expect(alarmNote).not.toContainText(/unbegrenzt|unlimited/i);
      await box.getByRole("button", { name: "Bei Flip benachrichtigen" }).click();
      await expect(page).toHaveURL(/#settings/);
      const card = page.getByTestId("alerts-settings");
      await expect(card).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
      await expect(card).toContainText(used);
      // arrived, and still nothing is on: no event switch of the matrix is set
      await expect(card.getByTestId("alert-matrix").locator('input:checked, [role="switch"][aria-checked="true"]')).toHaveCount(0);
    });
  }
});
