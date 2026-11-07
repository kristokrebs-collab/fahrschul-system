import { test } from "@playwright/test";
import { seed } from "./helpers";

test("panel attrs", async ({ page }) => {
  await seed(page);
  await page.goto("/#trades");
  const aside = page.locator('[data-layer="Seitenleiste"]');
  await page.mouse.move(30, 300);
  await aside.getByRole("combobox").fill("einst");
  await aside.getByRole("option").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  console.log(await page.locator(".sf-panel").evaluate((el) => `${el.outerHTML.slice(0, 200)} | scroll ${el.scrollHeight}/${el.clientHeight} tab=${el.getAttribute("tabindex")}`));
});
