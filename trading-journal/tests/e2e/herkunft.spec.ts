/**
 * F24 Mensch – Regelwerk – KI end to end (mobile 390 + desktop): the card „Entscheidung: du, Regelwerk, KI“ on Analyse › Vergleich
 * shows the three groups with sample word and intervals, a group with too few trades as „Zu wenig Daten“ (no figures), the pairs
 * without a „besser“; „Herkunft nachtragen“ writes exactly the tapped trade into the journal; the trade editor carries the choice
 * „Entscheidung“; the KI-Protokoll is honest when empty. No clocks, nothing that depends on the market mock's time.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, screenshot, seed, stored, toast } from "./helpers";

const PROJECTS = ["mobile", "desktop"];
const layer = (page: Page, key: string) => page.locator(`[data-page="${key}"][data-page-role="current"]`);

interface T {
  id: string;
  decision?: { by: string };
  [k: string]: unknown;
}

/** 14 own (8 wins), 12 rules (4 wins), 3 ai, 4 without a mark – closed trades with a stop (R), one day apart. */
function seeded(): T[] {
  const out: T[] = [];
  let n = 0;
  const mk = (by: "own" | "rules" | "ai" | null, win: boolean): T => {
    n++;
    const d = new Date(Date.UTC(2026, 2, 1 + n, 9, 0));
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T09:00`;
    return {
      id: `h${n}`,
      account: "scalp",
      side: "long",
      status: "closed",
      date,
      pair: "BTC/USDT",
      timeframe: "1h",
      entry: 100,
      stop: 99,
      target: 102,
      exit: win ? 102 : 99,
      size: 1000,
      leverage: 1,
      fees: 0,
      pnlManual: win ? 20 : -10,
      setups: [],
      checks: {},
      conviction: null,
      followedPlan: null,
      emotion: "",
      reason: "",
      notes: "",
      chart: "",
      pnl: win ? 20 : -10,
      r: win ? 2 : -1,
      createdAt: "2026-03-01T09:00:00.000Z",
      updatedAt: "2026-03-01T09:00:00.000Z",
      ...(by ? { decision: { by } } : null),
    };
  };
  for (let i = 0; i < 14; i++) out.push(mk("own", i < 8));
  for (let i = 0; i < 12; i++) out.push(mk("rules", i < 4));
  for (let i = 0; i < 3; i++) out.push(mk("ai", i < 2));
  for (let i = 0; i < 4; i++) out.push(mk(null, i < 2));
  return out;
}

async function openCard(page: Page): Promise<void> {
  await seed(page, { extra: { "tj2-trades": seeded() } });
  await page.goto("/#analyse");
  await expect(layer(page, "analyse").locator("h1").first()).toHaveText("Analyse", { timeout: 25_000 });
  await expect(page.locator("[data-page-skeleton]")).toHaveCount(0, { timeout: 25_000 });
  const card = page.getByTestId("ana-decision");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible({ timeout: 25_000 });
}

test.describe("Mensch – Regelwerk – KI", () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("the card shows three groups with sample word and spans, the small one as „Zu wenig Daten“, and the pairs without a ranking", async ({ page }, info) => {
    const errors = collectErrors(page);
    await openCard(page);
    const card = page.getByTestId("ana-decision");
    const groups = card.getByTestId("decision-group");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toHaveAttribute("data-by", "own");
    await expect(groups.nth(0)).toHaveAttribute("data-n", "14");
    await expect(groups.nth(1)).toHaveAttribute("data-n", "12");
    await expect(groups.nth(2)).toHaveAttribute("data-n", "3");
    await expect(groups.nth(2)).toHaveAttribute("data-enough", "0");
    await expect(groups.nth(2).getByTestId("decision-few")).toContainText("Zu wenig Daten");
    await expect(groups.nth(2)).not.toContainText("Trefferquote");
    await expect(groups.nth(0)).toContainText(/Trefferquote\s*57 % \(\d+–\d+ %\)/);
    await expect(groups.nth(0)).toContainText("Stichprobe: tragfähig");
    await expect(groups.nth(0)).toContainText("von dir gesetzt 14");
    await expect(card.getByTestId("decision-pair")).toHaveCount(3);
    await expect(card.getByTestId("decision-pair").filter({ hasText: "zu wenig Daten" })).toHaveCount(2);
    await expect(card.getByTestId("decision-unassigned")).toContainText("4 von 33 geschlossenen Trades haben keine Herkunft");
    await expect(card.getByTestId("decision-headline")).not.toContainText(/besser als|schlechter als/);
    await expect(card).toContainText("keine Ursache");
    await expectNoHorizontalScroll(page);
    await screenshot(page, info, "herkunft-card");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("„Herkunft nachtragen“ writes exactly the tapped trade; the groups follow; the KI-Protokoll is honest when empty", async ({ page }) => {
    const errors = collectErrors(page);
    await openCard(page);
    const card = page.getByTestId("ana-decision");
    await card.getByTestId("decision-assign-toggle").click();
    const rows = card.getByTestId("decision-assign-row");
    await expect(rows).toHaveCount(4);
    const id = await rows.first().getAttribute("data-trade");
    await rows.first().getByRole("radio", { name: "KI" }).click();
    await expect(card.getByTestId("decision-assign-status")).toContainText("Herkunft gespeichert");
    await expect(rows).toHaveCount(3);
    await expect(card.locator('[data-testid="decision-group"][data-by="ai"]')).toHaveAttribute("data-n", "4");
    const trades = (await stored<T[]>(page, "tj2-trades")) ?? [];
    expect(trades.filter((t) => t.decision?.by === "ai").map((t) => t.id)).toContain(id);
    expect(trades.filter((t) => t.decision?.by === "ai")).toHaveLength(4);
    expect(trades).toHaveLength(33);
    // the log
    await card.getByTestId("decision-log-toggle").click();
    await expect(card.getByTestId("decision-ailog-empty")).toBeVisible();
    await expect(card.getByTestId("decision-ailog")).toContainText("kein Gespräch, keine Frage und keine Antwort");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the trade editor carries „Entscheidung“: Offen · Ich · Regelwerk · KI, saved with the trade", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#trades");
    await expect(layer(page, "trades").locator("h1").first()).toBeVisible({ timeout: 25_000 });
    await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" }).click();
    const editor = page.getByRole("dialog", { name: "Trade eintragen" });
    await expect(editor).toBeVisible();
    await expect(editor.locator("[inert] #f-entry")).toHaveCount(0);
    await editor.locator("#f-entry").fill("80000");
    await editor.locator("#f-stop").fill("79200");
    await editor.locator("#f-exit").fill("81500");
    await editor.locator("#f-size").fill("4000");
    await editor.locator("#f-reason").fill("E2E Herkunft");
    const group = editor.getByRole("radiogroup", { name: "Entscheidung von" });
    await group.scrollIntoViewIfNeeded();
    await expect(group.getByRole("radio")).toHaveCount(4);
    await expect(group.getByRole("radio", { name: "Offen" })).toBeChecked();
    await group.getByRole("radio", { name: "Regelwerk" }).click();
    await expect(group.getByRole("radio", { name: "Regelwerk" })).toBeChecked();
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(toast(page)).toContainText("Trade gespeichert");
    const trades = (await stored<T[]>(page, "tj2-trades")) ?? [];
    const t = trades.find((x) => x.reason === "E2E Herkunft");
    expect(t?.decision).toEqual({ by: "rules" });
    // an untouched trade gains no key
    const old = trades.find((x) => x.id === "t_a1b2c3d4e5f");
    expect(old && "decision" in old).toBe(false);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("accessibility of the card (axe, WCAG 2.1 AA) with the assign list and the log open", async ({ page }) => {
    test.setTimeout(120_000);
    await openCard(page);
    const card = page.getByTestId("ana-decision");
    await card.getByTestId("decision-assign-toggle").click();
    await card.getByTestId("decision-log-toggle").click();
    await expect(card.getByTestId("decision-ailog")).toBeVisible();
    await page.waitForTimeout(1200);
    const res = await new AxeBuilder({ page }).include('[data-testid="ana-decision"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(lines, "axe violations").toEqual([]);
  });
});
