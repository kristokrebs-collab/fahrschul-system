/**
 * Berichte – Funktionsprüfung der ganzen Seite (Runde 13, Paket B), phone (390×844) + Galaxy Tab (1692×978), production build, no cloud.
 * What `coach.spec.ts` (Bericht bereit, Markdown, PDF mounted) and `frost-f2.spec.ts` (the three frost cards) do not cover:
 *   1  every kind of report (Tag · Woche · Monat · Quartal · Jahr) and every focus opens with its cards, the period steps and stops,
 *      the keyboard does the same (radio group with arrows, focus chips with Space, the period arrows with Enter);
 *   2  export: CSV and JSON carry the report on screen (period key, the focus limits the sections), the print document is the only
 *      thing on the page under `@media print` (print.css: white paper, the app hidden) and is gone afterwards;
 *   3  offline: the page keeps working – switching the period, exporting, asking the journal;
 *   4  an empty journal: honest empty states on every card, nothing to export, nothing invented;
 *   5  touch targets ≥ 44 px on a touch screen, axe (dark) on the whole page, no horizontal scroll, no console error.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { collectErrors, expectNoHorizontalScroll, hasTouch, openRoute, pinClock, scrollUntilVisible, seed } from "./helpers";

const PROJECTS = ["mobile", "tablet"];
const DAY = 86_400_000;
/** Wed 2026-10-14 12:30 Berlin: the newest finished week is KW 41, the running one KW 42. */
const WED = Date.UTC(2026, 9, 14, 10, 30);
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

/** Thirteen closed trades, one per day up to today (wins and losses, long and short, one without a stop). */
function journal(now: number): Record<string, unknown>[] {
  return Array.from({ length: 13 }, (_, d) => {
    const at = now - d * DAY - 5 * 3_600_000;
    const win = d % 3 !== 0;
    const short = d % 5 === 0;
    const entry = 60_000;
    return {
      id: `bf_${d}`,
      account: "scalp",
      timeframe: "1h",
      target: null,
      fees: 1,
      pnlManual: null,
      checks: { "g:trigger": true, "g:stop": true },
      conviction: 3,
      followedPlan: true,
      emotion: "Ruhig",
      reason: d % 2 ? "Ausbruch über das Vortageshoch" : "",
      notes: "",
      chart: "",
      pnl: null,
      r: null,
      mistakes: [],
      side: short ? "short" : "long",
      status: "closed",
      date: local(at),
      exitDate: local(at + 3_600_000),
      pair: "BTC/USDT",
      entry,
      stop: d === 2 ? null : short ? entry + 600 : entry - 600,
      exit: short ? (win ? entry - 900 : entry + 600) : win ? entry + 900 : entry - 600,
      size: 5000,
      leverage: 3,
      setups: ["s_bo"],
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at + 3_600_000).toISOString(),
    };
  });
}

async function open(page: Page, empty = false): Promise<void> {
  const clock = await pinClock(page, WED);
  await seed(page, { clock: clock.now, empty, extra: empty ? {} : { "tj2-trades": journal(clock.now()) } });
  await openRoute(page, "/#berichte", "Berichte");
}

const view = (page: Page) => page.getByTestId("berichte-view");
const kind = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Art des Berichts" }).getByRole("radio", { name });
const focus = (page: Page, name: string) => page.getByTestId("report-focus").filter({ hasText: name });

