import { assertMockOnly, type IntegrationMode } from "../types.js";

/**
 * "Sichere Zahlungsoption" für apps/student (Rechnungen sind dort
 * ausdrücklich read-only). Es liegt in dieser Umgebung kein echter
 * Zahlungsanbieter vor (siehe docs/integration-gaps.md) – dieser Adapter
 * liefert NUR einen Platzhalter-Link zurück, löst NIEMALS eine echte
 * Belastung aus. `apps/api` mutiert dadurch keine Zahlungs-/Rechnungsdaten;
 * eine echte Zahlung müsste über einen künftigen Live-Adapter UND einen
 * eigenen serverseitigen Webhook laufen, nicht über diese Schüler-App.
 */
export interface PaymentLinkResult {
  mode: IntegrationMode;
  placeholderUrl: string;
  note: string;
}

export interface PaymentAdapter {
  mode: IntegrationMode;
  createPaymentLink(rechnungId: string, betragCent: number): Promise<PaymentLinkResult>;
}

export class MockPaymentAdapter implements PaymentAdapter {
  mode: IntegrationMode = "mock";

  async createPaymentLink(rechnungId: string, betragCent: number): Promise<PaymentLinkResult> {
    return {
      mode: "mock",
      placeholderUrl: `mock-payment://rechnung/${rechnungId}?betragCent=${betragCent}`,
      note: "GAP: kein echter Zahlungsanbieter in dieser Umgebung – dies ist ein Platzhalter-Link, keine echte Zahlungsauslösung (siehe docs/integration-gaps.md).",
    };
  }
}

export function createPaymentAdapter(mode: IntegrationMode): PaymentAdapter {
  assertMockOnly(mode, "Zahlungsanbieter");
  return new MockPaymentAdapter();
}
