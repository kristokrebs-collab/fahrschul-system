/**
 * A3 end to end (mobile + desktop, production build, market mock with REAL BTCUSDT 4h bars): a simulation of the Labor is saved with
 * its id (IndexedDB) and comes back the same after a reload; "Alle Pfade" draws 10 000 lines on a canvas (a worker on an
 * OffscreenCanvas where the browser has one) with „berechnet“ and „gezeichnet“ apart in the title, the labelled sample on request;
 * the trade shows the simulation saved for it, also after a reload. Nothing here depends on the clock beyond a fixed set of bars.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, screenshot, seed } from "./helpers";
import { synthPrice } from "./mocks/synth";
import { themeSettled } from "./uxHarness";

const PROJECTS = ["mobile", "desktop"];
const PLAN = { entry: "82.900", stop: "80.500", target: "87.700" };

async function openLabor(page: Page, info: TestInfo, mode: "all" | "sample" | null = "all"): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Zeitmaschine runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true });
  if (mode) await page.addInitScript((m) => localStorage.setItem("tj2-tm-paths-mode", JSON.stringify(m)), mode);
  await openRoute(page, "/#labor", "Labor");
  await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
  return errors;
}

async function runPlan(page: Page): Promise<void> {
  await page.getByTestId("tm-entry").fill(PLAN.entry);
  await page.getByTestId("tm-stop").fill(PLAN.stop);
  await page.getByTestId("tm-target").fill(PLAN.target);
  await page.getByTestId("tm-load-start").click();
  await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
}

/** Non-transparent pixels of the path canvas (read through a copy, the way the Branchen spec reads its charts). */
async function ink(page: Page): Promise<number> {
  return page.getByTestId("tm-paths-host").locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });
}

const records = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ id: string; tradeId: string | null; seed: number; model: string; dataHash: string }[]>((resolve, reject) => {
        const open = indexedDB.open("tj2-timemachine");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("simulations")) return resolve([]);
          const req = db.transaction("simulations").objectStore("simulations").getAll();
          req.onsuccess = () => resolve((req.result as Record<string, unknown>[]).map((r) => ({ id: r.simulationId as string, tradeId: (r.tradeId as string | null) ?? null, seed: r.seed as number, model: r.modelVersion as string, dataHash: r.dataHash as string })));
          req.onerror = () => reject(req.error);
        };
      }),
  );

