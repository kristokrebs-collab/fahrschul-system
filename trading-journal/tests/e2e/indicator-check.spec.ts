/**
 * F64 / F14 end to end (production build, market mock): der Indikator-Vertrag und der Abgleich einer TradingView-Chartdaten-CSV mit der
 * Berechnung des Labors, im Browser gelesen (nichts wird hochgeladen). Die Datei wird im Test nach dem Format des Exports gebaut (Spalten
 * aus den Funktionen des Labors auf der festen Testreihe) – eine echte Exportdatei aus einem TradingView-Konto liegt der Prüfung nicht vor.
 * Keine Uhr-Sprünge, nur Endzustände; mobil + Desktop, axe, kein seitliches Scrollen.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { cleanInputs, compareIndicator, defaultInputs, indicatorById, parseTvChart, testBars } from "../../src/domain/tvimport";
import { collectErrors, expectNoHorizontalScroll, openRoute, seed } from "./helpers";

const PROJECTS = ["mobile", "desktop"];

/** the export of an RSI(14) plot over the 4-decimal candles of the test series */
function rsiExport(n = 400): string {
  const iso = (sec: number): string => new Date(sec * 1000).toISOString().replace(".000Z", "Z");
  const bars = testBars(n).map((b) => ({ ...b, o: +b.o.toFixed(4), h: +b.h.toFixed(4), l: +b.l.toFixed(4), c: +b.c.toFixed(4) }));
  const d = indicatorById("rsi")!;
  const rsi = d.compute(bars, defaultInputs(d)).rsi!;
  return ["time,open,high,low,close,Volume,RSI", ...bars.map((b, i) => `${iso(b.t)},${b.o},${b.h},${b.l},${b.c},${b.v},${Number.isFinite(rsi[i]!) ? rsi[i]!.toFixed(6) : ""}`)].join("\n");
}

test.describe("Labor · Indikator-Abgleich", () => {
  test.setTimeout(120_000);

  test("Vertrag aufklappen, Export lesen, „gleichwertig validiert“, falsche Eingabe weicht ab – nichts wird hochgeladen", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    const errors = collectErrors(page);
    const posts: string[] = [];
    page.on("request", (r) => r.method() === "POST" && posts.push(r.url()));
    await seed(page, { boxes: true });
    await openRoute(page, "/#labor", "Labor");
    const card = page.getByTestId("labor-tv-indicators");
    await card.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await expect(card).toBeVisible({ timeout: 30_000 });

    // der Vertrag: zu, dann auf – gemessener erster Wert, Prüfaussage, kein Wiederzeichnen
    await expect(page.getByTestId("labor-tv-known")).toContainText("kein Wiederzeichnen");
    await expect(page.getByTestId("labor-tv-contract-item")).toHaveCount(0);
    await page.getByTestId("labor-tv-contract-toggle").click();
    await expect(page.getByTestId("labor-tv-contract-item")).toHaveCount(12);
    const rsi = page.locator('[data-testid="labor-tv-contract-item"][data-indicator="rsi"]');
    await expect(rsi).toContainText("ta.rsi(close, 14)");
    await expect(rsi.getByTestId("labor-tv-warmup")).toContainText("ab Kerze 15");
    await expect(page.locator('[data-testid="labor-tv-contract-item"][data-indicator="keltner"]')).toContainText("nicht gegen TradingView-Zahlen geprüft");
    await expectNoHorizontalScroll(page);
    await page.getByTestId("labor-tv-contract-toggle").click();

    // der Abgleich
    await page.getByTestId("labor-tv-ind-file").setInputFiles({ name: "chart.csv", mimeType: "text/csv", buffer: Buffer.from(rsiExport()) });
    await expect(page.getByTestId("labor-tv-ind-summary")).toContainText("400 Kerzen gelesen");
    await expect(page.getByTestId("labor-tv-ind-summary")).toContainText("Zeiteinheit 1D");
    const col = page.getByTestId("labor-tv-ind-col");
    await expect(col).toHaveAttribute("data-column", "RSI");
    await expect(col.getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "equal");
    await expect(col.getByTestId("labor-tv-ind-result")).toContainText("gleichwertig validiert");
    await expectNoHorizontalScroll(page);

    // eine andere Länge als im Chart weicht ab, mit den größten Abweichungen
    const len = col.getByTestId("labor-tv-ind-in-len");
    await len.fill("21");
    await len.blur();
    await expect(col.getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "differs");
    await expect(col.getByTestId("labor-tv-ind-worst").getByRole("listitem")).toHaveCount(5);
    await len.fill("14");
    await len.blur();
    await expect(col.getByTestId("labor-tv-ind-result")).toHaveAttribute("data-verdict", "equal");

    const res = await new AxeBuilder({ page }).include('[data-testid="labor-tv-indicators"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await card.screenshot({ path: `/tmp/shots/${info.project.name}-indicator-check.png`, animations: "disabled" });
    expect(posts.filter((u) => !u.includes("127.0.0.1") && !u.includes("localhost"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("dieselbe Datei gibt in der Seite und im Rechenkern dasselbe Urteil (die Seite rechnet nichts anderes)", async ({ page }, info) => {
    test.skip(!PROJECTS.includes(info.project.name), "mobile + desktop");
    const chart = parseTvChart(rsiExport());
    expect(chart.errors).toEqual([]);
    const d = indicatorById("rsi")!;
    const r = compareIndicator(chart, chart.columns[0]!, d, "rsi", cleanInputs(d, { len: 14 }));
    expect(r.verdict).toBe("equal");
    expect(r.compared).toBe(386);
    void page;
  });
});
