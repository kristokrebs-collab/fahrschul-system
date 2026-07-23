import { describe, expect, it } from "vitest";
import { checkBookingConflicts, intervalsOverlap } from "../rules.js";

const hour = (h: number, m = 0) =>
  new Date(`2026-08-03T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`);

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    expect(
      intervalsOverlap({ beginnAt: hour(9), endeAt: hour(10) }, { beginnAt: hour(9), endeAt: hour(11) }),
    ).toBe(true);
  });

  it("does not flag back-to-back intervals as overlapping", () => {
    expect(
      intervalsOverlap({ beginnAt: hour(9), endeAt: hour(10) }, { beginnAt: hour(10), endeAt: hour(11) }),
    ).toBe(false);
  });
});

describe("checkBookingConflicts", () => {
  const qualification = { fahrlehrerId: "instructor-1", klassen: ["B" as const] };
  const vehicle = { fahrzeugId: "vehicle-1", klasse: "B" as const };

  it("passes when instructor is qualified, free, and vehicle matches", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: [], instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects double-booking the same instructor for overlapping times", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-1",
        status: "confirmed",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
    ];
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9, 30), endeAt: hour(10, 30) },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("INSTRUCTOR_DOUBLE_BOOKED");
  });

  it("ignores cancelled bookings when checking for conflicts", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-1",
        status: "cancelled",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
    ];
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects when instructor is not qualified for the requested class", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: null, klasse: "A", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: [], instructorQualification: qualification, vehicleClass: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("INSTRUCTOR_NOT_QUALIFIED");
  });

  it("rejects when the vehicle class does not match the requested class", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "A", beginnAt: hour(9), endeAt: hour(10) },
      {
        existingBookings: [],
        instructorQualification: { fahrlehrerId: "instructor-1", klassen: ["A"] },
        vehicleClass: vehicle,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("VEHICLE_WRONG_CLASS");
  });

  it("rejects when the student already has an overlapping booking (Schüler frei)", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-2",
        fahrzeugId: "vehicle-2",
        schuelerId: "student-1",
        status: "confirmed",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
    ];
    const result = checkBookingConflicts(
      {
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-1",
        schuelerId: "student-1",
        klasse: "B",
        beginnAt: hour(9, 30),
        endeAt: hour(10, 30),
      },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("STUDENT_DOUBLE_BOOKED");
  });

  it("rejects overlapping room bookings (Raum frei)", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-2",
        fahrzeugId: null,
        raumId: "room-1",
        status: "confirmed",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
    ];
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: null, raumId: "room-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("ROOM_DOUBLE_BOOKED");
  });

  it("rejects overlapping simulator bookings (Simulator frei)", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-2",
        fahrzeugId: null,
        simulatorgeraetId: "sim-1",
        status: "confirmed",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
    ];
    const result = checkBookingConflicts(
      {
        fahrlehrerId: "instructor-1",
        fahrzeugId: null,
        simulatorgeraetId: "sim-1",
        klasse: "B",
        beginnAt: hour(9, 30),
        endeAt: hour(10, 30),
      },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: null },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("SIMULATOR_DOUBLE_BOOKED");
  });

  it("rejects when the vehicle is not einsatzbereit (Wartung)", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      {
        existingBookings: [],
        instructorQualification: qualification,
        vehicleClass: { ...vehicle, status: "wartung" },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("VEHICLE_NOT_READY");
  });

  it("rejects Automatik-Wunsch gegen Schaltwagen (Getriebeart-Mismatch)", () => {
    const result = checkBookingConflicts(
      {
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-1",
        klasse: "B",
        getriebeart: "automatik",
        beginnAt: hour(9),
        endeAt: hour(10),
      },
      {
        existingBookings: [],
        instructorQualification: qualification,
        vehicleClass: { ...vehicle, automatik: false },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("GEARBOX_MISMATCH");
  });

  it("rejects when required handicap equipment is missing on the vehicle", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      {
        existingBookings: [],
        instructorQualification: qualification,
        vehicleClass: { ...vehicle, handicapAusstattung: [] },
        handicapBedarf: ["rollstuhlrampe"],
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("HANDICAP_EQUIPMENT_MISSING");
  });

  it("passes when the vehicle carries the required handicap equipment", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      {
        existingBookings: [],
        instructorQualification: qualification,
        vehicleClass: { ...vehicle, handicapAusstattung: ["rollstuhlrampe"] },
        handicapBedarf: ["rollstuhlrampe"],
      },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects back-to-back bookings without the minimum break (Pause/Arbeitszeit)", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-2",
        status: "confirmed",
        beginnAt: hour(8),
        endeAt: hour(9),
      },
    ];
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("MIN_BREAK_VIOLATED");
  });

  it("passes when the gap between two bookings satisfies the minimum break", () => {
    const existing = [
      {
        id: "b1",
        fahrlehrerId: "instructor-1",
        fahrzeugId: "vehicle-2",
        status: "confirmed",
        beginnAt: hour(8),
        endeAt: hour(9),
      },
    ];
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", beginnAt: hour(9, 20), endeAt: hour(10) },
      { existingBookings: existing, instructorQualification: qualification, vehicleClass: vehicle },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a Sonderfahrt before the minimum number of Übungsstunden (Ausbildungsreihenfolge, unbestätigt)", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", art: "Sonderfahrt", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: [], instructorQualification: qualification, vehicleClass: vehicle, completedUebungsstunden: 2 },
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("TRAINING_ORDER_VIOLATED");
  });

  it("allows a Sonderfahrt once the minimum number of Übungsstunden is reached", () => {
    const result = checkBookingConflicts(
      { fahrlehrerId: "instructor-1", fahrzeugId: "vehicle-1", klasse: "B", art: "Sonderfahrt", beginnAt: hour(9), endeAt: hour(10) },
      { existingBookings: [], instructorQualification: qualification, vehicleClass: vehicle, completedUebungsstunden: 5 },
    );
    expect(result.ok).toBe(true);
  });
});
