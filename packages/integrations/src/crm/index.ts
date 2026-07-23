import { assertMockOnly, type IntegrationMode } from "../types.js";

export interface CrmLeadPayload {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  source: string;
}

export interface CrmWebhookAdapter {
  mode: IntegrationMode;
  receiveLead(payload: CrmLeadPayload): Promise<{ leadId: string }>;
}

/** Mock-Webhook-Endpoint für Website/CRM-Lead-Erfassung. */
export class MockCrmWebhookAdapter implements CrmWebhookAdapter {
  mode: IntegrationMode = "mock";
  received: CrmLeadPayload[] = [];

  async receiveLead(payload: CrmLeadPayload) {
    this.received.push(payload);
    return { leadId: `mock-lead-${this.received.length}` };
  }
}

export function createCrmWebhookAdapter(mode: IntegrationMode): CrmWebhookAdapter {
  assertMockOnly(mode, "CRM Webhook");
  return new MockCrmWebhookAdapter();
}
