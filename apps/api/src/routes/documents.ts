import { auditEreignisse, dokumente } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { DocumentStorageAdapter, MalwareScanAdapter } from "@fahrschul/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_DOC_TYPES = ["sehtest", "erste-hilfe", "passbild", "sonstiges"] as const;

const reviewSchema = z.object({
  entscheidung: z.enum(["akzeptiert", "abgelehnt"]),
  ablehnungsgrund: z.string().optional(),
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

      const [inserted] = await db
        .insert(dokumente)
        .values({
          standortId: request.user!.standortId,
          schuelerId,
          typ,
          dateiname: file.filename,
          speicherReferenz: reference,
          scanStatus: scanResult.status,
          status: "eingereicht",
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "document.submitted",
          aktion: "documents.upload",
          entitaet: "dokument",
          entitaetId: inserted.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:documents.upload",
          nachher: { id: inserted.id, typ: inserted.typ, dateiname: inserted.dateiname },
        }),
      );

      return reply.code(201).send({ document: inserted });
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
            status: "eingereicht",
          })
          .returning();
        await tx
          .update(dokumente)
          .set({ ersetztVonDokumentId: replacement.id, updatedAt: new Date() })
          .where(eq(dokumente.id, original.id));
        return replacement;
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
      const [doc] = await db.select().from(dokumente).where(eq(dokumente.id, params.id)).limit(1);
      if (!doc) return reply.code(404).send({ error: "document_not_found" });

      const accepted = parsed.data.entscheidung === "akzeptiert";
      const [updated] = await db
        .update(dokumente)
        .set({
          geprueft: accepted,
          status: accepted ? "geprueft" : "abgelehnt",
          ablehnungsgrund: accepted ? null : parsed.data.ablehnungsgrund ?? "Nicht angegeben",
          updatedAt: new Date(),
        })
        .where(eq(dokumente.id, params.id))
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: accepted ? "document.verified" : "document.rejected",
          aktion: "documents.review",
          entitaet: "dokument",
          entitaetId: updated.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:documents.review",
          nachher: updated,
        }),
      );

      return reply.send({ document: updated });
    },
  );
}
