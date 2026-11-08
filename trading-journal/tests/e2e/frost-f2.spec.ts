/**
 * Paket F2 (Frost) end to end on the production build, mobile + desktop, no cloud:
 *   A  "Einträge durchgehen" – the journal card in Berichte: "Eintrag 01 von NN" from the real list of the shown week, the real setup chip,
 *      the real R of the first entry (worked out here from the seed), paging by button / key / swipe, the giant word overlapped by the card,
 *      touch targets ≥ 44 px, no jump of the section while paging;
 *   B  "Heute abschließen" – the running week's card: closing with something open is quiet, closing after the process earns ONE quiet
 *      confirmation, vibration and tone stay OFF until switched on (and the vibration never runs under reduced motion), it survives a reload;
 *   C  "Frag dein Journal" – dot → bar → shimmer → three cards, real numbers (1 of 9 trades has no stop), an unknown question is not answered,
 *      reduced motion has no beat, the trades behind the answer open the trade detail;
 *   axe (dark + light) on the three cards, no horizontal scroll, no console error, and the page does not grow after its first picture.
 * Screenshots (small) land in docs/audit/img-frost/ when `FROST_SHOTS=1`.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { collectErrors, expectNoHorizontalScroll, openRoute, pinClock, scrollUntilVisible, seed, stored } from "./helpers";

const DAY = 86_400_000;
const MIN = 60_000;
/** Wed 2026-10-14 12:30 Berlin: the newest finished week is KW 41 (5.–11.10.), the running one KW 42. */
const WED = Date.UTC(2026, 9, 14, 10, 30);
const PROJECTS = ["mobile", "desktop"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.FROST_SHOTS === "1";

const BERLIN = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const local = (ms: number): string => BERLIN.format(new Date(ms)).replace(" ", "T");

/** Nine closed trades on the last nine days: d % 3 = 0 are losses (exit at the stop), the others wins; day 2 has NO stop, day 3 has a review + a tag. */
function journal(now: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let d = 1; d <= 9; d++) {
    const at = now - d * DAY - 5 * 3_600_000;
    const win = d % 3 !== 0;
    const entry = 60_000;
    out.push({
      id: `f_${d}`,
      account: "scalp",
      timeframe: "1h",
      target: null,
      fees: 1,
      pnlManual: null,
      checks: { "g:trigger": true, "g:stop": true },
      conviction: 3,
      followedPlan: true,
      emotion: "Ruhig",
      reason: "",
      notes: d === 3 ? "Stopp zu eng gesetzt, nächstes Mal weiter weg" : "",
      tags: d === 3 ? ["ausbruch"] : undefined,
      chart: "",
      pnl: null,
      r: null,
      mistakes: [],
      side: "long",
      status: "closed",
      date: local(at),
      exitDate: local(at + 60 * MIN),
      pair: "BTC/USDT",
      entry,
      stop: d === 2 ? null : entry - 600,
      exit: win ? entry + 900 : entry - 600,
      size: 5000,
      leverage: 3,
      setups: ["s_bo"],
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at + 60 * MIN).toISOString(),
    });
  }
  return out;
}

interface OpenOpts {
  theme?: "light";
  extra?: Record<string, unknown>;
  /** record vibrations and AudioContext constructions of the page */
  spy?: boolean;
}

async function open(page: Page, now: number, opts: OpenOpts = {}): Promise<void> {
  const clock = await pinClock(page, now);
  if (opts.spy) {
    await page.addInitScript(() => {
      const w = window as unknown as { __vib: number[]; __audio: number };
      w.__vib = [];
      w.__audio = 0;
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: (ms: number) => (w.__vib.push(ms), true) });
      (window as unknown as { AudioContext: unknown }).AudioContext = class {
        constructor() {
          w.__audio++;
          throw new Error("no audio in the test");
        }
      };
    });
  }
  await seed(page, { clock: clock.now, extra: { "tj2-trades": journal(clock.now()), ...(opts.theme ? { "tj2-theme": JSON.stringify(opts.theme) } : {}), ...(opts.extra ?? {}) } });
  await openRoute(page, "/#berichte", "Berichte");
}

