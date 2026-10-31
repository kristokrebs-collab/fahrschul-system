/**
 * Bedienelemente (Runde 10): die reichen Hover-Feinheiten gibt es nur auf Seiten mit `[data-rich]` – die Übersicht bleibt wie sie war –,
 * Chips bekommen ihr Häkchen, Suchfelder ihr „×“, Kopieren zeigt ✓ + „Kopiert“ und geht zurück, Zustände schieben nichts.
 * Desktop (Maus): Hover-Effekte. Mobil: dieselben Seiten ohne Hover-Effekte, aber mit allen Zuständen.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, seed, toast } from "./helpers";

async function open(page: Page, hash: string): Promise<void> {
  await seed(page);
  await page.goto(`/#${hash}`);
  await expect(page.locator(`[data-page="${hash}"][data-page-role="current"] h1`).first()).toBeAttached({ timeout: 30_000 });
}

/** The first visible large `Button` with a roll label (secondary, md: it also has the magnet) on the current page. */
const rollButton = (page: Page, hash: string) => page.locator(`[data-page="${hash}"][data-page-role="current"] button[data-fx~="roll"][data-fx~="magnet"]:not([disabled]):visible`).first();

test.describe("Hover-Feinheiten (nur Maus, nur reiche Seiten)", () => {
  test("reiche Seite: Glanzstreifen läuft, der Text rollt, der Button neigt sich zum Zeiger und kehrt zurück", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Maus");
    const errors = collectErrors(page);
    await open(page, "studio");
    const btn = rollButton(page, "studio");
    await btn.scrollIntoViewIfNeeded();
    const box = (await btn.boundingBox())!;
    // rest: nothing moved
    const rest = await btn.evaluate((el) => ({
      lean: getComputedStyle(el).translate,
      label: getComputedStyle(el.querySelector(".btn-roll > span") as Element).transform,
      shine: getComputedStyle(el.querySelector(".btn-fx") as Element, "::after").transform,
    }));
    expect(rest.lean).toBe("none");
    expect(rest.label).toBe("none");
    // the second line of the roll is a pseudo copy: the accessible name is the label once, not twice
    const label = (await btn.innerText()).trim();
    await expect(btn).toHaveAccessibleName(label);
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 4 });
    // the roll: the label has left its line (translateY(-100%)), the pseudo copy sits on it
    await expect
      .poll(() => btn.evaluate((el) => new DOMMatrix(getComputedStyle(el.querySelector(".btn-roll > span") as Element).transform).m42), { timeout: 4000 })
      .toBeLessThan(-8);
    await expect
      .poll(() => btn.evaluate((el) => new DOMMatrix(getComputedStyle(el.querySelector(".btn-fx") as Element, "::after").transform).m41), { timeout: 4000 })
      .toBeGreaterThan(20);
    // the magnet: a few px towards the pointer (right of centre), never more than 4
    await expect.poll(() => btn.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(" ")[0] ?? "0")), { timeout: 4000 }).toBeGreaterThan(0.5);
    const x = await btn.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(" ")[0] ?? "0"));
    expect(x).toBeLessThanOrEqual(4.01);
    // leaving: back to rest
    await page.mouse.move(box.x + box.width + 120, box.y - 60, { steps: 4 });
    await expect.poll(() => btn.evaluate((el) => getComputedStyle(el).translate), { timeout: 4000 }).toBe("none");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Cockpit (wie die Übersicht ohne [data-rich]): kein Rollen, kein Magnet, kein Glanzstreifen", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Maus");
    await open(page, "cockpit");
    const btn = rollButton(page, "cockpit");
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.scrollIntoViewIfNeeded();
    const box = (await btn.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 4 });
    await page.waitForTimeout(900);
    const now = await btn.evaluate((el) => ({
      lean: getComputedStyle(el).translate,
      magnet: el.hasAttribute("data-magnet"),
      roll: getComputedStyle(el.querySelector(".btn-roll > span") as Element).transform,
      rollClip: getComputedStyle(el.querySelector(".btn-roll") as Element).overflow,
      shine: getComputedStyle(el.querySelector(".btn-fx") as Element, "::after").content,
    }));
    expect(now.lean).toBe("none");
    expect(now.magnet).toBe(false);
    expect(now.roll).toBe("none");
    expect(now.rollClip).toBe("visible");
    expect(now.shine).toBe("none");
  });
});

