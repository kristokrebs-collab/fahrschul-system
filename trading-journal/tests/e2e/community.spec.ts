/**
 * P12 Community end to end against the Supabase mock (`mocks/supabase.ts`) and the community mock (`mocks/social.ts`):
 * the honest state without cloud, the signed-out pitch, the own card + ranking (podium, opt-in, own row), groups
 * (create, invite link, joint review with a redacted trade, comment with @mention), the mentor desk (queue, goal), the
 * student's goals, joining by invitation link, a team's seats, share links (create → public SharedView → revoke) and
 * feedback. Every shared payload is checked against the strict schema in the mock (a money field would be a 422).
 *
 * Runs on `/#community` of the cloud edition (the production build against the mock project, `cloudUrl` in
 * helpers.ts); a share link is born in the trade detail (P14: its footer carries the share button) and opened publicly
 * at the app root (`/#share/<token>`); "without cloud" runs on `/#community` of the default build. `PW_COMMUNITY_URL` /
 * `PW_SHARE_BASE` override the cloud URLs. `P12_SHOTS_DIR` writes review screenshots.
 */
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { clippedTexts, CLOUD_BASE, cloudUrl, collectErrors, expectNoHorizontalScroll, seed, toast } from "./helpers";
import { mockBilling } from "./mocks/billing";
import { fig, mockSocial, mockTradePayload, type MockGroup, type MockSocialOptions } from "./mocks/social";
import { mockSupabase } from "./mocks/supabase";

const COMMUNITY_URL = process.env.PW_COMMUNITY_URL ?? cloudUrl("community");
const TRADES_URL = process.env.PW_COMMUNITY_TRADES_URL ?? cloudUrl("trades");
/** Page that serves `#share/<token>` (P14: the app root). */
const SHARE_BASE = process.env.PW_SHARE_BASE ?? `${CLOUD_BASE}/`;
const SHOTS = process.env.P12_SHOTS_DIR;
const EMAIL = "trader@example.com";
const PASSWORD = "richtig-geheim-42";
const ME = "00000001-1111-4111-8111-111111111111";
const PROJECTS = ["mobile", "desktop"];

async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(1800); // entrances settle (JS animations are not frozen by `animations: "disabled"`)
  await page.screenshot({ path: `${SHOTS}/P12-social-${name}-${info.project.name === "mobile" ? "390" : "1440"}.png`, fullPage, animations: "disabled" });
}

/** Opens a page of the app and waits for its own `h1` (fails when it does not come up). */
async function open(page: Page, url = COMMUNITY_URL): Promise<void> {
  const res = await page.goto(url);
  expect(res?.ok(), `${url} answers`).toBe(true);
  await expect(page.locator('[data-page-role="current"] h1').first()).toBeVisible({ timeout: 30_000 });
}

async function setup(page: Page, social: MockSocialOptions = {}) {
  const errors = collectErrors(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  const sb = await mockSupabase(page);
  await mockBilling(page, { enabled: false });
  const soc = await mockSocial(page, social);
  await seed(page);
  return { sb, soc, errors };
}

async function ready(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[inert]")).toHaveCount(0);
}

/** The share sheet is ready once the camera dove into the R (the card behind the wall is inert until then). */
async function shareReady(sheet: Locator): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-pulse="glyph-zoom"]')).toHaveAttribute("data-covered", "", { timeout: 10_000 });
}

/**
 * Signs in through the header pill and closes the welcome sheet once the first sync is live. Afterwards no dialog is
 * open – unless `expectNext` (an invitation link opens the join sheet right after the login).
 */
async function signIn(page: Page, { expectNext = false }: { expectNext?: boolean } = {}): Promise<void> {
  await page.locator('[data-cloud-pill="signin"]').click();
  const sheet = page.getByRole("dialog", { name: "Anmelden" });
  await ready(sheet);
  await sheet.getByLabel("E-Mail").fill(EMAIL);
  await sheet.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await sheet.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Alles synchron.", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Los geht’s" }).click();
  if (expectNext) await expect(page.getByRole("dialog", { name: "Willkommen" })).toHaveCount(0);
  else await expect(page.getByRole("dialog")).toHaveCount(0);
}

const member = (id: string, pseudonym: string, role: MockGroup["members"][number]["role"], stats = false) => ({ id, pseudonym, role, shareLevel: stats ? ("stats" as const) : ("none" as const), figures: stats ? fig(0.31, 74, 58) : null });

