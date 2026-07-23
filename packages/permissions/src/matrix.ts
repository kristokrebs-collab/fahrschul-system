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
    "documents:upload:own",
    "documents:read:own",
    "invoices:read:own",
  ],
  fahrlehrer: [
    "students:read:own",
    "appointments:read:own",
    "appointments:create",
    "appointments:cancel:own",
    "availability:write:own",
    "documents:read:own",
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
