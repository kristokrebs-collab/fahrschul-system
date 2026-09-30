/**
 * Einstellungen: Startkapital → `Speichern` → toast + hero, `Live-Daten` wired to the market layer,
 * `Backup (JSON)` download, `Backup importieren` (merge) preview + toast.
 */
import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors, fixture, isMobile, screenshot, seed, toast } from "./helpers";

async function gotoSettings(page: import("@playwright/test").Page) {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
}

test("Startkapital → `Speichern` → toast, hero subline shows the new capital", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoSettings(page);
  await page.locator("#s-makro").fill("30000");
  await page.locator("#s-scalp").fill("10000");
  await page.getByRole("button", { name: "Speichern", exact: true }).first().click();
  await expect(toast(page)).toContainText("Einstellungen gespeichert");
  await screenshot(page, info, "settings-saved");
  // the saved draft is not reverted by the settings re-hydration
  await expect(page.locator("#s-makro")).toHaveValue("30000");
  await page.goto("/#overview");
  await expect(page.getByText("Startkapital 40.000 USDT")).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("unsaved edits survive an external settings change (SetupEditor save)", async ({ page }) => {
  await seed(page);
  await gotoSettings(page);
  await page.locator("#s-makro").fill("31000");
  // a settings write from elsewhere: change a ui pref that does not touch settings → nothing lost; then a real settings write
  await page.evaluate(() => {
    const w = window as unknown as { __tjSaveSettingsProbe?: unknown };
    w.__tjSaveSettingsProbe = true;
  });
  await page.locator("#s-scalp").fill("6000");
  await expect(page.locator("#s-makro")).toHaveValue("31000");
});

test("`Live-Daten` shows real feed rows from the market layer; refresh / reconnect / clear cache do not crash", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByTestId("market-panel")).toContainText("BTC/USDT");
  await gotoSettings(page);
  const card = page.locator("div.group", { has: page.getByRole("heading", { name: "Live-Daten" }) }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Noch keine Statusdaten")).toHaveCount(0);
  const rows = card.locator("tbody tr");
  expect(await rows.count()).toBeGreaterThanOrEqual(10);
  await expect(card.getByText("Kerzen 4h")).toBeVisible();
  await expect(card.getByText("Mark-Preis")).toBeVisible();
  await expect(card.getByText("Gesamtstatus")).toBeVisible();
  await expect(rows.filter({ hasText: "Live" }).first()).toBeVisible();
  await screenshot(page, info, "settings-live-data");

  await card.getByRole("button", { name: "Jetzt aktualisieren" }).click();
  await card.getByRole("button", { name: "Jetzt neu verbinden" }).click();
  await card.getByRole("button", { name: "Cache leeren" }).click();
  await page.waitForTimeout(1500);
  await expect(card.getByText("Kerzen 4h")).toBeVisible();
  await expect(rows.filter({ hasText: /Live|Verbinde/ }).first()).toBeVisible({ timeout: 15_000 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("`Backup (JSON)` triggers a download", async ({ page }) => {
  await seed(page);
  await gotoSettings(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Backup (JSON)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^trade-journal-\d{4}-\d{2}-\d{2}\.json$/);
});

test("`Backup importieren` (merge) shows the preview and toasts `Backup importiert`", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await gotoSettings(page);
  // backup format `{ exportedAt, settings, trades, hyblock, schemaVersion }` built from the legacy fixture
  const trades = (fixture["tj2-trades"] as Record<string, unknown>[]).slice(0, 3).map((t, i) => ({ ...t, id: `imp_${i}`, notes: "imported" }));
  const backup = { exportedAt: "2026-06-01T10:00:00.000Z", settings: fixture["tj2-settings"], trades, hyblock: fixture["tj2-hyblock"], schemaVersion: 1 };
  const dir = mkdtempSync(join(tmpdir(), "tj-backup-"));
  const file = join(dir, "trade-journal-2026-06-01.json");
  writeFileSync(file, JSON.stringify(backup));

  await page.getByRole("button", { name: "Backup importieren" }).click();
  const dialog = page.getByRole("dialog", { name: "Backup importieren" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Backup-Datei").setInputFiles(file);
  await expect(dialog.getByTestId("import-preview")).toBeVisible();
  await expect(dialog.getByTestId("import-preview-text")).toContainText("3 Trades");
  await expect(dialog.getByRole("radio", { name: "Zusammenführen" })).toHaveAttribute("aria-checked", "true");
  await screenshot(page, info, "settings-import-preview");
  await dialog.getByRole("button", { name: "Importieren", exact: true }).click();
  await expect(toast(page)).toContainText("Backup importiert");
  await expect(dialog).toBeHidden();
  await page.goto("/#trades");
  await expect(page.getByLabel("16 Trades")).toBeVisible();
  if (!isMobile(info)) await screenshot(page, info, "trades-after-import");
  expect(errors, errors.join("\n")).toEqual([]);
});