test.describe("Community", () => {
  test.setTimeout(150_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "P12 runs on mobile + desktop");
  });

  test("without cloud: an honest, animated state – no ranking, no invented members", async ({ page }, info) => {
    const errors = collectErrors(page);
    await seed(page);
    await open(page, "/#community"); // the default build has no cloud
    await expect(page.getByRole("heading", { level: 1, name: "Community" })).toBeVisible();
    const card = page.getByTestId("community-no-cloud");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { name: "Community braucht die Cloud" })).toBeVisible();
    await expect(card.getByText("Statistik ab 10 Tradern")).toBeVisible();
    await expect(page.getByText("Einen Trade als Bild teilen", { exact: false })).toBeVisible();
    await expect(page.getByTestId("leaderboard-card")).toHaveCount(0);
    await expect(page.getByTestId("community-marquee")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "no-cloud", true);
    expect(errors).toEqual([]);
  });

  test("signed out: the pitch and the way in", async ({ page }, info) => {
    const { errors } = await setup(page);
    await open(page);
    await expect(page.getByTestId("community-signed-out")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Werde Teil der Community" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, info, "signed-out");
    await page.getByTestId("community-signin").click();
    await expect(page.getByRole("dialog", { name: "Anmelden" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("signed in: own card with percentile, ranking with podium; opting in puts the own row on the board", async ({ page }, info) => {
    const { soc, errors } = await setup(page, { optIn: false });
    await open(page);
    await signIn(page);
    const you = page.getByTestId("you-card");
    await expect(you.getByText("Stiller Falke 27")).toBeVisible();
    await expect(you.getByTestId("you-percentile")).toContainText("Besser als", { timeout: 15_000 });
    const board = page.getByTestId("leaderboard-card");
    await expect(board.getByTestId("podium-1")).toContainText("Kühner Luchs 14");
    await expect(board.getByTestId("board-row").first()).toBeVisible();
    await expect(board.locator("[data-me]")).toHaveCount(0);
    // the own figures are whole (the R figure was cut by 2 px at 1440)
    await expect(you.getByTestId("you-expectancy")).toContainText("R");
    expect(await clippedTexts(you.locator('[data-testid^="you-"] > .dot-num')), "cut own figures").toEqual([]);
    await expectNoHorizontalScroll(page);
    await shot(page, info, "board");

    await board.getByTestId("board-join").getByRole("button", { name: "Mitmachen" }).click();
    await expect(toast(page).getByText("Du bist in der Rangliste", { exact: false })).toBeVisible();
    expect(soc.me.optIn).toBe(true);
    await expect(board.locator("[data-me]")).toHaveCount(1);
    await expect(you.getByTestId("you-optin")).toHaveAttribute("aria-checked", "true");

    await board.getByRole("radio", { name: "Disziplin" }).click();
    await expect(board.getByText("Trades nach Plan und ohne Fehler.")).toBeVisible();
    await expect(board.getByTestId("podium-1")).toContainText("%");
    await page.getByTestId("you-reroll").click();
    await expect(you.getByText("Klarer Wolf 63")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("groups: create, invite link, a redacted trade for review, a comment with @mention", async ({ page }, info) => {
    const { soc, errors } = await setup(page);
    await open(page);
    await signIn(page);
    const groups = page.getByTestId("groups-card");
    await expect(groups.getByTestId("groups-empty")).toBeVisible();
    await groups.getByTestId("group-create").click();
    const sheet = page.getByRole("dialog", { name: "Neue Gruppe" });
    await ready(sheet);
    await sheet.getByTestId("group-name").fill("Morgenrunde");
    await sheet.getByTestId("group-create-submit").click();
    await expect(toast(page).getByText("Gruppe erstellt")).toBeVisible();
    await expect(groups.getByTestId("group-header")).toContainText("Morgenrunde");

    // invite link (copied)
    await groups.getByTestId("invite-member").click();
    await expect(toast(page).getByText("Link kopiert")).toBeVisible();
    await expect(groups.getByTestId("invite-row")).toHaveCount(1);
    const g = soc.groups[0]!;
    // a second member joins "on another device" (mock state) and shares stats
    g.members.push(member("22222222-2222-4222-8222-222222222222", "Ruhige Eule 81", "member", true));

    // review: pick a trade → share sheet → post to the group
    await groups.getByTestId("review-new").click();
    const picker = page.getByRole("dialog", { name: "Trade zur Review" });
    await ready(picker);
    await picker.getByTestId("pick-trade").first().click();
    const share = page.getByRole("dialog", { name: "Teilen" });
    await shareReady(share);
    await expect(share.getByText("Nie geteilt: Euro-Beträge", { exact: false })).toBeVisible();
    await share.getByPlaceholder("Frage an die Gruppe (optional)").fill("Stop zu eng?");
    await share.getByTestId("share-post-review").click();
    await expect(toast(page).getByText("Trade zur Review geteilt")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(g.reviews).toHaveLength(1);
    expect(JSON.stringify(g.reviews[0]!.payload)).not.toMatch(/"pnl"|"size"|"fees"|notes/);

    const review = groups.getByTestId("review-card").first();
    await expect(review).toContainText("Stop zu eng?");
    await review.getByRole("button", { name: "@Ruhige Eule 81" }).click();
    await review.getByTestId("comment-input").pressSequentially("Stop unter das Tief.");
    await review.getByTestId("comment-send").click();
    await expect(review.getByTestId("comment")).toHaveCount(1);
    expect(g.reviews[0]!.comments[0]!.mentions).toEqual(["22222222-2222-4222-8222-222222222222"]);
    await expect(groups.getByTestId("member-row")).toHaveCount(2);
    // the member lines are whole: "+0,31R · 74 % Disz. · 58 Tr." wraps between its parts at 390 px (was cut)
    await expect(groups.getByTestId("member-row").filter({ hasText: "Disz." })).toHaveCount(1);
    expect(await clippedTexts(groups.getByTestId("member-row")), "cut member texts").toEqual([]);
    await expectNoHorizontalScroll(page);
    await review.scrollIntoViewIfNeeded();
    await shot(page, info, "group");
    expect(errors).toEqual([]);
  });

  test("mentor desk: the review queue is dealt, a goal goes to the student", async ({ page }, info) => {
    const student = "33333333-3333-4333-8333-333333333333";
    const groups: MockGroup[] = [
      {
        id: "abcdabcd-0000-4000-8000-00000000a001",
        kind: "mentor",
        name: "Mentoring Q4",
        description: "Wöchentliche Trade-Reviews",
        ownerId: ME,
        members: [member(ME, "Stiller Falke 27", "owner"), member(student, "Kühner Luchs 14", "student", true), member("44444444-4444-4444-8444-444444444444", "Klare Möwe 33", "student")],
        invites: [],
        reviews: [
          { id: "abcdabcd-0000-4000-8000-00000000r001", authorId: student, payload: mockTradePayload(), question: "Warum bin ich hier rein?", status: "open", reviewedBy: null, createdAt: "2026-10-11T18:00:00Z", comments: [] },
          { id: "abcdabcd-0000-4000-8000-00000000r002", authorId: student, payload: mockTradePayload({ result: "win", r: 2.4, movePct: 3.1, pair: "ETHUSDT" }), question: "Teilgewinn zu früh?", status: "open", reviewedBy: null, createdAt: "2026-10-12T07:30:00Z", comments: [] },
        ],
      },
    ];
    const { soc, errors } = await setup(page, { groups });
    await open(page);
    await signIn(page);
    const desk = page.getByTestId("mentor-desk");
    await expect(desk.getByTestId("queue-card")).toHaveCount(2);
    await expect(desk).toContainText("2 offen");
    await desk.scrollIntoViewIfNeeded();
    await shot(page, info, "mentor");
    await desk.getByTestId("queue-card").first().getByRole("button", { name: "Erledigt" }).click();
    await expect(desk.getByTestId("queue-card")).toHaveCount(1);
    await desk.getByTestId("goal-open").first().click();
    const sheet = page.getByRole("dialog", { name: "Ziel für Kühner Luchs 14" });
    await ready(sheet);
    await sheet.getByTestId("goal-send").click();
    await expect(toast(page).getByText("Ziel vorgeschlagen")).toBeVisible();
    expect(soc.goals[0]).toMatchObject({ studentId: student, draft: { metric: "planAdherence", target: 0.9, comparator: "atLeast" } });
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test("student: sees only own reviews and the mentor's goals; declines one", async ({ page }) => {
    const groups: MockGroup[] = [
      {
        id: "abcdabcd-0000-4000-8000-00000000a002",
        kind: "mentor",
        name: "Mentoring",
        description: "",
        ownerId: "55555555-5555-4555-8555-555555555555",
        members: [member("55555555-5555-4555-8555-555555555555", "Treue Elster 58", "owner"), member(ME, "Stiller Falke 27", "student"), member("44444444-4444-4444-8444-444444444444", "Klare Möwe 33", "student")],
        invites: [],
        reviews: [{ id: "abcdabcd-0000-4000-8000-00000000r009", authorId: "44444444-4444-4444-8444-444444444444", payload: mockTradePayload(), question: "Nicht für dich", status: "open", reviewedBy: null, createdAt: "2026-10-11T18:00:00Z", comments: [] }],
      },
    ];
    const { soc, errors } = await setup(page, { groups });
    soc.goals.push({ id: "abcdabcd-0000-4000-8000-00000000g001", groupId: groups[0]!.id, mentorId: "55555555-5555-4555-8555-555555555555", studentId: ME, draft: { title: "Keine Regelbrüche", kind: "limit", metric: "ruleBreaks", target: 0, comparator: "atMost", period: "week" }, status: "open", createdAt: "2026-10-12T08:00:00Z" });
    await open(page);
    await signIn(page);
    const card = page.getByTestId("groups-card");
    await expect(card.getByTestId("feed-empty")).toBeVisible(); // the other student's review is not visible
    await expect(card.getByTestId("member-row")).toHaveCount(2); // owner + me, not the other student
    const goal = card.getByTestId("goal-item");
    await expect(goal).toContainText("Keine Regelbrüche");
    await goal.getByRole("button", { name: "Ablehnen" }).click();
    await expect(toast(page).getByText("Ziel abgelehnt")).toBeVisible();
    expect(soc.goals[0]!.status).toBe("declined");
    expect(errors).toEqual([]);
  });

  test("invitation link: sign in → the join sheet shows where you go → join (share stats on)", async ({ page }, info) => {
    const groups: MockGroup[] = [
      { id: "abcdabcd-0000-4000-8000-00000000a003", kind: "group", name: "Asia Open", description: "", ownerId: "55555555-5555-4555-8555-555555555555", members: [member("55555555-5555-4555-8555-555555555555", "Treue Elster 58", "owner")], invites: [{ code: "ABCDEFGH23", role: "member", uses: 0, maxUses: 10, expiresAt: "2026-12-31T00:00:00Z" }], reviews: [] },
    ];
    const { soc, errors } = await setup(page, { groups });
    await open(page, process.env.PW_COMMUNITY_URL ? `${COMMUNITY_URL}?invite=ABCDEFGH23` : cloudUrl("community?invite=ABCDEFGH23"));
    await expect(page.getByTestId("community-invite-waiting")).toBeVisible();
    expect(page.url()).not.toContain("invite=");
    await signIn(page, { expectNext: true });
    const sheet = page.getByRole("dialog", { name: "Gruppe beitreten" });
    await ready(sheet);
    await expect(sheet.getByTestId("join-preview")).toContainText("Einladung zu „Asia Open“");
    await shot(page, info, "join");
    await sheet.getByRole("switch").click();
    await sheet.getByTestId("join-submit").click();
    await expect(toast(page).getByText("Willkommen in „Asia Open“")).toBeVisible();
    await expect(page.getByTestId("group-header")).toContainText("Asia Open");
    expect(soc.groups[0]!.members.find((m) => m.id === ME)).toMatchObject({ role: "member", shareLevel: "stats" });
    expect(errors).toEqual([]);
  });

  test("team: the owner sees the seats of the Team plan", async ({ page }) => {
    const groups: MockGroup[] = [
      { id: "abcdabcd-0000-4000-8000-00000000a004", kind: "team", name: "Desk Berlin", description: "", ownerId: ME, seats: 5, members: [member(ME, "Stiller Falke 27", "owner"), member("66666666-6666-4666-8666-666666666666", "Fester Specht 83", "member")], invites: [], reviews: [] },
    ];
    const { errors } = await setup(page, { groups });
    await open(page);
    await signIn(page);
    await expect(page.getByTestId("team-seats")).toContainText("2 von 5 Sitzen belegt");
    await expect(page.getByTestId("member-row").filter({ hasText: "Sitz" })).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("share link: born from the trade, opened publicly, revoked at once", async ({ page, context }, info) => {
    const { soc, errors } = await setup(page);
    await open(page, TRADES_URL);
    await signIn(page);
    // the trade detail's footer carries the share button (P14)
    const row = info.project.name === "mobile" ? page.getByRole("list", { name: "Trades" }).locator("li").first().getByRole("button").first() : page.locator("tbody tr[tabindex='0']").first();
    await row.click();
    const detail = page.getByRole("dialog", { name: "Trade-Details" });
    await expect(detail).toBeVisible();
    await detail.getByTestId("share-button").click();
    const sheet = page.getByRole("dialog", { name: "Teilen" });
    await shareReady(sheet);
    await sheet.getByTestId("share-opt-prices").click();
    await expect(sheet.getByText("Einstieg, Ausstieg, Stop, Ziel")).toBeVisible();
    await shot(page, info, "share-sheet");
    await sheet.getByTestId("share-create").click();
    const url = await sheet.getByTestId("share-url").inputValue();
    expect(url).toMatch(/#share\/[A-Za-z0-9_-]{22}$/);
    await sheet.getByTestId("share-copy").click();
    await expect(toast(page).getByText("Link kopiert")).toBeVisible();
    expect(soc.shares[0]!.payload).toMatchObject({ kind: "trade" });
    expect(JSON.stringify(soc.shares[0]!.payload)).not.toMatch(/"pnl"|"size"|"fees"|notes|reason/);

    // the public view (another tab, same mocks)
    const pub = await context.newPage();
    await mockSupabase(pub);
    const viewer = await mockSocial(pub);
    viewer.shares.push(...soc.shares);
    // the link points at the app root (`/#share/<token>`); until P14 routes it, the harness serves the same hash
    await pub.goto(`${SHARE_BASE}${url.slice(url.indexOf("#"))}`);
    await expect(pub.getByTestId("shared-view")).toHaveAttribute("data-phase", "ok", { timeout: 20_000 });
    await expect(pub.getByTestId("trade-share-card")).toBeVisible();
    await expect(pub.getByText(/\d+× angesehen/)).toBeVisible(); // StrictMode (dev) reads twice
    await expectNoHorizontalScroll(pub);
    await shot(pub, info, "shared-view");

    // revoke in "Deine Links"
    await page.keyboard.press("Escape");
    await page.goto(COMMUNITY_URL);
    const links = page.getByTestId("shares-card");
    await expect(links.getByTestId("share-row")).toHaveCount(1);
    // the setup select shows the whole name ("Früher Makro-Trendbruch" was cut at 390 and 1440), and so does its list
    const pick = links.getByRole("button", { name: "Welche Grundlage?" });
    await expect(pick).toHaveText("Früher Makro-Trendbruch");
    expect(await clippedTexts(links), "cut texts in Deine Links").toEqual([]);
    await pick.click();
    const options = page.getByRole("listbox", { name: "Welche Grundlage?" });
    await expect(options.getByRole("option", { name: "4H-Neckline-Short unter 84.500" })).toBeVisible();
    expect(await clippedTexts(options), "cut setup names in the open select").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(options).toHaveCount(0);
    await links.getByTestId("share-revoke").click();
    await expect(toast(page).getByText("Link zurückgezogen")).toBeVisible();
    viewer.shares.splice(0, viewer.shares.length, ...soc.shares);
    await pub.reload();
    await expect(pub.getByTestId("shared-view")).toHaveAttribute("data-phase", "gone");
    await expect(pub.getByText("Dieser Link ist abgelaufen oder wurde zurückgezogen.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("feedback goes out; reduced motion shows the same page at rest", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { soc, errors } = await setup(page);
    await open(page);
    await signIn(page);
    const card = page.getByTestId("feedback-card");
    await card.getByRole("radio", { name: "Idee" }).click();
    await card.getByTestId("feedback-text").fill("Bitte ein Wochen-Ranking.");
    await card.getByTestId("feedback-send").click();
    await expect(toast(page).getByText("Danke! Dein Feedback ist angekommen.")).toBeVisible();
    await expect(card.getByTestId("feedback-sent")).toBeVisible();
    expect(soc.feedback[0]).toMatchObject({ kind: "idea", message: "Bitte ein Wochen-Ranking.", user: ME });
    await expectNoHorizontalScroll(page);
    expect(errors.filter((e) => !/Reduced Motion enabled/.test(e))).toEqual([]);
  });
});