test.describe("Berichte: Funktionsprüfung der ganzen Seite", () => {
  test.setTimeout(240_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "390×844 + Galaxy Tab 1692×978");
  });

  test("1 · jede Berichtsart und jeder Fokus öffnet mit seinen Karten; der Zeitraum blättert und hält an; alles auch per Tastatur", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await expect(view(page)).toHaveAttribute("data-key", "2026-W41");
    // every kind of report: the key follows, the hero names a period, no card throws
    for (const [name, k, key] of [
      ["Tag", "day", /^2026-10-\d{2}$/],
      ["Monat", "month", /^2026-(09|10)$/],
      ["Quartal", "quarter", /^2026-Q[34]$/],
      // the page opens on the newest FINISHED period – for the year that is the last one
      ["Jahr", "year", /^202[56]$/],
      ["Woche", "week", /^2026-W4[012]$/],
    ] as const) {
      await kind(page, name).click();
      await expect(view(page)).toHaveAttribute("data-kind", k);
      await expect(view(page)).toHaveAttribute("data-key", key);
      await expect(page.getByTestId("report-summary")).not.toBeEmpty();
      await expect(page.getByTestId("report-period-label")).not.toBeEmpty();
    }
    await expect(view(page)).toHaveAttribute("data-key", "2026-W41");

    // the period steps forward to the running week and stops there; back while older trades exist
    await page.getByTestId("report-next").click();
    await expect(view(page)).toHaveAttribute("data-key", "2026-W42");
    await expect(page.getByTestId("report-next")).toBeDisabled();
    await page.getByTestId("report-prev").click();
    await page.getByTestId("report-prev").click();
    await expect(view(page)).toHaveAttribute("data-key", "2026-W40");
    await expect(page.getByTestId("report-prev")).toBeDisabled();
    await page.getByTestId("report-newest").click();
    await expect(view(page)).toHaveAttribute("data-key", "2026-W41");

    // every focus: only its section (full width), "Alles" brings the whole report back
    for (const [name, id] of [
      ["Strategie", "report-strategy"],
      ["Risiko", "report-risk"],
      ["Psychologie", "report-psych"],
      ["Fehler", "report-mistakes"],
    ] as const) {
      await focus(page, name).click();
      await expect(focus(page, name)).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId("report-performance")).toHaveCount(0);
      await expect(page.getByTestId("journal-cards")).toHaveCount(0);
      await expect(page.getByTestId("ask-journal")).toHaveCount(0);
    }
    await focus(page, "Alles").click();
    for (const id of ["report-performance", "report-compare", "report-strategy", "report-risk", "report-psych", "report-mistakes", "report-goals", "week-review", "journal-cards", "ask-journal"]) {
      const card = page.getByTestId(id);
      await scrollUntilVisible(page, card);
      await expect(card, id).toBeVisible();
    }
    await page.evaluate(() => window.scrollTo(0, 0));

    // keyboard: the kind is a radio group (arrows move and choose), the period arrows and the focus chips are buttons
    await kind(page, "Woche").focus();
    await page.keyboard.press("ArrowRight");
    await expect(view(page)).toHaveAttribute("data-kind", "month");
    await expect(kind(page, "Monat")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(view(page)).toHaveAttribute("data-kind", "week");
    await page.getByTestId("report-next").focus();
    await page.keyboard.press("Enter");
    await expect(view(page)).toHaveAttribute("data-key", "2026-W42");
    await focus(page, "Risiko").focus();
    await page.keyboard.press("Space");
    await expect(focus(page, "Risiko")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("report-performance")).toHaveCount(0);
    // every control of the toolbar has a name a screen reader can say
    for (const name of ["Vorheriger Zeitraum", "Nächster Zeitraum"]) await expect(page.getByRole("button", { name })).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Fokus des Berichts" })).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Zeitraum" })).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("2 · Export: CSV und JSON tragen den Bericht auf dem Bildschirm; im Druck steht nur das helle Druckdokument", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await expect(view(page)).toHaveAttribute("data-key", "2026-W41");

    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-csv").click()]);
    expect(csv.suggestedFilename()).toMatch(/\.csv$/);
    const csvText = readFileSync(await csv.path(), "utf8");
    expect(csvText.split(/\r?\n/)[0]).toContain("Abschnitt");
    expect(csvText).toContain("2026-W41");
    expect(csvText).toContain("Performance");
    expect(csvText).toContain("Risiko");

    const [json] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-json").click()]);
    expect(json.suggestedFilename()).toMatch(/\.json$/);
    const parsed = JSON.parse(readFileSync(await json.path(), "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).toContain("2026-W41");

    // the focus limits the export: only "Risiko" – no performance block
    await focus(page, "Risiko").click();
    const [csv2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-csv").click()]);
    const csvRisk = readFileSync(await csv2.path(), "utf8");
    expect(csvRisk).toContain("Risiko");
    expect(csvRisk).not.toContain("Performance");
    await focus(page, "Alles").click();

    // print: under `@media print` the page is the print document alone – white paper, the app hidden (print.css)
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => {
      const w = window as unknown as { __print?: { rootDisplay: string; appHidden: boolean; bg: string; ink: string; text: string } };
      window.print = () => {
        const root = document.querySelector<HTMLElement>(".report-print-root");
        const others = Array.from(document.body.children).filter((el) => el !== root && !["SCRIPT", "STYLE", "LINK"].includes(el.tagName));
        w.__print = {
          rootDisplay: root ? getComputedStyle(root).display : "missing",
          appHidden: others.every((el) => getComputedStyle(el).display === "none"),
          bg: root ? getComputedStyle(root).backgroundColor : "",
          ink: root ? getComputedStyle(root).color : "",
          text: root?.textContent ?? "",
        };
      };
    });
    await page.getByTestId("report-export-pdf").click();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __print?: unknown }).__print)).toBe(true);
    const printed = await page.evaluate(() => (window as unknown as { __print: { rootDisplay: string; appHidden: boolean; bg: string; ink: string; text: string } }).__print);
    expect(printed.rootDisplay).toBe("block");
    expect(printed.appHidden, "the app itself is not printed").toBe(true);
    expect(printed.bg).toBe("rgb(255, 255, 255)");
    expect(printed.ink).toBe("rgb(17, 17, 17)");
    expect(printed.text).toContain("KW 41");
    await page.emulateMedia({ media: "screen" });
    await expect(page.locator(".report-print-root")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("tj-report-printing"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("3 · ohne Netz: Zeitraum wechseln, exportieren und das Journal fragen gehen weiter", async ({ page }) => {
    await open(page);
    const ask = page.getByTestId("ask-journal");
    await scrollUntilVisible(page, ask);
    await expect(ask).toHaveAttribute("data-phase", "idle", { timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.context().setOffline(true);

    await page.getByTestId("report-prev").click();
    await expect(view(page)).toHaveAttribute("data-key", "2026-W40");
    await expect(page.getByTestId("report-summary")).not.toBeEmpty();
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByTestId("report-export-csv").click()]);
    expect(readFileSync(await csv.path(), "utf8")).toContain("2026-W40");
    await kind(page, "Monat").click();
    await expect(view(page)).toHaveAttribute("data-kind", "month");
    await expect(page.getByTestId("report-summary")).not.toBeEmpty();

    await scrollUntilVisible(page, ask);
    await ask.getByTestId("ask-input").fill("Trades ohne Stopp");
    await ask.getByTestId("ask-input").press("Enter");
    await expect(ask.getByTestId("ask-card")).toHaveCount(3, { timeout: 5000 });
    await expect(ask.getByTestId("ask-card-value").first()).toHaveText("1 von 13 (8 %)");
    await page.context().setOffline(false);
  });

  test("4 · leeres Journal: ehrliche Leerzustände auf jeder Karte, nichts zu exportieren, nichts erfunden", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, true);
    await expect(page.getByTestId("report-summary")).toContainText("Keine abgeschlossenen Trades");
    await expect(page.getByTestId("report-archive")).toContainText("Noch kein abgeschlossener Zeitraum");
    await expect(page.getByTestId("report-export")).toContainText("nichts zu exportieren");
    for (const f of ["md", "csv", "json", "pdf"]) await expect(page.getByTestId(`report-export-${f}`)).toBeDisabled();
    for (const id of ["report-performance", "report-strategy", "report-risk", "journal-cards", "week-review"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // the question card says what is missing instead of offering questions that could only answer "nothing"
    const ask = page.getByTestId("ask-journal");
    await scrollUntilVisible(page, ask);
    await expect(ask.getByTestId("ask-none")).toContainText("Noch keine abgeschlossenen Trades");
    await expect(ask.getByTestId("ask-example")).toHaveCount(0);
    // a typed question is still answered honestly: nothing there, never a number
    await ask.getByTestId("ask-input").fill("Trades ohne Stopp");
    await ask.getByTestId("ask-input").press("Enter");
    await expect(ask).toHaveAttribute("data-phase", "done", { timeout: 5000 });
    await expect(ask.getByTestId("ask-card")).toHaveCount(0);
    // the running week: the day can be closed without a trade (checklist and review do not apply)
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("report-running").click();
    const day = page.getByTestId("day-close");
    await scrollUntilVisible(page, day);
    await expect(day.getByTestId("day-close-item-checklist")).toHaveAttribute("data-state", "na");
    await expect(day.getByTestId("day-close-item-review")).toHaveAttribute("data-state", "na");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("5 · Touch-Ziele ≥ 44 px, axe auf der ganzen Seite (dunkel), kein Querscrollen", async ({ page }, info) => {
    await open(page);
    // let every deferred card arrive
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h + 1500; y += 700) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(90);
    }
    await expect(page.getByTestId("ask-journal")).toHaveAttribute("data-phase", "idle", { timeout: 20_000 });
    if (hasTouch(info)) {
      // every button, link, field and switch of the page: a 44 px target (its own box, or the invisible `touch-hit` area around it)
      const small = await view(page).evaluate((root) => {
        const out: string[] = [];
        const els = root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="radio"], [role="switch"], [tabindex="0"]');
        for (const el of Array.from(els)) {
          if (el.closest('[data-testid="ledger-card"]')) continue; // the Transaktionsbuch has its own spec (ledger.spec.ts)
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || el.closest("[aria-hidden=true]")) continue;
          const after = getComputedStyle(el, "::after");
          const hit = after.content !== "none" && after.position === "absolute" ? { w: Math.max(r.width, parseFloat(after.width) || 0), h: Math.max(r.height, parseFloat(after.height) || 0) } : { w: r.width, h: r.height };
          // a radio of a segmented control shares the height of its group
          const group = el.getAttribute("role") === "radio" ? el.closest('[role="radiogroup"]')?.getBoundingClientRect() : null;
          const hh = Math.max(hit.h, group?.height ?? 0);
          if (hh < 43.5 || (hit.w < 43.5 && !group)) out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 24)}] ${Math.round(hit.w)}×${Math.round(hh)}`);
        }
        return out;
      });
      expect(small, "Ziele unter 44 px").toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    const res = await new AxeBuilder({ page }).include('[data-testid="berichte-view"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await expectNoHorizontalScroll(page);
  });
});
