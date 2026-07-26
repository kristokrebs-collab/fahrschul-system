import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const organisationen = pgTable("organisationen", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const standorte = pgTable("standorte", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisationen.id),
  name: text("name").notNull(),
  adresse: text("adresse"),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rollen sind bewusst als geschlossene Menge im Anwendungscode
 * (@fahrschul/domain ROLES) definiert. Auf DB-Ebene per CHECK-Constraint
 * durchgesetzt (siehe migrations/0001_init.sql), damit die Datenbank auch
 * bei Bugs im Anwendungscode keine unbekannte Rolle akzeptiert.
 */
export const benutzer = pgTable("benutzer", {
  id: uuid("id").primaryKey().defaultRandom(),
  standortId: uuid("standort_id").references(() => standorte.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  rolle: text("rolle").notNull(),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"),
  status: text("status").notNull().default("aktiv"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  benutzerId: uuid("benutzer_id")
    .notNull()
    .references(() => benutzer.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  /**
   * PROMPT -1 §17 (Phase 3) – Step-up-Authentisierung.
   *
   * Zeitpunkt der letzten FRISCHEN Wiederanmeldung innerhalb dieser Sitzung
   * und, falls eng vergeben, für welche Aktion sie gilt. Absichtlich an der
   * SESSION und nicht in einer eigenen Tabelle: damit endet die Freigabe
   * zwingend mit der Sitzung und `POST /auth/logout-all` entzieht sie sofort.
   */
  stepUpVerifiedAt: timestamp("step_up_verified_at", { withTimezone: true }),
  stepUpScope: text("step_up_scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
