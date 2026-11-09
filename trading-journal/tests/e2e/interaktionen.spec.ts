/**
 * A5 "Interaktionen" (R11) end to end, phone + desktop: Papierkorb (a removed screenshot comes back with its original bytes),
 * Radial Share (trade detail: keyboard, edge clamp, hit boxes), Speicher-Morph (✓ only after the store answered, an honest failure
 * with „Erneut versuchen“), Login/Signup-Morph (one form, the card's height eases) and Thinking Orbs (the frame loop stops for a hidden
 * tab). The login test runs on the cloud edition against the Supabase mock (`PW_CLOUD_BASE_URL`).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, openRoute, openTradeEditor, seed } from "./helpers";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { mockSupabase } from "./mocks/supabase";
import { bandSettled, expectNotInert, gateToSignIn, openGated } from "./cloudSignIn";
import { noisePng, sha256 } from "./shotFixtures";

const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function only(info: TestInfo): void {
  test.skip(!PROJECTS.includes(info.project.name), "Interaktionen run on mobile + desktop");
}

function onDisk(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "tj-int-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

/** SHA-256 of the blob under `key` in the page's IndexedDB `tj2-shots`. */
async function storedHash(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open("tj2-shots");
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const conn = req.result;
          if (!conn.objectStoreNames.contains("blobs")) return resolve(null);
          const get = conn.transaction("blobs").objectStore("blobs").get(k);
          get.onsuccess = async () => {
            conn.close();
            const blob = get.result as Blob | undefined;
            if (!blob) return resolve(null);
            const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
            resolve([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""));
          };
          get.onerror = () => resolve(null);
        };
      }),
    key,
  );
}

async function axeClean(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(900);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), `${what}: axe`).toEqual([]);
}

/* ------------------------------------------------------------------------------------------------------ Papierkorb */

test.describe("Papierkorb", () => {
  test.setTimeout(120_000);

  test("Screenshot entfernen → Pille mit Rückgängig → dieselben Original-Bytes sind wieder da", async ({ page }, info) => {
    only(info);
    const errors = collectErrors(page);
    await seed(page, {});
    await page.goto("/#overview");
    const png = noisePng(640, 480, 5);
    const editor = await openTradeEditor(page);
    await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
    await editor.getByTestId("shots-drop").locator('input[type="file"]').setInputFiles(onDisk("chart.png", png));
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("trash-pill")).toHaveCount(0);

    await editor.getByRole("button", { name: "Screenshot 1 entfernen" }).click();
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveCount(0);
    const pill = page.getByTestId("trash-pill");
    await expect(pill).toBeVisible();
    await expect(pill.getByTestId("trash-text")).toHaveText("Screenshot 1 entfernt");
    // the screen reader gets a sentence of its own
    await expect(page.getByTestId("trash-live")).toContainText("Screenshot 1 entfernt");

    // the bytes are still on the device while the window is open (pinned against the sweep)
    const key = await page.evaluate(() => new Promise<string | null>((r) => {
      const q = indexedDB.open("tj2-shots");
      q.onsuccess = () => {
        const c = q.result;
        const k = c.transaction("blobs").objectStore("blobs").getAllKeys();
        k.onsuccess = () => {
          c.close();
          r((k.result[0] as string | undefined) ?? null);
        };
      };
    }));
    expect(key).toBeTruthy();
    expect(await storedHash(page, key!)).toBe(sha256(png));

    await pill.getByTestId("trash-undo").click();
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible();
    await expect(page.getByTestId("trash-pill")).toHaveCount(0);
    await expect(page.getByTestId("trash-live")).toContainText("wiederhergestellt");
    expect(await storedHash(page, key!)).toBe(sha256(png));
    expect(errors).toEqual([]);
  });

  test("nach sechs Sekunden ist es endgültig weg; die Pille hat eine Touch-Fläche von 44 px und besteht axe", async ({ page }, info) => {
    only(info);
    await seed(page, {});
    await page.goto("/#overview");
    const editor = await openTradeEditor(page);
    await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
    await editor.getByTestId("shots-drop").locator('input[type="file"]').setInputFiles(onDisk("a.png", noisePng(320, 240, 2)));
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Screenshot 1 entfernen" }).click();
    const pill = page.getByTestId("trash-pill");
    await expect(pill).toBeVisible();
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: "[data-trash-host]" });
    expect(misses, JSON.stringify(misses)).toEqual([]);
    await axeClean(page, "[data-trash-host]", "Papierkorb-Pille");
    await expect(pill).toHaveCount(0, { timeout: 12_000 });
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toHaveCount(0);
  });

  test("Hover hält die Uhr an, bis der Zeiger weggeht", async ({ page }, info) => {
    only(info);
    test.skip(info.project.name !== "desktop", "hover needs a mouse");
    await seed(page, {});
    await page.goto("/#overview");
    const editor = await openTradeEditor(page);
    await editor.getByTestId("shots-drop").scrollIntoViewIfNeeded();
    await editor.getByTestId("shots-drop").locator('input[type="file"]').setInputFiles(onDisk("a.png", noisePng(320, 240, 4)));
    await expect(editor.getByRole("button", { name: "Screenshot 1 öffnen" })).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Screenshot 1 entfernen" }).click();
    const pill = page.getByTestId("trash-pill");
    await pill.hover();
    await page.waitForTimeout(7500);
    await expect(pill).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(pill).toHaveCount(0, { timeout: 9000 });
  });
});

