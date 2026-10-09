/**
 * Zero data loss across versions and tabs:
 * - `Backup importieren` with the OTHER journal version's backup format (`{ exportedAt, settings, trades }`, its
 *   `trade.signal` SignalSnap, `trade.mistakes`, `settings.signals`, `settings.mistakes`, setup `s_mtf`) keeps every
 *   field and shows them (trade detail, settings);
 * - the other version's raw localStorage opens as is, and an edit here keeps its extra fields;
 * - two tabs of the same browser: a trade saved in A and settings saved in the stale tab B both survive.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OTHER_MISTAKES, OTHER_SIGNAL_SNAP, otherBackup, otherSettings, otherTrades } from "../unit/otherVersion.fixture";
import { collectErrors, isMobile, openTradeEditor, screenshot, seed, stored, toast } from "./helpers";

interface StoredTrade {
  id: string;
  entry: number;
  reason?: string;
  signal?: unknown;
  mistakes?: string[];
  updatedAt?: string;
}

/** Opens the detail of trade `id` from the trades page (table row / phone card). */
async function openTrade(page: Page, id: string, mobile: boolean) {
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await page.waitForTimeout(700);
  // scoped to the trades page (the kept-alive overview has its own `data-trade-id` rows)
  const row = mobile ? page.getByRole("list", { name: "Trades" }).locator(`[data-trade-id="${id}"]`) : page.locator(`tbody tr[data-trade-id="${id}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  return detail;
}

test("Backup importieren: the other version's backup keeps signal, mistakes, signal settings and tags", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  const dir = mkdtempSync(join(tmpdir(), "tj-other-"));
  const file = join(dir, "trade-journal-2026-10-03.json");
  writeFileSync(file, JSON.stringify(otherBackup()));

  await page.getByRole("button", { name: "Backup importieren" }).click();
  const dialog = page.getByRole("dialog", { name: "Backup importieren" });
  await dialog.getByLabel("Backup-Datei").setInputFiles(file);
  await expect(dialog.getByTestId("import-preview-text")).toContainText("2 Trades");
  await expect(dialog.getByRole("radio", { name: "Zusammenführen" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Importieren", exact: true }).click();
  await expect(toast(page)).toContainText("Backup importiert");
  await expect(dialog).toBeHidden();

  const trades = (await stored<StoredTrade[]>(page, "tj2-trades")) ?? [];
  expect(trades).toHaveLength(15);
  const t1 = trades.find((t) => t.id === "t_other_1");
  expect(t1?.signal, "SignalSnap kept field for field").toMatchObject(OTHER_SIGNAL_SNAP);
  expect(t1?.mistakes).toEqual(["Zu früh raus"]);
  expect(trades.find((t) => t.id === "t_other_2")?.mistakes).toEqual([]);
  const settings = await stored<{ signals?: Record<string, unknown>; mistakes?: string[]; setups?: { id: string }[] }>(page, "tj2-settings");
  expect(settings?.signals).toMatchObject({ rsiNear: 12, ladder: ["30m", "45m", "1h", "4h"], zoneTf: "1h" });
  for (const m of OTHER_MISTAKES) expect(settings?.mistakes).toContain(m);
  expect(settings?.setups?.some((s) => s.id === "s_mtf")).toBe(true);

  // shown: the stored check and the tag on the trade, the signal settings in the Einstiegs-Check card
  await page.locator("#s-sgRsiNear").scrollIntoViewIfNeeded();
  await expect(page.locator("#s-sgRsiNear")).toHaveValue("12");
  const detail = await openTrade(page, "t_other_1", isMobile(info));
  await expect(detail.getByTestId("signal-summary")).toHaveAttribute("data-strength", "2");
  await expect(detail.getByTestId("signal-summary")).toContainText("2 von 4 Timeframes");
  await expect(detail).toContainText("Zu früh raus");
  await screenshot(page, info, "import-other-detail");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("the other version's localStorage opens as is; editing a trade here keeps its signal and tags", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page, {
    empty: true,
    extra: {
      "tj2-trades": otherTrades(),
      "tj2-settings": otherSettings(),
      "tj2-hyblock": [{ id: "h_o1", at: "2026-10-01T09:00", longPct: 61, delta: 2, deltaCandles: 2, structure: true, rsi: false, note: "" }],
    },
  });
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await expect(page.getByText("2 Trades", { exact: true })).toBeVisible();

  const detail = await openTrade(page, "t_other_1", isMobile(info));
  await expect(detail.getByTestId("signal-summary")).toHaveAttribute("data-strength", "2");
  await detail.getByRole("button", { name: "Bearbeiten" }).click();
  const editor = page.getByRole("dialog", { name: "Trade bearbeiten" });
  await expect(editor).toBeVisible();
  // the stored check is shown, not re-computed (date and side unchanged)
  await expect(editor.getByTestId("signal-summary")).toHaveAttribute("data-strength", "2");
  await expect(editor.getByRole("group", { name: "Fehler-Tags" }).getByRole("button", { name: "Zu früh raus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await editor.locator("#f-notes").fill("Hier nachgetragen");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(toast(page)).toContainText("Trade aktualisiert");

  const t1 = ((await stored<(StoredTrade & { notes?: string; checks?: Record<string, boolean> })[]>(page, "tj2-trades")) ?? []).find((t) => t.id === "t_other_1");
  expect(t1?.notes).toBe("Hier nachgetragen");
  expect(t1?.signal).toMatchObject(OTHER_SIGNAL_SNAP);
  expect(t1?.mistakes).toEqual(["Zu früh raus"]);
  expect(t1?.checks).toMatchObject({ "s_mtf:mtf_base": true, "s_mtf:mtf_next": true, "g:trigger": true });
  // settings of the other version untouched by opening and editing
  const s = await stored<{ signals?: Record<string, unknown>; market?: Record<string, unknown> }>(page, "tj2-settings");
  expect(s?.signals).toMatchObject({ rsiNear: 12 });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("two tabs: a trade saved in A and settings saved in the stale tab B both survive", async ({ page: a, context }) => {
  await seed(a);
  await a.goto("/#overview");
  await expect(a.getByText("Netto-P&L").first()).toBeVisible();
  const b = await context.newPage();
  await seed(b);
  await b.goto("/#settings");
  await expect(b.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  // B starts editing before A saves anything
  await b.locator("#s-makro").fill("33333");

  // A: a new trade
  const editor = await openTradeEditor(a);
  await editor.locator("#f-entry").fill("80000");
  await editor.locator("#f-exit").fill("80800");
  await editor.locator("#f-size").fill("2000");
  await editor.locator("#f-reason").fill("Tab A Trade");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(toast(a)).toContainText("Trade gespeichert");

  // B (its journal state is from before A's save): saves its settings
  await b.getByRole("button", { name: "Speichern", exact: true }).first().click();
  await expect(toast(b)).toContainText("Einstellungen gespeichert");

  // nothing lost: A's trade and B's capital are both in storage
  const trades = (await stored<StoredTrade[]>(b, "tj2-trades")) ?? [];
  expect(trades).toHaveLength(14);
  expect(trades.some((t) => t.reason === "Tab A Trade")).toBe(true);
  expect((await stored<{ capital?: { makro?: number } }>(b, "tj2-settings"))?.capital?.makro).toBe(33333);

  // B shows A's trade without a reload (storage event)
  await b.goto("/#trades");
  await expect(b.getByText("14 Trades", { exact: true })).toBeVisible();

  // A (stale settings) saves a different setting: B's capital stays
  await a.goto("/#settings");
  await expect(a.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(a.locator("#s-makro")).toHaveValue("33333");
  await a.locator("#s-scalp").fill("7777");
  await a.getByRole("button", { name: "Speichern", exact: true }).first().click();
  await expect(toast(a)).toContainText("Einstellungen gespeichert");
  const cap = (await stored<{ capital?: { makro?: number; scalp?: number } }>(a, "tj2-settings"))?.capital;
  expect(cap).toEqual({ makro: 33333, scalp: 7777 });
  expect(((await stored<StoredTrade[]>(a, "tj2-trades")) ?? []).length).toBe(14);
  await b.close();
});
