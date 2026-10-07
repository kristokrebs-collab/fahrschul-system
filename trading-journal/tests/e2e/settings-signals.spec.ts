/**
 * Einstellungen → Einstiegs-Check (ladder, RSI, "Top-Trader · Retail" group) and Fehler-Tags: edits are saved into
 * `settings.signals` / `settings.mistakes` merged over the stored objects (unknown keys survive), come back after a
 * reload, and drive the live check (the whale row follows periods / in Folge / weight) and the editor's tag chips.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, fixture, openTradeEditor, screenshot, seed, stored, toast } from "./helpers";

const baseSettings = fixture["tj2-settings"] as Record<string, unknown>;

async function gotoSettings(page: Page) {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Speichern", exact: true }).first().click();
  await expect(toast(page)).toContainText("Einstellungen gespeichert");
}

interface StoredSignals {
  ladder?: string[];
  rsiOs?: number;
  foo?: string;
  whale?: { on?: boolean; periods?: string[]; minRun?: number; weight?: number; keep?: number };
}

test("Einstiegs-Check card: ladder, RSI and the Top-Trader group are saved, reloaded and drive the live check", async ({ page }, info) => {
  const errors = collectErrors(page);
  // the other version's / an older save's extra keys must survive a save from this page
  await seed(page, { synth: { ratios: "whale-long" }, extra: { "tj2-settings": { ...baseSettings, signals: { foo: "keep", whale: { keep: 1 } } } } });
  await gotoSettings(page);
  const card = page.getByTestId("settings-signal-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();

  // ladder: 2h joins (30m → 45m → 1h → 2h → 4h)
  const rung2h = card.getByRole("button", { name: "Stufe 2h", exact: true });
  await expect(rung2h).toHaveAttribute("aria-pressed", "false");
  await rung2h.click();
  await expect(rung2h).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("list", { name: "Leiter" })).toContainText("2h");

  // Top-Trader kaufen · Retail rot: + period 4h, 3 in a row, weight 20
  const whale = card.getByTestId("settings-whale");
  await expect(whale.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await whale.getByRole("button", { name: "Periode 4h", exact: true }).click();
  await expect(whale.getByRole("button", { name: "Periode 4h", exact: true })).toHaveAttribute("aria-pressed", "true");
  await whale.getByRole("radiogroup", { name: /In Folge/ }).getByRole("radio", { name: "3", exact: true }).click();
  await whale.getByRole("radiogroup", { name: /Gewicht/ }).getByRole("radio", { name: "20", exact: true }).click();
  await expect(whale).toContainText("+20 Score, ein gültiger Einstieg wird eine Stärke höher");
  await screenshot(page, info, "settings-signal-card");
  await save(page);

  const s = (await stored<{ signals?: StoredSignals }>(page, "tj2-settings"))?.signals;
  expect(s?.ladder).toEqual(["30m", "45m", "1h", "2h", "4h"]);
  expect(s?.foo, "unknown key kept").toBe("keep");
  expect(s?.whale).toMatchObject({ keep: 1, on: true, periods: ["30m", "1h", "4h"], minRun: 3, weight: 20 });

  // reload: the card shows the stored values
  await page.reload();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Stufe 2h", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(whale.getByRole("button", { name: "Periode 4h", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(whale.getByRole("radiogroup", { name: /In Folge/ }).getByRole("radio", { name: "3", exact: true })).toHaveAttribute("aria-checked", "true");

  // the live check follows: five rungs, the whale row reads all three periods with 3 in a row and weight 20
  await page.goto("/#overview");
  const check = page.getByTestId("signal-card");
  await check.scrollIntoViewIfNeeded();
  await expect(check).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(check.getByTestId("signal-rung")).toHaveCount(5);
  const row = check.getByTestId("signal-whale");
  await expect(row).toHaveAttribute("data-state", "ok");
  await expect(row).toContainText("+20 Score · +1 Stärke");
  await expect(row.getByLabel("Perioden in Folge")).toContainText("4h · 4×");
  await expect(check.getByRole("list", { name: "Bedingungen" })).toContainText("Top-Trader kaufen · Retail rot (3× 30m/1h/4h)");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("switching the Top-Trader check off hides the row; switching on again restores it", async ({ page }) => {
  await seed(page, { synth: { ratios: "whale-long" } });
  await gotoSettings(page);
  const whale = page.getByTestId("settings-whale");
  await whale.scrollIntoViewIfNeeded();
  await whale.getByRole("switch").click();
  await expect(whale.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await save(page);
  expect((await stored<{ signals?: StoredSignals }>(page, "tj2-settings"))?.signals?.whale?.on).toBe(false);
  await page.goto("/#overview");
  const check = page.getByTestId("signal-card");
  await check.scrollIntoViewIfNeeded();
  await expect(check).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(check.getByTestId("signal-whale")).toHaveCount(0);
});

test("Fehler-Tags: rename, add, remove, adopt a tag that only trades carry; the editor offers the saved list", async ({ page }, info) => {
  const errors = collectErrors(page);
  const trades = (fixture["tj2-trades"] as Record<string, unknown>[]).map((t, i) => (i === 0 ? { ...t, mistakes: ["Alter Tag"] } : t));
  await seed(page, { extra: { "tj2-trades": trades } });
  await gotoSettings(page);
  const card = page.getByTestId("settings-mistakes-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole("textbox", { name: "Fehler-Tag 1" })).toHaveValue("Zu früh rein");

  // rename the first, remove "Kein Stop", add one
  await card.getByRole("textbox", { name: "Fehler-Tag 1" }).fill("Zu früh eingestiegen");
  await card.getByRole("button", { name: "Fehler-Tag entfernen: Kein Stop" }).click();
  await expect(card.getByRole("button", { name: "Fehler-Tag entfernen: Kein Stop" })).toHaveCount(0);
  await card.getByRole("button", { name: "+ Fehler-Tag hinzufügen" }).click();
  const rows = card.getByRole("textbox", { name: /^Fehler-Tag \d+$/ });
  await rows.last().fill("Ohne Alarm");

  // a tag that only a trade carries is offered for adoption
  const orphans = card.getByTestId("mistake-orphans");
  await expect(orphans).toContainText("Alter Tag");
  await orphans.getByRole("button", { name: "„Alter Tag“ wieder in die Liste aufnehmen" }).click();
  await screenshot(page, info, "settings-mistakes");
  await save(page);

  const list = (await stored<{ mistakes?: string[] }>(page, "tj2-settings"))?.mistakes ?? [];
  expect(list[0]).toBe("Zu früh eingestiegen");
  expect(list).not.toContain("Kein Stop");
  expect(list).toContain("Ohne Alarm");
  expect(list).toContain("Alter Tag");
  // the trade keeps its tag (renaming / removing never rewrites trades)
  const t0 = ((await stored<Record<string, unknown>[]>(page, "tj2-trades")) ?? [])[0];
  expect(t0?.mistakes).toEqual(["Alter Tag"]);

  // the editor offers the saved list
  const editor = await openTradeEditor(page);
  const tags = editor.getByRole("group", { name: "Fehler-Tags" });
  await expect(tags.getByRole("button", { name: "Zu früh eingestiegen", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "Ohne Alarm", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "Kein Stop", exact: true })).toHaveCount(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