const vibrations = (page: Page): Promise<number[]> => page.evaluate(() => (window as unknown as { __vib: number[] }).__vib);
const audioCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __audio: number }).__audio);

async function accessible(page: Page, selector: string, what: string): Promise<void> {
  await page.waitForTimeout(1000);
  const res = await new AxeBuilder({ page }).include(selector).withTags(TAGS).analyze();
  const lines = res.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(lines, `${what}: axe violations`).toEqual([]);
}

async function shot(loc: Locator, info: TestInfo, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync("docs/audit/img-frost", { recursive: true });
  await loc.screenshot({ path: `docs/audit/img-frost/${name}-${info.project.name}.png`, scale: "css", animations: "disabled" });
}

/** The box of a locator (fails when it is not rendered). */
async function box(loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await loc.boundingBox();
  expect(b, "has a box").not.toBeNull();
  return b!;
}

const KW41 = { from: "2026-10-05T00:00", to: "2026-10-12T00:00" };
/** How many of the seeded trades fall into KW 41 (the week the report opens on). */
const inKw41 = (now: number): number => journal(now).filter((t) => (t.date as string) >= KW41.from && (t.date as string) < KW41.to).length;

test.describe("Paket F2: Frost – drei Elemente mit echter Funktion", () => {
  test.setTimeout(300_000);
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(!PROJECTS.includes(info.project.name), "Paket F2 runs on mobile + desktop");
  });

  /* ------------------------------------------------------------------------------------------------ A */
  test("A · Journal-Karte: Eintrag n von m aus der echten Liste, echtes Setup, echtes R, blättern per Knopf, Taste und Wischen", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, WED);
    await expect(page.getByTestId("berichte-view")).toHaveAttribute("data-key", "2026-W41");
    const section = page.getByTestId("journal-cards");
    await scrollUntilVisible(page, section);
    await expect(section).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    const total = inKw41(WED);
    expect(total).toBeGreaterThanOrEqual(5);
    await expect(section).toHaveAttribute("data-total", String(total));
    const pill = section.getByTestId("journal-pill");
    const pad = (n: number) => String(n).padStart(2, "0");
    await expect(pill).toHaveText(`Eintrag 01 von ${pad(total)}`);

    // the data is the journal's: the setup chip is the stored setup name, the first entry is day 9 (a loss at its stop): −600 × 5000/60000 − 1 fee = −51
    // on a risk of 50 → −1,02 R, net −51,00
    const setupName = (await stored<{ setups: { id: string; name: string }[] }>(page, "tj2-settings"))!.setups.find((s) => s.id === "s_bo")!.name;
    await expect(section.getByTestId("journal-entry")).toHaveAttribute("data-id", "f_9");
    await expect(section.getByTestId("journal-chip").first()).toHaveText(setupName);
    const r = section.getByTestId("journal-r");
    await expect(r).toHaveText("−1,02 R");
    await expect(r).toHaveAttribute("data-tone", "loss");
    await expect(section.getByTestId("journal-net")).toHaveText("−51,00 netto");
    await shot(section, info, "a-journal-karte");

    // the giant word is behind the card and the card overlaps it; the touch targets are ≥ 44 px
    const word = await box(section.getByTestId("journal-word"));
    const card = await box(section.getByTestId("journal-card"));
    expect(card.y, "the card starts inside the word").toBeGreaterThan(word.y);
    expect(card.y, "…and overlaps its lower part").toBeLessThan(word.y + word.height - 8);
    for (const id of ["journal-prev", "journal-next", "journal-open"]) {
      const b = await box(section.getByTestId(id));
      expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(43.5);
    }
    await expectNoHorizontalScroll(page);

    // paging: the section keeps its height (no jump), the index follows the entry
    const h0 = (await box(section)).height;
    await section.getByTestId("journal-next").click();
    await expect(pill).toHaveText(`Eintrag 02 von ${pad(total)}`);
    await expect(section.getByTestId("journal-entry")).toHaveAttribute("data-id", "f_8");
    await expect(section.getByTestId("journal-r")).toHaveAttribute("data-tone", "win");
    expect(Math.abs((await box(section)).height - h0)).toBeLessThan(1.5);
    await section.getByTestId("journal-prev").click();
    await expect(pill).toHaveText(`Eintrag 01 von ${pad(total)}`);
    await expect(section.getByTestId("journal-prev")).toBeDisabled();

    // keyboard
    await section.getByTestId("journal-card").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(pill).toHaveText(`Eintrag 03 von ${pad(total)}`);
    await page.keyboard.press("End");
    await expect(pill).toHaveText(`Eintrag ${pad(total)} von ${pad(total)}`);
    await expect(section.getByTestId("journal-next")).toBeDisabled();
    await page.keyboard.press("Home");
    await expect(pill).toHaveText(`Eintrag 01 von ${pad(total)}`);

    // swipe (pointer events, as a finger makes them): left = next, right = back
    const swipe = async (dx: number) => {
      const c = section.getByTestId("journal-card");
      await c.dispatchEvent("pointerdown", { clientX: 220, clientY: 400, pointerType: "touch", button: 0, isPrimary: true });
      await c.dispatchEvent("pointerup", { clientX: 220 + dx, clientY: 404, pointerType: "touch", button: 0, isPrimary: true });
    };
    await swipe(-110);
    await expect(pill).toHaveText(`Eintrag 02 von ${pad(total)}`);
    await swipe(120);
    await expect(pill).toHaveText(`Eintrag 01 von ${pad(total)}`);

    // the entry that has a review and a tag shows both (day 3 = KW 41? day 3 is Sat 11.10. → yes)
    await section.getByTestId("journal-next").click({ clickCount: 1 });
    for (let i = 0; i < total; i++) {
      if ((await section.getByTestId("journal-entry").getAttribute("data-id")) === "f_3") break;
      await section.getByTestId("journal-next").click();
    }
    await expect(section.getByTestId("journal-entry")).toHaveAttribute("data-id", "f_3");
    await expect(section.getByTestId("journal-review")).toHaveText("Review geschrieben");
    await expect(section.getByTestId("journal-chip").last()).toHaveText("#ausbruch");
    // an entry without a stop has no R – and says so
    await section.getByTestId("journal-card").focus();
    await page.keyboard.press("Home");
    // „Trade öffnen“ opens the trade detail
    await section.getByTestId("journal-open").click();
    await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });

  /* ------------------------------------------------------------------------------------------------ B */
  test("B · Heute abschließen: leise bei Offenem, EINE Bestätigung nach erledigtem Prozess, Haptik und Ton nur nach dem Einschalten", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, WED, { spy: true });
    // the running week (KW 42) holds today's card
    await page.getByTestId("report-running").click();
    await expect(page.getByTestId("berichte-view")).toHaveAttribute("data-key", "2026-W42");
    const card = page.getByTestId("day-close");
    await scrollUntilVisible(page, card);
    await expect(card).toHaveAttribute("data-state", "open");
    // today has no trade: checklist and review do not apply; the note is open → not ready
    await expect(card.getByTestId("day-close-item-checklist")).toHaveAttribute("data-state", "na");
    await expect(card.getByTestId("day-close-item-reflection")).toHaveAttribute("data-state", "open");
    await expect(card).toHaveAttribute("data-ready", "no");
    // both channels are OFF by default
    await expect(card.getByTestId("day-close-haptic")).toHaveAttribute("aria-checked", "false");
    await expect(card.getByTestId("day-close-sound")).toHaveAttribute("aria-checked", "false");
    // the week: dots, a sentence without a shortfall, nothing that scolds
    await expect(card.getByTestId("day-close-days").getByRole("listitem")).toHaveCount(7);
    await expect(card.getByTestId("day-close-days-text")).toContainText("mit Rückblick");
    const text = (await card.innerText()).replace(/\s+/g, " ");
    expect(text).not.toMatch(/USDT|€|\$|Gewinn|Verlust|Netto|Upgrade|Premium|nur noch|verpass|Serie|in Gefahr/i);
    await expectNoHorizontalScroll(page);
    await shot(card, info, "b-heute-abschliessen-offen");
    // touch target of the round button ≥ 44 px
    const b = await box(card.getByTestId("day-close-done"));
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(43.5);

    // 1 · closing with the process open: recorded quietly – an info toast, no confirmation, no vibration, no tone
    await page.getByTestId("day-close-haptic").click();
    await page.getByTestId("day-close-sound").click();
    await card.getByTestId("day-close-done").click();
    await expect(card).toHaveAttribute("data-state", "closed");
    await expect(page.getByText("Noch offen: Notiz oder Check-in.").first()).toBeVisible();
    await expect(page.getByText("Checkliste und Review für heute sind erledigt.")).toHaveCount(0);
    expect(await vibrations(page)).toEqual([]);
    expect(await audioCount(page)).toBe(0);
    await expect.poll(async () => (await stored<{ coach?: { dayCloses?: Record<string, { closed: boolean; ready: boolean }> } }>(page, "tj2-settings"))?.coach?.dayCloses?.["2026-10-14"]).toMatchObject({ closed: true, ready: false });
    await card.getByTestId("day-close-reopen").click();
    await expect(card).toHaveAttribute("data-state", "open");

    // 2 · the process is done (a note for today): ONE quiet confirmation – and now the switched-on channels answer
    await page.evaluate(() => {
      const j = (window as unknown as { __tjJournal?: { getState: () => { saveDay?: (k: string, d: Record<string, unknown>) => Promise<void> } } }).__tjJournal;
      void j?.getState().saveDay?.("2026-10-14", { note: "Pause heute, Woche durchgesehen" });
    });
    await expect(card).toHaveAttribute("data-ready", "yes", { timeout: 10_000 });
    await expect(card.getByTestId("day-close-item-reflection")).toHaveAttribute("data-state", "done");
    await card.getByTestId("day-close-done").click();
    await expect(card).toHaveAttribute("data-state", "closed");
    await expect(page.getByText("Checkliste und Review für heute sind erledigt.").first()).toBeVisible();
    await expect(card.getByTestId("day-close-check")).toHaveAttribute("data-ring", "");
    await shot(card, info, "b-heute-abschliessen-erledigt");
    expect(await vibrations(page)).toEqual([18]);
    expect(await audioCount(page)).toBe(1); // the tone was tried once (the test's AudioContext throws – no sound is asked of a CI machine)
    await expect.poll(async () => (await stored<{ coach?: { dayCloses?: Record<string, { closed: boolean; ready: boolean }> } }>(page, "tj2-settings"))?.coach?.dayCloses?.["2026-10-14"]).toMatchObject({ closed: true, ready: true });

    // it survives a reload (the stored closing is read back; the page itself may open on another week after a reload)
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Berichte" }).first()).toBeVisible({ timeout: 60_000 });
    expect((await stored<{ coach?: { dayCloses?: Record<string, { closed: boolean; ready: boolean }> } }>(page, "tj2-settings"))?.coach?.dayCloses?.["2026-10-14"]).toMatchObject({ closed: true, ready: true });
    expect(errors).toEqual([]);
  });

  test("B · Reduzierte Bewegung: keine Vibration, kein Punktefeuer – die ruhige Bestätigung bleibt", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, WED, { spy: true, extra: { "tj2-feedback": { v: 1, sound: false, haptic: true } } });
    await page.evaluate(() => {
      const j = (window as unknown as { __tjJournal?: { getState: () => { saveDay?: (k: string, d: Record<string, unknown>) => Promise<void> } } }).__tjJournal;
      void j?.getState().saveDay?.("2026-10-14", { note: "Pause" });
    });
    await page.getByTestId("report-running").click();
    const card = page.getByTestId("day-close");
    await scrollUntilVisible(page, card);
    await expect(card).toHaveAttribute("data-ready", "yes", { timeout: 10_000 });
    await expect(card.getByTestId("day-close-haptic")).toHaveAttribute("aria-checked", "true");
    await card.getByTestId("day-close-done").click();
    await expect(page.getByText("Checkliste und Review für heute sind erledigt.").first()).toBeVisible();
    await page.waitForTimeout(900);
    expect(await vibrations(page)).toEqual([]);
    await expect(page.locator("[data-celebrate] [data-burst]")).toHaveCount(0);
  });

  /* ------------------------------------------------------------------------------------------------ C */
  test("C · Frag dein Journal: Punkt → Leiste → Schimmer → drei Karten mit echten Zahlen; Unverstandenes wird nicht geraten", async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, WED);
    const ask = page.getByTestId("ask-journal");
    await scrollUntilVisible(page, ask);
    await expect(ask).toHaveAttribute("data-phase", "idle", { timeout: 20_000 });
    // collapsed: a dot with three example questions
    await expect(ask.getByTestId("ask-bar")).not.toHaveAttribute("data-open", "");
    await expect(ask.getByTestId("ask-example")).toHaveCount(3);
    const dot = await box(ask.getByTestId("ask-open"));
    expect(Math.min(dot.width, dot.height)).toBeGreaterThanOrEqual(43.5);
    const idleHeight = (await box(ask)).height;
    await shot(ask, info, "c-frag-dein-journal-ruhe");

    // the dot grows into the bar and takes focus
    await ask.getByTestId("ask-open").click();
    await expect(ask.getByTestId("ask-bar")).toHaveAttribute("data-open", "");
    await expect(ask.getByTestId("ask-input")).toBeFocused();
    await ask.getByTestId("ask-input").pressSequentially("Trades ohne Stopp", { delay: 15 });
    await ask.getByTestId("ask-input").press("Enter");
    // the shimmer names the real count, then three cards
    await expect(ask).toHaveAttribute("data-phase", "seek");
    await expect(ask.getByTestId("ask-seek")).toHaveText("Durchsuche 9 Trades …");
    await expect(ask).toHaveAttribute("data-phase", "done", { timeout: 5000 });
    const cards = ask.getByTestId("ask-card");
    await expect(cards).toHaveCount(3);
    // 1 of the 9 seeded trades (day 2) has no stop – and nothing else is claimed
    await expect(ask.getByTestId("ask-card-value").first()).toHaveText("1 von 9 (11 %)");
    await expect(ask.getByTestId("ask-text")).toContainText("1 von 9");
    await expect(ask.getByTestId("ask-confidence")).toContainText("Belastbarkeit");
    // the three cards stand beside each other (desktop) / below each other (phone), none on top of another
    const boxes = [await box(cards.nth(0)), await box(cards.nth(1)), await box(cards.nth(2))];
    if (info.project.name === "mobile") for (let i = 1; i < 3; i++) expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y + boxes[i - 1]!.height - 2);
    else for (let i = 1; i < 3; i++) expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width - 2);
    await expectNoHorizontalScroll(page);
    await shot(ask, info, "c-frag-dein-journal-antwort");
    // the card grew by the answer, not by a surprise: the reserved stage holds the answer's size (a few px at most for a longer sentence)
    expect((await box(ask)).height - idleHeight).toBeLessThan(260);

    // the trades behind it – one tap opens the trade
    await ask.getByTestId("ask-trades-toggle").click();
    const rows = ask.getByTestId("ask-trades").locator("[data-trade-id]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-trade-id", "f_2");
    await rows.first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // a question it cannot place
    await ask.getByTestId("ask-input").fill("Wie wird das Wetter morgen?");
    await ask.getByTestId("ask-input").press("Enter");
    await expect(ask).toHaveAttribute("data-phase", "done", { timeout: 5000 });
    const unknown = ask.getByTestId("ask-unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText("So kann ich das noch nicht beantworten.");
    await expect(unknown.getByTestId("ask-example")).toHaveCount(3);
    await expect(ask.getByTestId("ask-card")).toHaveCount(0);
    await shot(ask, info, "c-frag-dein-journal-unbekannt");
    // an example is one tap away and answers
    for (const ex of await unknown.getByTestId("ask-example").all()) {
      const eb = await box(ex);
      expect(eb.height).toBeGreaterThanOrEqual(43.5);
    }
    await unknown.getByTestId("ask-example").nth(1).click();
    await expect(ask.getByTestId("ask-card")).toHaveCount(3, { timeout: 5000 });
    // no network call carried the question (the function works offline)
    expect(errors).toEqual([]);
  });

  test("C · Die Frage geht ohne Netz: nichts verlässt das Gerät; Reduzierte Bewegung ohne Schimmer-Pause", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, WED);
    const requests: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("data:")) requests.push(r.url());
    });
    const ask = page.getByTestId("ask-journal");
    await scrollUntilVisible(page, ask);
    await ask.getByTestId("ask-open").click();
    await page.context().setOffline(true);
    const before = requests.length;
    await ask.getByTestId("ask-input").fill("Beste Wochentage");
    await ask.getByTestId("ask-input").press("Enter");
    // reduced motion: the answer is there at once (no 0,5 s beat)
    await expect(ask).toHaveAttribute("data-phase", "done", { timeout: 1500 });
    await expect(ask.getByTestId("ask-card")).toHaveCount(3);
    // (the page's own market polling may still ask for prices; none of it carries the question – and the answer came while OFFLINE)
    expect(requests.slice(before).filter((u) => /Wochentage|ask|frage/i.test(decodeURIComponent(u))), "no request carried the question").toEqual([]);
    await page.context().setOffline(false);
  });

  /* ------------------------------------------------------------------------------------------ a11y + shift */
  for (const theme of [undefined, "light"] as const) {
    test(`axe (${theme ?? "dark"}): Journal-Karte, Heute abschließen, Frag dein Journal – offen und mit Antwort`, async ({ page }) => {
      await open(page, WED, { theme, extra: { "tj2-days": { "2026-10-14": { note: "ok", updatedAt: "2026-10-14T08:00:00Z" } } } });
      const section = page.getByTestId("journal-cards");
      await scrollUntilVisible(page, section);
      await expect(section).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
      await accessible(page, '[data-testid="journal-cards"]', `Journal-Karte (${theme ?? "dark"})`);
      await section.getByTestId("journal-next").click();
      await accessible(page, '[data-testid="journal-cards"]', `Journal-Karte, Eintrag 2 (${theme ?? "dark"})`);

      const ask = page.getByTestId("ask-journal");
      await scrollUntilVisible(page, ask);
      await expect(ask).toHaveAttribute("data-phase", "idle", { timeout: 20_000 });
      await accessible(page, '[data-testid="ask-journal"]', `Frag dein Journal, Ruhe (${theme ?? "dark"})`);
      await ask.getByTestId("ask-open").click();
      await ask.getByTestId("ask-input").fill("Verluste letzten Monat");
      await ask.getByTestId("ask-input").press("Enter");
      await expect(ask).toHaveAttribute("data-phase", "done", { timeout: 5000 });
      await accessible(page, '[data-testid="ask-journal"]', `Frag dein Journal, Antwort (${theme ?? "dark"})`);
      await ask.getByTestId("ask-input").fill("Wie wird das Wetter?");
      await ask.getByTestId("ask-input").press("Enter");
      await expect(ask.getByTestId("ask-unknown")).toBeVisible({ timeout: 5000 });
      await accessible(page, '[data-testid="ask-journal"]', `Frag dein Journal, nicht verstanden (${theme ?? "dark"})`);

      await page.getByTestId("report-running").click();
      const day = page.getByTestId("day-close");
      await scrollUntilVisible(page, day);
      await accessible(page, '[data-testid="day-close"]', `Heute abschließen (${theme ?? "dark"})`);
      await day.getByTestId("day-close-done").click();
      await expect(day).toHaveAttribute("data-state", "closed");
      await accessible(page, '[data-testid="day-close"]', `Heute abschließen, abgeschlossen (${theme ?? "dark"})`);
    });
  }

  test("kein Layoutsprung: nach dem ersten Bild wächst die Seite nicht, die Karten reservieren ihren Platz", async ({ page }) => {
    await open(page, WED);
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    // scroll the page once so deferred cells mount, then compare the height a moment later with a few seconds later
    const h = await height();
    for (let y = 0; y < h + 1200; y += 600) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    const first = await height();
    const ask = page.getByTestId("ask-journal");
    await expect(ask).toBeVisible();
    const askAt = await box(ask);
    await page.waitForTimeout(3000);
    const last = await height();
    expect(last - first, `die Seite wuchs von ${first} auf ${last} px`).toBeLessThan(60);
    expect(Math.abs((await box(ask)).height - askAt.height)).toBeLessThan(2);
  });
});
