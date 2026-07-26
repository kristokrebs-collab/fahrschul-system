import type { SyncState } from "@fahrschul/domain";

/**
 * PROMPT -1 §1/§7 – die SICHTBARE Hälfte.
 *
 * Ein Zustand, den niemand sieht, ist kein Zustand. Diese Tabelle ist die
 * einzige Quelle der Beschriftungen für alle vier Frontends – damit
 * `retrying` nicht in einer App "Fehler" und in einer anderen "wird
 * gesendet" heißt.
 *
 * Zwei Beschriftungen sind besonders wichtig und deshalb erklärt:
 *
 *  - **`syncing` heißt NICHT "gespeichert".** Ein kritischer Vorgang darf
 *    erst nach Serverbestätigung als erfolgreich erscheinen (§7). Solange
 *    gesendet wird, heißt es "wird übertragen".
 *  - **Unbekannter Ausgang heißt "Status wird geprüft"** – wörtlich aus §7.
 *    Nie "erfolgreich", nie "fehlgeschlagen". Diese Beschriftung kommt aus
 *    `syncStateLabel(status, { outcomeUnknown: true })` und überschreibt jede
 *    andere.
 */

export const SYNC_STATE_LABEL: Record<SyncState, string> = {
  synced: "Aktuell",
  local_draft: "Lokaler Entwurf",
  queued: "Wartet auf Übertragung",
  syncing: "Wird übertragen",
  retrying: "Erneuter Versuch läuft",
  conflict: "Konflikt – Prüfung nötig",
  failed: "Fehlgeschlagen",
  offline: "Offline",
  stale: "Veraltet – bitte prüfen",
};

export const SYNC_STATE_HINT: Record<SyncState, string> = {
  synced: "Vom Server bestätigt.",
  local_draft: "Nur auf diesem Gerät gespeichert (verschlüsselt). Noch nicht gesendet.",
  queued: "Wird gesendet, sobald eine Verbindung besteht.",
  syncing: "Noch nicht bestätigt – bitte das Ergebnis abwarten.",
  retrying: "Vorübergehender Fehler. Der Versuch wird automatisch wiederholt.",
  conflict:
    "Der Server hat einen Konflikt gemeldet. Nichts wurde automatisch überschrieben – bitte entscheiden.",
  failed: "Endgültig fehlgeschlagen. Der Vorgang bleibt mit vollem Kontext erhalten.",
  offline: "Keine Verbindung. Kritische Vorgänge sind bis dahin nicht möglich.",
  stale: "Grundlage hat sich geändert oder der Entwurf ist zu alt. Bitte ausdrücklich bestätigen.",
};

/** §7: die Beschriftung für "wir wissen es nicht" – wörtlich vorgeschrieben. */
export const OUTCOME_UNKNOWN_LABEL = "Status wird geprüft";

export function syncStateLabel(
  status: SyncState,
  options: { outcomeUnknown?: boolean } = {},
): string {
  if (options.outcomeUnknown) return OUTCOME_UNKNOWN_LABEL;
  return SYNC_STATE_LABEL[status];
}

export function syncStateHint(status: SyncState, options: { outcomeUnknown?: boolean } = {}): string {
  if (options.outcomeUnknown) {
    return "Der Ausgang ist unbekannt. Es wird beim Server nachgefragt – bis dahin gilt der Vorgang weder als erfolgreich noch als fehlgeschlagen.";
  }
  return SYNC_STATE_HINT[status];
}

/** Grobe Einordnung für Farbe/Icon – bewusst nur drei Stufen. */
export function syncStateSeverity(
  status: SyncState,
  options: { outcomeUnknown?: boolean } = {},
): "ok" | "info" | "warn" {
  if (options.outcomeUnknown) return "warn";
  switch (status) {
    case "synced":
      return "ok";
    case "conflict":
    case "failed":
    case "stale":
      return "warn";
    default:
      return "info";
  }
}
