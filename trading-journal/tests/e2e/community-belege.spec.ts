/**
 * Community: Ergebnisbeleg (F57), Rangliste mit Datenherkunft und Drawdown (F50 / F71), Chartfälle mit Hypothese vorab
 * (F47) – end to end against the Supabase mock and the community mock (`mocks/social.ts`, which validates every payload
 * with the real strict schemas). Runs on the cloud edition (`cloudUrl`), mobile + desktop, with axe on the new surfaces.
 *
 * No clock jumps and nothing that depends on the time of day: the proof is built from the fixture journal (fixed 2026
 * dates, the period given explicitly); the Chartfall candles come from a synthetic exchange that is aligned to the 4h
 * grid and flat up to the anchor, +1 % per candle after it, so the result is the same on every run.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { cloudUrl, collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { mockSocial, type MockGroup, type MockSocialOptions } from "./mocks/social";
import { mockSupabase } from "./mocks/supabase";

const COMMUNITY_URL = cloudUrl("community");
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const ME = "00000001-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const H4 = 14_400_000;

async function open(page: Page, url = COMMUNITY_URL): Promise<void> {
  const res = await page.goto(url);
  // a change of the hash alone is no new document (no response): reload, so the page starts on the new route
  if (res) expect(res.ok(), `${url} answers`).toBe(true);
  else await page.reload();
  await expect(page.locator('[data-page-role="current"] h1').first()).toBeVisible({ timeout: 30_000 });
}

async function setup(page: Page, social: MockSocialOptions = {}) {
  const errors = collectErrors(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await mockSupabase(page);
  await mockBilling(page, { enabled: false });
  const soc = await mockSocial(page, social);
  await seed(page);
  return { soc, errors };
}

async function signIn(page: Page): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function expectAccessible(page: Page, include: string, what: string): Promise<void> {
  await page.waitForTimeout(1500); // entrances settle: contrast is measured on the final colours
  const res = await new AxeBuilder({ page }).include(include).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

const member = (id: string, pseudonym: string, role: MockGroup["members"][number]["role"]) => ({ id, pseudonym, role, shareLevel: "none" as const, figures: null });

test.describe("Community: Belege, Rangliste, Chartfälle", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "runs on mobile + desktop");
  });

  test("Ergebnisbeleg: Vorschau aus dem Journal → Link → öffentliche Seite mit der ganzen Liste → zurückziehen", async ({ page }) => {
    const { soc, errors } = await setup(page);
    await open(page);
    await signIn(page);

    await page.getByTestId("share-proof").click();
    const sheet = page.getByTestId("proof-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[inert]")).toHaveCount(0);
    // no name yet → no link, and it says why
    await expect(sheet.getByTestId("share-create")).toHaveCount(0);
    await expect(sheet.getByTestId("proof-error")).toContainText("Gib deiner Strategie einen Namen.");
    await sheet.getByTestId("proof-name").fill("Breakout 4h");
    // the period of the fixture journal (11 closed trades, 2 still open)
    await sheet.getByTestId("proof-from").fill("2026-01-01");
    await sheet.getByTestId("proof-to").fill("2026-05-01");
    const preview = sheet.getByTestId("proof-preview");
    await expect(preview).toContainText("Trades in der Liste11");
    await expect(preview).toContainText("Nie dabei: Euro-Beträge, Kontogröße, Börse, Märkte, Uhrzeiten, Notizen, dein Name.");
    await expect(sheet.getByTestId("proof-basis-hint")).toContainText("Das kann die App nicht prüfen");
    await expectAccessible(page, '[data-testid="proof-sheet"]', "Beleg-Baukasten");

    await sheet.getByTestId("share-create").click();
    await expect(sheet.getByTestId("share-url")).toHaveValue(/#share\/\S{22}$/);
    const share = soc.shares[0]!;
    expect(share.kind).toBe("proof");
    const payload = share.payload as { kind: "proof"; trades: unknown[]; scope: { only: null; inPeriod: number; open: number }; strategy: string };
    expect(payload.trades).toHaveLength(11);
    expect(payload.scope).toEqual({ only: null, inPeriod: 11, open: 2 });
    expect(JSON.stringify(payload)).not.toMatch(/BTC|ETH|"pnl"|"size"|"fees"|notes|T\d\d:\d\d/);

    // the public page (no login needed: another tab with the same mocks opens the share URL)
    await page.keyboard.press("Escape");
    const pub = await page.context().newPage();
    await mockSupabase(pub);
    const viewer = await mockSocial(pub);
    viewer.shares.push(...soc.shares);
    await pub.goto(cloudUrl(`share/${share.token}`));
    await expect(pub.getByTestId("shared-view")).toHaveAttribute("data-phase", "ok", { timeout: 30_000 });
    const proof = pub.getByTestId("proof-page");
    await expect(proof).toBeVisible({ timeout: 30_000 });
    await expect(proof.getByTestId("proof-strategy")).toHaveText("Breakout 4h");
    await expect(proof.getByTestId("proof-period")).toContainText("01.01.2026 – 01.05.2026");
    await expect(proof.getByTestId("proof-scope")).toContainText("Alle 11 geschlossenen Trades des Zeitraums sind in der Liste");
    await expect(proof.getByTestId("proof-complete")).toContainText("Zum Stand waren 2 Positionen noch offen");
    await expect(proof.getByTestId("proof-sample")).toContainText("unter 30 sagt jede Kennzahl wenig");
    await expect(proof.getByTestId("proof-limits")).toContainText("Keine professionelle Finanzberatung.");
    await expect(proof.getByTestId("proof-row")).toHaveCount(11);
    // result and risk side by side, both readable as text
    await expect(proof.getByRole("img", { name: /^Summe / })).toBeVisible();
    await expect(proof.getByRole("img", { name: /^Drawdown / })).toBeVisible();
    await expect(proof.getByTestId("proof-curve")).toBeVisible();
    await expectNoHorizontalScroll(pub);
    await expectAccessible(pub, '[data-testid="proof-page"]', "Beleg-Seite");

    // revoked in „Deine Links“: the page is gone
    await expect(page.getByTestId("shares-card").getByTestId("share-row")).toHaveCount(1);
    await page.getByTestId("shares-card").getByTestId("share-revoke").click();
    await expect(toast(page).getByText("Link zurückgezogen")).toBeVisible();
    expect(share.revoked).toBe(true);
    viewer.shares.splice(0, viewer.shares.length, ...soc.shares);
    await pub.reload();
    await expect(pub.getByTestId("shared-view")).toHaveAttribute("data-phase", "gone", { timeout: 30_000 });
    expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
  });

  test("Rangliste: Drawdown neben jedem Wert, Filter nach Datenherkunft, Drawdown als Kennzahl", async ({ page }) => {
    const { errors } = await setup(page, { optIn: true });
    await open(page);
    await signIn(page);
    const card = page.getByTestId("leaderboard-card");
    await expect(card.getByTestId("podium-1")).toContainText("Kühner Luchs 14");
    await expect(card.getByTestId("podium-1")).toContainText("DD 1,5R");
    await expect(card.getByTestId("podium-1")).toContainText("Börsen-API");
    await expect(card.getByTestId("board-origin")).toContainText("Ob ein Konto Echtgeld oder Demo ist, weiß die App nicht");
    await expect(card.getByText("Kein Rang sagt, wer der beste Trader ist", { exact: false })).toBeVisible();
    const everyone = await card.getByTestId("board-meta").count();
    expect(everyone).toBeGreaterThan(5);

    // only traders whose records came through the exchange interface
    await card.getByTestId("board-origin").getByRole("radio", { name: "Börse" }).click();
    await expect(card.getByTestId("board-origin")).toContainText("lesende Börsen-Schnittstelle");
    await expect.poll(async () => card.getByTestId("board-meta").count()).toBeLessThan(everyone);
    const metas = await card.getByTestId("board-meta").allTextContents();
    expect(metas.every((t) => t.includes("Börsen-API")), metas.join(" | ")).toBe(true);

    // the drawdown ranks the smaller one first
    await card.getByTestId("board-origin").getByRole("radio", { name: "Alle" }).click();
    await card.getByRole("radio", { name: "Drawdown" }).click();
    await expect(card.getByText("Weniger ist besser", { exact: false })).toBeVisible();
    await expect(card.getByTestId("podium-1")).toContainText("1,5R");
    await expect(card.getByTestId("board-meta").first()).not.toContainText("DD "); // not repeated beside itself
    await expect(page.getByTestId("you-card").getByTestId("you-drawdown")).toContainText("3,2");
    await expect(page.getByTestId("you-card").getByTestId("you-origin")).toContainText("Börsen-API");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="leaderboard-card"]', "Rangliste");
    expect(errors).toEqual([]);
  });

  test("Chartfall: der Verlauf bleibt verdeckt, bis die Hypothese festgehalten ist – dann kommt das Ergebnis aus den Kerzen", async ({ page }) => {
    const anchorMs = Math.floor((Date.now() - 20 * H4) / H4) * H4;
    const requests: string[] = [];
    const g: MockGroup = {
      id: "abcdabcd-0000-4000-8000-00000000a001",
      kind: "group",
      name: "Morgenrunde",
      description: "",
      ownerId: OTHER,
      members: [member(ME, "Stiller Falke 27", "member"), member(OTHER, "Ruhige Eule 81", "owner")],
      invites: [],
      reviews: [],
      cases: [{ id: "abcdabcd-0000-4000-8000-0000000000c1", authorId: OTHER, pair: "BTCUSDT", interval: "4h", anchorMs, horizon: 12, question: "Hält die Box nach oben?", closesAt: new Date(Date.now() + 86_400_000).toISOString(), closed: false, createdAt: new Date().toISOString(), hyps: [] }],
    };
    const { soc, errors } = await setup(page, { groups: [g], rankedOthers: 0 });
    // a synthetic exchange on the 4h grid: flat at 100 up to the anchor, +1 % per candle after it (registered last → answers first)
    await page.route("https://fapi.binance.com/fapi/v1/klines**", async (route: Route) => {
      const u = new URL(route.request().url());
      requests.push(u.search);
      if (u.searchParams.get("interval") !== "4h") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
      const from = Number(u.searchParams.get("startTime") ?? anchorMs - 200 * H4);
      const to = Math.min(Number(u.searchParams.get("endTime") ?? Date.now()), Date.now());
      const rows = [];
      for (let t = Math.ceil(from / H4) * H4; t + H4 <= to && rows.length < 1500; t += H4) {
        const k = Math.max(0, Math.round((t - anchorMs) / H4));
        const close = t <= anchorMs ? 100 : 100 * (1 + 0.01 * k);
        const open = t <= anchorMs ? 100 : 100 * (1 + 0.01 * (k - 1));
        rows.push([t, String(open), String(Math.max(open, close) + 1), String(Math.min(open, close) - 1), String(close), "10", t + H4 - 1, "1000", 100, "5", "500", "0"]);
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
    });
    await open(page);
    await signIn(page);

    const card = page.getByTestId("case-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("data-phase", "decide");
    const chart = card.getByTestId("case-chart");
    await expect(chart).toHaveAttribute("data-future", "hidden", { timeout: 30_000 });
    await expect(chart.locator("svg g > rect")).toHaveCount(90); // the 90 candles up to the anchor – none of the 12 after it
    await expect(card.getByTestId("case-hidden")).toContainText("12 Kerzen");
    await expect(card.getByTestId("case-result")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="case-card"]', "Chartfall vor der Hypothese");

    // incomplete → nothing is sent
    await card.getByTestId("case-commit").click();
    await expect(card.getByText("Mindestens 10 Zeichen.")).toBeVisible();
    expect(g.cases![0]!.hyps).toHaveLength(0);
    await card.getByRole("radio", { name: "Steigt" }).click();
    await card.getByRole("radio", { name: "80 %" }).click();
    await card.getByTestId("case-reason").fill("Ausbruch über die Box mit Volumen");
    await card.getByTestId("case-commit").click();
    await expect(toast(page).getByText("Hypothese festgehalten")).toBeVisible();
    expect(g.cases![0]!.hyps).toHaveLength(1);
    expect(g.cases![0]!.hyps[0]).toMatchObject({ userId: ME, direction: "up", confidence: 80 });

    // stored → the future appears, the result is worked out from the candles
    await expect(card).toHaveAttribute("data-phase", "committed");
    await expect(chart).toHaveAttribute("data-future", "shown", { timeout: 30_000 });
    await expect(chart.locator("svg g > rect")).toHaveCount(102);
    await expect(card.getByTestId("case-outcome")).toContainText("+12,0 % zum Ankerkurs");
    await expect(card.getByTestId("case-mine-result")).toContainText("Deine Hypothese: Steigt (80 %) – trifft zu.");
    await expect(card.getByText("Die Texte der anderen bleiben verdeckt, bis der Fall geschlossen ist.")).toBeVisible();
    await expect(card.getByTestId("case-form")).toHaveCount(0);

    // a second hypothesis is refused by the server (written once)
    expect(soc.groups[0]!.cases![0]!.hyps).toHaveLength(1);

    // the author's side: another member wrote one earlier; closing opens everyone's
    g.cases![0]!.hyps.unshift({ userId: OTHER, direction: "down", confidence: 60, reason: "Ich erwarte einen Rücksetzer", createdAt: new Date(Date.now() - 3600_000).toISOString() });
    g.cases![0]!.closed = true;
    await open(page, COMMUNITY_URL);
    const closed = page.getByTestId("case-card");
    await expect(closed).toHaveAttribute("data-phase", "closed", { timeout: 30_000 });
    const rows = closed.getByTestId("hypothesis-row");
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await expect(closed.getByTestId("case-tally")).toContainText("2 Hypothesen: 1 steigt · 1 fällt · 0 seitwärts");
    await expect(rows.filter({ hasText: "Ich erwarte einen Rücksetzer" })).toContainText("trifft nicht zu");
    await expect(rows.filter({ hasText: "Du ·" })).toContainText("trifft zu");
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, '[data-testid="case-card"]', "geschlossener Chartfall");
    expect(requests.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("Neuer Chartfall: die Vorschau lädt die echten Kerzen, erst dann lässt sich der Fall stellen", async ({ page }) => {
    const anchorOf = (now: number) => Math.floor(now / H4) * H4 - H4;
    const g: MockGroup = { id: "abcdabcd-0000-4000-8000-00000000a001", kind: "group", name: "Morgenrunde", description: "", ownerId: ME, members: [member(ME, "Stiller Falke 27", "owner")], invites: [], reviews: [] };
    const { soc, errors } = await setup(page, { groups: [g], rankedOthers: 0 });
    await page.route("https://fapi.binance.com/fapi/v1/klines**", async (route: Route) => {
      const u = new URL(route.request().url());
      const from = Number(u.searchParams.get("startTime") ?? Date.now() - 300 * H4);
      const now = Date.now();
      const rows = [];
      for (let t = Math.ceil(from / H4) * H4; t + H4 <= now && rows.length < 1500; t += H4) rows.push([t, "100", "101", "99", "100", "10", t + H4 - 1, "1000", 100, "5", "500", "0"]);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
    });
    await open(page);
    await signIn(page);
    await page.getByTestId("case-new").click();
    const sheet = page.getByTestId("case-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[inert]")).toHaveCount(0);
    await expect(sheet.getByTestId("case-chart")).toHaveAttribute("data-future", "hidden", { timeout: 30_000 });
    await expect(sheet.getByTestId("case-post")).toBeEnabled();
    await sheet.getByTestId("case-question").fill("Hält die Box nach oben?");
    await sheet.getByRole("radio", { name: "24 Kerzen" }).click();
    await expectAccessible(page, '[data-testid="case-sheet"]', "Neuer Chartfall");
    await sheet.getByTestId("case-post").click();
    await expect(toast(page).getByText("Chartfall gestellt")).toBeVisible();
    const made = soc.groups[0]!.cases![0]!;
    expect(made).toMatchObject({ pair: "BTCUSDT", interval: "4h", horizon: 24, question: "Hält die Box nach oben?", authorId: ME });
    expect(made.anchorMs % H4).toBe(0);
    expect(made.anchorMs).toBeLessThanOrEqual(anchorOf(Date.now()));
    await expect(page.getByTestId("case-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("case-card").getByText("BTCUSDT · 4 Std")).toBeVisible();
    // a broken symbol blocks the case
    await page.getByTestId("case-new").click();
    const again = page.getByTestId("case-sheet");
    await again.getByTestId("case-pair").fill("BT");
    await expect(again.getByTestId("case-post")).toBeDisabled();
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});