test.describe("Chips, Suche, Kopieren", () => {
  test("Chip: das Häkchen-Abzeichen springt an, wenn ein Chip gewählt wird; nichts verschiebt sich", async ({ page }) => {
    await open(page, "risiko");
    const chip = page.locator('[data-page="risiko"][data-page-role="current"]').getByTestId("risk-chip-2");
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.scrollIntoViewIfNeeded();
    const before = await chip.evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, x: (el as HTMLElement).offsetLeft }));
    expect(await chip.evaluate((el) => getComputedStyle(el, "::before").scale)).toBe("0");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el, "::before").scale), { timeout: 3000 }).toBe("1");
    await expect.poll(() => chip.evaluate((el) => getComputedStyle(el, "::after").clipPath), { timeout: 3000 }).toMatch(/inset\(0(px)?\)|none/);
    const after = await chip.evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, x: (el as HTMLElement).offsetLeft }));
    expect(after).toEqual(before);
  });

  test("Suchfeld: das „×“ erscheint mit Text, leert und lässt den Fokus im Feld", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Tippen am Desktop");
    await open(page, "setups");
    const field = page.locator('[data-page="setups"][data-page-role="current"] input[type="search"]').first();
    await field.scrollIntoViewIfNeeded();
    const clear = field.locator("xpath=ancestor::*[@data-input][1]").locator("button.fx-clear");
    await expect(clear).toBeHidden();
    await field.fill("break");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect(clear).toBeHidden();
  });

  test("Kopieren: ✓ zeichnet sich, „Kopiert“ rollt herein und alles geht zurück; die Breite bleibt", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "labor");
    const copy = page.getByTestId("playbook-copy");
    await copy.scrollIntoViewIfNeeded();
    await expect(copy).toBeVisible();
    const w0 = await copy.evaluate((el) => (el as HTMLElement).offsetWidth);
    // the ✓ stays only ~1.2 s and a busy machine polls slowly: record what the button shows on every change instead of sampling
    await copy.evaluate((el) => {
      const seen: { s: string | null; sr: string | null | undefined; check: boolean; w: number }[] = [];
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      new MutationObserver(() =>
        seen.push({ s: el.getAttribute("data-status"), sr: el.querySelector(".sr-only")?.textContent, check: !!el.querySelector("svg.fx-check path"), w: (el as HTMLElement).offsetWidth }),
      ).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    });
    await copy.click();
    const done = () => page.evaluate(() => (window as unknown as { __seen: { s: string | null }[] }).__seen);
    await expect.poll(async () => { const s = await done(); return s.some((x) => x.s === "success") && s[s.length - 1]?.s === null; }, { timeout: 20_000 }).toBe(true);
    const seen = (await page.evaluate(() => (window as unknown as { __seen: { s: string | null; sr: string; check: boolean; w: number }[] }).__seen));
    const ok = seen.filter((x) => x.s === "success");
    expect(ok.some((x) => x.sr === "Kopiert" && x.check)).toBe(true);
    for (const x of seen) expect(Math.abs(x.w - w0), `Breite ${x.w} statt ${w0}`).toBeLessThan(0.6);
    await expect(copy).toHaveAccessibleName(/kopieren/i);
  });
});

interface UiHook {
  __tjUi: { getState(): { pushToast(t: { kind: string; title: string; milestone?: boolean }): number; dismissToast(id: number): void } };
}

test.describe("Toast: Meilenstein", () => {
  test("ein Routine-Toast streut nie, ein Meilenstein-Toast ein kleines Konfetti (mini), die Insel bleibt lesbar", async ({ page }) => {
    await open(page, "settings");
    // the puff lives ~0.9 s and the polling gets slow: a MutationObserver counts every mini burst that ever appeared
    await page.evaluate(() => {
      const w = window as unknown as { __mini: number; __bursts: number };
      w.__mini = 0;
      w.__bursts = 0;
      new MutationObserver(() => {
        if (document.querySelector('[data-celebrate] [data-kind="mini"]')) w.__mini++;
        if (document.querySelector("[data-celebrate] [data-burst]")) w.__bursts++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const counts = () => page.evaluate(() => ({ mini: (window as unknown as { __mini: number }).__mini, bursts: (window as unknown as { __bursts: number }).__bursts }));
    const id = await page.evaluate(() => (window as unknown as UiHook).__tjUi.getState().pushToast({ kind: "success", title: "Routine gespeichert" }));
    await expect(toast(page).getByText("Routine gespeichert")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await counts()).toEqual({ mini: 0, bursts: 0 });
    await page.evaluate((i) => (window as unknown as UiHook).__tjUi.getState().dismissToast(i), id);
    await page.evaluate(() => (window as unknown as UiHook).__tjUi.getState().pushToast({ kind: "success", title: "Erstes Ziel geschafft", milestone: true }));
    await expect(toast(page).getByText("Erstes Ziel geschafft")).toBeVisible();
    await expect.poll(async () => (await counts()).mini, { timeout: 8000 }).toBeGreaterThan(0);
  });

  test("gestaffelter Abgang: Tippen schließt den Toast, auch die Zeit schließt ihn – danach ruht die Insel (kein hängendes Symbol, keine Leiste)", async ({ page }) => {
    await open(page, "settings");
    const island = page.locator("[data-toast-island]");
    await page.evaluate(() => (window as unknown as UiHook).__tjUi.getState().pushToast({ kind: "success", title: "Eins gespeichert" }));
    await expect(toast(page).getByText("Eins gespeichert")).toBeVisible();
    // the symbol, the text and the remaining-time bar are all there while it shows
    await expect(island.locator("svg").first()).toBeVisible();
    await toast(page).getByRole("button").first().click();
    // the pointer must not rest on the next toast: a hovered toast waits (its countdown pauses)
    await page.mouse.move(2, 2);
    await expect(island).toHaveAttribute("data-idle", "", { timeout: 6000 });
    await expect(toast(page).getByText("Eins gespeichert")).toHaveCount(0);
    await page.evaluate(() => (window as unknown as UiHook).__tjUi.getState().pushToast({ kind: "error", title: "Zwei fehlgeschlagen" }));
    await expect(toast(page).getByText("Zwei fehlgeschlagen")).toBeVisible();
    await expect(island).toHaveAttribute("data-idle", "", { timeout: 9000 });
  });

  test("Reduced Motion: auch ein Meilenstein-Toast streut nichts", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "settings");
    await page.evaluate(() => {
      const w = window as unknown as { __bursts: number };
      w.__bursts = 0;
      new MutationObserver(() => {
        if (document.querySelector("[data-celebrate] [data-burst]")) w.__bursts++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.evaluate(() => (window as unknown as UiHook).__tjUi.getState().pushToast({ kind: "success", title: "Erstes Ziel geschafft", milestone: true }));
    await expect(toast(page).getByText("Erstes Ziel geschafft")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __bursts: number }).__bursts)).toBe(0);
  });
});
