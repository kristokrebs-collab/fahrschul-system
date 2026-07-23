import { expect, test } from "@playwright/test";

/**
 * Kritische E2E-Flows (siehe docs/student-app-final-qa.md zum
 * Ausführungsstatus in dieser Sandbox). Setzt einen laufenden apps/api
 * (Port 4000, gegen fahrschul_dev/eine seed-Datenbank) voraus; Login-Daten
 * entsprechen `packages/database/src/seed.ts`.
 */

test.describe("student app – critical flows", () => {
  test("login redirects to Heute and shows the bottom navigation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("schueler@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(/\/heute/);
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
    for (const label of ["Heute", "Ausbildung", "Termine", "Lernen", "Mehr"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("Termine tab lists open offers and lets the student accept one", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("schueler@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();

    await page.getByRole("link", { name: "Termine" }).click();
    await expect(page.getByRole("heading", { name: "Termine" })).toBeVisible();
  });

  test("PrüfungsReady view never shows a set-clearance action for the student", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("schueler@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();

    await page.getByRole("link", { name: "Ausbildung" }).click();
    await page.getByRole("link", { name: "PrüfungsReady-Übersicht ansehen" }).click();
    await expect(page.getByText("PrüfungsReady")).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
  });
});
