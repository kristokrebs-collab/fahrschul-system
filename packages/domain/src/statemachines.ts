import { z } from "zod";

/**
 * PROMPT -1 §10 – Vier persistierte State Machines mit den EXAKTEN
 * Zustandsmengen der Spezifikation.
 *
 * Diese Datei ist die DB-unabhängige, unit-testbare Fachlogik. Sie hat ein
 * exaktes Spiegelbild in der Datenbank (Tabelle `state_machine_transitions`,
 * gefüllt in migrations/0007_reliability_core.sql), sodass die Allow-List
 * auch dann greift, wenn ein Schreibvorgang den Anwendungscode umgeht
 * (Verteidigung in der Tiefe – dasselbe Prinzip wie bei den
 * EXCLUDE-Constraints gegen Doppelbuchungen).
 *
 * Persistenz + Wiederaufnahme: der Zustand liegt AUSSCHLIESSLICH in der
 * jeweiligen Entitätsspalte (`terminangebote.angebot_status`,
 * `dokumente.dokument_status`, `banktransaktionen.zahlung_status`,
 * `fahrzeugmaengel.mangel_status`), nie im Prozessspeicher. Jeder
 * Mehrschrittprozess wird über den Job-Store (§13) fortgesetzt und ist damit
 * nach einem Neustart an genau der Stelle wiederaufnehmbar, an der er stand.
 */

// ---------------------------------------------------------------------------
// Zustandsmengen (wörtlich aus der Spezifikation)
// ---------------------------------------------------------------------------
export const TERMINANGEBOT_STATES = [
  "created",
  "sent",
  "delivered",
  "accepted",
  "booking_pending",
  "confirmed",
  "rejected",
  "expired",
  "cancelled",
  "failed_review",
] as const;

export const DOKUMENT_STATES = [
  "uploaded",
  "quarantined",
  "scanning",
  "submitted",
  "in_review",
  "verified",
  "rejected",
  "expired",
  "deleted",
] as const;

export const ZAHLUNG_STATES = [
  "imported",
  "matching",
  "suggested",
  "review_required",
  "matched",
  "partially_matched",
  "reversed",
  "failed",
] as const;

export const FAHRZEUGMANGEL_STATES = [
  "reported",
  "triaged",
  "vehicle_blocked",
  "replacement_pending",
  "resolved",
  "reopened",
] as const;

export const terminangebotStateSchema = z.enum(TERMINANGEBOT_STATES);
export const dokumentStateSchema = z.enum(DOKUMENT_STATES);
export const zahlungStateSchema = z.enum(ZAHLUNG_STATES);
export const fahrzeugmangelStateSchema = z.enum(FAHRZEUGMANGEL_STATES);

export type TerminangebotState = z.infer<typeof terminangebotStateSchema>;
export type DokumentState = z.infer<typeof dokumentStateSchema>;
export type ZahlungState = z.infer<typeof zahlungStateSchema>;
export type FahrzeugmangelState = z.infer<typeof fahrzeugmangelStateSchema>;

export const STATE_MACHINES = ["terminangebot", "dokument", "zahlung", "fahrzeugmangel"] as const;
export const stateMachineNameSchema = z.enum(STATE_MACHINES);
export type StateMachineName = z.infer<typeof stateMachineNameSchema>;

// ---------------------------------------------------------------------------
// Allow-List der Übergänge (identisch zu state_machine_transitions in 0007)
// ---------------------------------------------------------------------------
export const STATE_TRANSITIONS: Record<StateMachineName, Record<string, readonly string[]>> = {
  terminangebot: {
    created: ["sent", "cancelled", "expired", "failed_review"],
    // "sent -> accepted" ist erlaubt, weil ein Schüler ein Angebot auch dann
    // annehmen kann, wenn die Zustellbestätigung (delivered) noch nicht
    // eingetroffen ist – die Angebotsliste ist pollbar.
    sent: ["delivered", "accepted", "rejected", "expired", "cancelled", "failed_review"],
    delivered: ["accepted", "rejected", "expired", "cancelled"],
    accepted: ["booking_pending", "failed_review", "cancelled"],
    booking_pending: ["confirmed", "failed_review", "cancelled"],
    confirmed: ["cancelled"],
    rejected: ["sent", "expired", "cancelled"],
    expired: [],
    cancelled: [],
    failed_review: ["sent", "cancelled"],
  },
  dokument: {
    uploaded: ["scanning", "quarantined", "deleted"],
    scanning: ["submitted", "quarantined", "deleted"],
    quarantined: ["scanning", "deleted"],
    submitted: ["in_review", "quarantined", "expired", "deleted"],
    in_review: ["verified", "rejected", "expired", "deleted"],
    verified: ["expired", "deleted"],
    rejected: ["in_review", "deleted"],
    expired: ["deleted"],
    deleted: [],
  },
  zahlung: {
    imported: ["matching", "failed"],
    matching: ["suggested", "review_required", "matched", "partially_matched", "failed"],
    suggested: ["matched", "partially_matched", "review_required", "failed"],
    review_required: ["matched", "partially_matched", "failed"],
    // Aus "matched" führt einzig "reversed" heraus – das ist die
    // Fachregel "eine Banktransaktion wird nicht zweimal vollständig
    // zugeordnet" (§3), DB-seitig zusätzlich mit SQLSTATE FS003 abgesichert.
    matched: ["reversed"],
    partially_matched: ["matched", "review_required", "reversed"],
    reversed: ["matching"],
    failed: ["matching"],
  },
  fahrzeugmangel: {
    reported: ["triaged", "vehicle_blocked", "resolved"],
    triaged: ["vehicle_blocked", "replacement_pending", "resolved"],
    vehicle_blocked: ["replacement_pending", "resolved"],
    replacement_pending: ["vehicle_blocked", "resolved"],
    resolved: ["reopened"],
    reopened: ["triaged", "vehicle_blocked", "replacement_pending", "resolved"],
  },
};

