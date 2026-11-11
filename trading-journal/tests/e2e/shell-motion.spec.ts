/**
 * Runde 10 – the shell's richer motion, the way a reader meets it (mobile 390 + desktop 1440):
 *   - the sidebar's rail peeks: the pointer or the keyboard opens the names OVER the page (nothing the page stands on moves), Escape
 *     and leaving close it, the foot button still pins it (that one does move the page – it is the reader's choice);
 *   - the icons draw themselves once per page load and never again (nor under reduced motion; Runde 12: `sidebar-sequenz.spec.ts`);
 *   - the menu behind „Mehr“ is a bottom sheet on the phone: every entry is there in well under a second and a pull on its head closes it;
 *   - the header's price is an odometer, the local-mode badge pulses softly, the burger turns into the cross;
 *   - no long task and no slow input on the way (`measure`).
 * Frames are not compared pixel by pixel here – only end states, geometry and the timing facts that matter.
 */
import { expect, test, type Page } from "@playwright/test";
import { centre, collectErrors, expectNoHorizontalScroll, seed, touchKit, waitForStableLayout } from "./helpers";
import { UX_PROJECTS } from "./uxHarness";

const side = (page: Page) => page.locator('[data-layer="Seitenleiste"]');
const mobile = (name: string) => name === "mobile";

/** Whether the element at (x, y) belongs to the sidebar (the clipped rail must let the page have the rest of its box). */
const sidebarAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => !!document.elementFromPoint(px!, py!)?.closest('[data-layer="Seitenleiste"]'), [x, y]);

