import { z } from "zod";
import type { Role } from "./roles.js";

/**
 * Prüfungs-Pipeline als explizite State Machine (Prompt 2). Die 9 Zustände
 * aus der Aufgabenstellung, jeder Übergang ist hier als Kante mit
 * erlaubten Ausgangsrollen hinterlegt – "every transition
 * authorization-checked, reasoned, and audited". `apps/api` prüft
 * zusätzlich die Permission-Matrix (`exam:pipeline:advance`); diese Datei
 * ist die reine, DB-unabhängige Fachlogik und daher unit-testbar ohne API.
 */
export const PRUEFUNG_STATUS = [
  "in_vorbereitung",
  "voraussetzungen_fehlen",
  "fahrlehrer_go",
  "bueroprüfung",
  "unterlagen_vollstaendig",
  "termin_angefragt",
  "termin_bestaetigt",
  "durchgefuehrt",
  "ergebnis_dokumentiert",
] as const;

export const pruefungStatusSchema = z.enum(PRUEFUNG_STATUS);
export type PruefungStatus = z.infer<typeof pruefungStatusSchema>;

export interface PruefungTransition {
  from: PruefungStatus;
  to: PruefungStatus;
  /**
   * Rollen, die DIESEN Übergang ausführen dürfen, sofern sie generell die
   * Permission `exam:pipeline:advance` besitzen. `fahrlehrer_go` ist
   * bewusst auf `fahrlehrer` beschränkt (Spec: "'Fahrlehrer-Go' must come
   * from an instructor-role actor"), alle anderen Übergänge sind
   * `buero`-only, weil Büro die Pipeline operativ betreibt.
   */
  allowedRoles: Role[];
}

export const PRUEFUNG_TRANSITIONS: PruefungTransition[] = [
  { from: "in_vorbereitung", to: "voraussetzungen_fehlen", allowedRoles: ["buero"] },
  { from: "voraussetzungen_fehlen", to: "in_vorbereitung", allowedRoles: ["buero"] },
  { from: "in_vorbereitung", to: "fahrlehrer_go", allowedRoles: ["fahrlehrer"] },
  { from: "voraussetzungen_fehlen", to: "fahrlehrer_go", allowedRoles: ["fahrlehrer"] },
  { from: "fahrlehrer_go", to: "bueroprüfung", allowedRoles: ["buero"] },
  { from: "bueroprüfung", to: "unterlagen_vollstaendig", allowedRoles: ["buero"] },
  { from: "bueroprüfung", to: "voraussetzungen_fehlen", allowedRoles: ["buero"] },
  { from: "unterlagen_vollstaendig", to: "termin_angefragt", allowedRoles: ["buero"] },
  { from: "termin_angefragt", to: "termin_bestaetigt", allowedRoles: ["buero"] },
  { from: "termin_bestaetigt", to: "durchgefuehrt", allowedRoles: ["buero"] },
  { from: "durchgefuehrt", to: "ergebnis_dokumentiert", allowedRoles: ["buero"] },
];

export class PruefungTransitionError extends Error {
  code: "INVALID_TRANSITION" | "FORBIDDEN_ROLE";
  constructor(code: "INVALID_TRANSITION" | "FORBIDDEN_ROLE", message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Prüft, ob ein Übergang von `from` nach `to` durch die gegebene Rolle
 * erlaubt ist. Wirft einen typisierten Fehler statt stillschweigend `false`
 * zurückzugeben, damit apps/api den Grund direkt weiterreichen kann
 * (Spec: "reasoned").
 */
export function assertTransitionAllowed(from: PruefungStatus, to: PruefungStatus, actorRole: Role): PruefungTransition {
  const edge = PRUEFUNG_TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!edge) {
    throw new PruefungTransitionError(
      "INVALID_TRANSITION",
      `Übergang von "${from}" nach "${to}" ist in der Prüfungs-Pipeline nicht vorgesehen.`,
    );
  }
  if (!edge.allowedRoles.includes(actorRole)) {
    throw new PruefungTransitionError(
      "FORBIDDEN_ROLE",
      `Übergang nach "${to}" erfordert eine der Rollen [${edge.allowedRoles.join(", ")}], nicht "${actorRole}".`,
    );
  }
  return edge;
}

export function possibleNextStates(from: PruefungStatus): PruefungStatus[] {
  return PRUEFUNG_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}
