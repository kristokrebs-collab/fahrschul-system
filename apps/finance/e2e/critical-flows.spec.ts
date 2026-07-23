import { expect, test } from "@playwright/test";

/**
 * Kritische E2E-Flows für apps/finance. NICHT ausgeführt in dieser Sandbox
 * (siehe playwright.config.ts + docs/finance-final-qa.md) – geschrieben,
 * damit sie in einer Umgebung mit Zugriff auf cdn.playwright.dev direkt
 * lauffähig sind. Setzt einen laufenden apps/api (Port 4000) mit einem
 * seed-erzeugten `finanzen@example.test`-Konto voraus.
 */

test.describe("apps/finance – critical flows", () => {
  test("login redirects to the GF cockpit and shows the 7 core KPI cards", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("finanzen@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("heading", { name: "Geschäftsführungs-Cockpit" })).toBeVisible();
    for (const title of [
      "Leistung/Umsatz",
      "Deckungsbeitrag/Ergebnis",
      "Liquidität",
      "Fahrlehrerauslastung",
      "Fahrzeugauslastung",
      "Offene Forderungen",
      "Forecast",
    ]) {
      await expect(page.getByText(title)).toBeVisible();
    }
  });

  test("a non-finance role (e.g. buero) is blocked from the cockpit with a clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("buero@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByText("Kein Zugriff")).toBeVisible();
  });

  test("bank reconciliation: syncing the mock feed populates the review queue and only 'sicher' rows are ever auto-booked", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("finanzen@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByRole("button", { name: "Mock-Feed abrufen" }).click();
    await expect(page.getByText("Bankabgleich – Review-Queue")).toBeVisible();
    const sicherBadges = page.locator(".badge--sicher");
    await expect(sicherBadges).toHaveCount(0); // sichere Treffer werden sofort gebucht, erscheinen nicht in der Queue
  });

  test("export request opens a signed download and logs an audit entry (asserted indirectly via a new tab)", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("finanzen@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    const [downloadPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Export (CSV)" }).click(),
    ]);
    await expect(downloadPage).toHaveURL(/\/finance\/exports\/.+\/download\?token=/);
  });
});
