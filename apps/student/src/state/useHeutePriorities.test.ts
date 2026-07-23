import { describe, expect, it } from "vitest";
import { computeHeutePriority } from "./useHeutePriorities.js";
import type { Dokument, ExamReadiness, Lernressource, Terminangebot, Terminbuchung } from "../api/types.js";

const baseReadiness: ExamReadiness = {
  dataAsOf: new Date().toISOString(),
  formalPrerequisites: [],
  theoryStatus: { assignedResources: 0, visitedResources: 0, note: "" },
  mandatoryDrives: { klasse: "B", done: {}, required: {} },
  competencyAreas: { source: "feedback.wentWell", items: [] },
  openLearningGoals: [],
  instructorClearance: { status: "offen", grantedAt: null },
  officeReview: { status: "offen" },
  disclaimer: "",
};

const futureBooking: Terminbuchung = {
  id: "b0",
  terminangebotId: null,
  schuelerId: "s1",
  fahrlehrerId: "f1",
  beginnAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  endeAt: new Date(Date.now() + 1000 * 60 * 60 * 25).toISOString(),
  art: "Übungsstunde",
  status: "bestaetigt",
};

/** "Alles im grünen Bereich": nächster Termin vorhanden, keine offenen Punkte. */
function empty() {
  return {
    examReadiness: baseReadiness,
    documents: [] as Dokument[],
    offers: [] as { offer: Terminangebot | null }[],
    appointments: [futureBooking] as Terminbuchung[],
    hasWunschzeiten: true,
    learningResources: [] as Lernressource[],
  };
}

describe("computeHeutePriority", () => {
  it("returns null (no warning) when everything is fine", () => {
    expect(computeHeutePriority(empty())).toBeNull();
  });

  it("prioritizes an exam/appointment blocker above everything else", () => {
    const input = empty();
    input.examReadiness = { ...baseReadiness, instructorClearance: { status: "abgelehnt", grantedAt: null } };
    input.documents = [{ id: "1", typ: "sehtest", dateiname: "a", geprueft: false, status: "abgelehnt", ablehnungsgrund: "x", gueltigBis: null, ersetztVonDokumentId: null, scanStatus: "sauber" }];
    input.hasWunschzeiten = false;
    const result = computeHeutePriority(input);
    expect(result?.kind).toBe("exam_blocker");
  });

  it("shows a rejected document before a missing next appointment", () => {
    const input = empty();
    input.documents = [{ id: "1", typ: "sehtest", dateiname: "a", geprueft: false, status: "abgelehnt", ablehnungsgrund: "unscharf", gueltigBis: null, ersetztVonDokumentId: null, scanStatus: "sauber" }];
    const result = computeHeutePriority(input);
    expect(result?.kind).toBe("document_rejected");
    expect(result?.detail).toContain("unscharf");
  });

  it("flags an appointment offer expiring within 24h", () => {
    const input = empty();
    input.offers = [
      {
        offer: {
          id: "o1",
          fahrlehrerId: "f1",
          fahrzeugId: null,
          beginnAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
          endeAt: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
          klasse: "B",
          art: "Übungsstunde",
          treffpunkt: null,
          automatik: false,
          ablaufAt: new Date(Date.now() + 1000 * 60 * 60 * 2).toISOString(),
          status: "offen",
        },
      },
    ];
    expect(computeHeutePriority(input)?.kind).toBe("offer_expiring");
  });

  it("falls back to 'no next appointment' when the student has none", () => {
    const input = empty();
    input.appointments = [];
    const result = computeHeutePriority(input);
    expect(result?.kind).toBe("no_next_appointment");
  });

  it("flags missing availability once a next appointment exists but no wunschzeiten", () => {
    const input = empty();
    input.hasWunschzeiten = false;
    expect(computeHeutePriority(input)?.kind).toBe("missing_availability");
  });

  it("recommends open theory/simulator learning before a generic recommendation", () => {
    const input = empty();
    input.learningResources = [
      { id: "r1", titel: "Simulator 1", typ: "simulator", ort: null, beschreibung: null, url: null, fortschritt: "offen" },
    ];
    expect(computeHeutePriority(input)?.kind).toBe("theory_pending");
  });
});