test.describe("Zeitmaschine · gespeicherte Simulation", () => {
  test.setTimeout(240_000);

  test("die Simulation hat ID, Seed, Modell, Daten-Hash und Kosten, liegt in IndexedDB und kommt nach dem Neuladen unverändert zurück", async ({ page }, info) => {
    const errors = await openLabor(page, info);
    await runPlan(page);
    const sim = page.getByTestId("tm-sim");
    await sim.scrollIntoViewIfNeeded();
    const id = (await page.getByTestId("tm-sim-id").textContent()) ?? "";
    expect(id).toMatch(/^sim_[0-9a-f]{32}$/);
    await expect(page.getByTestId("tm-sim-model")).toHaveText("zeitmaschine/1");
    await expect(page.getByTestId("tm-sim-seed")).toHaveText("19");
    await expect(page.getByTestId("tm-sim-size")).toContainText("10.000 Läufe");
    await expect(page.getByTestId("tm-sim-data")).toContainText(/Hash [0-9a-f]{12}…/);
    await expect(page.getByTestId("tm-sim-costs")).toContainText("Gebühren");
    await expect(page.getByTestId("tm-sim-stored")).toContainText("auf diesem Gerät gespeichert");
    // the honest scope: what is missing is said
    await expect(page.getByTestId("tm-scope-missing")).toContainText("Spread");
    await expect(page.getByTestId("tm-scope-missing")).toContainText("Liquidität");
    await expect(page.getByTestId("tm-scope-missing")).toContainText(/regime/i);
    const target = (await page.getByTestId("tm-p-target").textContent()) ?? "";

    await expect.poll(async () => (await records(page)).map((r) => r.id)).toEqual([id]);
    const [rec] = await records(page);
    expect(rec).toMatchObject({ seed: 19, model: "zeitmaschine/1", tradeId: null });
    expect(rec!.dataHash).toMatch(/^[0-9a-f]{64}$/);
    await screenshot(page, info, "tm-sim-meta");

    // reload: the same plan on the same candles gives the same simulation back – from the device, without a new computation
    await page.reload();
    await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
    await page.getByTestId("tm-load-start").click();
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-sim-id")).toHaveText(id);
    await expect(page.getByTestId("tm-sim-restored")).toBeVisible();
    await expect(page.getByTestId("tm-p-target")).toHaveText(target);
    await expect(page.getByTestId("tm-busy")).toHaveCount(0);
    // „Neu rechnen“ computes again and the figures are the same
    await page.getByTestId("tm-start").click();
    await expect(page.getByTestId("tm-sim-check")).toHaveAttribute("data-check", "same", { timeout: 120_000 });
    expect((await records(page)).map((r) => r.id)).toEqual([id]);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("„Alle Pfade“: 10 000 Linien auf dem Canvas – berechnet und gezeichnet getrennt im Titel, Pixel sind da", async ({ page }, info) => {
    const errors = await openLabor(page, info, "all");
    await runPlan(page);
    await page.getByTestId("tm-fan-block").scrollIntoViewIfNeeded();
    await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
    const box = page.getByTestId("tm-paths");
    await expect(box).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-paths-title")).toContainText("berechnet: 10.000 · gezeichnet: 10.000");
    await expect(page.getByTestId("tm-paths-title")).toContainText("alle berechneten Läufe");
    await expect(box).toHaveAttribute("data-computed", "10000");
    await expect(box).toHaveAttribute("data-drawn", "10000");
    await expect(box).toHaveAttribute("data-engine", /worker|main/);
    expect(await ink(page)).toBeGreaterThan(2_000);
    await expect(box.locator('[data-line="stop"]')).toHaveCount(1);
    await expect(box.locator('[data-line="target"]')).toHaveCount(1);
    await expect(page.getByTestId("tm-paths-done")).toContainText(/Gezeichnet in \d+ ms/);
    // a simulation is no forecast – said next to the picture
    await expect(box).toContainText("keine Prognose");
    await screenshot(page, info, "tm-paths-all");
    await box.screenshot({ path: `/tmp/shots/${info.project.name}-tm-paths-all-el.png` });
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("die Stichprobe für schwache Geräte ist beschriftet; zurück zu „Alle“ und zu den Bändern", async ({ page }, info) => {
    const errors = await openLabor(page, info, "sample");
    await runPlan(page);
    await page.getByTestId("tm-fan-block").scrollIntoViewIfNeeded();
    await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
    const box = page.getByTestId("tm-paths");
    await expect(box).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-paths-title")).toContainText("berechnet: 10.000 · gezeichnet: 2.000");
    await expect(page.getByTestId("tm-paths-title")).toContainText("jeder 5. Lauf");
    await expect(page.getByTestId("tm-paths-sample")).toContainText("Stichprobe: 2.000 von 10.000 berechneten Läufen");
    expect(await ink(page)).toBeGreaterThan(500);
    await screenshot(page, info, "tm-paths-sample");
    await box.screenshot({ path: `/tmp/shots/${info.project.name}-tm-paths-sample-el.png` });
    await page.getByRole("radio", { name: "Alle 10.000" }).click();
    await expect(page.getByTestId("tm-paths-title")).toContainText("gezeichnet: 10.000", { timeout: 30_000 });
    await expect(box).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    await expect(page.getByTestId("tm-paths-sample")).toHaveCount(0);
    await page.getByRole("radio", { name: "Bänder" }).click();
    await expect(page.getByTestId("tm-fan")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("ein Handy ohne gewählte Darstellung startet mit der Stichprobe (grober Zeiger), der Rechner mit allen – und beides steht im Titel", async ({ page }, info) => {
    const errors = await openLabor(page, info, null);
    await runPlan(page);
    await page.getByTestId("tm-fan-block").scrollIntoViewIfNeeded();
    await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
    const box = page.getByTestId("tm-paths");
    await expect(box).toHaveAttribute("data-state", "done", { timeout: 120_000 });
    const every = Number(await box.getAttribute("data-every"));
    const drawn = Number(await box.getAttribute("data-drawn"));
    if (info.project.name === "mobile") {
      expect(every).toBe(5);
      expect(drawn).toBe(2_000);
      await expect(page.getByTestId("tm-paths-sample")).toContainText("Dein Gerät ist eher schwach");
    } else {
      // the desktop project's machine decides (cores / memory): either way the title says what was drawn
      expect([1, 5]).toContain(every);
    }
    await expect(page.getByTestId("tm-paths-title")).toContainText(`berechnet: 10.000 · gezeichnet: ${drawn.toLocaleString("de-DE")}`);
    expect(errors).toEqual([]);
  });
});

test.describe("Zeitmaschine · Barrierefreiheit der neuen Teile (axe, WCAG 2.1 A + AA)", () => {
  test.setTimeout(240_000);
  for (const theme of ["dark", "light"] as const) {
    test(`Alle Pfade, „Diese Simulation“ und Modellumfang (${theme})`, async ({ page }, info) => {
      test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
      await seed(page, { boxes: true, extra: { "tj2-theme": JSON.stringify({ pref: theme, accent: "signal" }), "tj2-tm-paths-mode": JSON.stringify("all") } });
      await openRoute(page, "/#labor", "Labor");
      await themeSettled(page);
      await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
      await runPlan(page);
      await page.getByTestId("tm-fan-block").scrollIntoViewIfNeeded();
      await page.getByRole("radio", { name: "Alle Pfade (Alpha)" }).click();
      await expect(page.getByTestId("tm-paths")).toHaveAttribute("data-state", "done", { timeout: 120_000 });
      await page.waitForTimeout(1500);
      for (const [sel, what] of [
        ['[data-testid="tm-fan-block"]', "Fächer mit allen Pfaden"],
        ['[data-testid="tm-sim"]', "Diese Simulation"],
        ['[data-testid="tm-scope"]', "Modellumfang"],
      ] as const) {
        const res = await new AxeBuilder({ page }).include(sel).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
        expect(lines, `${what}: axe violations`).toEqual([]);
      }
    });
  }
});

/* ------------------------------------------------------------------------------------------------------ Trade-Detail */

const HOUR = 3_600_000;
function berlin(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function trade(anchor: number) {
  const at = (h: number) => Math.floor((anchor - h * HOUR) / HOUR) * HOUR;
  const p = (t: number) => Math.round(synthPrice(t, anchor) * 10) / 10;
  const e = at(100);
  const x = at(90);
  return { id: "t_tm_a", account: "scalp", timeframe: "1h", checks: {}, conviction: 4, followedPlan: true, emotion: "Ruhig", reason: "", notes: "", chart: "", leverage: 5, fees: 2, pnlManual: null, pnl: null, r: null, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", status: "closed", pair: "BTC/USDT", target: null, setups: [] as string[], side: "long", date: berlin(e), exitDate: berlin(x), entry: p(e), stop: Math.round(p(e) * 0.99 * 10) / 10, exit: p(x), size: Math.round(p(e) * 0.2 * 10) / 10 };
}

test.describe("Trade · gespeicherte Zeitmaschine", () => {
  test.setTimeout(240_000);

  test("die Simulation eines Trades steht am Trade – nach dem Neuladen noch, aus IndexedDB; ein Trade ohne Simulation zeigt nichts", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
    const errors = collectErrors(page);
    const anchor = Date.now();
    const b = trade(anchor);
    await seed(page, { synth: { anchor }, extra: { "tj2-trades": [b, { ...b, id: "t_tm_other", date: berlin(anchor - 50 * HOUR), exitDate: berlin(anchor - 40 * HOUR) }] } });
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });

    // no simulation yet: nothing is shown
    await page.locator('[data-trade-id="t_tm_a"]:visible').first().click();
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("button", { name: "Zeitmaschine" })).toBeVisible();
    await expect(page.getByTestId("trade-simulation")).toHaveCount(0);

    // run it for this trade
    await detail.getByRole("button", { name: "Zeitmaschine" }).click();
    await expect(page.getByTestId("tm-card")).toHaveAttribute("data-status", "done", { timeout: 180_000 });
    const id = (await page.getByTestId("tm-sim-id").textContent()) ?? "";
    expect(id).toMatch(/^sim_/);
    await expect.poll(async () => (await records(page)).filter((r) => r.tradeId === "t_tm_a").length).toBe(1);
    await page.keyboard.press("Escape");

    // back at the trade: the saved simulation is shown
    await expect(page.getByTestId("trade-simulation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("trade-simulation")).toHaveAttribute("data-sim-id", id);
    await expect(page.getByTestId("trade-simulation-meta")).toContainText("Seed 19");
    await expect(page.getByTestId("trade-simulation-stored")).toContainText("keine Prognose");
    await screenshot(page, info, "tm-trade-saved");

    // reload: the same simulation, from the device
    await page.reload();
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await page.locator('[data-trade-id="t_tm_a"]:visible').first().click();
    await expect(page.getByTestId("trade-simulation")).toHaveAttribute("data-sim-id", id, { timeout: 15_000 });
    await page.keyboard.press("Escape");

    // another trade has none
    await page.locator('[data-trade-id="t_tm_other"]:visible').first().click();
    await expect(detail.getByRole("button", { name: "Zeitmaschine" })).toBeVisible();
    await expect(page.getByTestId("trade-simulation")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
