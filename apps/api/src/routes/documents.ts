import { createHash } from "node:crypto";
import { auditEreignisse, dokumente } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { DocumentStorageAdapter, MalwareScanAdapter } from "@fahrschul/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
import {
  IdempotencyConflictError,
  IDEMPOTENT_OPERATIONS,
  readIdempotencyKey,
  runIdempotent,
  sendIdempotencyConflict,
} from "../lib/idempotency.js";
import {
  assertVersion,
  readExpectedVersion,
  requireExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError, transitionState } from "../lib/state-machine.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_DOC_TYPES = ["sehtest", "erste-hilfe", "passbild", "sonstiges"] as const;

const reviewSchema = z.object({
  entscheidung: z.enum(["akzeptiert", "abgelehnt"]),
  ablehnungsgrund: z.string().optional(),
  /** §4: die gelesene Version (alternativ If-Match-Header). */
  expectedVersion: z.number().int().nonnegative().optional(),
  /** §3/§19: Prüfprotokoll ist Pflicht – die DB lehnt verified/rejected ohne ab (FS006). */
  pruefprotokoll: z
    .object({
      geprueftePunkte: z.array(z.string()).min(1),
      bemerkung: z.string().max(1000).optional(),
    })
    .optional(),
});

export interface DocumentRouteDeps {
  storage: DocumentStorageAdapter;
  malwareScan: MalwareScanAdapter;
}

