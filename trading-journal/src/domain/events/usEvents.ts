/**
 * US stock market events (F43): opening, closing (also the early close) and holidays of the NYSE as calendar events,
 * computed by the rules of `usMarket.ts`. Kept apart from the calendar so the Labor's filter worker can use it without the
 * FOMC list and the settings code.
 */
import { usHolidayOn, usSession, US_ZONE } from "./usMarket";
import { DAY, type CalendarEvent, type EventSource } from "./types";
import { addDays, dayKeyIn, wallOf, wallToUtc, weekdayOfKey } from "./zone";

export const NYSE_SOURCE: EventSource = {
  label: "NYSE – Handelszeiten und Feiertage",
  rule: "Börsenöffnung 09:30 und Schluss 16:00 Uhr New Yorker Zeit (Sommerzeit der USA berücksichtigt); Feiertage nach der NYSE-Regel berechnet, Sonderschließungen nicht.",
  url: "https://www.nyse.com/markets/hours-calendars",
  checkedAt: "2026-10-25",
};

const clockLabel = (ms: number): string => {
  const w = wallOf(ms, US_ZONE);
  return `${String(w.h).padStart(2, "0")}:${String(w.min).padStart(2, "0")}`;
};

/** US session events and holidays of the New York days that touch `[from, to)`. */
export function usEvents(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const first = addDays(dayKeyIn(from, US_ZONE), -1);
  const last = addDays(dayKeyIn(to, US_ZONE), 1);
  for (let key = first; key <= last; key = addDays(key, 1)) {
    const dow = weekdayOfKey(key);
    if (dow === 0 || dow === 6) continue;
    const [y = 1970, m = 1, d = 1] = key.split("-").map(Number);
    const holiday = usHolidayOn(key);
    if (holiday) {
      const at = wallToUtc({ y, m, d, h: 0, min: 0 }, US_ZONE);
      if (at >= to || at + DAY <= from) continue;
      out.push({
        id: `usHoliday:${key}`,
        kind: "usHoliday",
        title: `US-Börsen geschlossen: ${holiday.name}`,
        at,
        end: at + DAY,
        allDay: true,
        dayKey: key,
        dayZone: US_ZONE,
        importance: "mittel",
        ...(holiday.observedFor ? { detail: `beobachtet für den ${holiday.observedFor}` } : {}),
        source: NYSE_SOURCE,
      });
      continue;
    }
    const s = usSession(key);
    if (!s) continue;
    if (s.open >= from && s.open < to) {
      out.push({ id: `usOpen:${key}`, kind: "usOpen", title: "US-Börsen öffnen (NYSE)", at: s.open, importance: "mittel", detail: `${clockLabel(s.open)} Uhr New Yorker Zeit`, source: NYSE_SOURCE });
    }
    if (s.close >= from && s.close < to) {
      out.push({
        id: `usClose:${key}`,
        kind: "usClose",
        title: s.early ? "US-Börsen schließen früh (NYSE)" : "US-Börsen schließen (NYSE)",
        at: s.close,
        importance: s.early ? "mittel" : "niedrig",
        detail: s.early ? `${clockLabel(s.close)} Uhr New Yorker Zeit – ${s.earlyReason}` : `${clockLabel(s.close)} Uhr New Yorker Zeit`,
        source: NYSE_SOURCE,
      });
    }
  }
  return out;
}
