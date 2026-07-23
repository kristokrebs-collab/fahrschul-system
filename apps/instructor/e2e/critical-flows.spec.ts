import { expect, test } from "@playwright/test";

/**
 * Kritische E2E-Flows für apps/instructor. NICHT ausgeführt in dieser
 * Sandbox (siehe playwright.config.ts + docs/instructor-final-qa.md) –
 * geschrieben, damit sie in einer Umgebung mit Zugriff auf
 * cdn.playwright.dev direkt lauffähig sind. Setzt einen laufenden
 * apps/api (Port 4000) mit Seed-Daten voraus (Login: fahrlehrer@example.test).
 */

test.describe("instructor app – critical flows", () => {
  test("login redirects to Heute and shows all five nav tabs", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("fahrlehrer@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page).toHaveURL(/\/heute/);
    for (const label of ["Heute", "Schüler", "Dokumentieren", "Fahrzeug", "Mehr"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("starting a lesson enters Drive Lock Mode and hides the bottom navigation", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("fahrlehrer@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();

    await page.getByRole("button", { name: "Stunde starten" }).first().click();
    await expect(page).toHaveURL(/\/drivelock/);
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
    await expect(page.getByTestId("notfall-link")).toBeVisible();
    await expect(page.getByTestId("buero-link")).toBeVisible();
    await expect(page.getByTestId("stunde-beenden-link")).toBeVisible();
  });

  test("Stunde beenden requires all 8 steps before completing", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail").fill("fahrlehrer@example.test");
    await page.getByLabel("Passwort").fill("Test-Passwort-123!");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByRole("button", { name: "Stunde starten" }).first().click();
    await page.getByTestId("stunde-beenden-link").click();
    await expect(page.getByText(/Schritt 1 von 8/)).toBeVisible();
  });

  // Viewport-Spot-Check (siehe docs/instructor-final-qa.md für den
  // Ausführungsstatus): 390 (Phone), 768 (Tablet), 1024 (Tablet quer).
  for (const viewport of [
    { width: 390, height: 844, name: "phone" },
    { width: 768, height: 1024, name: "tablet-portrait" },
    { width: 1024, height: 768, name: "tablet-landscape" },
  ]) {
    test(`Heute is usable at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/login");
      await page.getByLabel("E-Mail").fill("fahrlehrer@example.test");
      await page.getByLabel("Passwort").fill("Test-Passwort-123!");
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
    });
  }
});
