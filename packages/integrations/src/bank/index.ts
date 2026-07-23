import { assertMockOnly, type IntegrationMode } from "../types.js";

export interface BankTransaction {
  id: string;
  amountCent: number;
  bookedAt: Date;
  reference: string;
  counterparty: string;
}

export interface BankFeedAdapter {
  mode: IntegrationMode;
  fetchTransactions(sinceIso: string): Promise<BankTransaction[]>;
}

/**
 * Mock-Feed für Tests: liefert eine feste Fixture-Liste. Reale
 * FinTS/EBICS-Anbindung ist NICHT Teil dieser Sitzung (kein Zugang) – die
 * Zuordnung Zahlung<->Rechnung bleibt in apps/api ein expliziter,
 * überprüfbarer Schritt (Rolle finanzen), nicht automatisch-unsicher.
 */
export class MockBankFeedAdapter implements BankFeedAdapter {
  mode: IntegrationMode = "mock";
  fixture: BankTransaction[];

  constructor(fixture: BankTransaction[] = []) {
    this.fixture = fixture;
  }

  async fetchTransactions(sinceIso: string): Promise<BankTransaction[]> {
    const since = new Date(sinceIso);
    return this.fixture.filter((tx) => tx.bookedAt >= since);
  }
}

export function createBankFeedAdapter(mode: IntegrationMode): BankFeedAdapter {
  assertMockOnly(mode, "Bank-Feed");
  return new MockBankFeedAdapter();
}
