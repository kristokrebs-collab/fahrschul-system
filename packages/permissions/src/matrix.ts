import type { Role } from "@fahrschul/domain";

/**
 * Alle vergebbaren Berechtigungen. Format: "<ressource>:<aktion>[:<scope>]".
 * scope "own" = nur eigene/zugeordnete Datensätze, "any" = alle Datensätze
 * am Standort/organisationsweit (Middleware muss den Scope zusätzlich zur
 * Anfrage gegen die Datenbank prüfen, die Matrix definiert nur das Maximum).
 */
export const PERMISSIONS = [
  "students:read:own",
  "students:read:any",
  "students:write:any",
  "appointments:read:own",
  "appointments:read:any",
  "appointments:create",
  "appointments:cancel:own",
  "appointments:cancel:any",
  "availability:write:own",
  "availability:write:any",
  "documents:upload:own",
  "documents:read:own",
  "documents:read:any",
  "documents:verify",
  "invoices:read:own",
  "invoices:manage",
  "payments:manage",
  "bank:reconcile",
  "reports:management",
  "users:manage",
  "audit:read",
  "system:admin",
  // Prompt 1 (apps/student) – konservative Erweiterungen, siehe
  // docs/role-permission-matrix.md "Fachliche Anmerkungen".
  "appointments:accept:own", // Schüler nimmt ein bestehendes Terminangebot an (KEIN appointments:create)
  "wunschzeiten:write:own", // Schüler pflegt eigene Wunschzeiten (nicht die Fahrlehrer-Verfügbarkeit)
  "exam:read:own", // Schüler sieht die eigene PrüfungsReady-Übersicht (read-only)
  "exam:clearance:set", // NUR Fahrlehrer/Büro dürfen eine Prüfungsfreigabe setzen
  "feedback:read:own", // Schüler sieht freigegebenes Fahrstundenfeedback (nie interne Notizen)
  "feedback:manage:own", // Fahrlehrer erfasst Feedback zu eigenen Fahrten
  "learning:read:own", // Schüler sieht Lerninhalte/eigenen Lernfortschritt
  "flex:participate:own", // Schüler nimmt an Krebs Flex teil (Opt-in/Annahme), solange Flag != hidden
  // Prompt 2 (apps/office) – Büro-Zentrale.
  "office:dashboard:read", // Heute-Queue/Planung/Auswertungen-Lesezugriff
  "leads:manage", // Leads/CRM anlegen/bearbeiten/konvertieren
  "messages:manage", // Nachrichtenvorlagen + Sende-Log verwalten
  "resources:manage", // Räume/Simulatoren/Fahrzeugmängel/Arbeitszeitregeln pflegen
  "exam:pipeline:advance", // Prüfungs-Pipeline-Zustand weiterschalten (fahrlehrer_go bleibt zusätzlich rollen-geprüft, siehe pruefungspipeline.ts)
  "storno:manage", // Storno-Retter-Flow auslösen/steuern
  "audit:read:office", // Büro sieht das Audit-Log ihres Standorts (enger als audit:read der Geschäftsführung/Systemdienst)
  // Prompt 3 (apps/instructor) – Fahrlehrer-App.
  "instructor:lesson:start", // Stunde starten (serverseitig validiert, own scope)
  "instructor:lesson:complete", // Stunde beenden (verpflichtender 8-Schritt-Fluss)
  "instructor:voice_log:manage", // Sprachprotokoll aufnehmen/bearbeiten/bestätigen
  "competency:write:own", // Kompetenzraster-Beobachtungen zu eigenen Schülern erfassen
  "competency:read:own", // Kompetenzraster zu eigenen Schülern lesen (Briefing)
  "vehicle:issue:report", // Fahrzeug-Mangelmeldung/Quick-Check (own = eigene Meldung)
  "arbeitszeit:read:own", // eigene Arbeitszeit-Ansicht (Plan vs. Ist)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Rolle -> Berechtigungen. Quelle der Wahrheit für docs/role-permission-matrix.md
 * (siehe scripts/print-matrix.ts) und für die Middleware in apps/api.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  schueler: [
    "students:read:own",
    "appointments:read:own",
    "appointments:cancel:own",
    "appointments:accept:own",
    "wunschzeiten:write:own",
    "documents:upload:own",
    "documents:read:own",
    "invoices:read:own",
    "exam:read:own",
    "feedback:read:own",
    "learning:read:own",
    "flex:participate:own",
  ],
  fahrlehrer: [
    "students:read:own",
    "appointments:read:own",
    "appointments:create",
    "appointments:cancel:own",
    "availability:write:own",
    "documents:read:own",
    "exam:clearance:set",
    "feedback:manage:own",
    "exam:pipeline:advance", // eingeschränkt auf den Übergang "fahrlehrer_go", siehe pruefungspipeline.ts
    "instructor:lesson:start",
    "instructor:lesson:complete",
    "instructor:voice_log:manage",
    "competency:write:own",
    "competency:read:own",
    "vehicle:issue:report",
    "arbeitszeit:read:own",
  ],
  buero: [
    "students:read:any",
    "students:write:any",
    "appointments:read:any",
    "appointments:create",
    "appointments:cancel:any",
    "availability:write:any",
    "documents:read:any",
    "documents:verify",
    "invoices:read:own",
    "exam:clearance:set",
    "office:dashboard:read",
    "leads:manage",
    "messages:manage",
    "resources:manage",
    "exam:pipeline:advance",
    "storno:manage",
    "audit:read:office",
  ],
  finanzen: [
    "students:read:any",
    "invoices:read:own",
    "invoices:manage",
    "payments:manage",
    "bank:reconcile",
    "reports:management",
  ],
  geschaeftsfuehrung: [
    "students:read:any",
    "appointments:read:any",
    "documents:read:any",
    "invoices:read:own",
    "invoices:manage",
    "reports:management",
    "audit:read",
  ],
  systemdienst: ["users:manage", "audit:read", "system:admin"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
