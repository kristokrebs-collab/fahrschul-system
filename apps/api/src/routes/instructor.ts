import {
  arbeitszeitregeln,
  ausbildungen,
  auditEreignisse,
  fahrstundenFeedback,
  fahrzeuge,
  fahrzeugmaengel,
  kompetenzbeobachtungen,
  pruefungsfreigaben,
  raeume,
  schueler,
  simulatorgeraete,
  sprachprotokolle,
  terminbuchungen,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import {
  kompetenzstatusSchema,
  kompetenzfeldSchema,
  lessonCompletionInputSchema,
} from "@fahrschul/domain";
import type { AiSuggestionAdapter, TranscriptionAdapter } from "@fahrschul/integrations";
import { and, eq, gte, lt, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";
import { sendBusinessConstraintError } from "../lib/state-machine.js";
import { getOwnFahrlehrerId } from "../services/own-scope.js";
import { completeLesson, InstructorLessonError, startLesson } from "../services/instructor-lesson.js";
import type { Tx } from "../services/booking.js";

export interface InstructorRouteDeps {
  transcription: TranscriptionAdapter;
  aiSuggestions: AiSuggestionAdapter;
}

function dayBounds(dateStr?: string) {
  const base = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Wirft konsistent auf InstructorLessonError, sonst 500. */
function sendLessonError(err: unknown, reply: import("fastify").FastifyReply) {
  if (err instanceof InstructorLessonError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  throw err;
}

const kompetenzInputSchema = z.object({
  feld: kompetenzfeldSchema,
  kompetenzstatus: kompetenzstatusSchema,
  beobachtung: z.string().nullable().optional(),
  terminbuchungId: z.string().uuid().nullable().optional(),
});

const voiceLogCreateSchema = z.object({
  terminbuchungId: z.string().uuid(),
  audioReferenzOderDiktat: z.string().min(1),
});

const voiceLogEditSchema = z.object({
  transcriptBearbeitet: z.string().min(1).optional(),
  internZusammenfassung: z.string().nullable().optional(),
  schuelerseitigZusammenfassung: z.string().nullable().optional(),
  naechstesZiel: z.string().nullable().optional(),
  kompetenzvorschlaege: z
    .array(z.object({ feld: kompetenzfeldSchema, kompetenzstatus: kompetenzstatusSchema }))
    .optional(),
});

const vehicleIssueSchema = z.object({
  fahrzeugId: z.string().uuid(),
  grund: z.string().min(1),
  kilometerstand: z.number().int().nonnegative().nullable().optional(),
  tankLadungProzent: z.number().int().min(0).max(100).nullable().optional(),
  warnleuchten: z.array(z.string()).default([]),
  schweregrad: z.enum(["gering", "mittel", "kritisch"]).default("mittel"),
  einsatzbereit: z.boolean(),
  fotoReferenz: z.string().nullable().optional(),
  sprachnotizReferenz: z.string().nullable().optional(),
  geroutetAn: z.enum(["buero", "fuhrpark"]).default("buero"),
});

/**
 * Fahrlehrer-App-Backend (Prompt 3). Alle Endpunkte sind `own`-scoped auf
 * den eingeloggten Fahrlehrer (kein Zugriff auf fremde Termine/Schüler),
 * geprüft über `getOwnFahrlehrerId`, NICHT nur über die Permission-Matrix.
 */
export function registerInstructorRoutes(app: FastifyInstance, db: Database, deps: InstructorRouteDeps) {
  async function requireOwnFahrlehrer(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
    const fahrlehrerId = await getOwnFahrlehrerId(db, request.user!.id);
    if (!fahrlehrerId) {
      reply.code(403).send({ error: "forbidden", reason: "no_instructor_profile" });
      return null;
    }
    return fahrlehrerId;
  }

  /**
   * Eigene Schüler (own scope): abgeleitet aus terminbuchungen, KEINE
   * separate Zuordnungstabelle (die es in Prompt 0-2 fachlich nicht gibt) –
   * "eigene Schüler" = mit denen dieser Fahrlehrer mindestens einen Termin
   * hatte/hat.
   */
  app.get(
    "/instructor/schueler",
    { preHandler: [requireAuth, requirePermission("competency:read:own")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const rows = await db
        .selectDistinct({ schueler })
        .from(terminbuchungen)
        .innerJoin(schueler, eq(terminbuchungen.schuelerId, schueler.id))
        .where(eq(terminbuchungen.fahrlehrerId, fahrlehrerId));
      return reply.send({ schueler: rows.map((r) => r.schueler) });
    },
  );

  /** Heute: eigene Termine des Tages, live aus terminbuchungen + Referenzen. */
  app.get(
    "/instructor/heute",
    { preHandler: [requireAuth, requirePermission("appointments:read:own")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const { start, end } = dayBounds((request.query as { datum?: string }).datum);

      const rows = await db
        .select({
          buchung: terminbuchungen,
          schueler,
          fahrzeug: fahrzeuge,
          raum: raeume,
          simulator: simulatorgeraete,
        })
        .from(terminbuchungen)
        .leftJoin(schueler, eq(terminbuchungen.schuelerId, schueler.id))
        .leftJoin(fahrzeuge, eq(terminbuchungen.fahrzeugId, fahrzeuge.id))
        .leftJoin(raeume, eq(terminbuchungen.raumId, raeume.id))
        .leftJoin(simulatorgeraete, eq(terminbuchungen.simulatorgeraetId, simulatorgeraete.id))
        .where(
          and(
            eq(terminbuchungen.fahrlehrerId, fahrlehrerId),
            ne(terminbuchungen.status, "cancelled"),
            gte(terminbuchungen.beginnAt, start),
            lt(terminbuchungen.beginnAt, end),
          ),
        )
        .orderBy(terminbuchungen.beginnAt);

      return reply.send({ termine: rows, dataAsOf: new Date().toISOString() });
    },
  );

  /**
   * Schülerbriefing – liest ausschließlich bereits bestehende
   * Trainings-Fortschrittsdaten (fahrstunden_feedback/ausbildungen/
   * pruefungsfreigaben/kompetenzbeobachtungen), dieselben Tabellen, die
   * apps/student und apps/office nutzen. Keine neue Modellierung.
   */
  app.get(
    "/instructor/schueler/:id/briefing",
    { preHandler: [requireAuth, requirePermission("competency:read:own")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };

      // own-scope: der Fahrlehrer muss mindestens einmal mit diesem Schüler
      // gebucht (gehabt) haben, sonst kein Zugriff.
      const [ownBooking] = await db
        .select({ id: terminbuchungen.id })
        .from(terminbuchungen)
        .where(and(eq(terminbuchungen.schuelerId, params.id), eq(terminbuchungen.fahrlehrerId, fahrlehrerId)))
        .limit(1);
      if (!ownBooking) return reply.code(403).send({ error: "forbidden", reason: "not_own_student" });

      const [ausbildung] = await db
        .select()
        .from(ausbildungen)
        .where(eq(ausbildungen.schuelerId, params.id))
        .limit(1);

      const lastFeedback = await db
        .select()
        .from(fahrstundenFeedback)
        .where(eq(fahrstundenFeedback.schuelerId, params.id))
        .orderBy(fahrstundenFeedback.createdAt);

      const kompetenzen = await db
        .select()
        .from(kompetenzbeobachtungen)
        .where(eq(kompetenzbeobachtungen.schuelerId, params.id));

      const [freigabe] = await db
        .select()
        .from(pruefungsfreigaben)
        .where(eq(pruefungsfreigaben.schuelerId, params.id))
        .limit(1);

      const openZiele = lastFeedback.length ? lastFeedback[lastFeedback.length - 1].nextGoal : null;

      let naechsterFormalerSchritt = "Ausbildung fortsetzen";
      if (freigabe) {
        if (freigabe.status === "offen") naechsterFormalerSchritt = "Fahrlehrer-Go für Prüfung fehlt";
        else if (freigabe.buerofreigabeStatus === "offen") naechsterFormalerSchritt = "Büro-Prüfung ausstehend";
        else naechsterFormalerSchritt = "Prüfungstermin abstimmen";
      }

      return reply.send({
        // Schülerbriefing – für ~15s-Lesbarkeit auf das Nötigste begrenzt.
        heuteUeben: openZiele ?? "Kein offenes Lernziel hinterlegt.",
        daraufAchten: lastFeedback.length ? lastFeedback[lastFeedback.length - 1].workOn : null,
        letzterFortschritt: lastFeedback.length
          ? { wentWell: lastFeedback[lastFeedback.length - 1].wentWell, at: lastFeedback[lastFeedback.length - 1].createdAt }
          : null,
        offeneLernziele: lastFeedback.map((f) => f.nextGoal).filter(Boolean),
        fahrzeugBedarf: ausbildung ? { getriebeart: ausbildung.getriebeart, handicapBedarf: ausbildung.handicapBedarf } : null,
        naechsterFormalerSchritt,
        kompetenzraster: kompetenzen,
        ausbildung,
        dataAsOf: new Date().toISOString(),
      });
    },
  );

  app.get(
    "/instructor/schueler/:id/kompetenzraster",
    { preHandler: [requireAuth, requirePermission("competency:read:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const rows = await db.select().from(kompetenzbeobachtungen).where(eq(kompetenzbeobachtungen.schuelerId, params.id));
      return reply.send({ kompetenzraster: rows });
    },
  );

  app.post(
    "/instructor/schueler/:id/kompetenzraster",
    { preHandler: [requireAuth, requirePermission("competency:write:own")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      const parsed = kompetenzInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const [inserted] = await db
        .insert(kompetenzbeobachtungen)
        .values({
          standortId: request.user!.standortId,
          schuelerId: params.id,
          fahrlehrerId,
          terminbuchungId: parsed.data.terminbuchungId ?? null,
          feld: parsed.data.feld,
          kompetenzstatus: parsed.data.kompetenzstatus,
          beobachtung: parsed.data.beobachtung ?? null,
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "competency.observed",
          aktion: "kompetenzraster.observe",
          entitaet: "kompetenzbeobachtung",
          entitaetId: inserted.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:instructor.kompetenzraster",
          nachher: inserted,
        }),
      );

      return reply.code(201).send({ kompetenzbeobachtung: inserted });
    },
  );

  /** Stunde starten – echte serverseitige Validierung, siehe services/instructor-lesson.ts. */
  app.post(
    "/instructor/lessons/:id/start",
    { preHandler: [requireAuth, requirePermission("instructor:lesson:start")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      try {
        const booking = await db.transaction((tx) =>
          startLesson(tx, {
            terminbuchungId: params.id,
            fahrlehrerId,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
          }),
        );
        return reply.send({ termin: booking });
      } catch (err) {
        return sendLessonError(err, reply);
      }
    },
  );

  /**
   * Stunde beenden – zod-Schema `lessonCompletionInputSchema` erzwingt ALLE
   * 8 Schritte als Pflichtfelder; ein unvollständiges Payload wird mit 400
   * abgelehnt, BEVOR die Transaktion überhaupt beginnt, sodass
   * `lesson.completed` niemals mit fehlenden Feldern ausgelöst wird.
   */
  app.post(
    "/instructor/lessons/:id/complete",
    { preHandler: [requireAuth, requirePermission("instructor:lesson:complete")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      const parsed = lessonCompletionInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      /**
       * PROMPT -1 §2/§3 – "Fahrstunde abschließen".
       * Wird ein Idempotenzschlüssel mitgeschickt, läuft der Abschluss über
       * den generischen Mechanismus (Retry liefert dieselbe Antwort statt
       * einer zweiten Abschluss-Buchung). Unabhängig davon verhindert die
       * Datenbank einen zweiten endgültigen Abschluss (Trigger
       * fs_lesson_completed_once, SQLSTATE FS001) – die Invariante hängt
       * NICHT am Idempotenzschlüssel.
       */
      const idempotencyKey = readIdempotencyKey(request);

      /**
       * Der Abschluss UND die daraus abgeleiteten Kompetenzbeobachtungen
       * laufen in DERSELBEN Transaktion. Vorher war der Kompetenz-Insert ein
       * Nachlauf ausserhalb der Transaktion – ein Absturz dazwischen hätte
       * eine abgeschlossene Stunde ohne Beobachtungen hinterlassen, und ein
       * Retry hätte sie doppelt angelegt.
       */
      const completeAll = async (tx: Tx) => {
        const inner = await completeLesson(tx, {
          terminbuchungId: params.id,
          fahrlehrerId,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          payload: parsed.data,
        });
        for (const obs of inner.beobachteteKompetenzfelder) {
          await tx.insert(kompetenzbeobachtungen).values({
            standortId: request.user!.standortId,
            schuelerId: inner.booking.schuelerId,
            fahrlehrerId,
            terminbuchungId: inner.booking.id,
            feld: obs.feld,
            kompetenzstatus: obs.kompetenzstatus,
            beobachtung: obs.beobachtung,
          });
        }
        return inner;
      };

      try {
        const result = idempotencyKey
          ? await (async () => {
              const outcome = await runIdempotent({
                db,
                operation: IDEMPOTENT_OPERATIONS.lessonComplete,
                key: idempotencyKey,
                benutzerId: request.user!.id,
                standortId: request.user!.standortId,
                target: params.id,
                payload: parsed.data,
                handler: async (tx) => {
                  const inner = await completeAll(tx);
                  return {
                    status: 200,
                    body: { booking: inner.booking, lernziele: inner.lernziele },
                    entitaet: "terminbuchung",
                    entitaetId: inner.booking.id,
                  };
                },
              });
              return outcome.body as { booking: { id: string }; lernziele: string[] };
            })()
          : await db.transaction(completeAll);

        return reply.send({ termin: result.booking });
      } catch (err) {
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (sendBusinessConstraintError(err, reply)) return reply;
        return sendLessonError(err, reply);
      }
    },
  );

  app.post(
    "/instructor/lessons/:id/no-show",
    { preHandler: [requireAuth, requirePermission("instructor:lesson:start")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      const [booking] = await db.select().from(terminbuchungen).where(eq(terminbuchungen.id, params.id)).limit(1);
      if (!booking || booking.fahrlehrerId !== fahrlehrerId) return reply.code(404).send({ error: "not_found" });
      const [updated] = await db
        .update(terminbuchungen)
        .set({ status: "no_show", updatedAt: new Date() })
        .where(eq(terminbuchungen.id, params.id))
        .returning();
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "lesson.cancelled",
          aktion: "lesson.no_show",
          entitaet: "terminbuchung",
          entitaetId: updated.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:instructor.no-show",
        }),
      );
      return reply.send({ termin: updated });
    },
  );

  app.post(
    "/instructor/lessons/:id/verspaetung",
    { preHandler: [requireAuth, requirePermission("instructor:lesson:start")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      const parsed = z.object({ minuten: z.number().int().positive() }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      const [booking] = await db.select().from(terminbuchungen).where(eq(terminbuchungen.id, params.id)).limit(1);
      if (!booking || booking.fahrlehrerId !== fahrlehrerId) return reply.code(404).send({ error: "not_found" });
      const [updated] = await db
        .update(terminbuchungen)
        .set({ verspaetungMinuten: parsed.data.minuten, updatedAt: new Date() })
        .where(eq(terminbuchungen.id, params.id))
        .returning();
      return reply.send({ termin: updated });
    },
  );

  // ---------------------------------------------------------------------
  // Sprachprotokoll (Voice-Log): 1) Aufnahme -> 2) Transkription (Mock) ->
  // 3) Original bleibt sichtbar -> 4) KI-Vorschlag (Mock) -> 5) Fahrlehrer
  // bearbeitet -> 6) Fahrlehrer bestätigt -> 7) Split-Save. Schülerseitige
  // Inhalte erscheinen NIE vor Schritt 6 (kein automatisches Publizieren).
  // ---------------------------------------------------------------------
  app.post(
    "/instructor/voice-logs",
    { preHandler: [requireAuth, requirePermission("instructor:voice_log:manage")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const parsed = voiceLogCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const [booking] = await db
        .select()
        .from(terminbuchungen)
        .where(eq(terminbuchungen.id, parsed.data.terminbuchungId))
        .limit(1);
      if (!booking || booking.fahrlehrerId !== fahrlehrerId) {
        return reply.code(403).send({ error: "forbidden", reason: "not_own_booking" });
      }

      const transcription = await deps.transcription.transcribe(parsed.data.audioReferenzOderDiktat);
      const suggestions = await deps.aiSuggestions.suggest(transcription.transcript);

      const [inserted] = await db
        .insert(sprachprotokolle)
        .values({
          standortId: request.user!.standortId,
          terminbuchungId: booking.id,
          fahrlehrerId,
          schuelerId: booking.schuelerId,
          audioReferenz: parsed.data.audioReferenzOderDiktat,
          transcriptOriginal: transcription.transcript,
          aiVorschlaege: suggestions.vorschlaege,
          sprachprotokollStatus: "transkribiert",
        })
        .returning();

      return reply.code(201).send({ sprachprotokoll: inserted });
    },
  );

  app.patch(
    "/instructor/voice-logs/:id",
    { preHandler: [requireAuth, requirePermission("instructor:voice_log:manage")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };
      const parsed = voiceLogEditSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const [row] = await db.select().from(sprachprotokolle).where(eq(sprachprotokolle.id, params.id)).limit(1);
      if (!row || row.fahrlehrerId !== fahrlehrerId) return reply.code(404).send({ error: "not_found" });
      if (row.sprachprotokollStatus === "bestaetigt") {
        return reply.code(409).send({ error: "already_confirmed" });
      }

      const [updated] = await db
        .update(sprachprotokolle)
        .set({
          transcriptBearbeitet: parsed.data.transcriptBearbeitet ?? row.transcriptBearbeitet,
          internZusammenfassung: parsed.data.internZusammenfassung ?? row.internZusammenfassung,
          schuelerseitigZusammenfassung: parsed.data.schuelerseitigZusammenfassung ?? row.schuelerseitigZusammenfassung,
          naechstesZiel: parsed.data.naechstesZiel ?? row.naechstesZiel,
          kompetenzvorschlaege: parsed.data.kompetenzvorschlaege ?? row.kompetenzvorschlaege,
          sprachprotokollStatus: "entwurf",
          updatedAt: new Date(),
        })
        .where(eq(sprachprotokolle.id, params.id))
        .returning();

      return reply.send({ sprachprotokoll: updated });
    },
  );

  /**
   * Bestätigen (Schritt 6+7): erst hier wird schülerseitiger Inhalt in
   * `fahrstunden_feedback` gespiegelt – EXAKT über denselben
   * intern/schülerseitig-Split-Mechanismus wie Prompt 1
   * (`internalNotes` vs. `releasedFields`), siehe apps/api/src/routes/
   * feedback.ts. Kein automatisches Publizieren vor dieser Aktion.
   */
  app.post(
    "/instructor/voice-logs/:id/confirm",
    { preHandler: [requireAuth, requirePermission("instructor:voice_log:manage")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const params = request.params as { id: string };

      const [row] = await db.select().from(sprachprotokolle).where(eq(sprachprotokolle.id, params.id)).limit(1);
      if (!row || row.fahrlehrerId !== fahrlehrerId) return reply.code(404).send({ error: "not_found" });
      if (row.sprachprotokollStatus === "bestaetigt") return reply.code(409).send({ error: "already_confirmed" });

      const result = await db.transaction(async (tx) => {
        const [feedback] = await tx
          .insert(fahrstundenFeedback)
          .values({
            standortId: request.user!.standortId,
            terminbuchungId: row.terminbuchungId,
            schuelerId: row.schuelerId,
            fahrlehrerId,
            // Schülerseitig NUR aus schuelerseitigZusammenfassung/naechstesZiel,
            // NIE aus internZusammenfassung (identischer Split wie Prompt 1).
            workOn: row.schuelerseitigZusammenfassung,
            nextGoal: row.naechstesZiel,
            internalNotes: row.internZusammenfassung,
            releasedFields: ["workOn", "nextGoal"],
          })
          .returning();

        for (const suggestion of (row.kompetenzvorschlaege as { feld: string; kompetenzstatus: string }[]) ?? []) {
          await tx.insert(kompetenzbeobachtungen).values({
            standortId: request.user!.standortId,
            schuelerId: row.schuelerId,
            fahrlehrerId,
            terminbuchungId: row.terminbuchungId,
            feld: suggestion.feld,
            kompetenzstatus: suggestion.kompetenzstatus,
            beobachtung: "Aus Sprachprotokoll bestätigt.",
          });
        }

        const [updated] = await tx
          .update(sprachprotokolle)
          .set({
            sprachprotokollStatus: "bestaetigt",
            bestaetigtAt: new Date(),
            bestaetigtDurchBenutzerId: request.user!.id,
            gespiegeltesFeedbackId: feedback.id,
            updatedAt: new Date(),
          })
          .where(eq(sprachprotokolle.id, row.id))
          .returning();

        await tx.insert(auditEreignisse).values(
          buildEventRow({
            type: "voice_log.confirmed",
            aktion: "voice_log.confirm",
            entitaet: "sprachprotokoll",
            entitaetId: updated.id,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            source: "apps/api:instructor.voice-log-confirm",
            nachher: { feedbackId: feedback.id },
          }),
        );

        return { sprachprotokoll: updated, feedback };
      });

      return reply.send(result);
    },
  );

  app.get(
    "/instructor/voice-logs",
    { preHandler: [requireAuth, requirePermission("instructor:voice_log:manage")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;
      const rows = await db.select().from(sprachprotokolle).where(eq(sprachprotokolle.fahrlehrerId, fahrlehrerId));
      return reply.send({ sprachprotokolle: rows });
    },
  );

  // ---------------------------------------------------------------------
  // Fahrzeug: Quick-Check + Mangelmeldung (Prompt 2s fahrzeugmaengel,
  // hier erweitert um Quick-Check-Felder). einsatzbereit=false setzt
  // fahrzeuge.status="wartung" -> dieselbe harte Regel VEHICLE_NOT_READY
  // aus packages/scheduling blockiert dann sofort neue Buchungen.
  // ---------------------------------------------------------------------
  app.post(
    "/instructor/vehicle-issues",
    { preHandler: [requireAuth, requirePermission("vehicle:issue:report")] },
    async (request, reply) => {
      const parsed = vehicleIssueSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const result = await db.transaction(async (tx) => {
        const [mangel] = await tx
          .insert(fahrzeugmaengel)
          .values({
            standortId: request.user!.standortId,
            fahrzeugId: parsed.data.fahrzeugId,
            grund: parsed.data.grund,
            gemeldetVonBenutzerId: request.user!.id,
            kilometerstand: parsed.data.kilometerstand ?? null,
            tankLadungProzent: parsed.data.tankLadungProzent ?? null,
            warnleuchten: parsed.data.warnleuchten,
            schweregrad: parsed.data.schweregrad,
            einsatzbereit: parsed.data.einsatzbereit,
            fotoReferenz: parsed.data.fotoReferenz ?? null,
            sprachnotizReferenz: parsed.data.sprachnotizReferenz ?? null,
            geroutetAn: parsed.data.geroutetAn,
          })
          .returning();

        if (!parsed.data.einsatzbereit) {
          await tx
            .update(fahrzeuge)
            .set({ status: "wartung", updatedAt: new Date() })
            .where(eq(fahrzeuge.id, parsed.data.fahrzeugId));
        }
        return mangel;
      });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "vehicle_issue.reported",
          aktion: "vehicle_issue.report",
          entitaet: "fahrzeugmangel",
          entitaetId: result.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:instructor.vehicle-issue",
          nachher: result,
        }),
      );

      return reply.code(201).send({ fahrzeugmangel: result });
    },
  );

  app.get(
    "/instructor/vehicle-issues/mine",
    { preHandler: [requireAuth, requirePermission("vehicle:issue:report")] },
    async (request, reply) => {
      const rows = await db
        .select()
        .from(fahrzeugmaengel)
        .where(eq(fahrzeugmaengel.gemeldetVonBenutzerId, request.user!.id));
      return reply.send({ fahrzeugmaengel: rows });
    },
  );

  // ---------------------------------------------------------------------
  // Arbeitszeit – rein lesende, eigene Sicht: Plan (arbeitszeitregeln) vs.
  // Ist (Summe der eigenen Terminbuchungen heute/diese Woche). Keine
  // geheime Rangliste, keine automatische Personalaktion (siehe Prompt 2
  // "Arbeitszeit").
  // ---------------------------------------------------------------------
  app.get(
    "/instructor/arbeitszeit",
    { preHandler: [requireAuth, requirePermission("arbeitszeit:read:own")] },
    async (request, reply) => {
      const fahrlehrerId = await requireOwnFahrlehrer(request, reply);
      if (!fahrlehrerId) return;

      const [regel] = await db
        .select()
        .from(arbeitszeitregeln)
        .where(eq(arbeitszeitregeln.fahrlehrerId, fahrlehrerId))
        .limit(1);

      const { start, end } = dayBounds();
      const heuteBuchungen = await db
        .select()
        .from(terminbuchungen)
        .where(
          and(
            eq(terminbuchungen.fahrlehrerId, fahrlehrerId),
            ne(terminbuchungen.status, "cancelled"),
            gte(terminbuchungen.beginnAt, start),
            lt(terminbuchungen.beginnAt, end),
          ),
        );

      const istMinutenHeute = heuteBuchungen.reduce((sum, b) => {
        const ist = b.tatsaechlicheDauerMinuten ?? (b.endeAt.getTime() - b.beginnAt.getTime()) / 60000;
        return sum + ist;
      }, 0);

      const planMinutenHeute = heuteBuchungen.reduce(
        (sum, b) => sum + (b.endeAt.getTime() - b.beginnAt.getTime()) / 60000,
        0,
      );

      const maxMinutenProTag = regel ? Number(regel.maxStundenProTag) * 60 : 8 * 60;

      return reply.send({
        regel,
        heute: {
          planMinuten: planMinutenHeute,
          istMinuten: istMinutenHeute,
          maxMinuten: maxMinutenProTag,
          warnung: istMinutenHeute > maxMinutenProTag,
        },
        dataAsOf: new Date().toISOString(),
      });
    },
  );
}
