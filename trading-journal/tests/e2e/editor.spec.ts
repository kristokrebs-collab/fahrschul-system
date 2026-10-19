/**
 * Trade editor additions: the live Einstiegs-Check snapshot stored with a new trade (candle-close state "bestätigt",
 * the graded Top-Trader-Kombi and the falling-knife filter), mistake tags (list + own tag) stored as `trade.mistakes`,
 * both shown in the trade detail, and the unsaved-input guard ("Änderungen verwerfen?") on Escape / Abbrechen. The
 * page clock is pinned at 06:03 UTC (the synthetic signal candles — 30m base, 45m, 1h — closed a few minutes ago →
 * "bestätigt").
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, isMobile, pinClock, screenshot, seed, stored, toast, utcToday } from "./helpers";

const fab = (page: Page) => page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Trade eintragen" });

interface StoredTrade {
  id: string;
  entry: number;
  reason?: string;
  mistakes?: string[];
  signal?: {
    side: string;
    strength: number;
    valid: boolean;
    label: string;
    mode?: string;
    state?: string;
    tfs: { tf: string; kind: string | null; state?: string }[];
    whale?: unknown;
    parts?: { id: string; ok: boolean; grade: number; data: boolean; items: { id: string; met: boolean | null }[] }[];
    knife?: { n: number; items: { id: string; met: boolean | null }[] };
  } | null;
}

test("new trade: the live check snapshot (bestätigt, Top-Trader-Kombi 4/4, falling-knife filter) and the mistake tags are stored and shown in the detail", async ({ page }, info) => {
  const errors = collectErrors(page);
  // 06:03 UTC: the 30m, 45m and 1h candles with the turn have all closed (the entry is confirmed, not provisional)
  const at = utcToday(6, 3);
  const clock = await pinClock(page, at);
  await seed(page, { synth: { ratios: "whale-long", anchor: at - 60_000 }, clock: clock.now });
  await page.goto("/#overview");
  // the live check has evaluated (the editor's section reads the same engine)
  await expect(page.getByTestId("signal-card")).toHaveAttribute("data-state", "ok", { timeout: 25_000 });
  await fab(page).click();
  const editor = page.getByRole("dialog", { name: "Trade eintragen" });
  await expect(editor).toBeVisible();

  const summary = editor.getByTestId("signal-summary");
  await expect(summary).toHaveAttribute("data-strength", "4", { timeout: 15_000 });
  await expect(summary).toHaveAttribute("data-state", "confirmed");
  await expect(summary).toContainText("Sehr starker Long-Einstieg");
  await expect(summary.getByTestId("signal-summary-state")).toHaveAttribute("data-state", "confirmed");
  await expect(summary.getByTestId("signal-summary-state")).toHaveText("bestätigt");
  await expect(summary.getByTestId("signal-summary-part-traders")).toHaveAttribute("data-ok", "true");
  await expect(editor.getByText("Live-Check · wird beim Speichern mitgespeichert")).toBeVisible();

  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0); // the open morph has lifted `inert` (a fill before it is lost)
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
  expect(t!.signal).toMatchObject({ side: "long", strength: 4, valid: true, label: "Sehr starker Long-Einstieg", mode: "live", state: "confirmed" });
  expect(t!.signal!.tfs.slice(0, 3).every((x) => x.kind === "bottom" || x.kind === "buy"), JSON.stringify(t!.signal!.tfs)).toBe(true);
  // the graded combo is stored as a part (the legacy `whale` reading is no longer written)
  const traders = t!.signal!.parts?.find((p) => p.id === "traders");
  expect(traders, JSON.stringify(t!.signal!.parts)).toMatchObject({ ok: true, grade: 1, data: true });
  expect(traders!.items.map((i) => [i.id, i.met])).toEqual([
    ["pos", true],
    ["acc", true],
    ["retail", true],
    ["zone", true],
  ]);
  expect(t!.signal!.parts?.map((p) => p.id)).toEqual(["traders", "div", "sr"]);
  expect(t!.signal!.knife?.items.map((i) => i.id)).toEqual(["structure", "divergence", "whale"]);
  expect(t!.signal!.whale).toBeUndefined();
  // the 13 legacy trades are untouched
  expect(trades).toHaveLength(14);

  // trade detail: the stored check with its state, parts, the filter and the tags
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await page.waitForTimeout(700);
  const row = isMobile(info) ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator(`tbody tr[data-trade-id="${t!.id}"]`).first();
  await row.click();
  const detail = page.getByRole("dialog", { name: "Trade-Details" });
  await expect(detail).toBeVisible();
  const ds = detail.getByTestId("signal-summary");
  await expect(ds).toHaveAttribute("data-strength", "4");
  await expect(ds).toHaveAttribute("data-state", "confirmed");
  await expect(ds.getByTestId("signal-summary-state")).toHaveText("bestätigt");
  const part = ds.getByTestId("signal-summary-part-traders");
  await expect(part).toHaveAttribute("data-ok", "true");
  await expect(part.locator("li[data-met=true]")).toHaveCount(4);
  await expect(ds.getByTestId("signal-summary-part-div")).toBeVisible();
  await expect(ds.getByTestId("signal-summary-part-sr")).toBeVisible();
  await expect(ds.getByTestId("signal-summary-part-knife")).toContainText(`${t!.signal!.knife!.n} von 3`);
  await expect(ds.getByTestId("signal-summary-whale")).toHaveCount(0);
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
  await expect(editor.locator("[inert] #f-entry")).toHaveCount(0); // the open morph has lifted `inert` (a fill before it is lost)
  await editor.locator("#f-entry").click();
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
