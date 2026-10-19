/**
 * F33 "Was wäre wenn" and F38 "Lernmodus" end to end on the production build (synthetic market, so candles exist for
 * every past window; the seeded trades sit on that price path).
 *
 * - Was wäre wenn: the trade detail opens the sheet; the recorded row, the re-run with the trader's own rules, the variants
 *   and the builder's variant are listed; the hindsight and the same-candle notes are on screen; the builder changes the
 *   variant's row; NOTHING in the stored trades changes.
 * - Lernmodus: from the trade detail (and from the replay) the sheet opens on the trade's setup; an incomplete decision is
 *   refused with the gaps and stores nothing; a complete one is STORED (with the time) and only then the course is
 *   shown; the reflection is stored; the history counts rounds with their sample size; the assistant opens it.
 * - 390 px: no horizontal scroll; no console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, isMobile, openRoute, seed, stored } from "./helpers";
import { synthPrice } from "./mocks/synth";

const HOUR = 3_600_000;
const PROJECTS = ["mobile", "desktop"];
/** `F33_SHOTS=<dir>` additionally writes screenshots for the visual check. */
const SHOTS = process.env.F33_SHOTS;
async function shot(page: Page, info: { project: { name: string } }, name: string, fullPage = false) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/f33f38-${name}-${info.project.name}.png`, fullPage, animations: "disabled" });
}

/** The fields a "what if" must never touch, per trade (the idle MAE / MFE backfill may add its own measurements meanwhile). */
const core = (list: unknown): string =>
  JSON.stringify(
    ((list as Record<string, unknown>[] | null) ?? [])
      .map((t) => ({ id: t.id, side: t.side, status: t.status, date: t.date, exitDate: t.exitDate, entry: t.entry, stop: t.stop, target: t.target, exit: t.exit, size: t.size, setups: t.setups, pnl: t.pnl, r: t.r }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );

/** Local wall clock of `ms` in Europe/Berlin (the browser's zone) as `YYYY-MM-DDTHH:mm`. */
function berlin(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Trades on the synthetic path: three of the setup "s_bo" (Breakout), one of "s_sweep" – all BTC/USDT on 1h. */
function trades(anchor: number) {
  const at = (h: number) => Math.floor((anchor - h * HOUR) / HOUR) * HOUR;
  const p = (t: number) => round1(synthPrice(t, anchor));
  const base = { account: "scalp", timeframe: "1h", checks: {}, conviction: 4, followedPlan: true, emotion: "Ruhig", reason: "", notes: "", chart: "", leverage: 5, fees: 2, pnlManual: null, pnl: null, r: null, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", status: "closed", pair: "BTC/USDT", target: null };
  const mk = (id: string, side: "long" | "short", setups: string[], from: number, to: number) => {
    const e = at(from);
    const x = at(to);
    return { ...base, id, side, setups, date: berlin(e), exitDate: berlin(x), entry: p(e), stop: round1(p(e) * (side === "long" ? 0.99 : 1.01)), exit: p(x), size: round1(p(e) * 0.2) };
  };
  return [mk("t_wi_a", "short", ["s_bo"], 70, 62), mk("t_wi_b", "short", ["s_bo"], 52, 44), mk("t_wi_c", "short", ["s_sweep"], 36, 28), mk("t_wi_d", "long", ["s_bo"], 100, 90)];
}

async function setup(page: Page) {
  const anchor = Date.now();
  await seed(page, { synth: { anchor }, extra: { "tj2-trades": trades(anchor) } });
}

const detail = (page: Page) => page.getByRole("dialog", { name: "Trade-Details" });

async function openTrade(page: Page, id: string) {
  await page.goto("/#trades");
  await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
  await page.locator(`[data-trade-id="${id}"]:visible`).first().click();
  await expect(detail(page)).toBeVisible();
}

/** The German price text ("83.123,40") as a number. */
const german = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));

test.describe("Was wäre wenn · Lernmodus", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("Was wäre wenn: Ist, Nachrechnung, Varianten und eigene Variante – Hinweise sichtbar, nichts wird gespeichert", async ({ page }, info) => {
    const errors = collectErrors(page);
    await setup(page);
    await openTrade(page, "t_wi_b");
    const before = core(await stored(page, "tj2-trades"));
    await detail(page).getByRole("button", { name: "Was wäre wenn" }).click();
    const sheet = page.getByRole("dialog", { name: "Was wäre wenn" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
    // the honest notes
    await expect(sheet.getByTestId("whatif-hindsight")).toContainText("Im Nachhinein gewählt");
    await expect(sheet).toContainText("Reihenfolge innerhalb einer Kerze");
    await expect(sheet).toContainText("zählt der Stopp");
    // the rows: recorded (journal), the re-run, 7 variants, the composed one
    const results = sheet.getByTestId("whatif-results");
    await expect(results.getByTestId("whatif-row-recorded")).toContainText("Ist (Journal)");
    await expect(results.getByTestId("whatif-row-base")).toContainText("Nachrechnung mit deinen Regeln");
    for (const id of ["tight", "wide", "be1", "part1", "tgt2", "trail", "runon", "custom"]) await expect(results.getByTestId(`whatif-row-${id}`)).toBeVisible();
    // every simulated row says how it ended or why it cannot be calculated – never an empty cell
    for (const id of ["base", "tight", "wide", "be1", "part1", "tgt2", "trail", "custom"]) {
      const row = results.getByTestId(`whatif-row-${id}`);
      await expect(row).toHaveAttribute("data-status", /^(ok|skipped)$/);
      if ((await row.getAttribute("data-status")) === "ok") await expect(row).toContainText(/ R/);
      else await expect(row).toContainText("Nicht berechenbar:");
    }
    await shot(page, info, "whatif");
    // the builder: a target of 0,3 R is reached on the falling path of a short → the variant ends at the target
    const builder = sheet.getByTestId("whatif-builder");
    await builder.getByRole("radio", { name: "Ziel in R" }).click();
    await builder.getByLabel("Ziel (R der Variante)").fill("0,3");
    await expect(results.getByTestId("whatif-row-custom")).toContainText("Ziel bei");
    // an unusable number is said, not silently ignored
    await builder.getByLabel("Ziel (R der Variante)").fill("");
    await expect(builder.getByRole("status")).toContainText("Ziel in R fehlt");
    // a row can be shown in the chart
    await results.getByTestId("whatif-row-tight").getByRole("button").click();
    await expect(results.getByTestId("whatif-row-tight").getByRole("button")).toHaveAttribute("aria-pressed", "true");
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    // nothing was saved
    expect(core(await stored(page, "tj2-trades"))).toBe(before);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(detail(page)).toBeVisible(); // the detail comes back
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Lernmodus: Entscheidung wird vor dem Aufdecken gespeichert, Lücken werden verweigert, Reflexion und Verlauf", async ({ page }, info) => {
    const errors = collectErrors(page);
    await setup(page);
    await openTrade(page, "t_wi_b");
    await detail(page).getByRole("button", { name: "Üben" }).click();
    const sheet = page.getByRole("dialog", { name: "Üben" });
    await expect(sheet).toBeVisible();
    // the setup of the trade is preselected; the history is empty and says so
    await expect(sheet.getByTestId("training-setup-s_bo")).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByTestId("training-history")).toContainText("Noch keine Runde geübt");
    await expect(sheet).toContainText("Gezählt wird, ob du erkennst, deine Regeln befolgst und nachdenkst");
    await sheet.getByTestId("training-start").click();

    // case 1: the picture is frozen – no reveal, no timeline
    const kase = sheet.getByTestId("training-case");
    await expect(kase).toBeVisible();
    await expect(kase.locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
    await expect(kase.getByTestId("training-case-head")).toContainText("Markt und Datum verdeckt");
    await expect(kase.getByRole("slider", { name: "Aufdeck-Zeitleiste" })).toHaveCount(0);
    await expect(kase.getByTestId("training-reveal")).toHaveCount(0);

    // an incomplete decision is refused with the gaps – and stores nothing
    await kase.getByTestId("training-commit").click();
    await expect(kase.getByTestId("training-gaps")).toContainText("Einordnen");
    await expect(kase.getByTestId("training-gaps")).toContainText("Begründung");
    expect(((await stored<{ training?: unknown }>(page, "tj2-settings")) ?? {}).training).toBeUndefined();

    await shot(page, info, "train-frozen", true);
    // a complete one: Ja / Long / stop / first rule / reason
    await kase.getByRole("radio", { name: "Ja" }).click();
    await kase.getByRole("radio", { name: "Long", exact: true }).click();
    const stopField = kase.getByLabel("Stopp-Kurs");
    const close = german((await stopField.getAttribute("placeholder"))!);
    expect(close).toBeGreaterThan(1000);
    await stopField.fill(String(round1(close * 0.99)).replace(".", ","));
    await kase.getByRole("group", { name: "Regeln des Setups" }).getByRole("checkbox").first().click();
    await kase.getByLabel("Begründung in einem Satz").fill("Retest hält, Struktur intakt");
    await kase.getByTestId("training-commit").click();

    // revealed: the course plays on, the marks and the real trade are shown, the decision is in the settings
    const reveal = kase.getByTestId("training-reveal");
    await expect(reveal).toBeVisible({ timeout: 20_000 });
    await expect(kase.getByRole("slider", { name: "Aufdeck-Zeitleiste" })).toBeVisible();
    await expect(kase.getByTestId("training-then")).toContainText("Damals im Journal");
    await expect(kase.getByTestId("training-plan")).toContainText("Dein Plan auf den echten Kerzen");
    await expect(kase.getByTestId("training-case-head")).toContainText("BTC/USDT");
    await expect(reveal.getByTestId("mark-recognition")).toHaveAttribute("data-value", /^(yes|no)$/);
    await expect(reveal.getByTestId("mark-rules")).toHaveAttribute("data-value", "no"); // one rule only → the others are open
    await expect(reveal.getByTestId("mark-rules")).toContainText("Einstieg trotz offener Regel");
    const s1 = await stored<{ training?: { v: number; rounds: { decision: { action: string; stop: number; at: string; reason: string }; revealedAt: string; setupId: string; reflection?: unknown; rules: { followed: boolean | null } }[] } }>(page, "tj2-settings");
    expect(s1?.training?.v).toBe(1);
    expect(s1?.training?.rounds).toHaveLength(1);
    const r1 = s1!.training!.rounds[0]!;
    expect(r1).toMatchObject({ setupId: "s_bo", decision: { action: "long", reason: "Retest hält, Struktur intakt" }, rules: { followed: false } });
    expect(r1.decision.stop).toBeGreaterThan(0);
    expect(Date.parse(r1.decision.at)).toBeLessThanOrEqual(Date.parse(r1.revealedAt));
    expect(r1.reflection).toBeUndefined();

    await page.waitForTimeout(500);
    await shot(page, info, "train-reveal", true);
    // reflection
    await kase.getByTestId("training-reflect").getByRole("radio", { name: "Anders als gedacht" }).click();
    await kase.getByLabel("Reflexion").fill("Zu früh eingestiegen");
    await kase.getByTestId("training-reflect-save").click();
    await expect(reveal.getByTestId("mark-reflection")).toHaveAttribute("data-value", "yes");
    await expect
      .poll(async () => (await stored<{ training: { rounds: { reflection?: { verdict: string; note: string } }[] } }>(page, "tj2-settings"))?.training.rounds[0]?.reflection)
      .toMatchObject({ verdict: "surprised", note: "Zu früh eingestiegen" });
    if (isMobile(info)) await expectNoHorizontalScroll(page);

    // the remaining cases: wait, with a reason; the last button ends the round
    for (let i = 0; i < 3; i++) {
      await kase.getByTestId("training-next").click();
      const next = sheet.getByTestId("training-case");
      if (!(await next.isVisible().catch(() => false))) break;
      await expect(next.locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
      await next.getByRole("radio", { name: "Unsicher" }).click();
      await next.getByRole("radio", { name: "Warten" }).click();
      await next.getByLabel("Begründung in einem Satz").fill("kein klarer Retest");
      await next.getByTestId("training-commit").click();
      await expect(next.getByTestId("training-reveal")).toBeVisible({ timeout: 20_000 });
    }
    await sheet.getByTestId("training-next").click();

    // back at the start: the summary of the round and the history with its sample size
    await expect(sheet.getByTestId("training-summary")).toContainText("Fälle geübt");
    const hist = sheet.getByTestId("training-history");
    await expect(hist.getByTestId("hist-rules")).toContainText("zu wenig für eine Aussage");
    await expect(hist.getByTestId("hist-recognition")).toContainText("n = ");
    await expect(hist).toContainText("keine Aussage über deinen Handel");
    const rounds = (await stored<{ training: { rounds: unknown[] } }>(page, "tj2-settings"))!.training.rounds;
    expect(rounds.length).toBeGreaterThanOrEqual(2);
    // the journal's trades are untouched
    expect(((await stored<unknown[]>(page, "tj2-trades")) ?? []).length).toBe(4);
    if (isMobile(info)) await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Einstieg aus dem Replay und über den Assistenten", async ({ page }) => {
    const errors = collectErrors(page);
    await setup(page);
    await openTrade(page, "t_wi_a");
    await detail(page).getByRole("button", { name: "Replay" }).click();
    const replay = page.getByRole("dialog", { name: /^Replay/ });
    await expect(replay).toBeVisible();
    await replay.getByRole("button", { name: "Ähnliches üben" }).click();
    const sheet = page.getByRole("dialog", { name: "Üben" });
    await expect(sheet).toBeVisible();
    await expect(replay).toBeHidden();
    await expect(sheet.getByTestId("training-setup-s_bo")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(detail(page)).toBeVisible(); // the detail comes back

    // the assistant only opens it
    await page.keyboard.press("Escape");
    await expect(detail(page)).toBeHidden();
    await page.getByTestId("assistant-button").click();
    const assistant = page.getByRole("dialog", { name: "Assistent" });
    await expect(assistant).toBeVisible();
    await page.getByTestId("assistant-input").fill("Ich will üben");
    await page.getByTestId("assistant-send").click();
    await expect(page.getByRole("dialog", { name: "Üben" })).toBeVisible();
    await expect(assistant).toBeHidden();
    expect(((await stored<{ training?: unknown }>(page, "tj2-settings")) ?? {}).training).toBeUndefined();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("ohne passende Trades: ehrlicher Leerzustand", async ({ page }) => {
    await seed(page, { empty: true });
    await openRoute(page, "/#overview", "Übersicht");
    await page.getByTestId("assistant-button").click();
    await page.getByTestId("assistant-input").fill("Training starten");
    await page.getByTestId("assistant-send").click();
    const sheet = page.getByRole("dialog", { name: "Üben" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Noch nichts zu üben");
    await expect(sheet.getByTestId("training-start")).toHaveCount(0);
  });
});
