/**
 * TradingView-Signal-Empfänger und MCP-Verbindung (B3) end to end, mobile + desktop, ALL AGAINST MOCKS (the Supabase mock of the cloud build
 * and the connection functions faked in this file – no real TradingView, no server):
 *  1. Assistent: Zieladresse → Testsignal senden → "Empfang bestätigt" in Echtzeit (der Poll, nicht der Knopf); später kommen Signale "von außen"
 *     an und die Liste zeigt verarbeitet / doppelt / abgelehnt mit Grund, ohne dass jemand etwas drückt.
 *  2. MCP-Karte: "Einrichtung nötig (Betreiber)" ohne Betreiber-Kennung; mit ihr der Weg Verbinden → (mock) TradingView → zurück → Lese-Test → Trennen.
 * Nothing here proves the real service works – the report says what is mock only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { auditHitBoxes, HIT_SELECTOR } from "./hitbox";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, hasTouch, seed } from "./helpers";
import { mockSupabase } from "./mocks/supabase";
import { blockExternalNetwork, entryGate, openSignedIn, signInViaSheet } from "./cloudSignIn";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TOKEN = `tj_${"S".repeat(43)}`;

type Sig = Record<string, unknown>;
interface Mock {
  token: string | null;
  signals: Sig[];
  mcp: Record<string, unknown>;
  starts: number;
  tests: number;
  revokes: number;
  configured: boolean;
}

const row = (over: Sig): Sig => ({
  id: `s${Math.random().toString(36).slice(2, 9)}`,
  kind: "signal",
  status: "processed",
  reason: null,
  schemaId: "signal/1",
  source: "tradingview",
  signalId: "x",
  strategy: "trend",
  market: null,
  symbol: "XLE",
  direction: "long",
  time: new Date().toISOString(),
  data: null,
  via: "extern",
  receivedAt: new Date().toISOString(),
  ...over,
});

async function mockApi(page: Page, o: { configured: boolean }): Promise<Mock> {
  const m: Mock = {
    token: null,
    signals: [],
    starts: 0,
    tests: 0,
    revokes: 0,
    configured: o.configured,
    mcp: { configured: o.configured, host: o.configured ? "mcp.tradingview.test" : null, connected: false, status: null, scope: null, lastError: null, lastTestAt: null, lastTestOk: null, createdAt: null },
  };
  const send = (route: Route, status: number, body?: unknown) =>
    route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: body === undefined ? "" : JSON.stringify(body) });

  await page.route(/\/api\/v1\/connections\/tradingview\/mcp/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/mcp/start")) {
      m.starts++;
      return send(route, 200, { url: "https://www.tradingview.test/mcp/oauth/authorize?client_id=x&state=y" });
    }
    if (url.pathname.endsWith("/mcp/test")) {
      m.tests++;
      m.mcp = { ...m.mcp, lastTestAt: new Date().toISOString(), lastTestOk: true };
      return send(route, 200, { ok: true, tools: 35, watchlists: 2 });
    }
    if (method === "DELETE") {
      m.revokes++;
      m.mcp = { ...m.mcp, connected: false, status: null, lastTestAt: null, lastTestOk: null, createdAt: null };
      return send(route, 200, { ok: true, revoked: true });
    }
    return send(route, 404, { error: { code: "not_found", message: "Unbekannt." } });
  });

  await page.route(/\/api\/v1\/connections\/tradingview$/, async (route) => {
    const method = route.request().method();
    if (method === "GET")
      return send(route, 200, {
        hasToken: !!m.token,
        token: m.token ? { id: "t1", prefix: m.token.slice(0, 8), createdAt: new Date().toISOString(), lastUsedAt: null } : null,
        receipts: [],
        receiptsAvailable: true,
        signals: [...m.signals].reverse(),
        signalsAvailable: true,
        mcp: m.mcp,
        tradeAlerts: { allowed: true, plan: "pro" },
        origin: null,
      });
    if (method === "POST") {
      m.token = TOKEN;
      return send(route, 201, { token: TOKEN, path: `/api/v1/hooks/tradingview/${TOKEN}`, info: {} });
    }
    m.token = null;
    return send(route, 200, { ok: true });
  });

  await page.route(/\/api\/v1\/hooks\/tradingview\//, async (route) => {
    const body = route.request().postData() ?? "";
    m.signals.push(row({ kind: "test", signalId: null, schemaId: null, strategy: null, symbol: "TEST", direction: null, via: body.includes('"source":"app"') ? "app" : "extern" }));
    return send(route, 200, { ok: true, result: "test" });
  });

  // the sign-in page of (mock) TradingView: a blank page, the test comes back by hand
  await page.route(/^https:\/\/www\.tradingview\.test\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>mock</title><p>Anmeldung bei TradingView (Mock)</p>" }));
  await page.route(/\/api\/v1\/alerts\/test/, (route) => send(route, 200, { configured: false, entitled: true, hasEmail: true, emailConfirmed: true, lastRun: null, intervalMin: 5 }));
  return m;
}

async function signIn(page: Page): Promise<void> {
  await signInViaSheet(page, { synced: true });
}

async function openSettings(page: Page, configured: boolean, search = ""): Promise<Mock> {
  collectErrors(page);
  await blockExternalNetwork(page);
  await mockSupabase(page, {});
  const m = await mockApi(page, { configured });
  await seed(page);
  // Konto-Pflicht: the entry gate first, the settings page after the sign-in
  await openSignedIn(page, cloudUrl("settings", search), "Einstellungen", { synced: true });
  return m;
}

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1200);
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

const dialog = (page: Page) => page.getByRole("dialog");

test.describe("TradingView-Signale und MCP-Karte (Cloud-Build gegen Mocks)", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    test.skip(!["mobile", "desktop"].includes(info.project.name), "mobile + desktop only");
    void page;
  });

  test("Testsignal: der Empfang wird von selbst bestätigt; Signale von außen erscheinen in der Liste mit Ausgang und Grund", async ({ page }, info) => {
    const m = await openSettings(page, false);
    const slot = page.getByTestId("connect-slot-tradingview");
    await slot.scrollIntoViewIfNeeded();
    await expect(slot).toHaveAttribute("data-state", "disconnected", { timeout: 25_000 });
    await slot.click();
    const d = dialog(page);
    await d.getByTestId("tv-create").click();
    await expect(d.getByTestId("tv-url")).toContainText(`/api/v1/hooks/tradingview/${TOKEN}`);
    await d.getByTestId("tv-next").click();
    // templates with a token PLACEHOLDER, no order size, the plan note marked "zu prüfen"
    await expect(d.getByTestId("tv-tpl-signal")).toContainText('"schema":"signal/1"');
    await expect(d.getByTestId("tv-signal-url")).toContainText("/api/v1/signals/");
    await expect(d.getByTestId("tv-plan-note")).toContainText("laut Hilfe von TradingView zu prüfen");
    await d.getByTestId("tv-next").click();
    await expect(d.getByTestId("tv-waiting")).toBeVisible();
    await d.getByTestId("tv-send-test").click();
    await expect(d.getByTestId("tv-arrived")).toContainText("Empfang bestätigt", { timeout: 20_000 });
    await expect(d.getByTestId("tv-signal")).toHaveCount(1);
    await expect(d.getByTestId("tv-signal").first()).toContainText("Testsignal");

    // from outside, without anybody pressing anything: a Branchen-Signal, the same one again, a refused body
    m.signals.push(row({ id: "b1", schemaId: "branchen-trend/1", strategy: "s-20-40-2.8-0.02-2.0", data: { zustand: "gruen", kurs: 91.2 } }));
    m.signals.push(row({ id: "b2", status: "duplicate", reason: "Dieses Signal ist schon angekommen.", schemaId: "branchen-trend/1" }));
    m.signals.push(row({ id: "b3", status: "rejected", reason: "„direction“ muss „long“ oder „flat“ sein (short gibt es nicht).", schemaId: "signal/1", symbol: null, direction: null }));
    const items = d.getByTestId("tv-signal");
    await expect(items).toHaveCount(4, { timeout: 30_000 });
    await expect(items.nth(0)).toHaveAttribute("data-status", "rejected");
    await expect(items.nth(0)).toContainText("short gibt es nicht");
    await expect(items.nth(1)).toHaveAttribute("data-status", "duplicate");
    await expect(items.nth(1)).toContainText("doppelt");
    await expect(items.nth(2)).toContainText("Long · XLE · grün");
    await expect(items.nth(2)).toContainText("verarbeitet");

    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="connect-dialog"]', "TradingView-Dialog (Signalliste)");
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="connect-dialog"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
  });

  test("MCP-Karte ohne Betreiber-Kennung: 'Einrichtung nötig (Betreiber)', kein Knopf, der scheitern würde", async ({ page }) => {
    await openSettings(page, false);
    const slot = page.getByTestId("connect-slot-tradingview");
    await slot.scrollIntoViewIfNeeded();
    await expect(slot).toHaveAttribute("data-state", "disconnected", { timeout: 25_000 });
    await slot.click();
    const card = dialog(page).getByTestId("tvmcp");
    await expect(card).toHaveAttribute("data-state", "unconfigured");
    await expect(card).toContainText("Einrichtung nötig (Betreiber)");
    await expect(dialog(page).getByTestId("tvmcp-start")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="tvmcp"]', "MCP-Karte (nicht eingerichtet)");
  });

  test("MCP-Karte mit Einrichtung: verbinden → (Mock-)TradingView → zurück mit ?tvmcp=ok → Lese-Test → Trennen", async ({ page }, info) => {
    const m = await openSettings(page, true);
    const slot = page.getByTestId("connect-slot-tradingview");
    await slot.scrollIntoViewIfNeeded();
    await expect(slot).toHaveAttribute("data-state", "disconnected", { timeout: 25_000 });
    await slot.click();
    const card = dialog(page).getByTestId("tvmcp");
    await expect(card).toHaveAttribute("data-state", "disconnected");
    await expect(card).toContainText("nur einen Lese-Test");
    await expect(card).toContainText("Nachbau des Servers");
    if (hasTouch(info)) {
      const misses = await page.evaluate(auditHitBoxes, { selector: HIT_SELECTOR, root: '[data-testid="tvmcp"]' });
      expect(misses, JSON.stringify(misses)).toEqual([]);
    }
    // the browser goes to the https address of the sign-in page the server made – and nowhere else
    await Promise.all([page.waitForURL(/^https:\/\/www\.tradingview\.test\/mcp\/oauth\/authorize/, { timeout: 20_000 }), dialog(page).getByTestId("tvmcp-start").click()]);
    expect(m.starts).toBe(1);

    // TradingView sends the browser back (the server redirects to this fixed address); the server now knows the connection
    m.mcp = { ...m.mcp, connected: true, status: "active", scope: "mcp:read mcp:tools", createdAt: new Date().toISOString() };
    await page.goto(cloudUrl("settings", "?tvmcp=ok"));
    await signInIfAsked(page);
    const back = dialog(page).getByTestId("tvmcp-return");
    await expect(back).toContainText("Lese-Test", { timeout: 30_000 });
    expect(new URL(page.url()).search).toBe(""); // the marker is taken out of the address
    const card2 = dialog(page).getByTestId("tvmcp");
    await expect(card2).toHaveAttribute("data-state", "connected");
    await card2.getByTestId("tvmcp-test").click();
    await expect(card2.getByTestId("tvmcp-result")).toContainText("2 Merklisten");
    await expect(card2.getByTestId("tvmcp-last")).toContainText("in Ordnung");
    expect(m.tests).toBe(1);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="tvmcp"]', "MCP-Karte (verbunden)");

    await card2.getByTestId("tvmcp-revoke").click();
    await expect(card2).toContainText("widerrufen und hier gelöscht");
    await card2.getByTestId("tvmcp-revoke-yes").click();
    await expect(card2).toHaveAttribute("data-state", "disconnected", { timeout: 15_000 });
    expect(m.revokes).toBe(1);
  });
});

/**
 * A fresh page load of the cloud build: the return opens the TradingView dialog at once; the mock may or may not keep the session over the
 * reload. Close that dialog, sign in if the pill still asks for it, and open the TradingView dialog again (the sign-in outcome is in the store).
 */
async function signInIfAsked(page: Page): Promise<void> {
  const pill = page.locator('[data-cloud-pill="signin"]');
  // without the session the entry gate comes first (Konto-Pflicht); the return's dialog opens once the app is there
  await expect(dialog(page).first().or(entryGate(page))).toBeVisible({ timeout: 30_000 });
  if (await entryGate(page).isVisible()) await signIn(page);
  await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  if (await pill.isVisible({ timeout: 6_000 }).catch(() => false)) await signIn(page);
  await page.getByTestId("connect-slot-tradingview").scrollIntoViewIfNeeded();
  await page.getByTestId("connect-slot-tradingview").click();
}
