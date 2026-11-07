/**
 * Branchen-Trend › Papier-Portfolio end to end (C1, mobile + desktop, production build): a green industry (the industry function is a
 * spec mock whose data end YESTERDAY, the stock candles of the ETF a spec mock too) → „Prüfen“: candles, the Zeitmaschine in its worker,
 * the risk rule with every rule as Ja / Nein → „Papier-Position eröffnen“ → ONE position with signal / simulation / trade id → history.
 * A second click or a second delivery of the signal opens nothing; the Not-Aus stops new positions but not the exit; Rot = Cash closes;
 * the real (weeks old) data of the library are refused as too old and nothing is fetched; no request but GET leaves the page.
 */
import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, screenshot, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockIndustry } from "./mocks/industry";
import { recentTradingDay, stockHistoryBars, stockOpen } from "./mocks/planStockCandles";

const PROJECTS = ["mobile", "desktop"];
const STOCK_BARS = /\/api\/v1\/stocks\/bars/;
const JSON_HEADERS = { "content-type": "application/json" };

interface Rig {
  /** requests to the stock function, with the symbols asked for */
  symbols: string[];
  /** every request that is not a plain GET (an order would be one) */
  writes: string[];
}

async function stockRig(page: Page): Promise<Rig> {
  const rig: Rig = { symbols: [], writes: [] };
  page.on("request", (r: Request) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.method() !== "OPTIONS" && !r.url().startsWith("data:")) rig.writes.push(`${r.method()} ${r.url()}`);
  });
  const day = recentTradingDay(Date.now(), 1);
  await page.route(STOCK_BARS, async (route) => {
    const u = new URL(route.request().url());
    const symbols = (u.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
    rig.symbols.push(...symbols);
    const results: Record<string, unknown> = {};
    for (const s of symbols) results[s] = { ok: true, bars: stockHistoryBars("1d", day, 400), meta: { name: s, currency: "USD", exchange: "NYSEArca", price: 100, prevClose: 99, volume: 1_000_000, marketTime: stockOpen(day) + 390 * 60_000 } };
    return route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ source: "yahoo", interval: u.searchParams.get("interval"), range: u.searchParams.get("range"), fetchedAt: Date.now(), results }) });
  });
  return rig;
}

const yyyymmdd = (ms: number): number => Number(new Date(ms).toISOString().slice(0, 10).replace(/-/g, ""));

