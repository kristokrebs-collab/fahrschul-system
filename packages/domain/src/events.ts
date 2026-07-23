import { z } from "zod";

/**
 * Versioniertes Event-Log (Spec Schritt 6). Jedes Ereignis referenziert
 * Akteur, Quelle, Zeitpunkt, Korrelations-ID und Idempotenz-Schlüssel und
 * wird in der audit_events-Tabelle (packages/database) mit type=... abgelegt.
 */
export const EVENT_TYPES = [
  "lead.created",
  "student.enrolled",
  "availability.updated",
  "lesson.offer.created",
  "lesson.booked",
  "lesson.cancelled",
  "lesson.completed",
  "document.submitted",
  "document.verified",
  "exam.clearance.granted",
  "invoice.issued",
  "payment.matched",
  "lesson.offer.accepted",
  "lesson.offer.declined",
  "document.rejected",
  "document.reuploaded",
  "feedback.given",
  "feedback.self_assessment.set",
  "flex.opt_in",
  "flex.offer.accepted",
  "invoice.inquiry.raised",
  // Prompt 3 (apps/instructor)
  "lesson.started",
  "vehicle_issue.reported",
  "voice_log.confirmed",
  "competency.observed",
] as const;

export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

export const platformEventSchema = z.object({
  id: z.string().uuid(),
  type: eventTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  source: z.string(), // z.B. "apps/api", "apps/office", "mock:bank-feed"
  occurredAt: z.coerce.date(),
  correlationId: z.string(),
  idempotencyKey: z.string().nullable(),
  payload: z.record(z.unknown()).default({}),
});
export type PlatformEvent = z.infer<typeof platformEventSchema>;