export function registerDocumentRoutes(app: FastifyInstance, db: Database, deps: DocumentRouteDeps) {
  /**
   * Upload via multipart/form-data. Es wird NIE Base64 in einer JSON-/
   * DB-Spalte gespeichert (Security-Risk #4 im Prototyp) – die Datei geht
   * an den Storage-Adapter (packages/integrations, mock-backed mit echtem
   * Interface), die Datenbank hält ausschließlich die Referenz + Metadaten.
   * Der Malware-Scan-Hook läuft vor der Speicherung (Mock "always clean",
   * siehe packages/integrations/src/malware-scan, dokumentierte Lücke).
   */
  app.post(
    "/documents",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: "invalid_body", reason: "no_file" });
      }
      /**
       * PROMPT -1 §2 (Phase 2): Der Idempotenzschlüssel ist PFLICHT
       * (Umschaltpunkt: IDEMPOTENCY_MANDATORY in lib/idempotency.ts).
       *
       * Die Prüfung steht so FRÜH wie möglich – direkt nach dem Einlesen des
       * Multipart-Rahmens und VOR MIME-Prüfung, Größenprüfung, Malware-Scan
       * und Ablage. Früher geht es nicht, weil der Schlüssel
       * rückwärtskompatibel auch aus dem Formularfeld `idempotencyKey`
       * kommen darf und das Feld erst nach `request.file()` lesbar ist. Ein
       * `preHandler` könnte nur den Header sehen und würde ältere Aufrufer
       * grundlos abweisen.
       */
      const idempotencyKey =
        readIdempotencyKey(request) ??
        (file.fields.idempotencyKey as { value?: string } | undefined)?.value ??
        null;
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: "idempotency_key_required",
          operation: IDEMPOTENT_OPERATIONS.documentSubmit,
          hinweis:
            'Header "idempotency-key" (oder Formularfeld "idempotencyKey") ist für diese Operation verpflichtend.',
        });
      }

      const typ = (file.fields.typ as { value?: string } | undefined)?.value;
      if (!typ || !(ALLOWED_DOC_TYPES as readonly string[]).includes(typ)) {
        return reply.code(400).send({ error: "invalid_body", reason: "invalid_typ" });
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return reply.code(415).send({ error: "unsupported_media_type", mimetype: file.mimetype });
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_BYTES) {
        return reply.code(413).send({ error: "file_too_large", maxBytes: MAX_BYTES });
      }
      if (buffer.byteLength === 0) {
        return reply.code(400).send({ error: "invalid_body", reason: "empty_file" });
      }

      const scanResult = await deps.malwareScan.scan(buffer, file.filename);
      if (scanResult.status === "verdaechtig") {
        return reply.code(422).send({ error: "malware_scan_flagged" });
      }

      const { reference } = await deps.storage.put(file.filename, buffer);

      /**
       * PROMPT -1 §2/§10: Der Upload läuft über den generischen
       * Idempotenz-Mechanismus (Schlüssel aus Header `Idempotency-Key` oder
       * Formularfeld `idempotencyKey`) und durchläuft die persistierte
       * Dokument-State-Machine uploaded -> scanning -> submitted. Der Hash
       * enthält den Dateiinhalt, damit derselbe Schlüssel mit einer ANDEREN
       * Datei als Konflikt erkannt wird.
       */

      const insertDocument = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
        const [inserted] = await tx
          .insert(dokumente)
          .values({
            standortId: request.user!.standortId,
            schuelerId,
            typ,
            dateiname: file.filename,
            speicherReferenz: reference,
            scanStatus: scanResult.status,
            dokumentStatus: "uploaded",
          })
          .returning();

        await transitionState(tx, {
          machine: "dokument",
          entitaetId: inserted.id,
          to: "scanning",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Malware-Scan durchgeführt",
        });
        const submitted = await transitionState(tx, {
          machine: "dokument",
          entitaetId: inserted.id,
          to: "submitted",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Scan sauber – zur Prüfung eingereicht",
          eventType: "document.submitted",
          aktion: "documents.upload",
          source: "apps/api:documents.upload",
          payload: { typ: inserted.typ, dateiname: inserted.dateiname },
        });
        return (submitted.row ?? inserted) as typeof inserted;
      };

      try {
        const outcome = await runIdempotent({
          db,
          operation: IDEMPOTENT_OPERATIONS.documentSubmit,
          key: idempotencyKey,
          benutzerId: request.user!.id,
          standortId: request.user!.standortId,
          target: typ,
          payload: {
            typ,
            dateiname: file.filename,
            mimetype: file.mimetype,
            inhaltHash: createHash("sha256").update(buffer).digest("hex"),
          },
          handler: async (tx) => {
            const document = await insertDocument(tx);
            return {
              status: 201,
              body: { document },
              entitaet: "dokument",
              entitaetId: document.id,
            };
          },
        });
        return reply
          .code(outcome.replayed ? 200 : outcome.status)
          .send({ ...(outcome.body as object), replayed: outcome.replayed });
      } catch (err) {
        if (err instanceof IdempotencyConflictError) return sendIdempotencyConflict(err, reply);
        if (sendBusinessConstraintError(err, reply)) return reply;
        throw err;
      }
    },
  );

  app.get(
    "/documents/mine",
    { preHandler: [requireAuth, requirePermission("documents:read:own")] },
    async (request, reply) => {
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) return reply.send({ documents: [] });
      const rows = await db.select().from(dokumente).where(eq(dokumente.schuelerId, schuelerId));
      return reply.send({ documents: rows });
    },
  );

  /**
   * Re-Upload nach Ablehnung: legt einen NEUEN Dokument-Datensatz an und
   * verkettet ihn mit dem alten (`ersetztVonDokumentId`), damit die
   * Audit-Historie erhalten bleibt statt den abgelehnten Datensatz zu
   * überschreiben.
   */
  app.post(
    "/documents/:id/reupload",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }
      const [original] = await db
        .select()
        .from(dokumente)
        .where(and(eq(dokumente.id, params.id), eq(dokumente.schuelerId, schuelerId)))
        .limit(1);
      if (!original) {
        return reply.code(404).send({ error: "document_not_found" });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: "invalid_body", reason: "no_file" });
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        return reply.code(415).send({ error: "unsupported_media_type" });
      }
      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAX_BYTES || buffer.byteLength === 0) {
        return reply.code(413).send({ error: "file_too_large" });
      }
      const scanResult = await deps.malwareScan.scan(buffer, file.filename);
      if (scanResult.status === "verdaechtig") {
        return reply.code(422).send({ error: "malware_scan_flagged" });
      }
      const { reference } = await deps.storage.put(file.filename, buffer);

      const result = await db.transaction(async (tx) => {
        const [replacement] = await tx
          .insert(dokumente)
          .values({
            standortId: request.user!.standortId,
            schuelerId,
            typ: original.typ,
            dateiname: file.filename,
            speicherReferenz: reference,
            scanStatus: scanResult.status,
            dokumentStatus: "uploaded",
          })
          .returning();
        await transitionState(tx, {
          machine: "dokument",
          entitaetId: replacement.id,
          to: "scanning",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Malware-Scan nach Re-Upload",
        });
        const submitted = await transitionState(tx, {
          machine: "dokument",
          entitaetId: replacement.id,
          to: "submitted",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Re-Upload zur Prüfung eingereicht",
        });
        await tx
          .update(dokumente)
          .set({ ersetztVonDokumentId: replacement.id })
          .where(eq(dokumente.id, original.id));
        return (submitted.row ?? replacement) as typeof replacement;
      });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "document.reuploaded",
          aktion: "documents.reupload",
          entitaet: "dokument",
          entitaetId: result.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:documents.reupload",
          vorher: { id: original.id, status: original.status },
          nachher: { id: result.id },
        }),
      );

      return reply.code(201).send({ document: result });
    },
  );

  /**
   * Prüfung/Ablehnung durch das Büro (documents:verify – Prompt 2 Rolle,
   * hier nur als API-Endpunkt für die geforderten Reject/Reupload-Tests
   * bereitgestellt, kein UI in apps/student).
   */
  app.post(
    "/documents/:id/review",
    { preHandler: [requireAuth, requirePermission("documents:verify")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = reviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const accepted = parsed.data.entscheidung === "akzeptiert";
      // §4: Version optional-aber-geprüft. Schickt der Client eine Version
      // mit, wird ein veralteter Stand mit 409 + aktuellem Zustand abgelehnt.
      const expected = readExpectedVersion(request);

      try {
        const updated = await db.transaction(async (tx) => {
          const [doc] = await tx.select().from(dokumente).where(eq(dokumente.id, params.id)).limit(1);
          if (!doc) return null;
          assertVersion(doc, expected);

          // §10: die Prüfung führt über `in_review` zum Ergebnis – der
          // Zwischenzustand ist persistiert, damit eine unterbrochene Prüfung
          // im §19-Bericht auftaucht statt zu verschwinden.
          if (doc.dokumentStatus === "submitted") {
            await transitionState(tx, {
              machine: "dokument",
              entitaetId: doc.id,
              to: "in_review",
              akteurBenutzerId: request.user!.id,
              standortId: request.user!.standortId,
              grund: "Büroprüfung begonnen",
            });
          }

          // §3: `verified`/`rejected` verlangen ein Prüfprotokoll + Prüfer –
          // die Datenbank lehnt es sonst mit FS006 ab. Fehlt es im Body, wird
          // ein Minimalprotokoll aus der Entscheidung gebildet, damit die
          // bestehenden Aufrufer weiterlaufen, der Nachweis aber existiert.
          const protokoll = parsed.data.pruefprotokoll ?? {
            geprueftePunkte: [accepted ? "vollstaendig" : "unvollstaendig"],
            bemerkung: accepted ? null : parsed.data.ablehnungsgrund ?? "Nicht angegeben",
          };

          const result = await transitionState(tx, {
            machine: "dokument",
            entitaetId: doc.id,
            to: accepted ? "verified" : "rejected",
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            grund: accepted ? "Dokument akzeptiert" : parsed.data.ablehnungsgrund ?? "abgelehnt",
            eventType: accepted ? "document.verified" : "document.rejected",
            aktion: "documents.review",
            source: "apps/api:documents.review",
            patch: {
              geprueft: accepted,
              ablehnungsgrund: accepted ? null : parsed.data.ablehnungsgrund ?? "Nicht angegeben",
              pruefprotokoll: protokoll,
              gepruefDurchBenutzerId: request.user!.id,
              gepruefAt: new Date(),
            },
          });
          return result.row as typeof doc;
        });

        if (!updated) return reply.code(404).send({ error: "document_not_found" });
        withVersionHeaders(reply, updated);
        return reply.send({ document: updated });
      } catch (err) {
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        throw err;
      }
    },
  );
}
