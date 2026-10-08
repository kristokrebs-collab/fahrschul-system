/**
 * Einstellungen → Einstiegs-Check (ladder, RSI, candle-close confirmation, Top-Trader-Kombi, divergences, support /
 * resistance) and Fehler-Tags: edits are saved into `settings.signals` / `settings.mistakes` merged over the stored
 * objects (unknown keys and the former run-rule values survive), come back after a reload, and drive the live check
 * (the combo follows threshold / retail period / "+1 Stärke ab" / weight) and the editor's tag chips.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, fixture, openTradeEditor, pinClock, screenshot, seed, stored, toast, utcToday } from "./helpers";
import { expectedSignals } from "./mocks/synthOracle";

const baseSettings = fixture["tj2-settings"] as Record<string, unknown>;
const LIVE_PRICE = 84_199;

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
  strongCloses?: number;
  whale?: { on?: boolean; periods?: string[]; minRun?: number; weight?: number; keep?: number; topPct?: number; retailPeriod?: string; bonusParts?: number };
  div?: { on?: boolean; weight?: number; keep?: string };
  sr?: { on?: boolean; minR?: number; weight?: number };
}

test("Einstiegs-Check card: ladder, confirmation and the Top-Trader-Kombi are saved, reloaded and drive the live check", async ({ page }, info) => {
  const errors = collectErrors(page);
  const at = utcToday(10, 3);
  const clock = await pinClock(page, at);
  const anchor = at - 60_000;
  // the other version's / an older save's extra keys (and the former run-rule values) must survive a save from this page
  const signals0 = { foo: "keep", whale: { keep: 1, periods: ["30m", "1h"], minRun: 2 }, div: { keep: "x" } };
  await seed(page, { synth: { ratios: "whale-long", anchor }, clock: clock.now, extra: { "tj2-settings": { ...baseSettings, signals: signals0 } } });
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

  // Bestätigung (Kerzenschluss): stark bestätigt after 1 close; the 3-candle signal window offers at most 2
  const confirm = card.getByTestId("settings-confirm");
  const strong = confirm.getByRole("radiogroup", { name: /Stark bestätigt nach/ });
  await expect(strong.getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(strong.getByRole("radio", { name: "3", exact: true })).toHaveCount(0);
  await expect(confirm).toContainText("höchstens 2 bei diesem Signal-Fenster");
  await strong.getByRole("radio", { name: "1", exact: true }).click();
  await expect(confirm).toContainText("1 Schluss (inkl. der Signalkerze)");

  // Top-Trader-Kombi: threshold 70 % long, retail compared over 15m, +1 strength from 2 parts, weight 20
  const whale = card.getByTestId("settings-whale");
  await expect(whale.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect(whale.locator("#s-sgWhaleTop")).toHaveValue("64");
  await whale.locator("#s-sgWhaleTop").fill("70");
  await expect(whale).toContainText("Long: über 70 % Long · Short: über 70 % Short (Long unter 30 %)");
  await whale.getByRole("radiogroup", { name: /Retail-Vergleich/ }).getByRole("radio", { name: "15m", exact: true }).click();
  await whale.getByRole("radiogroup", { name: /\+1 Stärke ab/ }).getByRole("radio", { name: "2", exact: true }).click();
  await expect(whale).toContainText("2 von 4 Teilen erfüllt");
  await whale.getByRole("radiogroup", { name: /Gewicht/ }).getByRole("radio", { name: "20", exact: true }).click();
  await expect(whale).toContainText("bis +20 Score, anteilig (je erfüllter Teil ¼)");
  // the former run-rule controls are gone (their stored values stay)
  await expect(whale.getByRole("button", { name: "Periode 4h", exact: true })).toHaveCount(0);
  await expect(whale.getByRole("radiogroup", { name: /In Folge/ })).toHaveCount(0);

  // divergences and support / resistance: their own switch, weight and thresholds
  const div = card.getByTestId("settings-div");
  await expect(div.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await div.getByRole("radiogroup", { name: /Gewicht/ }).getByRole("radio", { name: "5", exact: true }).click();
  const sr = card.getByTestId("settings-sr");
  await expect(sr.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await sr.locator("#s-sgSrMinR").fill("3");
  await screenshot(page, info, "settings-signal-card");
  await save(page);

  const s = (await stored<{ signals?: StoredSignals }>(page, "tj2-settings"))?.signals;
  expect(s?.ladder).toEqual(["30m", "45m", "1h", "2h", "4h"]);
  expect(s?.foo, "unknown key kept").toBe("keep");
  expect(s?.strongCloses).toBe(1);
  expect(s?.whale).toMatchObject({ keep: 1, on: true, periods: ["30m", "1h"], minRun: 2, weight: 20, topPct: 70, retailPeriod: "15m", bonusParts: 2 });
  expect(s?.div).toMatchObject({ keep: "x", on: true, weight: 5 });
  expect(s?.sr).toMatchObject({ on: true, minR: 3 });

  // reload: the card shows the stored values
  await page.reload();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Stufe 2h", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(whale.locator("#s-sgWhaleTop")).toHaveValue("70");
  await expect(whale.getByRole("radiogroup", { name: /Retail-Vergleich/ }).getByRole("radio", { name: "15m", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(whale.getByRole("radiogroup", { name: /\+1 Stärke ab/ }).getByRole("radio", { name: "2", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(confirm.getByRole("radiogroup", { name: /Stark bestätigt nach/ }).getByRole("radio", { name: "1", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(sr.locator("#s-sgSrMinR")).toHaveValue("3");

  // the live check follows: five rungs; top traders (66 / 65,4 %) are below 70 %, retail red over 15m and the discount
  // hold → 2 of 4 parts = the combo holds with "+1 Stärke ab 2", +10 of 20 points
  const exp = expectedSignals(anchor, clock.now(), LIVE_PRICE, "whale-long", { cfg: s as Record<string, unknown> });
  const traders = exp.long.parts!.find((x) => x.id === "traders")!;
  expect(traders.met, "oracle: retail + zone").toBe(2);
  expect(traders.ok, "oracle: 2 parts are enough now").toBe(true);
  await page.goto("/#overview");
  const check = page.getByTestId("signal-card");
  await check.scrollIntoViewIfNeeded();
  await expect(check).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await expect(check.getByTestId("signal-rung")).toHaveCount(5);
  const row = check.getByTestId("signal-whale");
  await expect(row).toHaveAttribute("data-state", "ok");
  await expect(row.getByTestId("signal-part-points")).toHaveText("+10 von 20+1 Stärke");
  await expect(row.locator("[data-testid=signal-part-cell][data-id=pos]")).toHaveAttribute("data-met", "false");
  await expect(row.locator("[data-testid=signal-part-cell][data-id=pos]")).toContainText("Ziel > 70 % Long");
  await expect(row.locator("[data-testid=signal-part-cell][data-id=retail]")).toHaveAttribute("data-met", "true");
  await expect(row.locator("[data-testid=signal-part-cell][data-id=retail]")).toContainText("rot: Long-Anteil fällt (15m)");
  await expect(row.locator("[data-testid=signal-part-cell][data-id=retail]")).toContainText(traders.items.find((x) => x.id === "retail")!.value);
  await expect(check.getByRole("img", { name: `Score ${exp.long.score} von 100` })).toBeVisible();
  await expect(check.getByRole("list", { name: "Bedingungen" })).toContainText("Top-Trader long · Retail rot (2 von 4)");
  await expect(check.getByTestId("signal-div").getByTestId("signal-part-points")).toContainText("von 5");
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
