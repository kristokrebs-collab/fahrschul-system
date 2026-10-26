/**
 * „Muster-Entdecker“ (Auftrag B) end to end on the production build: Labor → the card at the end of the page. With the small
 * fixture journal it names the minimum instead of computing noise; with a seeded journal of 180 closed trades (a losing pattern
 * planted in the emotion field) the search runs in the Web Worker with progress, names the number of tests, and shows the
 * pattern under "Verlust-Muster" – with the disclaimer, the seed, no horizontal scroll on the phone and touch targets ≥ 44 px.
 *
 * Nothing depends on the clock or the market: the journal is seeded, the search is deterministic.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

/** 180 closed trades, deterministic: "FOMO" almost always loses, everything else is a coin flip. */
function journal(n: number): Record<string, unknown>[] {
  let s = 12345;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const emotions = ["Ruhig", "FOMO", "Fokussiert"];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const emotion = emotions[Math.floor(rnd() * 3)]!;
    const win = rnd() < (emotion === "FOMO" ? 0.04 : 0.5);
    const short = rnd() < 0.5;
    const d = new Date(2026, 0, 1 + Math.floor(i / 2), 8 + (i % 2) * 6, 0);
    const p = (x: number): string => String(x).padStart(2, "0");
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
    out.push({
      id: `t_e2e_${i}`,
      account: "scalp",
      side: short ? "short" : "long",
      status: "closed",
      date,
      pair: "BTC/USDT",
      timeframe: "4h",
      // the prices follow the side, so the app derives the same R (+2 / −1) as the planted result
      entry: 80000,
      stop: short ? 81000 : 79000,
      target: short ? 78000 : 82000,
      exit: win ? (short ? 78000 : 82000) : short ? 81000 : 79000,
      size: 8000,
      leverage: 4,
      fees: 0,
      pnlManual: null,
      setups: [],
      checks: {},
      conviction: null,
      followedPlan: null,
      emotion,
      reason: "",
      notes: "",
      chart: "",
      pnl: win ? 200 : -100,
      r: win ? 2 : -1,
      createdAt: d.toISOString(),
      updatedAt: d.toISOString(),
    });
  }
  return out;
}

test.describe("Labor · Muster-Entdecker", () => {
  test.setTimeout(120_000);

  test("with the small fixture journal the card names the minimum and computes nothing", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
    const errors = collectErrors(page);
    await seed(page, { boxes: true });
    await openRoute(page, LABOR_URL, "Labor");
    const card = page.getByTestId("labor-discovery");
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Muster-Entdecker" }).first()).toBeVisible();
    await expect(card).toHaveAttribute("data-source", "journal");
    await expect(card.getByTestId("discovery-empty")).toContainText("mindestens 80 Trades mit bekanntem R");
    await expect(card.getByTestId("discovery-start")).toBeDisabled();
    await expect(card.getByTestId("discovery-disclaimer")).not.toContainText("Finanzberatung");
    await card.getByTestId("discovery-method-toggle").click();
    await expect(card.getByTestId("discovery-method")).toContainText("Permutationstest");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("the search runs in the worker, names the number of tests and finds the planted losing pattern", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
    const errors = collectErrors(page);
    await seed(page, { boxes: true, extra: { "tj2-trades": journal(180) } });
    await openRoute(page, LABOR_URL, "Labor");
    const card = page.getByTestId("labor-discovery");
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByTestId("discovery-source")).toContainText("180 Trades mit bekanntem R", { timeout: 30_000 });
    await expect(card.getByTestId("discovery-seed")).toContainText("Seed): 20260424");
    const start = card.getByTestId("discovery-start");
    await expect(start).toBeEnabled();
    await start.click();
    await expect(card.getByTestId("discovery-result")).toBeVisible({ timeout: 60_000 });
    await expect(card.getByTestId("discovery-panel")).toHaveAttribute("data-status", "done");

    // the number of tests is stated, and so are the rejected ones
    await expect(card.getByTestId("discovery-counts")).toHaveText(/^Ich habe [\d.]+ Zusammenhänge geprüft, (keiner hält stand|1 hält stand|\d+ halten stand)\.$/);
    await expect(card.getByTestId("discovery-breakdown")).toContainText("verworfen (Zufall)");

    // the planted pattern sits under "Verlust-Muster", confirmed, with the sample in the sentence
    const loss = card.getByTestId("discovery-group-loss");
    const fomo = loss.getByTestId("discovery-finding").filter({ hasText: "Emotion FOMO" }).first();
    await expect(fomo).toBeAttached({ timeout: 15_000 });
    await fomo.scrollIntoViewIfNeeded();
    await expect(fomo).toHaveAttribute("data-tier", "confirmed");
    await expect(fomo.getByTestId("discovery-finding-text")).toHaveText(/^Wenn .*Emotion FOMO.*: nur \d+ % Treffer statt \d+ % \(n=\d+, bestätigt\)$/);
    // a journal field cannot be a backtest filter: no button, the reason instead
    await expect(fomo.getByTestId("discovery-filter-test")).toHaveCount(0);

    await fomo.getByTestId("discovery-details-toggle").click();
    await expect(fomo.getByTestId("discovery-details")).toContainText("Bestätigung (neuerer Teil)");
    await expect(card.getByTestId("discovery-disclaimer")).toContainText("Beobachtung, keine Ursache; kein Versprechen für die Zukunft.");

    await expectNoHorizontalScroll(page);
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="labor-discovery"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