/* ------------------------------------------------------------------------------------------------------ Radial Share */

async function openFirstTrade(page: Page, info: TestInfo): Promise<void> {
  await seed(page, {});
  await openRoute(page, "/#trades", "Trades");
  const row = info.project.name === "mobile" ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
  await row.click();
  await expect(page.getByRole("dialog", { name: "Trade-Details" })).toBeVisible();
}

test.describe("Radial Share", () => {
  test.setTimeout(90_000);

  test("Trade-Detail: Fächer mit Kopieren, Bild, Link; Pfeile, Esc schließt nur den Fächer", async ({ page }, info) => {
    only(info);
    const errors = collectErrors(page);
    await openFirstTrade(page, info);
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    const trigger = detail.getByTestId("share-button");
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    const names = await items.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names.slice(0, 3)).toEqual(["Kopieren", "Bild", "Link"]);
    await expect(items.first()).toBeFocused();

    // every target is fully on screen and at least 44 px
    const vp = page.viewportSize()!;
    for (const b of await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(vp.width);
      expect(b.bottom).toBeLessThanOrEqual(vp.height);
    }
    // the pointer of the click rests somewhere over the fan: take it away, so only the keyboard decides
    await page.mouse.move(1, 1);
    await page.keyboard.press("Home");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(items.nth(1)).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-label", "Teilen: Bild");
    await expect(page.getByTestId("radial-ring")).toBeVisible();
    await axeClean(page, "[data-radial-share]", "Teilen-Fächer");
    const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: "[data-radial-share]" });
    expect(misses, JSON.stringify(misses)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // the dialog under it is still open
    await expect(detail).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Kopieren legt die geschwärzte Kurzfassung in die Zwischenablage, Link öffnet das Teilen-Blatt", async ({ page, context }, info) => {
    only(info);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await openFirstTrade(page, info);
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await detail.getByTestId("share-button").scrollIntoViewIfNeeded();
    await detail.getByTestId("share-button").click();
    await page.getByTestId("radial-copy").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator('[role="status"][aria-live="polite"]').getByText("Kurzfassung kopiert")).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (text !== null) expect(text).toMatch(/·/);
    // no money in what was copied
    if (text !== null) expect(text).not.toMatch(/USDT\s*[-+]?\d|\$|€/);

    await detail.getByTestId("share-button").click();
    await page.getByTestId("radial-link").click();
    await expect(page.getByRole("dialog", { name: "Teilen" })).toBeVisible();
  });

  test("am rechten Rand bleibt jeder Punkt im Bild (Klemmung)", async ({ page }, info) => {
    only(info);
    await openFirstTrade(page, info);
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    const trigger = detail.getByTestId("share-button");
    await trigger.scrollIntoViewIfNeeded();
    // force the trigger to the screen's right edge, wherever the dialog puts it
    await trigger.evaluate((el) => {
      (el as HTMLElement).style.position = "fixed";
      (el as HTMLElement).style.right = "4px";
      (el as HTMLElement).style.top = "120px";
    });
    await trigger.click();
    const vp = page.viewportSize()!;
    const boxes = await page.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(vp.width);
      expect(b.top).toBeGreaterThanOrEqual(0);
    }
  });

  test("Bericht: Teilen-Fächer mit Kopieren, Datei, PDF", async ({ page }, info) => {
    only(info);
    await seed(page, {});
    await openRoute(page, "/#berichte", "Berichte");
    const trigger = page.getByTestId("report-share");
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "Kopieren" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Datei" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Runde 12: Glas-Chips, die Beschriftung „Kanal wählen“ und das Kreuz im Auslöser; Pfeiltasten wechseln die Beschriftung, nichts liegt übereinander", async ({ page }, info) => {
    only(info);
    const errors = collectErrors(page);
    await seed(page, {});
    await openRoute(page, "/#berichte", "Berichte");
    const trigger = page.getByTestId("report-share");
    await trigger.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(trigger.locator("[data-radial-icon]")).toHaveAttribute("data-radial-icon", "share");
    await trigger.click();
    const copy = page.getByRole("menuitem", { name: "Kopieren" });
    await expect(copy).toBeVisible();
    // the symbol turned into the cross, the button kept its width
    await expect(trigger.locator("[data-radial-icon]")).toHaveAttribute("data-radial-icon", "close");
    // a glass chip: a blur over a translucent ink
    const glass = await copy.evaluate((el) => ({ blur: getComputedStyle(el).backdropFilter, bg: getComputedStyle(el).backgroundColor }));
    expect(glass.blur).toMatch(/blur/);
    expect(glass.bg).toMatch(/rgba?\(|color\(/);
    // the caption: first the prompt, then what the active target does
    const caption = page.getByTestId("radial-caption");
    await expect(caption).toHaveText("Kanal wählen");
    await page.mouse.move(1, 1);
    await page.keyboard.press("ArrowRight");
    await expect(caption).toHaveText("Markdown-Datei speichern");
    await expect(page.getByTestId("radial-ring")).toBeVisible();
    // it lies inside the screen, on the side away from the fan, and never over a chip or the trigger
    const vp = page.viewportSize()!;
    const cb = (await caption.locator("span").first().boundingBox())!;
    expect(cb.x).toBeGreaterThanOrEqual(0);
    expect(cb.x + cb.width).toBeLessThanOrEqual(vp.width);
    expect(cb.y).toBeGreaterThanOrEqual(0);
    expect(cb.y + cb.height).toBeLessThanOrEqual(vp.height);
    const tb = (await trigger.boundingBox())!;
    const hits = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(hits(cb, tb), "caption over the trigger").toBe(false);
    for (const box of await page.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }))) expect(hits(cb, box), "caption over a chip").toBe(false);
    // the caption takes no pointer: a press on it would go to the layer below (and close the fan), never to the caption itself
    await expect(caption).toHaveCSS("pointer-events", "none");
    await axeClean(page, "[data-radial-share]", "Teilen-Fächer mit Beschriftung");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(caption).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Bericht: der Streifen der Seitenabschnitte, der seinen Chip ins Bild schiebt, nimmt den Fächer nicht weg", async ({ page }, info) => {
    only(info);
    await seed(page, {});
    await openRoute(page, "/#berichte", "Berichte");
    const trigger = page.getByTestId("report-share");
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "Kopieren" })).toBeVisible();
    // the sticky strip slides the chip of the section in view a moment after the page scrolled: a scroll event of ITS own, which
    // leaves the trigger where it is (on a slow runner it lands while the fan is open)
    await page.evaluate(() => {
      const strip = document.querySelector('nav[aria-label="Inhalt dieser Seite"] ul')!;
      strip.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);
    await expect(page.getByRole("menuitem", { name: "Datei" })).toBeVisible();
    // a scroll that does move the trigger still closes it
    await page.evaluate(() => window.scrollBy({ top: 120, behavior: "instant" }));
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------------------------------------------ Speicher-Morph */

test.describe("Speicher-Morph", () => {
  test.setTimeout(90_000);

  test("Risiko: ✓ erst nach der Antwort des Speichers; ein abgelehnter Schreibvorgang zeigt Erneut versuchen und kein ✓", async ({ page }, info) => {
    only(info);
    const errors = collectErrors(page);
    await seed(page, {});
    await openRoute(page, "/#risiko", "Risiko");
    const st = page.getByTestId("risk-settings");
    await st.scrollIntoViewIfNeeded();
    await st.getByTestId("rs-week").fill("5");
    await st.getByTestId("rs-week").press("Enter");
    await expect(st.getByTestId("risk-settings-saved")).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}").risk?.maxLossWeekPct)).toBe(0.05);

    // the browser refuses the write: no ✓, an honest failure, the same save can be repeated
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      (window as unknown as { __realSet: typeof real }).__realSet = real;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === "tj2-settings") throw new DOMException("full", "QuotaExceededError");
        return real.call(this, k, v);
      };
    });
    await st.getByTestId("rs-week").fill("6");
    await st.getByTestId("rs-week").press("Enter");
    await expect(st.getByTestId("risk-settings-saved-failed")).toBeVisible();
    await expect(st.getByTestId("risk-settings-saved")).toHaveCount(0);
    await expect(st.getByText("Nicht gespeichert")).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}").risk?.maxLossWeekPct)).toBe(0.05);

    // storage works again: „Erneut versuchen“ saves, and only then comes the ✓
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as unknown as { __realSet: typeof Storage.prototype.setItem }).__realSet;
    });
    await st.getByTestId("risk-settings-saved-retry").click();
    await expect(st.getByTestId("risk-settings-saved")).toBeVisible();
    await axeClean(page, '[data-testid="risk-settings"]', "Risiko-Einstellungen mit Speicherstatus");
    expect(errors.filter((e) => !/QuotaExceeded|full/.test(e))).toEqual([]);
  });

  test("Einstellungen: ein abgelehnter Schreibvorgang lässt den Knopf auf „Erneut versuchen“ stehen", async ({ page }, info) => {
    only(info);
    await seed(page, {});
    await openRoute(page, "/#settings", "Einstellungen");
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      (window as unknown as { __realSet: typeof real }).__realSet = real;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === "tj2-settings") throw new DOMException("full", "QuotaExceededError");
        return real.call(this, k, v);
      };
    });
    await page.locator("#s-makro").fill("12345");
    const save = page.getByRole("button", { name: "Speichern", exact: true }).first();
    await save.click();
    await expect(page.getByRole("button", { name: "Erneut versuchen" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Gespeichert" })).toHaveCount(0);
    await page.evaluate(() => {
      Storage.prototype.setItem = (window as unknown as { __realSet: typeof Storage.prototype.setItem }).__realSet;
    });
    await page.getByRole("button", { name: "Erneut versuchen" }).first().click();
    await expect(page.getByRole("button", { name: "Gespeichert" }).first()).toBeVisible();
  });
});

