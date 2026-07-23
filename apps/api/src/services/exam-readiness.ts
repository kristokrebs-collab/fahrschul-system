import { dokumente, fahrstundenFeedback, pruefungsfreigaben, terminbuchungen } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { and, eq } from "drizzle-orm";

/**
 * Gesetzliche Mindestzahlen für Sonderfahrten – NUR für Klasse B hinterlegt
 * (FahrSchAusbO Anlage 1: 5 Überlandfahrten, 4 Autobahnfahrten,
 * 3 Nachtfahrten). Für alle anderen Klassen wird bewusst KEINE Zahl
 * behauptet (siehe docs/fachliche-bestaetigungen.md Punkt 2 – offen bis zur
 * fachlichen Bestätigung durch die Fahrschule).
 */
const KLASSE_B_SONDERFAHRTEN_MINDESTZAHL = {
  ueberland: 5,
  autobahn: 4,
  nacht: 3,
} as const;

function classifySonderfahrt(art: string): "ueberland" | "autobahn" | "nacht" | null {
  const a = art.toLowerCase();
  if (a.includes("autobahn")) return "autobahn";
  if (a.includes("nacht")) return "nacht";
  if (a.includes("überland") || a.includes("ueberland") || a.includes("landstra")) return "ueberland";
  return null;
}

const FORMAL_PREREQUISITE_DOC_TYPES = ["sehtest", "erste-hilfe", "passbild"] as const;

export interface ExamReadinessView {
  dataAsOf: string;
  formalPrerequisites: { typ: string; vorhanden: boolean; geprueft: boolean }[];
  theoryStatus: { assignedResources: number; visitedResources: number; note: string };
  mandatoryDrives:
    | { klasse: "B"; done: Record<string, number>; required: typeof KLASSE_B_SONDERFAHRTEN_MINDESTZAHL }
    | { klasse: string; note: string };
  competencyAreas: { source: "feedback.wentWell"; items: string[] };
  openLearningGoals: string[];
  instructorClearance: { status: string; grantedAt: string | null };
  officeReview: { status: string };
  disclaimer: string;
}

/**
 * PrüfungsReady-Ansicht: LIEFERT AUSDRÜCKLICH KEINEN "Prüfungsreife"-Score/
 * Prozentwert (Non-Negotiable, siehe docs/security-risks.md "Automatische
 * Prüfungsfreigabe... muss so bleiben"). Nur einzelne, für sich lesbare
 * Fakten – die Gewichtung/Formel aus app.html (Tacho-Gauge) ist bewusst
 * NICHT Teil dieser Ansicht, da fachlich unbestätigt
 * (docs/fachliche-bestaetigungen.md Punkt 5/6).
 */
export async function buildExamReadinessView(
  db: Database,
  params: { schuelerId: string; ausbildungId: string; klasse: string },
): Promise<ExamReadinessView> {
  const now = new Date();

  const docs = await db
    .select({ typ: dokumente.typ, geprueft: dokumente.geprueft, status: dokumente.status })
    .from(dokumente)
    .where(eq(dokumente.schuelerId, params.schuelerId));

  const formalPrerequisites = FORMAL_PREREQUISITE_DOC_TYPES.map((typ) => {
    const match = docs.find((d) => d.typ === typ && d.status !== "abgelehnt");
    return { typ, vorhanden: Boolean(match), geprueft: Boolean(match?.geprueft) };
  });

  const bookings = await db
    .select({ art: terminbuchungen.art, status: terminbuchungen.status })
    .from(terminbuchungen)
    .where(and(eq(terminbuchungen.schuelerId, params.schuelerId)));

  const confirmed = bookings.filter((b) => b.status !== "cancelled");

  let mandatoryDrives: ExamReadinessView["mandatoryDrives"];
  if (params.klasse === "B") {
    const done: Record<string, number> = { ueberland: 0, autobahn: 0, nacht: 0 };
    for (const b of confirmed) {
      const kind = classifySonderfahrt(b.art);
      if (kind) done[kind] += 1;
    }
    mandatoryDrives = { klasse: "B", done, required: KLASSE_B_SONDERFAHRTEN_MINDESTZAHL };
  } else {
    mandatoryDrives = {
      klasse: params.klasse,
      note: "Für diese Klasse ist keine bestätigte Mindestzahl hinterlegt (siehe docs/fachliche-bestaetigungen.md Punkt 2).",
    };
  }

  const feedbackRows = await db
    .select({
      wentWell: fahrstundenFeedback.wentWell,
      nextGoal: fahrstundenFeedback.nextGoal,
      releasedFields: fahrstundenFeedback.releasedFields,
    })
    .from(fahrstundenFeedback)
    .where(eq(fahrstundenFeedback.schuelerId, params.schuelerId));

  const competencyAreas = Array.from(
    new Set(
      feedbackRows
        .filter((f) => (f.releasedFields as string[]).includes("wentWell") && f.wentWell)
        .map((f) => f.wentWell as string),
    ),
  );
  const openLearningGoals = Array.from(
    new Set(
      feedbackRows
        .filter((f) => (f.releasedFields as string[]).includes("nextGoal") && f.nextGoal)
        .map((f) => f.nextGoal as string),
    ),
  );

  const [clearance] = await db
    .select()
    .from(pruefungsfreigaben)
    .where(eq(pruefungsfreigaben.ausbildungId, params.ausbildungId))
    .limit(1);

  return {
    dataAsOf: now.toISOString(),
    formalPrerequisites,
    theoryStatus: {
      assignedResources: 0,
      visitedResources: 0,
      note: "Theorie-Fortschritt aus packages/integrations 'Fahren Lernen'-Adapter ist Mock-only (kein offizielles API, siehe docs/integration-gaps.md) – hier wird nur der lokale Lernfortschritt (Lernen-Tab) gezeigt, kein extern importierter Stand.",
    },
    mandatoryDrives,
    competencyAreas: { source: "feedback.wentWell", items: competencyAreas },
    openLearningGoals,
    instructorClearance: {
      status: clearance?.status ?? "offen",
      grantedAt: clearance?.freigegebenAt ? new Date(clearance.freigegebenAt).toISOString() : null,
    },
    officeReview: { status: clearance?.buerofreigabeStatus ?? "offen" },
    disclaimer:
      "Diese Ansicht zeigt ausschließlich einzelne, für sich lesbare Fakten. Es gibt bewusst KEINE zusammenfassende Kennzahl für die Erfolgsaussicht einer Prüfung (Non-Negotiable).",
  };
}
