import { assertMockOnly, type IntegrationMode } from "../types.js";

export interface NotificationMessage {
  to: string;
  channel: "email" | "push";
  subject: string;
  body: string;
}

export interface NotificationsAdapter {
  mode: IntegrationMode;
  send(message: NotificationMessage): Promise<{ id: string; delivered: boolean }>;
}

/**
 * Mock-Adapter: sendet nichts wirklich, sammelt Nachrichten in-memory für
 * Tests/Debugging. Interface ist bewusst so gehalten, dass ein späterer
 * Postmark/SES- bzw. FCM/APNs-Adapter dieselbe Signatur implementieren kann.
 */
export class MockNotificationsAdapter implements NotificationsAdapter {
  mode: IntegrationMode = "mock";
  sent: NotificationMessage[] = [];

  async send(message: NotificationMessage) {
    this.sent.push(message);
    return { id: `mock-notification-${this.sent.length}`, delivered: true };
  }
}

export function createNotificationsAdapter(mode: IntegrationMode): NotificationsAdapter {
  assertMockOnly(mode, "Notifications");
  return new MockNotificationsAdapter();
}