/* ------------------------------------------------------------------------------------------------------ Login/Signup-Morph */

test.describe("Login/Signup-Morph", () => {
  test.setTimeout(90_000);

  // Paket V replaced the morphing sheet (tabs, height spring) with the landscape card of the reference recording: the band crosses
  // the card once and the card keeps its height. The band run itself (900 ms, curve, focus) is pinned in auth-b.spec.ts; here: every
  // frame of the switch, the password manager's pairs on both sides, a11y and a clean console.
  test("Anmelden ↔ Registrieren: die Karte behält in jedem Bild ihre Höhe, die Passwort-Manager-Paare stimmen auf beiden Seiten", async ({ page }, info) => {
    only(info);
    const errors = collectErrors(page);
    await mockSupabase(page);
    await seed(page, {});
    // Konto-Pflicht: the login is the entry gate in front of the Konto page
    await openGated(page, cloudUrl("konto"));
    const signin = await gateToSignIn(page);
    await expectNotInert(signin.getByLabel("E-Mail"));
    await expect(signin.getByLabel("E-Mail")).toHaveAttribute("autocomplete", "username");
    await expect(signin.getByLabel("Passwort", { exact: true })).toHaveAttribute("autocomplete", "current-password");

    // sample the card height every frame during the switch
    await page.evaluate(() => {
      const card = document.querySelector('[data-testid="auth-card"]')!;
      const w = window as unknown as { __h: number[]; __stop: boolean };
      w.__h = [];
      w.__stop = false;
      const tick = () => {
        w.__h.push(card.getBoundingClientRect().height);
        if (!w.__stop) requestAnimationFrame(tick);
      };
      tick();
    });
    await page.getByTestId("auth-to-signup").click();
    const signup = page.getByRole("dialog", { name: "Konto erstellen" });
    await expect(signup).toBeVisible({ timeout: 5_000 });
    await bandSettled(page, 5_000);
    const heights = await page.evaluate(() => {
      const w = window as unknown as { __h: number[]; __stop: boolean };
      w.__stop = true;
      return w.__h;
    });
    expect(heights.length, "frames sampled during the switch").toBeGreaterThan(5);
    const h0 = heights[0]!;
    for (let i = 1; i < heights.length; i++) expect(Math.abs(heights[i]! - h0), `frame ${i}: ${heights.map((h) => Math.round(h)).join(",")}`).toBeLessThan(1);
    await expect(signup.getByLabel("E-Mail")).toHaveAttribute("autocomplete", "email");
    await expect(signup.getByLabel("Passwort", { exact: true })).toHaveAttribute("autocomplete", "new-password");

    // back to Anmelden: the pair for the password manager is restored
    await signup.getByTestId("auth-to-signin").click();
    const again = page.getByRole("dialog", { name: "Anmelden" });
    await expect(again).toBeVisible({ timeout: 5_000 });
    await bandSettled(page, 5_000);
    await expect(again.getByLabel("Passwort", { exact: true })).toHaveAttribute("autocomplete", "current-password");
    await expectNoHorizontalScroll(page);
    await axeClean(page, '[role="dialog"]', "Anmelde-Karte");
    expect(errors).toEqual([]);
  });

  test("ein ungültiges Feld bekommt den Fokus und die Meldung am Feld", async ({ page }, info) => {
    only(info);
    await mockSupabase(page);
    await seed(page, {});
    // Konto-Pflicht: the login is the entry gate in front of the Konto page
    await openGated(page, cloudUrl("konto"));
    const sheet = await gateToSignIn(page);
    await expect(sheet.locator("[inert]")).toHaveCount(0);
    await sheet.getByLabel("E-Mail").fill("keine-mail");
    await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(sheet.getByLabel("E-Mail")).toBeFocused();
    await expect(sheet.getByLabel("E-Mail")).toHaveAttribute("aria-invalid", "true");
  });
});

