import { assertMockOnly, type IntegrationMode } from "../types.js";

export interface CalendarEventInput {
  externalRef: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CalendarAdapter {
  mode: IntegrationMode;
  upsertEvent(input: CalendarEventInput): Promise<{ calendarEventId: string }>;
  deleteEvent(externalRef: string): Promise<void>;
}

/** Mock: CalDAV/Google/Outlook-Exportstub, siehe docs/integration-gaps.md. */
export class MockCalendarAdapter implements CalendarAdapter {
  mode: IntegrationMode = "mock";
  events = new Map<string, CalendarEventInput>();

  async upsertEvent(input: CalendarEventInput) {
    this.events.set(input.externalRef, input);
    return { calendarEventId: `mock-cal-${input.externalRef}` };
  }

  async deleteEvent(externalRef: string) {
    this.events.delete(externalRef);
  }
}

export function createCalendarAdapter(mode: IntegrationMode): CalendarAdapter {
  assertMockOnly(mode, "Calendar");
  return new MockCalendarAdapter();
}
