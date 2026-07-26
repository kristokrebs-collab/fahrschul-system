import { OFFLINE_DRAFT_KINDS, type OfflineDraftKind, type OfflineForbiddenOperation } from "@fahrschul/domain";

/**
 * PROMPT -1 §8 – DER VERTRAG, was offline überhaupt passieren darf.
 *
 * Bisher stand diese Regel in `apps/student` und `apps/instructor` jeweils als
 * Kommentar über einem `apiMutate` ohne Offline-Fallback, und in
 * `apps/office`/`apps/finance` überhaupt nicht (dort gab es gar keinen
 * Offline-Pfad – "nicht vorhanden" ist aber keine geprüfte Zusage).
 *
 * Hier ist der Vertrag EINMAL als Daten hinterlegt und für alle vier Apps
 * verbindlich – prüfbar, statt gut gemeint:
 *
 *   ERLAUBT offline, nur als ENTWURF:
 *     Verfügbarkeitsentwurf, Fahrstundenberichtsentwurf,
 *     Fahrzeugmangelentwurf, Schüler-Selbsteinschätzung
 *
 *   NICHT offline abschließbar:
 *     Terminbuchung, Terminstorno, Prüfung-Go, Zahlung/Rechnung,
 *     Fahrzeugblockierung, Dokumentverifizierung
 *
 * Diese Liste ist eine SPIEGELUNG der serverseitigen Regeln, kein Ersatz.
 * Der Server autorisiert und validiert jede Anfrage unverändert selbst; der
 * Client verhindert lediglich, dass die UI einen Erfolg behauptet, den es
 * nicht gibt.
 */

export interface MutationClassification {
  /** Idempotenz-Operationsname des Servers, falls es eine der zehn §2-Operationen ist. */
  operation: string | null;
  /**
   * `true` = kritisch. Ein kritischer Vorgang wird ERST nach Serverbestätigung
   * als erfolgreich angezeigt (§7) und braucht immer einen Idempotenzschlüssel.
   */
  kritisch: boolean;
  /** Gesetzt, wenn dieser Vorgang offline nicht abgeschlossen werden darf (§8). */
  offlineForbidden: OfflineForbiddenOperation | null;
  /** Gesetzt, wenn dieser Vorgang offline als Entwurf erlaubt ist (§8). */
  offlineDraftKind: OfflineDraftKind | null;
}

interface Regel extends MutationClassification {
  method: string;
  /** Regulärer Ausdruck auf dem Pfad (ohne Query). */
  pattern: RegExp;
}

const UUID = "[0-9a-fA-F-]{8,}";

