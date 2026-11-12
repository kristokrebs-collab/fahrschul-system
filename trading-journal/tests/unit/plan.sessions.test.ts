/**
 * Handelsplan · Zeit und Sitzungen: Ortszeit → UTC mit Sommerzeit (New York und London wechseln an verschiedenen Tagen),
 * der Beginn jeder Sitzung, Handelskalender der US-Börse (Wochenende, Feiertag, 13-Uhr-Schluss) und die "Flat by"-Zeit.
 * Alle Erwartungen von Hand gerechnet: Ortszeit minus Versatz = UTC.
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  adjustForEarlyClose,
  clockIn,
  dateTimeIn,
  dayKeyIn,
  dayLabelIn,
  flatByMs,
  latestSession,
  nyseDay,
  offsetMinutes,
  parseDayKey,
  parseHHMM,
  sessionDay,
  weekdayOf,
  zonedToUtc,
  zoneLabel,
  MIN,
  HOUR,
} from "@/domain/plan";

const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

describe("Zeitzonen (Intl, nie die Zone des Geräts)", () => {
  it("der Versatz folgt der Sommerzeit der Zone an DEM Zeitpunkt", () => {
    expect(offsetMinutes(utc(2026, 7, 1, 12), "America/New_York")).toBe(-240); // EDT
    expect(offsetMinutes(utc(2026, 1, 15, 12), "America/New_York")).toBe(-300); // EST
    expect(offsetMinutes(utc(2026, 7, 1, 12), "Europe/London")).toBe(60); // BST
    expect(offsetMinutes(utc(2026, 1, 15, 12), "Europe/London")).toBe(0); // GMT
    expect(offsetMinutes(utc(2026, 7, 1, 12), "Asia/Tokyo")).toBe(540); // keine Sommerzeit
    expect(offsetMinutes(utc(2026, 7, 1, 12), "UTC")).toBe(0);
  });

  it("Ortszeit → UTC: New York 9:30 im Sommer und im Winter", () => {
    expect(zonedToUtc({ y: 2026, mo: 10, d: 19, h: 9, mi: 30 }, "America/New_York")).toBe(utc(2026, 10, 19, 13, 30)); // EDT: +4 h
    expect(zonedToUtc({ y: 2026, mo: 11, d: 2, h: 9, mi: 30 }, "America/New_York")).toBe(utc(2026, 11, 2, 14, 30)); // EST: +5 h
  });

  it("die USA wechseln am 2. Sonntag im März (8.3.2026), London erst am letzten (29.3.2026): dazwischen 3 Wochen mit anderem Abstand", () => {
    // Freitag 6.3.: beide Winterzeit → 14:30 UTC
    expect(zonedToUtc({ y: 2026, mo: 3, d: 6, h: 9, mi: 30 }, "America/New_York")).toBe(utc(2026, 3, 6, 14, 30));
    // Montag 9.3.: New York schon Sommerzeit (13:30 UTC), London noch Winterzeit (8:00 = 08:00 UTC)
    expect(zonedToUtc({ y: 2026, mo: 3, d: 9, h: 9, mi: 30 }, "America/New_York")).toBe(utc(2026, 3, 9, 13, 30));
    expect(zonedToUtc({ y: 2026, mo: 3, d: 9, h: 8, mi: 0 }, "Europe/London")).toBe(utc(2026, 3, 9, 8, 0));
    // Montag 30.3.: London jetzt BST (7:00 UTC)
    expect(zonedToUtc({ y: 2026, mo: 3, d: 30, h: 8, mi: 0 }, "Europe/London")).toBe(utc(2026, 3, 30, 7, 0));
    // im Herbst umgekehrt: London endet am 25.10., New York am 1.11.
    expect(zonedToUtc({ y: 2026, mo: 10, d: 26, h: 8, mi: 0 }, "Europe/London")).toBe(utc(2026, 10, 26, 8, 0)); // GMT
    expect(zonedToUtc({ y: 2026, mo: 10, d: 26, h: 9, mi: 30 }, "America/New_York")).toBe(utc(2026, 10, 26, 13, 30)); // noch EDT
  });

  it("die ausgefallene Stunde (Vorstellen) rückt vor, die doppelte (Zurückstellen) zählt die erste", () => {
    // New York 8.3.2026: 2:30 gibt es nicht → wie Date: 3:30 EDT = 07:30 UTC
    expect(zonedToUtc({ y: 2026, mo: 3, d: 8, h: 2, mi: 30 }, "America/New_York")).toBe(utc(2026, 3, 8, 7, 30));
    // New York 1.11.2026: 1:30 gibt es zweimal → die erste (EDT) = 05:30 UTC
    expect(zonedToUtc({ y: 2026, mo: 11, d: 1, h: 1, mi: 30 }, "America/New_York")).toBe(utc(2026, 11, 1, 5, 30));
  });

  it("Tagesschlüssel, Uhr und Zonenname eines Zeitpunkts", () => {
    const t = utc(2026, 10, 19, 3, 30); // in New York noch Sonntag 23:30
    expect(dayKeyIn(t, "America/New_York")).toBe("2026-10-18");
    expect(clockIn(t, "America/New_York")).toBe("23:30");
    expect(dayKeyIn(t, "UTC")).toBe("2026-10-19");
    expect(zoneLabel(t, "America/New_York")).toBe("UTC−4");
    expect(zoneLabel(utc(2026, 12, 1), "America/New_York")).toBe("UTC−5");
    expect(zoneLabel(t, "UTC")).toBe("UTC");
    expect(zoneLabel(t, "Asia/Kolkata")).toBe("UTC+5:30");
    expect(dayLabelIn(t, "America/New_York")).toBe("So 18.10.");
    expect(dateTimeIn(utc(2026, 10, 19, 14, 15), "America/New_York")).toBe("19.10.2026 10:15");
  });

  it("Kalender: gültige Tage, Rechnen mit Tagen, Wochentag (19.10.2026 ist ein Montag)", () => {
    expect(parseDayKey("2026-02-29")).toBeNull();
    expect(parseDayKey("2026-10-19")).toEqual({ y: 2026, mo: 10, d: 19 });
    expect(parseDayKey("19.10.2026")).toBeNull();
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekdayOf("2026-10-19")).toBe(1);
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(parseHHMM("15:55")).toBe(955);
    expect(parseHHMM("9:30")).toBe(570);
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
  });
});

describe("Sitzungen", () => {
  it("Beginn jeder Sitzung am Montag 19.10.2026 (New York EDT, London BST, Tokio, UTC)", () => {
    expect(sessionDay("utc", "2026-10-19").openMs).toBe(utc(2026, 10, 19, 0, 0));
    expect(sessionDay("asia", "2026-10-19").openMs).toBe(utc(2026, 10, 19, 0, 0)); // Tokio 9:00 = 0:00 UTC
    expect(sessionDay("london", "2026-10-19").openMs).toBe(utc(2026, 10, 19, 7, 0));
    expect(sessionDay("newyork", "2026-10-19").openMs).toBe(utc(2026, 10, 19, 13, 30));
    expect(sessionDay("usstocks", "2026-10-19").openMs).toBe(utc(2026, 10, 19, 13, 30));
  });

  it("Beginn derselben Sitzungen im Winter (Montag 2.11.2026)", () => {
    expect(sessionDay("london", "2026-11-02").openMs).toBe(utc(2026, 11, 2, 8, 0));
    expect(sessionDay("newyork", "2026-11-02").openMs).toBe(utc(2026, 11, 2, 14, 30));
  });

  it("die US-Börse in Berlin: 15:30 meistens, in den Wochen zwischen den Zeitumstellungen 14:30", () => {
    expect(sessionDay("usstocks", "2026-10-19").openBerlin).toBe("15:30"); // beide Sommerzeit
    expect(sessionDay("usstocks", "2026-11-02").openBerlin).toBe("15:30"); // beide Winterzeit
    expect(sessionDay("usstocks", "2026-03-09").openBerlin).toBe("14:30"); // USA schon, Europa noch nicht
    expect(sessionDay("usstocks", "2026-10-26").openBerlin).toBe("14:30"); // Europa schon Winterzeit, USA noch nicht
    expect(sessionDay("usstocks", "2026-10-19").zone).toBe("UTC−4");
  });

  it("Ende, letzter Einstieg und Beschriftung am normalen US-Börsentag", () => {
    const d = sessionDay("usstocks", "2026-10-19");
    expect(d.tradingDay).toBe(true);
    expect(d.closeMs - d.openMs).toBe(390 * MIN); // 16:00
    expect(d.cutoffMs - d.openMs).toBe(360 * MIN); // 15:30
    expect(d.earlyClose).toBe(false);
    expect(d.label).toBe("Mo 19.10. · US-Börse 9:30 (UTC−4)");
  });

  it("Krypto-Sitzungen: der Tag hat 24 Stunden, der letzte Einstieg ist 4 Stunden nach Beginn (eigene Wahl möglich)", () => {
    const d = sessionDay("utc", "2026-10-19");
    expect(d.closeMs - d.openMs).toBe(24 * HOUR);
    expect(d.cutoffMs - d.openMs).toBe(240 * MIN);
    expect(sessionDay("utc", "2026-10-19", 120).cutoffMs - d.openMs).toBe(120 * MIN);
    expect(sessionDay("utc", "2026-10-19", 99999).cutoffMs - d.openMs).toBe(24 * HOUR); // nie nach dem Ende
    expect(d.tradingDay).toBe(true);
    // auch am Samstag: Krypto handelt
    expect(sessionDay("newyork", "2026-10-24").tradingDay).toBe(true);
  });

  it("US-Börse: Wochenende, Feiertag und Tag ohne Kalender", () => {
    expect(nyseDay("2026-10-24")).toMatchObject({ tradingDay: false, reason: "Wochenende", calendarKnown: true });
    expect(nyseDay("2026-11-26")).toMatchObject({ tradingDay: false, reason: "Feiertag der US-Börse (Thanksgiving)" });
    expect(nyseDay("2026-07-03").reason).toContain("Independence Day");
    expect(nyseDay("2027-03-26").reason).toContain("Karfreitag");
    // 2028 ist nicht im Kalender: Wochenenden erkannt, Feiertage nicht – und die App sagt es
    expect(nyseDay("2028-01-03")).toMatchObject({ tradingDay: true, calendarKnown: false });
    expect(nyseDay("2028-01-01")).toMatchObject({ tradingDay: false, calendarKnown: false });
    expect(sessionDay("usstocks", "2026-11-26")).toMatchObject({ tradingDay: false, closedReason: "Feiertag der US-Börse (Thanksgiving)" });
  });

  it("13-Uhr-Schluss (Tag nach Thanksgiving, 27.11.2026): Ende 13:00, letzter Einstieg rückt von 15:30 auf 12:30, Flat by von 15:55 auf 12:55", () => {
    const d = sessionDay("usstocks", "2026-11-27");
    expect(d.earlyClose).toBe(true);
    expect(d.openMs).toBe(utc(2026, 11, 27, 14, 30)); // EST
    expect(d.closeMs).toBe(utc(2026, 11, 27, 18, 0)); // 13:00 EST
    expect(d.cutoffMs).toBe(utc(2026, 11, 27, 17, 30)); // 12:30 EST
    expect(flatByMs(d, null)).toBe(utc(2026, 11, 27, 17, 55)); // 12:55
    expect(flatByMs(d, "15:55")).toBe(utc(2026, 11, 27, 17, 55)); // die getippte Zeit rückt mit
    expect(adjustForEarlyClose(360, 390, 210)).toBe(180);
    expect(adjustForEarlyClose(100, 390, 210)).toBe(100); // vor dem frühen Schluss bleibt es
    expect(adjustForEarlyClose(385, 390, 210)).toBe(205);
  });

  it("Flat by: Standard fünf Minuten vor dem Ende, eigene Uhrzeit in der Zone der Sitzung, vor dem Beginn ungültig", () => {
    const d = sessionDay("usstocks", "2026-10-19");
    expect(flatByMs(d, null)).toBe(utc(2026, 10, 19, 19, 55)); // 15:55 EDT
    expect(flatByMs(d, "15:00")).toBe(utc(2026, 10, 19, 19, 0));
    expect(flatByMs(d, "09:00")).toBeNull(); // vor 9:30
    expect(flatByMs(d, "kaputt")).toBeNull();
    const crypto = sessionDay("utc", "2026-10-19");
    expect(flatByMs(crypto, null)).toBe(utc(2026, 10, 19, 23, 55));
    expect(flatByMs(crypto, "22:00")).toBe(utc(2026, 10, 19, 22, 0));
  });

  it("die letzte Sitzung: vor dem Beginn die von gestern, am Wochenende (US-Börse) die vom Freitag", () => {
    // Montag 19.10.2026 08:00 in New York = 12:00 UTC: die Sitzung von heute hat noch nicht begonnen
    expect(latestSession("usstocks", utc(2026, 10, 19, 12, 0)).dayKey).toBe("2026-10-16"); // Freitag (Wochenende dazwischen)
    expect(latestSession("newyork", utc(2026, 10, 19, 12, 0)).dayKey).toBe("2026-10-18"); // Krypto: Sonntag zählt
    expect(latestSession("usstocks", utc(2026, 10, 19, 13, 30)).dayKey).toBe("2026-10-19"); // genau zum Beginn
    expect(latestSession("usstocks", utc(2026, 10, 24, 15, 0)).dayKey).toBe("2026-10-23"); // Samstag → Freitag
    expect(latestSession("utc", utc(2026, 10, 19, 0, 0)).dayKey).toBe("2026-10-19");
    // der Feiertag wird übersprungen: Freitag nach Thanksgiving-Donnerstag 26.11. → Mittwoch 25.11. wäre vor dem 26.
    expect(latestSession("usstocks", utc(2026, 11, 26, 20, 0)).dayKey).toBe("2026-11-25");
  });
});
