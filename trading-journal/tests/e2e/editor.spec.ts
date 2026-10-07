/**
 * Trade editor additions: the live Einstiegs-Check snapshot stored with a new trade (incl. "Top-Trader kaufen ·
 * Retail rot"), mistake tags (list + own tag) stored as `trade.mistakes`, both shown in the trade detail, and the
 * unsaved-input guard ("Änderungen verwerfen?") on Escape / Abbrechen.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, isMobile, screenshot, seed, stored, toast } from "./helpers";

const fab = (page: Page) => page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });

interface StoredTrade {
  id: string;
  entry: number;
  reason?: string;
  mistakes?: string[];
  signal?: { side: string; strength: number; valid: boolean; label: string; mode?: string; tfs: { tf: string; kind: string | null }[]; whale?: { ok: boolean; run: number; points: number } | null } | null;
}

test("new trade: the live check snapshot and the mistake tags are stored and shown in the detail", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page, { synth: { ratios: "whale-long" } });
  await page.goto("/#overview");
  // the live check has evaluated (the editor's section reads the same engine)
  await expect(page.getByTestId("signal-card")).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();

  const summary = editor.getByTestId("signal-summary");
  await expect(summary).toHaveAttribute("data-strength", "4", { timeout: 15_000 });
  await expect(summary).toContainText("Sehr starker Long-Einstieg");
  await expect(editor.getByText("Live-Check · wird beim Speichern mitgespeichert")).toBeVisible();

  await editor.locator("#f-entry").fill("80000");
  await editor.locator("#f-stop").fill("79200");
  await editor.locator("#f-exit").fill("81500");
  await editor.locator("#f-size").fill("4000");
  await editor.locator("#f-reason").fill("E2E Signal-Trade");

  const tags = editor.getByRole("group", { name: "Fehler-Tags" });
  await tags.getByRole("button", { name: "Zu früh raus", exact: true }).click();
  await expect(tags.getByRole("button", { name: "Zu früh raus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tags.getByRole("button", { name: "+ Eigener Fehler" }).click();
  const own = tags.getByRole("textbox", { name: "Eigener Fehler" });
  await own.fill("Nachgekauft");
  await own.press("Enter");
  await expect(tags.getByRole("button", { name: "Nachgekauft", exact: true })).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, info, "editor-signal-mistakes");

  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(toast(page)).toContainText("Trade gespeichert");

  const trades = (await stored<StoredTrade[]>(page, "tj2-trades")) ?? [];
  const t = trades.find((x) => x.reason === "E2E Signal-Trade");
  expect(t, "saved trade").toBeTruthy();
  expect(t!.mistakes).toEqual(["Zu früh raus", "Nachgekauft"]);
  expect(t!.signal, "signal snapshot").toBeTruthy();
  expect(t!.signal).toMatchObject({ side: "long", strength: 4, valid: true, label: "Sehr starker Long-Einstieg", mode: "live" });
  expect(t!.signal!.tfs.slice(0, 3).every((x) => x.kind === "bottom" || x.kind === "buy"), JSON.stringify(t!.signal!.tfs)).toBe(true);
  expect(t!.signal!.whale).toMatchObject({ ok: true, run: 4, points: 10 });
  // the 13 legacy trades are untouched
  expect(trades).toHaveLength(14);

  // trade detail: the stored check and the tags
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await page.waitForTimeout(700);
  const row = isMobile(info) ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator(`tbody tr[data-trade-id="${t!.id}"]`).first();
  await row.click();
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("signal-summary")).toHaveAttribute("data-strength", "4");
  await expect(detail).toContainText("Zu früh raus");
  await expect(detail).toContainText("Nachgekauft");
  await screenshot(page, info, "detail-signal-mistakes");
  expect(errors, errors.join("\n")).toEqual([]);
});

test("unsaved input: Escape and Abbrechen ask `Änderungen verwerfen?`; keep editing keeps the input, Verwerfen closes", async ({ page }, info) => {
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#overview");
  await expect(page.getByText("Netto-P&L").first()).toBeVisible();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });

  // untouched: Escape closes at once
  await fab(page).click();
  await expect(editor.locator("#f-entry")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await fab(page).click();
  await expect(editor.locator("#f-entry")).toBeVisible();
  await editor.locator("#f-entry").fill("80123");
  await page.keyboard.press("Escape");
  const confirm = editor.getByTestId("discard-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Änderungen verwerfen?");
  await expect(editor).toBeVisible();
  await screenshot(page, info, "editor-discard-confirm");
  // focus lands on the safe answer
  await expect(confirm.getByRole("button", { name: "Weiter bearbeiten" })).toBeFocused();
  await confirm.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(editor.locator("#f-entry")).toHaveValue("80123");

  // the header ✕ and Abbrechen ask too
  await editor.getByRole("button", { name: "Abbrechen" }).click();
  await expect(editor.getByTestId("discard-confirm")).toBeVisible();
  await editor.getByTestId("discard-confirm").getByRole("button", { name: "Verwerfen" }).click();
  await expect(editor).toBeHidden();
  // nothing was saved, a new editor starts empty
  expect(((await stored<StoredTrade[]>(page, "tj2-trades")) ?? []).some((x) => x.entry === 80123)).toBe(false);
  await fab(page).click();
  await expect(editor.locator("#f-entry")).toHaveValue("");
  expect(errors, errors.join("\n")).toEqual([]);
});
