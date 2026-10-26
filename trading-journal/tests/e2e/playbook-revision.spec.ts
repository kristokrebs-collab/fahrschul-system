/**
 * F45 Playbook-Fassungen end to end (production build, market mock): ein Playbook mit Kennung und Fassung wird eingelesen und als
 * fremder Entwurf angelegt; dieselbe Datei in Fassung 2 wird als NEUERE FASSUNG des Entwurfs erkannt (Unterschied in Klartext, nichts
 * passiert vor dem Klick), als neue Version übernommen; die Checkliste wird auf Wunsch eine Entscheidungsgrundlage im Journal.
 * Keine Uhr-Sprünge, nur Endzustände. Läuft auf `/#labor`, mobil + Desktop.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const LABOR_URL = process.env.PW_LABOR_URL ?? "/#labor";
const PROJECTS = ["mobile", "desktop"];

type Json = Record<string, unknown>;

/** the first rule with a numeric `level` gets another one */
function withLevel(node: unknown, level: number): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as Json;
  const params = n.params as Json | undefined;
  if (n.type === "leaf" && params && typeof params.level === "number") {
    params.level = level;
    return true;
  }
  return Array.isArray(n.children) && n.children.some((c) => withLevel(c, level));
}

async function open(page: Page, info: TestInfo): Promise<string[]> {
  test.skip(!PROJECTS.includes(info.project.name), "Labor runs on mobile + desktop");
  const errors = collectErrors(page);
  await seed(page, { boxes: true, extra: { "tj2-labor": { strategy: "custom", symbol: "BTCUSDT", period: "6m" } } });
  await openRoute(page, LABOR_URL, "Labor");
  return errors;
}

test.describe("Labor · Playbook-Fassungen", () => {
  test.setTimeout(120_000);

  test("Fassung 1 einlesen → Fassung 2 als neuere Fassung erkennen → als neue Version übernehmen → Checkliste ins Journal", async ({ page }, info) => {
    const errors = await open(page, info);
    const card = page.getByTestId("labor-playbook");
    await card.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await expect(card).toBeVisible();
    const base = JSON.parse(await card.getByTestId("playbook-text").inputValue()) as Json;
    delete base.key;
    const file = (level: number, rev: number, extra: Json = {}): string => {
      const pb = JSON.parse(JSON.stringify(base)) as Json;
      expect(withLevel((pb.idea as Json).long, level)).toBe(true);
      return JSON.stringify({ ...pb, title: "Fremde Idee", author: "Mia", id: "pb-e2etest0001", rev, ...extra });
    };

    // Fassung 1 mit Checkliste: Vorschau, dann als fremden Entwurf anlegen
    await card.getByTestId("playbook-input").fill(file(30, 1, { checklist: ["News geprüft", "Spread normal"] }));
    await card.getByTestId("playbook-check").click();
    const preview = card.getByTestId("playbook-preview");
    await expect(preview).toContainText("Fassung 1");
    await expect(preview.getByTestId("playbook-preview-checklist")).toContainText("Checkliste des Autors (2)");
    await expect(preview.getByTestId("playbook-update")).toHaveCount(0);
    await preview.getByTestId("playbook-create").click();
    await expect(preview.getByTestId("playbook-probe")).toBeVisible();

    // Fassung 2: erkannt als neuere Fassung desselben Playbooks; vor dem Klick bleibt alles, wie es war
    await card.getByTestId("playbook-input").fill(file(22, 2, { changes: "tieferes RSI-Niveau" }));
    await card.getByTestId("playbook-check").click();
    const update = card.getByTestId("playbook-update");
    await expect(update).toHaveAttribute("data-relation", "newer");
    await expect(update).toContainText("Dein Entwurf „Fremde Idee“ hat Fassung 1, diese Datei Fassung 2.");
    await expect(update.getByTestId("playbook-update-diff")).toContainText("RSI Niveau: 30 → 22");
    await expect(update).toContainText("Die App abonniert nichts");
    const draftRules = () => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.endsWith("labor-drafts")).map(([, v]) => v).join(""));
    expect(await draftRules()).toContain('"level":30');
    await expectNoHorizontalScroll(page);
    await update.getByTestId("playbook-update-apply").click();
    await expect(update).toContainText("Fassung 2 übernommen");
    const after = await draftRules();
    expect(after).toContain('"level":22');
    expect(after).toContain('"rev":2');

    // die Version steht im Abschnitt „Versionen“ mit der Notiz der Fassung
    const versions = page.getByTestId("labor-versions");
    await versions.scrollIntoViewIfNeeded();
    await expect(versions.getByTestId("version-note").first()).toHaveValue("Fassung 2 von Mia: tieferes RSI-Niveau");
    await expect(versions).toContainText("RSI Niveau: 30 → 22");

    // Checkliste → Entscheidungsgrundlage im Journal: erst nach dem Klick
    const setups = () => page.evaluate(() => ((window as unknown as { __tjJournal: { getState(): { settings: { setups: { name: string; checklist: { text: string }[] }[] } } } }).__tjJournal.getState().settings.setups).filter((s) => s.name === "Fremde Idee").map((s) => s.checklist.map((c) => c.text)));
    expect(await setups()).toEqual([]);
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId("playbook-input").fill(file(22, 2, { checklist: ["News geprüft", "Spread normal"] }));
    await card.getByTestId("playbook-check").click();
    await card.getByTestId("playbook-journal").click();
    await expect.poll(setups, { timeout: 15_000 }).toEqual([["News geprüft", "Spread normal"]]);

    const res = await new AxeBuilder({ page }).include('[data-testid="labor-playbook"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await card.screenshot({ path: `/tmp/shots/${info.project.name}-playbook-revision.png`, animations: "disabled" });
    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