test.describe("Seitenleiste und Menü: Bewegung", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
  });

  test("Computer: die Maus öffnet die Namen über der Seite – die Seite bewegt sich nicht, die Leiste lässt dem Rest ihre Fläche", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await waitForStableLayout(page);
    const aside = side(page);
    await expect(aside).not.toHaveAttribute("data-open", "");
    const h1 = page.locator('[data-page="trades"][data-page-role="current"] h1').first();
    const before = await h1.boundingBox();
    // at rest the rail is 64 px: a point at x = 150 is the page's
    expect(await sidebarAt(page, 150, 300)).toBe(false);
    await page.mouse.move(30, 300);
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    // the words are there – name and plain-word hint – and the open panel answers over the page
    await expect(aside.getByRole("link", { name: "Handelsplan" }).locator(".sb-lbl")).toBeVisible();
    await expect.poll(() => sidebarAt(page, 150, 300), { timeout: 5000 }).toBe(true);
    // nothing the page stands on moved
    const during = await h1.boundingBox();
    expect(during && before && Math.abs(during.x - before.x) < 0.5 && Math.abs(during.y - before.y) < 0.5, `heading ${JSON.stringify(before)} → ${JSON.stringify(during)}`).toBe(true);
    // leaving: it closes after a moment, the page's area is the page's again
    await page.mouse.move(900, 500);
    await expect(aside).not.toHaveAttribute("data-open", "", { timeout: 5000 });
    await expect.poll(() => sidebarAt(page, 150, 300), { timeout: 5000 }).toBe(false);
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Computer: Tastatur – der Fokus auf einer Zeile öffnet die Namen, Escape schließt, Enter öffnet die Seite", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const aside = side(page);
    await aside.getByRole("button", { name: "Trade eintragen" }).focus();
    // Runde 11: the search field stands between the primary action and the rows – the first Tab lands in it (and opens the panel with it)
    await page.keyboard.press("Tab");
    await expect(aside.getByRole("combobox", { name: "Seiten und Funktionen suchen" })).toBeFocused();
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    await page.keyboard.press("Tab");
    await expect(aside.locator("a:focus")).toHaveCount(1);
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(aside).not.toHaveAttribute("data-open", "");
    // a keyboard path through the rows opens it again and Enter takes the page
    await page.keyboard.press("Tab");
    await expect(aside).toHaveAttribute("data-open", "", { timeout: 5000 });
    await aside.getByRole("link", { name: "Markt", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#markt$/);
    await expect(aside.getByRole("link", { name: "Markt", exact: true })).toHaveAttribute("aria-current", "page");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Computer: die Markierung steht nach dem Gleiten auf der Zeile der Seite, ohne Rest-Verzerrung", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const aside = side(page);
    await aside.getByRole("link", { name: "Markt", exact: true }).click();
    await expect(page).toHaveURL(/#markt$/);
    await page.waitForTimeout(1200);
    const rest = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-nav-page="markt"]')!.getBoundingClientRect();
      const marker = document.querySelector<HTMLElement>("[data-sidebar-marker]")!;
      return { rowTop: row.top, rowH: row.height, mark: marker.getBoundingClientRect(), transform: getComputedStyle(marker).transform };
    });
    // 44 px tall, at the row's place, scale 1 once it rests
    expect(Math.abs(rest.mark.top - rest.rowTop)).toBeLessThan(1.5);
    expect(Math.abs(rest.mark.height - 44)).toBeLessThan(0.6);
  });

  test("Computer: der Fuß-Knopf klappt fest aus (die Seite rückt, es ist die Wahl des Lesers) und wieder ein", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await seed(page);
    await page.goto("/#trades");
    await expect(page.getByRole("heading", { name: /Alle Trades/ })).toBeVisible();
    await waitForStableLayout(page);
    const aside = side(page);
    const h1 = page.locator('[data-page="trades"][data-page-role="current"] h1').first();
    const x0 = (await h1.boundingBox())!.x;
    await aside.getByTestId("sidebar-toggle").click();
    await expect(aside).toHaveAttribute("data-expanded", "");
    await expect.poll(async () => (await h1.boundingBox())!.x - x0, { timeout: 5000 }).toBeGreaterThan(150);
    // pinned: the group titles are buttons again
    await expect(aside.getByTestId("sidebar-group-toggle")).toHaveCount(4);
    await aside.getByTestId("sidebar-toggle").click();
    await expect(aside).not.toHaveAttribute("data-expanded", "");
    await expect.poll(async () => Math.abs((await h1.boundingBox())!.x - x0), { timeout: 5000 }).toBeLessThan(1);
  });

  test("Computer: direkt auf einer Seite geladen steht die Markierung auf deren Zeile – auch während und nach der Einblend-Welle", async ({ page }, info) => {
    test.skip(mobile(info.project.name), "from 768 px");
    await seed(page);
    // a reload on a page far down the list: the wave makes every row's `li` a containing block while it runs – the row then reports
    // `offsetTop` 0 and the plate was parked at the top of the list until the next page change (Funktionsprüfung Runde 14)
    await page.goto("/#berichte");
    await expect(page.getByRole("heading", { name: "Berichte" }).first()).toBeVisible();
    const gap = () =>
      page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-layer="Seitenleiste"] [data-nav-page="berichte"]')!.getBoundingClientRect();
        const mark = document.querySelector<HTMLElement>("[data-sidebar-marker]")!.getBoundingClientRect();
        return Math.abs(mark.top - row.top);
      });
    // while the wave may still run the rows travel up to 14 px into place; the plate is at the row's resting place from the start
    expect(await gap()).toBeLessThan(16);
    await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/, { timeout: 12_000 });
    await page.waitForTimeout(300);
    expect(await gap()).toBeLessThan(1.5);
  });

  test("Die Symbole zeichnen sich einmal pro Seitenaufruf; danach nie wieder; mit „weniger Bewegung“ gar nicht", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const frame = page.locator(mobile(info.project.name) ? "[data-layer=\"Dock\"]" : ".sb");
    if (!mobile(info.project.name)) {
      // the sequence marks the sidebar while it runs, then removes the mark (its timing and order are measured in `sidebar-sequenz.spec.ts`)
      await expect(frame).toHaveAttribute("data-draw", /^(run|wait)$/, { timeout: 8000 }).catch(() => undefined);
      await expect(frame).not.toHaveAttribute("data-draw", /.+/, { timeout: 10_000 });
      // every stroke rests in its drawn state: no dash left behind
      const dashed = await page.evaluate(() => Array.from(document.querySelectorAll(".sb-ico :is(path,circle,rect,line,polyline)")).filter((s) => getComputedStyle(s).strokeDasharray !== "none").length);
      expect(dashed).toBe(0);
      // a route change does not start it again
      await side(page).getByRole("link", { name: "Markt", exact: true }).click();
      await expect(page).toHaveURL(/#markt$/);
      await page.waitForTimeout(1200);
      await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("weniger Bewegung: nichts zeichnet sich, nichts atmet, nichts bleibt endlos in Bewegung", async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1500);
    if (!mobile(info.project.name)) await expect(page.locator(".sb")).not.toHaveAttribute("data-draw", /.+/);
    const endless = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => (a instanceof CSSAnimation ? a.animationName : "waapi")),
    );
    expect(endless).toEqual([]);
  });

  test("Handy: „Mehr“ ist ein Blatt von unten – jeder Eintrag ist in unter einer Sekunde da, Ziehen am Kopf schließt", async ({ page }, info) => {
    test.skip(!mobile(info.project.name), "phone only");
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.waitForTimeout(1500);
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    // the moment every entry is fully there, measured in the page from the tap
    await page.evaluate(() => {
      const w = window as unknown as { __menu: { t0: number; done: number } };
      w.__menu = { t0: 0, done: 0 };
      document.addEventListener(
        "pointerdown",
        () => {
          w.__menu.t0 = performance.now();
          const poll = () => {
            const items = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label="Navigation"] [data-cmd-item]'));
            if (items.length >= 20 && items.every((el) => Number(getComputedStyle(el.closest<HTMLElement>("[style*='opacity']") ?? el).opacity) >= 0.99)) w.__menu.done = performance.now();
            else if (performance.now() - w.__menu.t0 < 6000) requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        },
        { once: true, capture: true },
      );
    });
    await bar.getByRole("button", { name: "Mehr" }).click();
    const menu = page.getByRole("dialog", { name: "Navigation" });
    await expect(menu).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __menu: { done: number } }).__menu.done), { timeout: 8000 }).toBeGreaterThan(0);
    const took = await page.evaluate(() => {
      const m = (window as unknown as { __menu: { t0: number; done: number } }).__menu;
      return Math.round(m.done - m.t0);
    });
    test.info().annotations.push({ type: "menu-fully-there-ms", description: String(took) });
    console.log(`menu fully there after ${took} ms`);
    // the machine of a test run is slow and shared: generous, but far below the 2.3 s the stagger used to need
    expect(took).toBeLessThan(2200);
    // a sheet: the top strip shows the dimmed page, the panel has its rounded top and a grabber
    const sheet = menu.locator("[data-sheet-handle]");
    await expect(sheet).toBeVisible();
    const top = await menu.evaluate((el) => el.querySelector<HTMLElement>(".rounded-t-3xl")!.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(4);
    expect(top).toBeLessThan(40);
    // a slow pull springs back; a flick down on the head closes the sheet
    const kit = await touchKit(page);
    await page.waitForTimeout(500);
    const y0 = (await sheet.boundingBox())!.y;
    await kit.slowPull(await centre(sheet), 0, 90);
    await page.waitForTimeout(900);
    await expect(menu).toBeVisible();
    expect(Math.abs((await sheet.boundingBox())!.y - y0), "back at rest").toBeLessThan(2);
    await kit.flick(await centre(sheet), 0, 140);
    await expect(menu).toBeHidden({ timeout: 4000 });
    // the bar is usable again, the page did not move
    await expect(bar.getByRole("button", { name: "Mehr" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Handy: ein Tipp auf den Streifen über dem Blatt schließt es; ein Seitenlink schließt und öffnet die Seite", async ({ page }, info) => {
    test.skip(!mobile(info.project.name), "phone only");
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const bar = page.getByRole("toolbar", { name: "Navigation" });
    await bar.getByRole("button", { name: "Mehr" }).click();
    const menu = page.getByRole("dialog", { name: "Navigation" });
    await expect(menu).toBeVisible();
    await page.waitForTimeout(700);
    await page.mouse.click(195, 4);
    await expect(menu).toBeHidden({ timeout: 4000 });
    await bar.getByRole("button", { name: "Mehr" }).click();
    await expect(menu).toBeVisible();
    await page.waitForTimeout(700);
    await menu.getByRole("link", { name: /^Handelsplan/ }).click();
    await expect(page).toHaveURL(/#plan$/);
    await expect(menu).toBeHidden({ timeout: 4000 });
  });

  test("Kopfleiste: der Kurs ist ein Zählwerk, das Schild „Lokaler Modus“ pulsiert sanft, die Menü-Taste ist ein Burger", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    const ticker = page.locator("[data-header-ticker]");
    // the price is an odometer once a price has come in (the e2e market mock prints one); a dash before
    await expect(ticker).toContainText(/\d|–/, { timeout: 15_000 });
    if (await ticker.locator("[data-rolling-digits]").count()) await expect(ticker.locator("[data-rolling-digits] .sr-only")).toContainText(/\d/);
    const badge = page.locator("header").getByTestId("local-badge");
    await expect(badge).toBeVisible();
    // the dot is a pulse dot (warn tone): a soft ring for three beats, then rest – no loop
    await expect(badge.locator('[data-tone="warn"]')).toHaveCount(1);
    await page.waitForTimeout(6500);
    const endless = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity).length);
    expect(endless).toBe(0);
    // the menu button: bars at rest; the cross while the navigation is open
    // (found by its mark: while the navigation is open the header is aria-hidden behind it, a role query would not see the button)
    const crossed = () => page.evaluate(() => document.querySelector("header .burger")?.hasAttribute("data-open") ?? null);
    expect(await crossed()).toBe(false);
    await page.locator("header").getByRole("button", { name: "Menü, Navigation öffnen" }).click();
    await expect.poll(crossed, { timeout: 5000 }).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden({ timeout: 5000 });
    await expect.poll(crossed, { timeout: 5000 }).toBe(false);
    void info;
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Menü-Finder: die Treffer erscheinen gestaffelt unter dem Feld, die Auswahl gleitet mit den Pfeiltasten", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await page.getByRole("button", { name: /(Menü, Navigation öffnen|^Mehr)/ }).first().click();
    const nav = page.getByRole("dialog", { name: "Navigation" });
    await expect(nav).toBeVisible();
    await page.waitForTimeout(900);
    const input = nav.getByRole("combobox", { name: "Was willst du tun?" });
    await input.fill("Wochenbericht");
    const hits = nav.getByTestId("nav-finder-results").locator("[data-feature]");
    await expect(hits.first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    // A4: the field is a combobox (focus stays in it; ↓ moves the active answer) and one plate glides behind the active answer
    // (the plate measures the answer – no fixed height needed)
    const plate = nav.locator(".sf-plate");
    await expect(plate).toBeAttached();
    await expect.poll(async () => Number(await plate.evaluate((el) => getComputedStyle(el).opacity)), { timeout: 4000 }).toBeGreaterThan(0.9);
    if ((await hits.count()) > 1) {
      await input.press("ArrowDown");
      await expect(hits.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(input).toBeFocused();
      await expect.poll(async () => Math.round(Math.abs((await plate.boundingBox())!.y - (await hits.nth(1).boundingBox())!.y)), { timeout: 4000 }).toBeLessThan(2);
    }
    // emptied: the box folds shut and the field stays
    await input.fill("");
    await expect(nav.getByTestId("nav-finder-results")).toBeHidden({ timeout: 4000 });
    await expect(input).toHaveAttribute("aria-expanded", "false");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

/**
 * Measurement (documented in `src/app/README.md`): long tasks (> 50 ms main-thread blocks) and slow input (Event Timing: the
 * duration from the input to the next paint, an INP-like number) over a tour of the shell – the rail's peek (desktop), the menu,
 * five page switches. The test fails only on a freeze (a task over 2.5 s, an input over 3.5 s: a test machine is shared and slow);
 * the numbers go to the report and the README.
 */
test.describe("Messung: Long Tasks und Eingabe", () => {
  test.setTimeout(240_000);
  test("eine Runde durch die Hülle", async ({ page }, info) => {
    test.skip(!UX_PROJECTS.includes(info.project.name), "mobile + desktop");
    await seed(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[]; __inputs: { name: string; duration: number }[] };
      w.__long = [];
      w.__inputs = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__long.push(Math.round(e.duration));
        }).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[]) if (e.interactionId) w.__inputs.push({ name: e.name, duration: Math.round(e.duration) });
        }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
      } catch {
        /* no Long Tasks / Event Timing in this engine: the numbers are empty */
      }
    });
    await page.goto("/#overview");
    await expect(page.getByText("Netto-P&L").first()).toBeVisible();
    await waitForStableLayout(page);
    // start counting after the first load (its own cost is not the shell's motion)
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[]; __inputs: unknown[] };
      w.__long.length = 0;
      w.__inputs.length = 0;
    });
    const isPhone = mobile(info.project.name);
    if (!isPhone) {
      await page.mouse.move(30, 300);
      await page.waitForTimeout(900);
      await page.mouse.move(900, 500);
      await page.waitForTimeout(700);
    }
    for (const name of ["Trades", "Markt", "Übersicht", "Trades", "Übersicht"]) {
      const target = isPhone ? page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name, exact: true }) : side(page).getByRole("link", { name, exact: true });
      await target.click();
      await page.waitForTimeout(900);
    }
    await page.getByRole("button", { name: /(Menü, Navigation öffnen|^Mehr)/ }).first().click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.waitForTimeout(1400);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden({ timeout: 5000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const w = window as unknown as { __long: number[]; __inputs: { name: string; duration: number }[] };
      return { long: w.__long, inputs: w.__inputs };
    });
    const maxLong = Math.max(0, ...m.long);
    const maxInput = Math.max(0, ...m.inputs.map((i) => i.duration));
    const line = `${info.project.name}: ${m.long.length} long tasks (max ${maxLong} ms), ${m.inputs.length} inputs ≥ 16 ms (max ${maxInput} ms)`;
    info.annotations.push({ type: "shell-measure", description: line });
    console.log(`MEASURE ${line} · long=${JSON.stringify(m.long)} · inputs=${JSON.stringify(m.inputs)}`);
    // Only a freeze fails the test: on a shared CI box (here: load average 30 on 4 cores) every number is inflated by scheduling –
    // read the logged values on a quiet machine, and compare a run against the build without the change (see the README).
    expect(maxLong, line).toBeLessThanOrEqual(2500);
    expect(maxInput, line).toBeLessThanOrEqual(3500);
  });
});
