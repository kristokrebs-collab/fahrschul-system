/**
 * P05 Risiko page end to end, on the real Box-zu-Box market (`mockMarket(…, { boxes: true })`: real BTCUSDT 4h / 1D
 * bars, one live price) and a seeded journal: 40 closed trades over two months on four pairs, two losses closed today
 * right before "now" (→ the pause), and three open positions with leverage (BTC long, ETH long, SOL short).
 * ETHUSDT / SOLUSDT daily candles are routed to one correlated driver (a cluster), XRPUSDT to an independent one.
 *
 * Covered: `h1 Risiko`; live limits (day-loss tank, rings, the pause pill and "Limit überschreiben" via hold), exposure
 * (legs, live uPnL, net meter), the calculator (live price → entry, stop / target chips incl. box edge and ATR, the
 * sizing cascade, leverage over the rule shakes + names the allowed size, "In Trade übernehmen" opens the editor
 * pre-filled), liquidation rows, the scenario slider (liquidation → dissolve, back → row returns), the correlation
 * matrix (one fetch per pair, cluster named), streaks, risk per strategy (setup ↔ asset), the settings writing at once
 * (settings.risk + settings.discipline), the guard toast after a save, the empty journal, no horizontal scroll at
 * 390 px, no console errors.
 *
 * Until P14 registers the page the spec opens the dev harness `/dev/risiko.html` (Vite dev server, e.g.
 * `npx vite --port 4181` + `PW_BASE_URL`); set `PW_RISIKO_URL=/#risiko` once routed. On a production preview without
 * the harness the tests skip themselves. `P05_SHOTS=<dir>` writes review screenshots.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { boxFixture } from "./mocks/boxFixture";

const RISIKO_URL = process.env.PW_RISIKO_URL ?? "/dev/risiko.html";
const SHOTS = process.env.P05_SHOTS;
const PROJECTS = ["mobile", "desktop"];
const DAY = 86_400_000;

/** The journal's local wall clock ("YYYY-MM-DDTHH:mm") in the BROWSER's zone (playwright.config: Europe/Berlin). */
const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = (p: Record<string, unknown>): Record<string, unknown> => ({
  account: "scalp",
  timeframe: "1h",
  target: null,
  fees: 1,
  pnlManual: null,
  setups: ["s_bo"],
  checks: {},
  conviction: 3,
  followedPlan: true,
  emotion: "Ruhig",
  reason: "",
  notes: "",
  chart: "",
  pnl: null,
  r: null,
  mistakes: [],
  ...p,
});

/** The seeded journal relative to `now` (live = the box market's live BTC price). */
export function riskTrades(now: number, live: number, opts: { pause?: boolean } = {}): Record<string, unknown>[] {
  const rand = rng(20261014);
  const out: Record<string, unknown>[] = [];
  const pairs = [
    ["BTC/USDT", live],
    ["ETH/USDT", 3200],
    ["SOL/USDT", 180],
    ["XRP/USDT", 2.4],
  ] as const;
  const setups = ["s_bo", "s_sweep", "s_ml"];
  for (let i = 0; i < 40; i++) {
    const at = now - 62 * DAY + i * 1.5 * DAY + Math.floor(rand() * 8) * 3_600_000;
    const [pair, px] = pairs[i % 4]!;
    const side = rand() < 0.6 ? "long" : "short";
    const dir = side === "long" ? 1 : -1;
    const entry = Number((px * (0.92 + rand() * 0.16)).toPrecision(6));
    const d = entry * (0.008 + rand() * 0.012);
    const riskMoney = i % 7 === 0 ? 140 : 40 + Math.round(rand() * 40);
    const qty = riskMoney / d;
    const win = rand() < 0.5;
    const r = win ? 1.2 + rand() * 1.6 : -(0.8 + rand() * 0.3);
    out.push(
      base({
        id: `e_rk_${i}`,
        side,
        status: "closed",
        date: local(at),
        exitDate: local(at + 3 * 3_600_000),
        pair,
        entry,
        stop: Number((entry - dir * d).toPrecision(6)),
        exit: Number((entry + dir * r * d).toPrecision(6)),
        size: Math.round(qty * entry),
        leverage: [3, 4, 5][i % 3],
        setups: [setups[i % 3]],
        createdAt: new Date(at).toISOString(),
        updatedAt: new Date(at).toISOString(),
      }),
    );
  }
  if (opts.pause !== false) {
    // two losses closed today right before "now": 160 of the 200 day limit (scalp 5 000 × 4 %), pause running
    for (const [k, minsAgo, pnl] of [
      [0, 25, -90],
      [1, 8, -70],
    ] as const) {
      const at = now - (minsAgo + 40) * 60_000;
      out.push(base({ id: `e_rk_today_${k}`, side: "long", status: "closed", date: local(at), exitDate: local(now - minsAgo * 60_000), pair: "BTC/USDT", entry: live, stop: live * 0.99, exit: live * 0.99, size: 5000, leverage: 3, pnlManual: pnl, createdAt: new Date(at).toISOString(), updatedAt: new Date(now - minsAgo * 60_000).toISOString() }));
    }
  }
  // open positions: BTC long 5×, ETH long 3×, SOL short 2× (makro)
  const openAt = local(now - 2 * 3_600_000);
  out.push(base({ id: "e_rk_open_btc", side: "long", status: "open", date: openAt, pair: "BTC/USDT", entry: Math.round(live * 0.995), stop: Math.round(live * 0.975), exit: null, size: 4000, leverage: 5 }));
  out.push(base({ id: "e_rk_open_eth", side: "long", status: "open", date: openAt, pair: "ETH/USDT", entry: 3200, stop: 3120, exit: null, size: 3000, leverage: 3, setups: ["s_sweep"] }));
  out.push(base({ id: "e_rk_open_sol", account: "makro", side: "short", status: "open", date: openAt, pair: "SOL/USDT", entry: 180, stop: 189, exit: null, size: 6000, leverage: 2, setups: ["s_ml"] }));
  return out;
}

