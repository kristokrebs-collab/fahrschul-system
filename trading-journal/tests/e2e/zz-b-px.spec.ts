/**
 * TEMPORARY (not committed): pixel harness of the shell package – Übersicht and Cockpit, dark and light, with the frame (header, sidebar / bar, footer,
 * fades) hidden, so only the content area is compared between two builds.
 */
import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seed, waitForStableLayout } from "./helpers";

const DIR = process.env.PX_DIR ?? "/tmp/px/x";
const HIDE = `[data-layer="Dock"],[data-layer="Seitenleiste"],[data-layer="Unterer Verlauf"],header,footer,[data-toast-island]{visibility:hidden !important}`;

for (const theme of ["dark", "light"] as const) {
  for (const route of ["overview", "cockpit"] as const) {
    test(`px ${route} ${theme}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      mkdirSync(DIR, { recursive: true });
      await page.addInitScript((t) => localStorage.setItem("tj2-theme", JSON.stringify({ pref: t, accent: "signal" })), theme);
      await seed(page);
      await page.goto(`/#${route}`);
      await page.locator("main").first().waitFor();
      await waitForStableLayout(page);
      await page.addStyleTag({ content: HIDE });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${DIR}/${route}-${theme}-${info.project.name}.png`, fullPage: true, animations: "disabled", caret: "hide" });
    });
  }
}
