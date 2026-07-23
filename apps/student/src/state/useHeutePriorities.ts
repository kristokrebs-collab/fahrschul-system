import type {
  Dokument,
  ExamReadiness,
  Lernressource,
  Terminangebot,
  Terminbuchung,
} from "../api/types.js";

export type HeuteWarningKind =
  | "exam_blocker"
  | "document_rejected"
  | "offer_expiring"
  | "no_next_appointment"
  | "missing_availability"
  | "theory_pending"
  | "learning_recommendation";

export interface HeutePriority {
  kind: HeuteWarningKind;
  title: string;
  detail: string;
  actionLabel: string;
  actionTo: string;
}

/**
 * Priorisierungslogik für den Heute-Tab (siehe Aufgabenstellung, exakte
 * Reihenfolge 1-7). Reine, testbare Funktion ohne Netzwerkzugriff - nur EINE
 * Warnung/Handlungsempfehlung wird zurückgegeben, auch wenn mehrere Punkte
 * zutreffen.
 */
export function computeHeutePriority(input: {
  examReadiness: ExamReadiness | null;
  documents: Dokument[];
  offers: { offer: Terminangebot | null }[];
  appointments: Terminbuchung[];
  hasWunschzeiten: boolean;
  learningResources: Lernressource[];
}): HeutePriority | null {
  const now = Date.now();

  if (input.examReadiness?.instructorClearance.status === "abgelehnt") {
    return {
      kind: "exam_blocker",
      title: "Prüfungsfreigabe noch nicht möglich",
      detail: "Dein Fahrlehrer hat die Freigabe aktuell abgelehnt – sprich mit ihm über die nächsten Schritte.",
      actionLabel: "PrüfungsReady ansehen",
      actionTo: "/ausbildung/pruefungsready",
    };
  }

  const rejectedDoc = input.documents.find((d) => d.status === "abgelehnt");
  if (rejectedDoc) {
    return {
      kind: "document_rejected",
      title: `Dokument abgelehnt: ${rejectedDoc.typ}`,
      detail: rejectedDoc.ablehnungsgrund ?? "Bitte lade das Dokument erneut hoch.",
      actionLabel: "Erneut hochladen",
      actionTo: "/mehr/dokumente",
    };
  }

  const expiringOffer = input.offers.find((o) => {
    if (!o.offer?.ablaufAt) return false;
    const msLeft = new Date(o.offer.ablaufAt).getTime() - now;
    return msLeft > 0 && msLeft < 1000 * 60 * 60 * 24;
  });
  if (expiringOffer?.offer) {
    return {
      kind: "offer_expiring",
      title: "Terminangebot läuft bald ab",
      detail: `Angebot am ${new Date(expiringOffer.offer.beginnAt).toLocaleString("de-DE")} verfällt bald.`,
      actionLabel: "Zu den Terminen",
      actionTo: "/termine",
    };
  }

  const nextAppointment = input.appointments
    .filter((a) => a.status !== "cancelled" && new Date(a.beginnAt).getTime() > now)
    .sort((a, b) => new Date(a.beginnAt).getTime() - new Date(b.beginnAt).getTime())[0];
  if (!nextAppointment) {
    return {
      kind: "no_next_appointment",
      title: "Noch kein nächster Termin",
      detail: "Nimm ein offenes Terminangebot an oder trage deine Wunschzeiten ein.",
      actionLabel: "Termine ansehen",
      actionTo: "/termine",
    };
  }

  if (!input.hasWunschzeiten) {
    return {
      kind: "missing_availability",
      title: "Wunschzeiten fehlen",
      detail: "Trage ein, wann du Zeit für Fahrstunden hast, damit dein Fahrlehrer besser planen kann.",
      actionLabel: "Wunschzeiten eintragen",
      actionTo: "/termine",
    };
  }

  const openTheory = input.learningResources.find(
    (r) => (r.typ === "kurs" || r.typ === "simulator") && r.fortschritt === "offen",
  );
  if (openTheory) {
    return {
      kind: "theory_pending",
      title: `Offen: ${openTheory.titel}`,
      detail: "Theorie/Simulator-Einheit noch nicht besucht.",
      actionLabel: "Zum Lernen-Tab",
      actionTo: "/lernen",
    };
  }

  const recommendation = input.learningResources.find((r) => r.fortschritt === "offen");
  if (recommendation) {
    return {
      kind: "learning_recommendation",
      title: `Empfehlung: ${recommendation.titel}`,
      detail: recommendation.beschreibung ?? "Ergänzendes Lernmaterial.",
      actionLabel: "Ansehen",
      actionTo: "/lernen",
    };
  }

  return null;
}