/** ETH and SOL daily candles from one driver (ρ high), XRP independent; BTC stays the real fixture. */
async function routeDaily(page: Page, requests: string[]): Promise<void> {
  await page.route("https://fapi.binance.com/fapi/v1/klines**", async (route) => {
    const u = new URL(route.request().url());
    const sym = u.searchParams.get("symbol") ?? "";
    if (u.searchParams.get("interval") !== "1d" || !["ETHUSDT", "SOLUSDT", "XRPUSDT"].includes(sym)) return route.fallback();
    requests.push(sym);
    const limit = Number(u.searchParams.get("limit") ?? 99);
    const driver = rng(7);
    const own = rng(sym.charCodeAt(0) * 31 + sym.length);
    const today = Math.floor(Date.now() / DAY) * DAY;
    const px0 = sym === "ETHUSDT" ? 3000 : sym === "SOLUSDT" ? 170 : 2.2;
    let px = px0;
    const rows: unknown[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      const m = (driver() - 0.5) * 0.06;
      const e = (own() - 0.5) * 0.06;
      const ret = sym === "XRPUSDT" ? e : m + e * 0.15;
      const open = px;
      px = px * (1 + ret);
      const t = today - i * DAY;
      rows.push([t, String(open), String(Math.max(open, px) * 1.01), String(Math.min(open, px) * 0.99), String(px), "1000", t + DAY - 1, "1", 1, "1", "1", "0"]);
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
  });
}

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  if (fullPage) {
    await page.addStyleTag({ content: "header{position:static!important}" });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(160);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${SHOTS}/P05-risk-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

async function openRisiko(page: Page): Promise<boolean> {
  const res = await page.goto(RISIKO_URL);
  if (!res || !res.ok()) return false;
  return page
    .getByRole("heading", { level: 1, name: "Risiko" })
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe("Risiko", () => {
  test.setTimeout(120_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P05 runs on mobile + desktop");
  });

  test("Limits, Pause, Exposure, Rechner → Editor, Liquidation, Szenario, Korrelation – no errors, no horizontal scroll", async ({ page }, info) => {
    const errors = collectErrors(page);
    const now = Date.now();
    const live = boxFixture(now).live;
    await seed(page, { boxes: true, extra: { "tj2-trades": riskTrades(now, live) } });
    const daily: string[] = [];
    await routeDaily(page, daily);
    test.skip(!(await openRisiko(page)), "the Risiko page is served by the dev harness (Vite dev server) until P14 routes it");
    await expect(page.getByTestId("risiko-view")).toBeVisible();

    // live limits: day loss 160 of 200 (warn), the pause after two losses, rings for the other limits
    const limits = page.getByTestId("risk-limits");
    await expect(limits.getByTestId("limit-day")).toHaveAttribute("data-state", "warn");
    await expect(limits).toContainText("160 USDT von 200 USDT heute");
    await expect(limits.getByTestId("limit-trades")).toBeVisible();
    await expect(limits.getByTestId("risk-cooldown")).toContainText(/\d Verluste in Folge/);
    await expect(limits).toContainText(/Pause · \d+:\d\d/);
    await expect(page.getByRole("meter", { name: "Tagesverlust" })).toBeVisible();
    await shot(page, info, "top");

    // exposure: three open legs, journal only (no exchange connected)
    const ex = page.getByTestId("risk-exposure");
    await expect(ex).toHaveAttribute("data-legs", "3");
    await expect(ex).toContainText("Nur Journal-Daten");
    await expect(ex.getByTestId("exposure-asset")).toHaveCount(3);

    // calculator: live price → entry, box / ATR stops, sizing cascade, R targets
    const calc = page.getByTestId("risk-calc");
    await calc.scrollIntoViewIfNeeded();
    await expect(calc.getByTestId("risk-live-price")).toBeVisible();
    await calc.getByRole("button", { name: "Live-Preis übernehmen" }).click();
    await expect(calc.getByLabel("Einstieg")).not.toHaveValue("");
    const stops = calc.getByTestId("risk-stop-chips");
    await expect(stops.getByTestId("stop-pct")).toBeVisible();
    await expect(stops.getByTestId("stop-atr")).toBeVisible({ timeout: 20_000 });
    await stops.getByTestId("stop-atr").click();
    const result = calc.getByTestId("risk-calc-result");
    await expect(result).toHaveAttribute("data-ok", "1");
    await expect(result).toContainText("Positionsgröße");
    await calc.getByTestId("risk-target-chips").getByTestId("target-r").nth(1).click();
    await expect(calc.getByTestId("risk-rr")).toContainText("1:2");
    // too big: 2 % risk with a hairline stop → over the leverage rule, the allowed size is named
    await calc.getByLabel("Stop").fill(String(Math.round(live * 0.999)));
    await calc.getByTestId("risk-chip-2").click();
    await expect(calc.getByTestId("risk-calc-toobig")).toContainText("Über deiner Hebel-Regel");
    await calc.getByLabel("Stop").fill(String(Math.round(live * 0.98)));
    await expect(calc.getByTestId("risk-calc-toobig")).toHaveCount(0);
    await shot(page, info, "calc");
    // "In Trade übernehmen" → the editor, pre-filled
    await calc.getByTestId("risk-adopt").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Stop-Loss")).toHaveValue(/\d/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // liquidation: the planned position + the open legs with leverage
    const liq = page.getByTestId("risk-liq");
    await liq.scrollIntoViewIfNeeded();
    await expect(liq.locator("[data-testid=liq-row][data-planned]")).toHaveCount(1);
    await expect(liq.getByTestId("liq-row")).toHaveCount(4);

    // scenario: −30 % liquidates the BTC 5× long (dissolves), back to 0 brings it back
    const sc = page.getByTestId("risk-scenario");
    await sc.scrollIntoViewIfNeeded();
    await expect(sc.getByTestId("scenario-leg")).toHaveCount(3);
    const slider = sc.getByTestId("scenario-slider");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(sc.getByTestId("scenario-shock")).toHaveText("−30,0 %");
    await expect(sc.getByTestId("scenario-liquidated").first()).toBeVisible();
    await expect(sc).not.toHaveAttribute("data-liquidated", "0");
    await shot(page, info, "scenario");
    await sc.getByTestId("scenario-preset-0").click();
    await expect(sc).toHaveAttribute("data-liquidated", "0");
    await expect(sc.getByTestId("scenario-leg")).toHaveCount(3);

    // correlation: ETH / SOL from one driver → cluster; one fetch per pair
    const corr = page.getByTestId("risk-corr");
    await corr.scrollIntoViewIfNeeded();
    await expect(corr).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
    await expect(corr.getByTestId("corr-clusters")).toContainText(/ETH/);
    await expect(corr.getByTestId("corr-clusters")).toContainText(/SOL/);
    expect(new Set(daily).size).toBe(daily.length);

    // streaks + risk per strategy (setup ↔ asset)
    await expect(page.getByTestId("risk-streak")).not.toHaveAttribute("data-status", "zu wenig");
    const spread = page.getByTestId("risk-spread");
    await spread.scrollIntoViewIfNeeded();
    await expect(spread.getByTestId("spread-row").first()).toBeVisible();
    await spread.getByRole("radio", { name: "Asset" }).click();
    await expect(spread.locator("[data-testid=spread-row][data-key=BTC]")).toBeVisible();
    await shot(page, info, "patterns");

    await expectNoHorizontalScroll(page);
    if (SHOTS) await shot(page, info, "full", true);
    expect(errors).toEqual([]);
  });

  test("Pause überschreiben per Halten, Einstellungen schreiben sofort, Wächter-Toast nach dem Speichern", async ({ page }) => {
    const errors = collectErrors(page);
    const now = Date.now();
    const live = boxFixture(now).live;
    await seed(page, { boxes: true, extra: { "tj2-trades": riskTrades(now, live) } });
    await routeDaily(page, []);
    test.skip(!(await openRisiko(page)), "the Risiko page is served by the dev harness (Vite dev server) until P14 routes it");

    // override the pause by holding
    const limits = page.getByTestId("risk-limits");
    const hold = limits.getByTestId("risk-override");
    await hold.scrollIntoViewIfNeeded();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1800);
    await page.mouse.up();
    await expect(limits).toContainText("Überschrieben bis");
    expect(await page.evaluate(() => (window as unknown as { __tjGuard: { getState(): { override: unknown } } }).__tjGuard.getState().override)).not.toBeNull();
    await limits.getByRole("button", { name: "Pause wieder aktivieren" }).click();
    await expect(limits.getByTestId("risk-override")).toBeVisible();

    // settings: the week limit into settings.risk, the day limit into settings.discipline (the same value the discipline uses)
    const st = page.getByTestId("risk-settings");
    await st.scrollIntoViewIfNeeded();
    await st.getByTestId("rs-week").fill("5");
    await st.getByTestId("rs-week").press("Enter");
    await expect(st.getByTestId("risk-settings-saved")).toBeVisible();
    await st.getByTestId("rs-day").fill("3");
    await st.getByTestId("rs-day").press("Tab");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { risk?: { maxLossWeekPct?: number }; discipline?: { maxLossDayPct?: number } }))
      .toMatchObject({ risk: { maxLossWeekPct: 0.05 }, discipline: { maxLossDayPct: 0.03 } });
    // 160 of now 150 → the day limit is breached: red beam card, the pause runs until midnight
    await expect(limits.getByTestId("limit-day")).toHaveAttribute("data-state", "breach");
    await expect(limits).toHaveAttribute("data-worst", "breach");
    // an invalid value is refused (shake), the stored one stays
    await st.getByTestId("rs-warn").fill("120");
    await st.getByTestId("rs-warn").press("Enter");
    await expect(st.getByTestId("rs-warn")).toHaveValue("75");

    // the guard: saving another losing trade today toasts the breach
    await page.evaluate((args) => {
      const j = (window as unknown as { __tjJournal: { getState(): { saveTrade(t: unknown): Promise<void> } } }).__tjJournal;
      void j.getState().saveTrade({ ...args.t });
    }, { t: base({ side: "long", status: "closed", date: local(now - 5 * 60_000), exitDate: local(now - 60_000), pair: "BTC/USDT", entry: live, stop: live * 0.99, exit: live * 0.995, size: 2000, pnlManual: -30, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) });
    await expect(toast(page)).toContainText(/Verluste in Folge|Grenze|Tageslimit/);
    expect(errors).toEqual([]);
  });

  test("leeres Journal: ehrliche Leerzustände, keine Fehler", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page, { empty: true, boxes: true });
    test.skip(!(await openRisiko(page)), "the Risiko page is served by the dev harness (Vite dev server) until P14 routes it");
    await expect(page.getByTestId("risk-exposure")).toContainText("Keine offenen Positionen");
    await expect(page.getByTestId("risk-margin")).toContainText("Keine Börse verbunden");
    await expect(page.getByTestId("risk-scenario")).toContainText("Keine offenen Positionen");
    await expect(page.getByTestId("risk-corr")).toHaveAttribute("data-state", "few");
    await expect(page.getByTestId("risk-streak")).toHaveAttribute("data-status", "zu wenig");
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
