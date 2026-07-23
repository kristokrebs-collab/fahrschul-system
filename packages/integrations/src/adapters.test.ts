import { describe, expect, it } from "vitest";
import {
  createBankFeedAdapter,
  createCalendarAdapter,
  createCrmWebhookAdapter,
  createDocumentStorageAdapter,
  createNotificationsAdapter,
} from "./index.js";

describe("integration adapters", () => {
  it("mock mode works for all adapters", async () => {
    const notifications = createNotificationsAdapter("mock");
    await notifications.send({ to: "a@b.de", channel: "email", subject: "Hi", body: "Test" });

    const calendar = createCalendarAdapter("mock");
    await calendar.upsertEvent({ externalRef: "1", title: "Termin", startsAt: new Date(), endsAt: new Date() });

    const bank = createBankFeedAdapter("mock");
    await bank.fetchTransactions(new Date(0).toISOString());

    const storage = createDocumentStorageAdapter("mock");
    const { reference } = await storage.put("test.pdf", Buffer.from("test"));
    expect(await storage.get(reference)).toEqual(Buffer.from("test"));

    const crm = createCrmWebhookAdapter("mock");
    await crm.receiveLead({ name: "Test", email: "a@b.de", source: "website" });
  });

  it("refuses sandbox/live mode (no real credentials in this environment)", () => {
    expect(() => createNotificationsAdapter("live")).toThrow();
    expect(() => createBankFeedAdapter("sandbox")).toThrow();
  });
});
