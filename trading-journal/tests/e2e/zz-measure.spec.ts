import { expect, test } from "@playwright/test";
import { pinClock, seed, utcToday } from "./helpers";

test("measure", async ({ page }, info) => {
  test.setTimeout(90_000);
  const at = utcToday(6, 3);
  const clock = await pinClock(page, at);
  await seed(page, { synth: { ratios: "slide-account", anchor: at - 60_000 }, clock: clock.now });
  await page.goto("/#markt");
  const card = page.getByTestId("markt-trader-net");
  await expect(card).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId("trader-net-plot")).toHaveAttribute("data-drawn", "true", { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const b = (await card.boundingBox())!;
  // the cell around it (Reserve) and the whole card's chain
  const outer = await card.evaluate((el) => {
    let e: HTMLElement | null = el as HTMLElement;
    const out: number[] = [];
    for (let i = 0; i < 4 && e; i++, e = e.parentElement) out.push(Math.round(e.getBoundingClientRect().height * 10) / 10);
    return out;
  });
  console.log(`MEASURE ${info.project.name} width=${page.viewportSize()!.width} card=${b.height} chain=${JSON.stringify(outer)}`);
});
