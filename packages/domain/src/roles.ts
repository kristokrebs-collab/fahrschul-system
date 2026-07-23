import { z } from "zod";

/**
 * Die sechs Rollen aus der Spezifikation. Bewusst als geschlossene Liste
 * (kein freier String), damit Rollen-Middleware und Permission-Matrix
 * exhaustiv geprüft werden können.
 */
export const ROLES = [
  "schueler",
  "fahrlehrer",
  "buero",
  "finanzen",
  "geschaeftsfuehrung",
  "systemdienst",
] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;