/** Initialzustand je Maschine. */
export const STATE_MACHINE_INITIAL: Record<StateMachineName, string> = {
  terminangebot: "created",
  dokument: "uploaded",
  zahlung: "imported",
  fahrzeugmangel: "reported",
};

/**
 * Abbildung der neuen Zustandsmengen auf die Alt-Statuswerte, die apps/*
 * weiterhin lesen (Expand-Contract, §14). Identisch zu den
 * `fs_*_legacy()`-Funktionen in migrations/0007_reliability_core.sql – hier
 * nur für Anzeige-/Testzwecke, die Datenbank bleibt die durchsetzende Stelle.
 */
export const STATE_LEGACY_MAP: Record<StateMachineName, Record<string, string>> = {
  terminangebot: {
    created: "offen",
    sent: "offen",
    delivered: "offen",
    accepted: "gebucht",
    booking_pending: "gebucht",
    confirmed: "gebucht",
    rejected: "abgelehnt",
    expired: "abgelaufen",
    cancelled: "storniert",
    failed_review: "pruefung_erforderlich",
  },
  dokument: {
    uploaded: "hochgeladen",
    quarantined: "quarantaene",
    scanning: "pruefung_laeuft",
    submitted: "eingereicht",
    in_review: "in_pruefung",
    verified: "geprueft",
    rejected: "abgelehnt",
    expired: "abgelaufen",
    deleted: "geloescht",
  },
  zahlung: {
    imported: "offen",
    matching: "offen",
    suggested: "offen",
    review_required: "offen",
    matched: "gebucht",
    partially_matched: "offen",
    reversed: "abgelehnt",
    failed: "abgelehnt",
  },
  fahrzeugmangel: {
    reported: "offen",
    triaged: "offen",
    vehicle_blocked: "offen",
    replacement_pending: "offen",
    resolved: "behoben",
    reopened: "offen",
  },
};

export class StateTransitionError extends Error {
  code = "INVALID_STATE_TRANSITION" as const;
  machine: StateMachineName;
  from: string;
  to: string;
  allowed: readonly string[];
  constructor(machine: StateMachineName, from: string, to: string, allowed: readonly string[]) {
    super(`Übergang "${from}" -> "${to}" ist in der ${machine}-State-Machine nicht vorgesehen.`);
    this.machine = machine;
    this.from = from;
    this.to = to;
    this.allowed = allowed;
  }
}

export function allowedNextStates(machine: StateMachineName, from: string): readonly string[] {
  return STATE_TRANSITIONS[machine][from] ?? [];
}

export function isTransitionAllowed(machine: StateMachineName, from: string, to: string): boolean {
  if (from === to) return true;
  return allowedNextStates(machine, from).includes(to);
}

/** Wirft einen typisierten Fehler statt `false` zurückzugeben, damit apps/api den Grund weiterreichen kann. */
export function assertStateTransition(machine: StateMachineName, from: string, to: string): void {
  if (!isTransitionAllowed(machine, from, to)) {
    throw new StateTransitionError(machine, from, to, allowedNextStates(machine, from));
  }
}

/** Terminale Zustände (keine ausgehenden Kanten) – nützlich für §19-Prüfungen und UI. */
export function terminalStates(machine: StateMachineName): string[] {
  return Object.entries(STATE_TRANSITIONS[machine])
    .filter(([, next]) => next.length === 0)
    .map(([state]) => state);
}
