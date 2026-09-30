/**
 * Trades page: table (desktop) / cards (mobile), row → TradeDetail morph, `Bearbeiten` → prefilled editor,
 * `Löschen` inline confirm → toast, Setups page editor round trip.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, isMobile, screenshot, seed, toast } from "./helpers";

async function gotoTrades(page: import("@playwright/test").Page) {
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
}

/** First trade row: `<tr tabindex=0>` on ≥ md, a card button in `ul[aria-label=Trades]` below. */
function firstRow(page: import("@playwright/test").Page, mobile: boolean) {
  return mobile ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
}

test("list renders 13 fixture trades as table (desktop) or cards (mobile)", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoTrades(page);
  await expect(page.getByLabel("13 Trades")).toBeVisible();
  if (isMobile(info)) {
    await expect(page.getByRole("list", { name: "Trades" })).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  } else {
    await expect(page.locator("tbody tr[tabindex='0']")).toHaveCount(13);
  }
  await page.waitForTimeout(600);
  await screenshot(page, info, "trades-list", true);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("row click → TradeDetail morph, `Bearbeiten` → prefilled editor", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoTrades(page);
  const row = firstRow(page, isMobile(info));
  await row.click();
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(80);
    await page.screenshot({ path: `/tmp/shots/${info.project.name}-detail-open-${i}.png` });
  }
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("Einstieg")).toBeVisible();
  await expect(detail.getByText("Checkliste")).toBeVisible();
  await screenshot(page, info, "trade-detail");
  const entry = (await detail.locator("dt", { hasText: "Einstieg" }).locator("xpath=following-sibling::dd[1]").textContent()) ?? "";

  await detail.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(detail).toBeHidden();
  const editor = page.getByRole("dialog", { name: "Trade bearbeiten" });
  await expect(editor).toBeVisible();
  const value = await editor.locator("#f-entry").inputValue();
  expect(value.replace(/\D/g, "")).toBe(entry.replace(/\D/g, ""));
  await screenshot(page, info, "trade-edit-prefilled");
  await editor.getByRole("button", { name: "Abbrechen" }).click();
  await expect(editor).toBeHidden();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("`Löschen` asks inline, `Ja, löschen` removes the trade and toasts", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoTrades(page);
  await firstRow(page, isMobile(info)).click();
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "Löschen" }).click();
  await expect(detail.getByText("Wirklich löschen?")).toBeVisible();
  await screenshot(page, info, "trade-delete-confirm");
  await detail.getByRole("button", { name: "Nein" }).click();
  await expect(detail.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await detail.getByRole("button", { name: "Löschen" }).click();
  await detail.getByRole("button", { name: "Ja, löschen" }).click();
  await expect(detail).toBeHidden();
  await expect(toast(page)).toContainText("Trade gelöscht");
  await expect(page.getByLabel("12 Trades")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test.describe("setups", () => {
  test("`Neue Entscheidungsgrundlage` → editor → save → card; `Bearbeiten` morphs from the card", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#setups");
    await expect(page.getByRole("heading", { name: "Entscheidungsgrundlagen" })).toBeVisible();
    await page.waitForTimeout(500);
    await screenshot(page, info, "setups-list", true);

    await page.getByRole("button", { name: "Neue Entscheidungsgrundlage" }).click();
    const editor = page.getByRole("dialog", { name: "Neue Entscheidungsgrundlage" });
    await expect(editor).toBeVisible();
    await editor.locator("#sf-name").fill("E2E Setup");
    await editor.locator("#sf-desc").fill("Regel A; Regel B");
    await screenshot(page, info, "setup-editor");
    await editor.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(toast(page)).toContainText("Grundlage angelegt");
    const card = page.getByRole("article", { name: "E2E Setup" });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Bearbeiten" }).click();
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(80);
      await page.screenshot({ path: `/tmp/shots/${info.project.name}-setup-edit-open-${i}.png` });
    }
    const edit = page.getByRole("dialog", { name: "Grundlage bearbeiten" });
    await expect(edit).toBeVisible();
    await expect(edit.locator("#sf-name")).toHaveValue("E2E Setup");
    await screenshot(page, info, "setup-editor-edit");
    await page.keyboard.press("Escape");
    await expect(edit).toBeHidden();
    await expect(card).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
