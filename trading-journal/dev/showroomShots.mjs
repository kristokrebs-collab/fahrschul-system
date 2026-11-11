// Screenshots of the Showroom for docs/audit/img-showroom (desktop + mobile, small JPEGs). Needs `npm run build:showroom` served on port 4470:
//   npx vite preview --outDir dist-showroom --port 4470   and then   node dev/showroomShots.mjs
import { chromium, devices } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";

const exe = existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined;
const OUT = "docs/audit/img-showroom";
mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4470/";
const browser = await chromium.launch({ executablePath: exe });

async function run(kind) {
  const mobile = kind === "m";
  const ctx = await browser.newContext(mobile ? { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, locale: "de-DE", colorScheme: "dark", deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 }, locale: "de-DE", colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => sessionStorage.setItem("tj2-intro", "1"));
  const reopen = async () => {
    if (!(await page.getByTestId("sr-panel").isVisible())) await page.getByTestId("sr-open").click();
  };
  const shot = (name) => page.screenshot({ path: `${OUT}/${kind}-${name}.jpg`, type: "jpeg", quality: 58, animations: "disabled" });
  await page.goto(BASE);
  await page.getByTestId("sr-state").waitFor({ timeout: 30000 });
  await page.getByText("Sync · live").first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot("01-start-panel");

  await page.getByTestId("sr-jump-signin").click();
  await page.getByRole("dialog", { name: "Anmelden" }).waitFor();
  await page.waitForTimeout(1800);
  await shot("02-anmelden-klinge");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await reopen();
  await page.getByTestId("sr-jump-order").click();
  await page.getByTestId("order-sheet").waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  await shot("03-bestellfenster");
  for (const box of await page.getByTestId("order-sheet").getByRole("checkbox").all()) await box.check();
  await page.getByTestId("order-pay").click();
  await page.getByTestId("demo-checkout").waitFor({ timeout: 40000 });
  await page.getByTestId("demo-holder").fill("Ada Beispiel");
  await page.getByTestId("demo-number").fill("4242424242424242");
  await page.getByTestId("demo-expiry").fill("1234");
  await page.getByTestId("demo-cvc").focus();
  await page.waitForTimeout(1000);
  await shot("04-zahlung-cvc-flip");
  await page.getByTestId("demo-cvc").fill("123");
  await page.getByTestId("demo-holder").focus();
  await page.waitForTimeout(900);
  await shot("05-zahlung-formular");
  await page.getByTestId("demo-pay").click();
  await page.waitForTimeout(1800);
  await shot("06-zahlung-pruefung");
  await page.getByTestId("demo-result").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await shot("07-zahlung-bezahlt");
  await page.getByTestId("demo-continue").click();
  await page.getByText("Demo: Tarif aktiv (simuliert)").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);
  await shot("08-tarif-aktiv");

  await page.goto(BASE);
  await page.getByTestId("sr-state").or(page.getByTestId("sr-open")).first().waitFor({ timeout: 30000 });
  await reopen();
  await page.getByTestId("sr-jump-flip").click();
  await page.getByTestId("markt-trader-net").getByText("Echte Daten").waitFor({ timeout: 40000 });
  await page.waitForTimeout(3500);
  await shot("09-markt-flip-wal");

  await reopen();
  await page.getByTestId("sr-jump-voice").click();
  await page.getByText("KI formuliert …").first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(900);
  await shot("10-coach-voice-ring");

  await reopen();
  await page.getByTestId("sr-jump-week").click();
  await page.getByTestId("week-close").waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  await shot("11-wochenabschluss");
  await ctx.close();
}
await run("d");
await run("m");
await browser.close();
