/** TEMPORARY (not committed): looks at the frame – rail, peek, pinned, search; bar. */
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seed, waitForStableLayout } from "./helpers";

const DIR = process.env.PX_DIR ?? "/tmp/px/shots";

for (const theme of ["dark", "light"] as const) {
  test(`desktop frame ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem("tj2-theme", JSON.stringify({ pref: t, accent: "signal" })), theme);
    await seed(page);
    await page.goto("/#trades");
    await page.locator("main").first().waitFor();
    await waitForStableLayout(page);
    await page.waitForTimeout(1500);
    const clip = { x: 0, y: 0, width: 520, height: 900 };
    await page.screenshot({ path: `${DIR}/rail-${theme}.png`, clip });
    await page.mouse.move(30, 300);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/peek-${theme}.png`, clip });
    await page.getByRole("combobox", { name: "Seiten und Funktionen suchen" }).fill("einst");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${DIR}/search-${theme}.png`, clip });
    await page.keyboard.press("Escape");
    await page.mouse.move(900, 500);
    await page.getByTestId("sidebar-toggle").click();
    await page.waitForTimeout(900);
    await page.mouse.move(900, 500);
    await page.screenshot({ path: `${DIR}/pinned-${theme}.png`, clip });
    await page.goto("/#settings");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/pinned-settings-${theme}.png`, clip });
  });

  test(`mobile frame ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile");
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem("tj2-theme", JSON.stringify({ pref: t, accent: "signal" })), theme);
    await seed(page);
    await page.goto("/#overview");
    await page.locator("main").first().waitFor();
    await waitForStableLayout(page);
    await page.waitForTimeout(1500);
    const clip = { x: 0, y: 704, width: 390, height: 140 };
    await page.screenshot({ path: `${DIR}/bar-overview-${theme}.png`, clip });
    await page.getByRole("toolbar", { name: "Navigation" }).getByRole("button", { name: "Markt" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/bar-markt-${theme}.png`, clip });
    await page.screenshot({ path: `${DIR}/full-markt-${theme}.png` });
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`funktionen ${theme}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });
    await page.addInitScript((t) => localStorage.setItem("tj2-theme", JSON.stringify({ pref: t, accent: "signal" })), theme);
    await seed(page);
    await page.goto("/#funktionen");
    await page.getByTestId("funktionen-view").waitFor();
    await waitForStableLayout(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/funktionen-${theme}-${info.project.name}.png` });
    await page.getByTestId("feature-search-input").fill("risiko");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${DIR}/funktionen-search-${theme}-${info.project.name}.png` });
  });
}
