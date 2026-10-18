/**
 * F74 assistant end to end (no cloud, no AI key – the local understanding layer must carry it): the header button opens
 * the sheet from the overview; colloquial and typo questions get real answers (never the dead-end sentence); a follow-up
 * inherits the last question; "öffne das Labor" navigates; "merk dir" lands in `settings.assistant` and in the visible
 * memory; the microphone (a stubbed `SpeechRecognition`) fills and sends the question; without recognition the reason
 * is shown and typing still works; 390 px has no horizontal scroll; no console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const open = async (page: Page) => {
  await page.getByTestId("assistant-button").click();
  const dialog = page.getByRole("dialog", { name: "Assistent" });
  await expect(dialog).toBeVisible();
  return dialog;
};

const ask = async (page: Page, text: string) => {
  const input = page.getByTestId("assistant-input");
  await input.fill(text);
  await page.getByTestId("assistant-send").click();
};

const SPEECH_STUB = `
  window.__rec = [];
  class FakeRec {
    constructor() { this.lang = ""; window.__rec.push(this); }
    start() { setTimeout(() => this.onstart && this.onstart(), 10); }
    stop() { this.onend && this.onend(); }
    abort() {}
    say(text) {
      const result = [{ transcript: text }]; result.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [result] });
      this.onend && this.onend();
    }
  }
  window.SpeechRecognition = FakeRec;
  window.webkitSpeechRecognition = FakeRec;
`;

test.describe("Assistent", () => {
  test("opens from the header and answers colloquial questions and typos", async ({ page }) => {
    const errors = collectErrors(page);
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);

    await ask(page, "was lief gut");
    const answers = dialog.getByTestId("assistant-answer");
    await expect(answers.first()).toBeVisible();
    await expect(dialog).not.toContainText("Das habe ich nicht verstanden");

    await ask(page, "wie ist mein bestes Setpu");
    await expect(dialog.getByTestId("assistant-entry").last()).toContainText("setup");
    await expect(dialog.getByTestId("assistant-entry").last().getByTestId("assistant-answer").first()).toBeVisible();

    await ask(page, "blubb xyzzy plugh");
    await expect(dialog.getByTestId("assistant-entry").last()).toContainText("Meintest du");
    await dialog.getByTestId("assistant-suggestion").first().click();
    await expect(dialog.getByTestId("assistant-entry")).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test("a follow-up inherits the last question", async ({ page }) => {
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);
    await ask(page, "Wie ist meine Win-Rate am Montag?");
    await expect(dialog.getByTestId("assistant-entry")).toHaveCount(1);
    await ask(page, "und im Long?");
    const last = dialog.getByTestId("assistant-entry").last();
    await expect(last).toContainText("Folgefrage");
    await expect(last.getByTestId("assistant-answer").first()).toBeVisible();
  });

  test("opens pages and remembers what it is told", async ({ page }) => {
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);

    await ask(page, "merk dir: ich handle nur in der London-Session");
    await expect(dialog.getByTestId("assistant-entry").last()).toContainText("Gemerkt");
    await dialog.getByRole("button", { name: /Was ich über dich weiß/ }).click();
    await expect(dialog.getByTestId("assistant-memory")).toContainText("ich handle nur in der London-Session");
    await expect
      .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("tj2-settings") ?? "{}") as { assistant?: { facts?: { text: string }[] } }).assistant?.facts?.[0]?.text ?? ""), { timeout: 10_000 })
      .toContain("London");

    await ask(page, "öffne das Labor");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#labor/);
  });

  test("the keyboard shortcut A opens it", async ({ page }) => {
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    await page.locator("body").press("a");
    await expect(page.getByRole("dialog", { name: "Assistent" })).toBeVisible();
  });

  test("the microphone fills and sends the question", async ({ page }) => {
    await page.addInitScript(SPEECH_STUB);
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);
    await dialog.getByTestId("assistant-mic").click();
    await expect(dialog.getByTestId("assistant-mic")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => (window as unknown as { __rec: { say(t: string): void }[] }).__rec.at(-1)!.say("was lief gut"));
    await expect(dialog.getByTestId("assistant-entry").first()).toContainText("was lief gut");
    await expect(dialog.getByTestId("assistant-answer").first()).toBeVisible();
  });

  test("without speech recognition the reason is shown and typing works", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).SpeechRecognition = undefined;
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition = undefined;
    });
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);
    await expect(dialog.getByTestId("assistant-mic")).toBeDisabled();
    await expect(dialog.getByTestId("assistant-voice-note")).toContainText("kann nicht zuhören");
    await ask(page, "hallo");
    await expect(dialog.getByTestId("assistant-answer").first()).toBeVisible();
  });

  test("no horizontal scroll at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seed(page);
    await openRoute(page, "/#overview", "Übersicht");
    const dialog = await open(page);
    await ask(page, "was lief gut");
    await expect(dialog.getByTestId("assistant-answer").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