async function open(page: Page, info: TestInfo, o: { fresh: boolean; extra?: Record<string, unknown> }): Promise<{ errors: string[]; rig: Rig }> {
  test.skip(!PROJECTS.includes(info.project.name), "Papier-Portfolio runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { extra: o.extra ?? {} });
  await mockIndustry(page, o.fresh ? { endDay: yyyymmdd(Date.now() - 86_400_000) } : {});
  const rig = await stockRig(page);
  await openRoute(page, "/#aktien", "Aktien");
  await expect(page.getByTestId("aktien-scanner")).toBeVisible();
  await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Branchen-Trend" }).click();
  await expect(page.getByTestId("branchen-honest")).toBeVisible();
  await expect(page.getByTestId("branchen-ampel-body")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.getByTestId("branchen-paper").scrollIntoViewIfNeeded();
  return { errors, rig };
}

const candidate = (page: Page, code: string) => page.locator(`[data-testid="paper-candidate"][data-branche="${code}"]`);
const panel = (page: Page, code: string) => candidate(page, code).getByTestId("paper-check-panel");
const checked = async (page: Page, code: string): Promise<void> => {
  await candidate(page, code).getByTestId("paper-check").click();
  await expect(panel(page, code)).toHaveAttribute("data-status", "done", { timeout: 120_000 });
};

test.describe("Branchen-Trend · Papier-Portfolio", () => {
  test.setTimeout(240_000);

  test("grünes Signal → Prüfen mit der Zeitmaschine → Regeln → genau eine Papier-Position mit drei IDs; Doppelklick und zweite Prüfung öffnen keine zweite", async ({ page }, info) => {
    const { errors, rig } = await open(page, info, { fresh: true });
    // candidates: green industries with an ETF in the list (Agric, Drugs, Steel, Mines, Util, Trans, RlEst in the mock); red and ETF-less ones are not offered
    const codes = await page.getByTestId("paper-candidate").evaluateAll((els) => els.map((e) => e.getAttribute("data-branche")));
    expect(codes).toEqual(expect.arrayContaining(["Agric", "Drugs", "Util"]));
    expect(codes).not.toContain("Beer"); // green, but no ETF
    expect(codes).not.toContain("MedEq"); // red
    await expect(page.getByTestId("paper-empty")).toBeVisible();
    expect(rig.symbols).toEqual([]); // nothing is fetched before a click

    await checked(page, "Util");
    expect(rig.symbols).toEqual(["XLU"]);
    const p = panel(page, "Util");
    const rules = p.getByTestId("paper-rule");
    await expect(rules).toHaveCount(10);
    expect(await rules.evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")))).toEqual(["notaus", "gruen", "alter", "instrument", "doppel", "offen", "kerzen", "zeitmaschine", "limit", "groesse"]);
    expect(await rules.evaluateAll((els) => els.map((e) => e.getAttribute("data-ok")))).toEqual(Array(10).fill("true"));
    await expect(p.getByTestId("paper-verdict")).toContainText("Alle Regeln sagen Ja");
    await expect(p.getByTestId("paper-plan")).toContainText("Prüfplan für XLU");
    await expect(p.getByTestId("paper-rules")).toContainText("Eine Simulation, keine Prognose");
    await expect(p.getByTestId("paper-sizing")).toContainText(/\d+ × XLU zu/);
    await screenshot(page, info, "paper-check");

    // a double click on the one button: one position
    await p.getByTestId("paper-open").dblclick();
    const pos = page.getByTestId("paper-position");
    await expect(pos).toHaveCount(1);
    await expect(pos).toHaveAttribute("data-status", "open");
    const sig = (await pos.getAttribute("data-signal-id")) ?? "";
    const sim = (await pos.getAttribute("data-simulation-id")) ?? "";
    const trade = (await pos.getAttribute("data-trade-id")) ?? "";
    expect(sig).toMatch(/^sig_[0-9a-f]{20}$/);
    expect(sim).toMatch(/^sim_[0-9a-f]{32}$/);
    expect(trade).toMatch(/^pp_[0-9a-f]{20}$/);
    await expect(pos).toContainText("PAPIER · nichts gesendet");
    await expect(page.getByTestId("paper-open-count")).toHaveText("offen 1 von 5");
    await expect(p.getByTestId("paper-open")).toHaveCount(0);
    await expect(p.getByTestId("paper-already")).toBeVisible();

    // the saved simulation of the check belongs to the position (same ids), visible one click away
    await p.getByTestId("paper-sim").locator("summary").click();
    await expect(p.getByTestId("trade-simulation")).toHaveAttribute("data-sim-id", sim);

    // the same signal checked again: "Doppelsignal", nothing fetched, nothing opened
    rig.symbols.length = 0;
    await candidate(page, "Util").getByTestId("paper-check").click();
    await expect(panel(page, "Util")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(panel(page, "Util").locator('[data-rule="doppel"]')).toHaveAttribute("data-ok", "false");
    expect(rig.symbols).toEqual([]);
    await expect(page.getByTestId("paper-position")).toHaveCount(1);

    // another green industry: its own position (the limit is five, not one)
    await checked(page, "Drugs");
    await panel(page, "Drugs").getByTestId("paper-open").click();
    await expect(page.getByTestId("paper-position")).toHaveCount(2);
    await expect(page.getByTestId("paper-open-count")).toHaveText("offen 2 von 5");

    // the book is on the device: a reload brings it back
    await page.reload();
    await page.getByRole("navigation", { name: "Inhalt dieser Seite" }).getByRole("button", { name: "Branchen-Trend" }).click();
    await expect(page.getByTestId("branchen-ampel-body")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await page.getByTestId("branchen-paper").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("paper-position")).toHaveCount(2);
    await expect(page.getByTestId("paper-position").first()).toHaveAttribute("data-status", "open");

    // closing by hand: closed, with a result; the second one stays open
    await page.locator('[data-testid="paper-position"][data-branche="Util"]').getByTestId("paper-close").click();
    await expect(page.locator('[data-testid="paper-position"][data-branche="Util"]')).toHaveAttribute("data-status", "closed", { timeout: 30_000 });
    await expect(page.getByTestId("paper-stats")).toContainText("1 geschlossen");
    await expect(page.getByTestId("paper-open-count")).toHaveText("offen 1 von 5");
    // the used-up signal does not open again
    await checked(page, "Util");
    await expect(panel(page, "Util").locator('[data-rule="doppel"]')).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("paper-position")).toHaveCount(2);

    // nothing was sent anywhere
    expect(rig.writes).toEqual([]);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("Not-Aus: keine neue Position; Schließen bleibt möglich; danach geht es wieder", async ({ page }, info) => {
    const { errors } = await open(page, info, { fresh: true });
    await checked(page, "Agric");
    await panel(page, "Agric").getByTestId("paper-open").click();
    await expect(page.getByTestId("paper-position")).toHaveCount(1);
    await page.getByTestId("paper-kill").click();
    await expect(page.getByTestId("paper-kill-state")).toHaveText("Not-Aus ist AN");
    await expect(page.getByTestId("paper-kill")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("paper-check-panel")).toHaveCount(0); // the checks made before are gone: they must run again
    await checked(page, "Steel");
    await expect(panel(page, "Steel").locator('[data-rule="notaus"]')).toHaveAttribute("data-ok", "false");
    await expect(panel(page, "Steel").getByTestId("paper-open")).toBeDisabled();
    await expect(panel(page, "Steel").getByTestId("paper-verdict")).toContainText("Eine Regel sagt Nein");
    await expect(page.getByTestId("paper-position")).toHaveCount(1);
    // closing is never blocked
    await page.locator('[data-testid="paper-position"][data-branche="Agric"]').getByTestId("paper-close").click();
    await expect(page.locator('[data-testid="paper-position"][data-branche="Agric"]')).toHaveAttribute("data-status", "closed", { timeout: 30_000 });
    await page.getByTestId("paper-kill").click();
    await expect(page.getByTestId("paper-kill-state")).toHaveText("Not-Aus aus");
    await checked(page, "Steel");
    await expect(panel(page, "Steel").getByTestId("paper-open")).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("Rot = Cash: die offene Position einer roten Branche schließt mit „Ausstieg – Rot = Cash“; nie eine Short-Position", async ({ page }, info) => {
    // a position of MedEq (red in the mock: it left the market inside the last 60 days) from an earlier visit
    const hex = (c: string, n: number) => c.repeat(n);
    const pos = { v: 1, id: `pp_${hex("a", 20)}`, tradeId: `pp_${hex("a", 20)}`, signalId: `sig_${hex("b", 20)}`, simulationId: `sim_${hex("c", 32)}`, branche: "MedEq", symbol: "IHI", name: "iShares U.S. Medical Devices ETF", side: "long", qty: 10, entry: 100, stop: 95, target: 110, riskAmount: 50, notional: 1000, openedAt: Date.now() - 5 * 86_400_000, signalAsOf: "20260901", signalAgeDays: 1, status: "open", modus: "PAPIER", gesendet: false };
    const { errors, rig } = await open(page, info, { fresh: true, extra: { "tj2-branchen-paper": { v: 1, killSwitch: false, positions: [pos] } } });
    const row = page.getByTestId("paper-position");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Die Ampel ist für diese Branche jetzt rot: Cash.");
    // red industries are no candidates
    await expect(candidate(page, "MedEq")).toHaveCount(0);
    await row.getByTestId("paper-close-rot").click();
    await expect(row).toHaveAttribute("data-status", "closed", { timeout: 30_000 });
    await expect(row).toContainText("Rot = Cash");
    expect(rig.symbols).toEqual(["IHI"]);
    await expect(page.getByTestId("paper-stats")).toContainText("1 geschlossen");
    expect(rig.writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("die echten Daten der Bibliothek sind Wochen alt: das Signal ist veraltet, nichts wird geladen, simuliert oder eröffnet", async ({ page }, info) => {
    const { errors, rig } = await open(page, info, { fresh: false });
    const first = page.getByTestId("paper-candidate").first();
    await expect(first.getByTestId("paper-age")).toContainText("Tage alt");
    await first.getByTestId("paper-check").click();
    const p = first.getByTestId("paper-check-panel");
    await expect(p).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(p.locator('[data-rule="alter"]')).toHaveAttribute("data-ok", "false");
    await expect(p.locator('[data-rule="alter"]')).toContainText("veraltet");
    await expect(p.getByTestId("paper-verdict")).toContainText("Eine Regel sagt Nein");
    await expect(p.getByTestId("paper-open")).toBeDisabled();
    expect(rig.symbols).toEqual([]);
    await expect(page.getByTestId("paper-position")).toHaveCount(0);
    await expect(page.getByTestId("paper-empty")).toBeVisible();
    await screenshot(page, info, "paper-stale");
    expect(rig.writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("Touch-Ziele der Karte sind mindestens 44 px; nichts ragt seitlich hinaus", async ({ page }, info) => {
    test.skip(!hasTouch(info), "touch project only");
    await open(page, info, { fresh: true });
    await checked(page, "Util");
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="branchen-paper"]' });
    expect(misses, JSON.stringify(misses)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });
});
