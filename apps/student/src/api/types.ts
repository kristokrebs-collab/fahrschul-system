/** Schlanke Response-Typen (kein vollständiges Domain-Re-Export, um Frontend/Backend lose zu koppeln). */

export interface Ausbildung {
  id: string;
  klasse: string;
  vorbesitzKlasse: string | null;
  istErweiterung: boolean;
  getriebeart: "schaltung" | "automatik";
  b197: boolean;
  status: string;
}

export interface SchuelerProfil {
  schueler: { id: string; vorname: string; nachname: string };
  ausbildungen: Ausbildung[];
}

export interface Terminangebot {
  id: string;
  fahrlehrerId: string;
  fahrzeugId: string | null;
  beginnAt: string;
  endeAt: string;
  klasse: string | null;
  art: string;
  treffpunkt: string | null;
  automatik: boolean;
  ablaufAt: string | null;
  status: string;
}

export interface Terminbuchung {
  id: string;
  terminangebotId: string | null;
  schuelerId: string;
  fahrlehrerId: string;
  beginnAt: string;
  endeAt: string;
  art: string;
  status: string;
}

export interface Dokument {
  id: string;
  typ: string;
  dateiname: string;
  geprueft: boolean;
  status: string;
  ablehnungsgrund: string | null;
  gueltigBis: string | null;
  ersetztVonDokumentId: string | null;
  scanStatus: string;
}

export interface Rechnungsposition {
  id: string;
  bezeichnung: string;
  einzelpreisCent: number;
  gesamtpreisCent: number;
}

export interface Rechnung {
  id: string;
  betragCent: number;
  faelligAm: string | null;
  status: string;
  positionen: Rechnungsposition[];
}

export interface FeedbackEintrag {
  id: string;
  terminbuchungId: string;
  releasedFields: string[];
  wentWell: string | null;
  workOn: string | null;
  nextGoal: string | null;
  resourceId: string | null;
  studentSelfAssessment: string | null;
  createdAt: string;
}

export interface Lernressource {
  id: string;
  titel: string;
  typ: "video" | "hoerbuch" | "simulator" | "kurs" | "gefahrentraining";
  ort: string | null;
  beschreibung: string | null;
  url: string | null;
  fortschritt: "offen" | "besucht";
}

export interface ExamReadiness {
  dataAsOf: string;
  formalPrerequisites: { typ: string; vorhanden: boolean; geprueft: boolean }[];
  theoryStatus: { assignedResources: number; visitedResources: number; note: string };
  mandatoryDrives:
    | { klasse: "B"; done: Record<string, number>; required: Record<string, number> }
    | { klasse: string; note: string };
  competencyAreas: { source: string; items: string[] };
  openLearningGoals: string[];
  instructorClearance: { status: string; grantedAt: string | null };
  officeReview: { status: string };
  disclaimer: string;
}

export interface FlagsResponse {
  flags: Record<string, "hidden" | "pilot" | "live">;
}
