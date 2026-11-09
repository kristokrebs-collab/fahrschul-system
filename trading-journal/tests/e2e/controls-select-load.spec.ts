/**
 * Auswahlliste (MorphSelect) unter Last: die Optik der reichen Seiten (Zeilen-Staffel, Marker, Häkchen, Pfeil) darf die Öffnen-Zuverlässigkeit
 * nicht ändern. Je Lauf wird das Währungsfeld der Einstellungen fünfmal geöffnet (Maus: Klick, Touch: Tippen), eine Zeile gewählt, das Feld liest den
 * neuen Wert, die Liste ist zu. Gedacht für `--repeat-each=10 --workers=4` (viele Läufe gleichzeitig = Last); dieselbe Datei läuft gegen den
 * Build davor und danach, der Vergleich ist die Zahl der Läufe, die ohne Wiederholung grün sind, und die Zeit bis „offen“.
 */
import { expect, test } from "@playwright/test";
import { collectErrors, seed } from "./helpers";

const ROUNDS = 5;

test("Auswahlliste öffnet bei jedem Antippen (Einstellungen › Währung)", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await seed(page);
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible({ timeout: 40_000 });
  const currency = page.locator("#s-currency");
  await currency.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const touch = !!info.project.use.hasTouch;
  const times: number[] = [];
  const values = ["EUR", "USD", "USDT", "EUR", "USDT"];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Date.now();
    if (touch) await currency.tap();
    else await currency.click();
    await expect(currency).toHaveAttribute("aria-expanded", "true", { timeout: 8000 });
    times.push(Date.now() - t0);
    const want = values[i] ?? "EUR";
    const option = page.getByRole("listbox").getByRole("option", { name: want, exact: true });
    if (touch) await option.tap();
    else await option.click();
    await expect(currency).toHaveAttribute("data-value", want, { timeout: 8000 });
    await expect(page.getByRole("listbox")).toHaveCount(0, { timeout: 8000 });
  }
  console.log(`SELECT ${info.project.name}: Zeit bis offen (ms, inkl. Klick) ${times.join(" ")}`);
  expect(errors, errors.join("\n")).toEqual([]);
});