const REGELN: Regel[] = [
  // ---- §2: die zehn idempotenten, kritischen Schreibvorgänge --------------
  {
    method: "POST",
    pattern: new RegExp(`^/appointment-offers/${UUID}/accept$`),
    operation: "appointment-offers.accept",
    kritisch: true,
    offlineForbidden: "termin_buchung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/appointments$/,
    operation: "appointments.create",
    kritisch: true,
    offlineForbidden: "termin_buchung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/appointments/${UUID}/cancel$`),
    operation: "appointments.cancel",
    kritisch: true,
    offlineForbidden: "termin_storno",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/instructor/lessons/${UUID}/complete$`),
    operation: "instructor.lessons.complete",
    kritisch: true,
    offlineForbidden: null,
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/invoices$/,
    operation: "invoices.create",
    kritisch: true,
    offlineForbidden: "rechnung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/finance/bank/${UUID}/resolve$`),
    operation: "finance.bank.resolve",
    kritisch: true,
    offlineForbidden: "zahlung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/documents$/,
    operation: "documents.submit",
    kritisch: true,
    offlineForbidden: null,
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/documents/${UUID}/reupload$`),
    operation: "documents.submit",
    kritisch: true,
    offlineForbidden: null,
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/pruefungen/${UUID}/transition$`),
    operation: "pruefungen.transition",
    kritisch: true,
    offlineForbidden: "pruefung_go",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/resources/fahrzeuge/${UUID}/block$`),
    operation: "resources.fahrzeuge.block",
    kritisch: true,
    offlineForbidden: "fahrzeug_blockierung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/communication\/send$/,
    operation: "communication.send",
    kritisch: true,
    offlineForbidden: null,
    offlineDraftKind: null,
  },

  // ---- weitere kritische Vorgänge ohne eigene §2-Operation ----------------
  {
    method: "POST",
    pattern: new RegExp(`^/appointment-offers/${UUID}/decline$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "termin_storno",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/flex/offers/${UUID}/accept$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "termin_buchung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/instructor/lessons/${UUID}/(start|no-show)$`),
    operation: null,
    kritisch: true,
    offlineForbidden: null,
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/documents/${UUID}/review$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "dokument_verifizierung",
    offlineDraftKind: null,
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/invoices/${UUID}$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "rechnung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/invoices/${UUID}/(pay|inquiry)$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "zahlung",
    offlineDraftKind: null,
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/resources/fahrzeuge/${UUID}$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "fahrzeug_blockierung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/finance\/bank\/sync$/,
    operation: null,
    kritisch: true,
    offlineForbidden: "zahlung",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: new RegExp(`^/pruefungsfreigaben(/${UUID})?.*$`),
    operation: null,
    kritisch: true,
    offlineForbidden: "pruefung_go",
    offlineDraftKind: null,
  },
  {
    method: "POST",
    pattern: /^\/exam\/clearance.*$/,
    operation: null,
    kritisch: true,
    offlineForbidden: "pruefung_go",
    offlineDraftKind: null,
  },

  // ---- offline ERLAUBT, aber nur als Entwurf ------------------------------
  {
    method: "POST",
    pattern: /^\/availability$/,
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "verfuegbarkeit_entwurf",
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/availability/${UUID}$`),
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "verfuegbarkeit_entwurf",
  },
  {
    method: "PUT",
    pattern: /^\/me\/wunschzeiten$/,
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "verfuegbarkeit_entwurf",
  },
  {
    method: "PATCH",
    pattern: new RegExp(`^/feedback/${UUID}/self-assessment$`),
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "schueler_selbsteinschaetzung",
  },
  {
    method: "POST",
    pattern: /^\/instructor\/vehicle-issues$/,
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "fahrzeugmangel_entwurf",
  },
  {
    method: "POST",
    pattern: /^\/instructor\/voice-logs$/,
    operation: null,
    kritisch: false,
    offlineForbidden: null,
    offlineDraftKind: "fahrstundenbericht_entwurf",
  },
];

const NEUTRAL: MutationClassification = {
  operation: null,
  kritisch: false,
  offlineForbidden: null,
  offlineDraftKind: null,
};

/** Zerlegt einen Pfad (Query wird ignoriert) und klassifiziert die Mutation. */
export function classifyMutation(method: string, path: string): MutationClassification {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  const upper = method.toUpperCase();
  for (const regel of REGELN) {
    if (regel.method === upper && regel.pattern.test(clean)) {
      return {
        operation: regel.operation,
        kritisch: regel.kritisch,
        offlineForbidden: regel.offlineForbidden,
        offlineDraftKind: regel.offlineDraftKind,
      };
    }
  }
  return NEUTRAL;
}

export class OfflineNotAllowedError extends Error {
  readonly operation: OfflineForbiddenOperation | null;
  readonly kritisch: boolean;
  constructor(operation: OfflineForbiddenOperation | null, kritisch: boolean) {
    super(
      operation
        ? `Dieser Vorgang (${operation}) kann offline nicht abgeschlossen werden.`
        : "Dieser Vorgang braucht eine Verbindung und kann offline nicht abgeschlossen werden.",
    );
    this.name = "OfflineNotAllowedError";
    this.operation = operation;
    this.kritisch = kritisch;
  }
}

/**
 * Wird von allen vier API-Clients vor einer Mutation aufgerufen. Wirft, wenn
 * offline UND der Vorgang nicht offline abgeschlossen werden darf.
 *
 * Absichtlich streng: alles, was NICHT ausdrücklich als Entwurf erlaubt ist,
 * ist offline verboten. Ein neuer Endpunkt ist damit standardmäßig
 * offline-gesperrt und nicht versehentlich offen.
 */
export function assertOfflineAllowed(method: string, path: string, online: boolean): void {
  if (online) return;
  const klasse = classifyMutation(method, path);
  if (klasse.offlineDraftKind) return;
  throw new OfflineNotAllowedError(klasse.offlineForbidden, klasse.kritisch);
}

export function isOfflineDraftKind(value: string): value is OfflineDraftKind {
  return (OFFLINE_DRAFT_KINDS as readonly string[]).includes(value);
}
