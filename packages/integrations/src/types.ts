/**
 * Gemeinsamer Modus für alle externen Integrationen (siehe
 * docs/integration-gaps.md). In dieser Umgebung liegen für keine
 * Integration echte Zugangsdaten vor, daher ist ausschließlich "mock"
 * verdrahtet. "sandbox"/"live" sind als Konfigurationsoption vorbereitet,
 * werfen aber bewusst einen Fehler, damit niemals fälschlich eine
 * "funktionierende Live-Schnittstelle" behauptet werden kann
 * (Non-Negotiable: "Keine behauptete Live-Schnittstelle ohne echten Test").
 */
export type IntegrationMode = "mock" | "sandbox" | "live";

export function assertMockOnly(mode: IntegrationMode, integrationName: string): void {
  if (mode !== "mock") {
    throw new Error(
      `${integrationName}: Modus "${mode}" ist in dieser Umgebung nicht verdrahtet (kein echter Zugang vorhanden, siehe docs/integration-gaps.md). Nur "mock" ist funktionsfähig.`,
    );
  }
}