/* ------------------------------------------------------------------------------------------------------ Thinking Orbs */

test.describe("Thinking Orbs", () => {
  test.setTimeout(150_000);

  test("Zeitmaschine: der Orb läuft während der Rechnung und hält bei verdecktem Tab an", async ({ page }, info) => {
    only(info);
    await seed(page, { boxes: true });
    // slow the page down so the run lasts long enough to look at the orb
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await openRoute(page, "/#labor", "Labor");
    await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
    await page.getByTestId("tm-entry").fill("82.900");
    await page.getByTestId("tm-stop").fill("80.500");
    await page.getByTestId("tm-target").fill("87.700");
    await page.getByRole("button", { name: /Weitere Einstellungen der Zeitmaschine/ }).click();
    await page.getByRole("radio", { name: "20 000" }).click();
    await page.getByTestId("tm-horizon").fill("400");
    await page.getByTestId("tm-load-start").click();
    const busy = page.getByTestId("tm-busy");
    await expect(busy.or(page.getByTestId("tm-card").and(page.locator('[data-status="done"]')))).toBeVisible({ timeout: 90_000 });
    test.skip(!(await busy.isVisible()), "the run finished before the orb could be inspected");
    await expect(busy.locator("canvas[data-orb-canvas]")).toBeVisible({ timeout: 10_000 });
    // one atomic script in the page (the run is short on a quiet machine): moves → hidden tab holds still → visible tab moves again
    const verdict = await page.evaluate(async () => {
      const canvas = () => document.querySelector<HTMLCanvasElement>('[data-testid="tm-busy"] canvas[data-orb-canvas]');
      const snap = () => canvas()?.toDataURL() ?? null;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const hide = (v: boolean) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => v });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      const a = snap();
      await wait(300);
      const b = snap();
      hide(true);
      await wait(120);
      const c = snap();
      await wait(450);
      const held = snap();
      hide(false);
      await wait(120);
      const d = snap();
      await wait(300);
      const e = snap();
      if ([a, b, c, held, d, e].some((x) => x === null)) return null;
      return { moves: a !== b, holds: c === held, resumes: d !== e };
    });
    test.skip(verdict === null, "the run finished before the orb could be inspected");
    expect(verdict).toEqual({ moves: true, holds: true, resumes: true });
  });

  test("reduzierte Bewegung: nur das stille Symbol, kein Canvas", async ({ page }, info) => {
    only(info);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed(page, { boxes: true });
    await openRoute(page, "/#labor", "Labor");
    await page.getByTestId("tm-section").scrollIntoViewIfNeeded();
    await page.getByTestId("tm-entry").fill("82.900");
    await page.getByTestId("tm-stop").fill("80.500");
    await page.getByTestId("tm-target").fill("87.700");
    await page.getByRole("button", { name: /Weitere Einstellungen der Zeitmaschine/ }).click();
    await page.getByRole("radio", { name: "20 000" }).click();
    await page.getByTestId("tm-horizon").fill("400");
    await page.getByTestId("tm-load-start").click();
    const busy = page.getByTestId("tm-busy");
    await expect(busy.or(page.getByTestId("tm-card").and(page.locator('[data-status="done"]')))).toBeVisible({ timeout: 90_000 });
    test.skip(!(await busy.isVisible()), "the run finished before the orb could be inspected");
    await expect(busy.locator("[data-orb-still]")).toBeVisible();
    await expect(busy.locator("canvas")).toHaveCount(0);
  });
});
