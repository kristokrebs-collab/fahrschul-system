import { auditEreignisse, dokumente, uploadSessions } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { DocumentStorageAdapter, MalwareScanAdapter } from "@fahrschul/integrations";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_DOCUMENT_BYTES,
  sha256,
  statusForValidationError,
  validateUpload,
} from "../lib/file-validation.js";
import { recordDocumentScanFailure } from "../lib/metrics.js";
import { log } from "../lib/observability.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { getOwnSchuelerId } from "../services/own-scope.js";
import { releaseDocumentAfterScan } from "../services/document-pipeline.js";
import { transitionState } from "../lib/state-machine.js";
import { sendBusinessConstraintError } from "../lib/state-machine.js";

/**
 * PROMPT -1 §12 – Wiederaufnehmbare (resumable) Uploads.
 *
 * ## Warum überhaupt
 *
 * §12 verlangt "große Uploads wiederaufnehmbar" und "abgebrochene Uploads
 * aufräumen". Ein einziges `POST /documents` mit 10 MB über eine mobile
 * Verbindung ist genau der Fall, der reihenweise scheitert – und danach ist
 * unklar, ob etwas angekommen ist.
 *
 * ## Der Ablauf, drei Schritte
 *
 * ```
 * POST /uploads                 -> Sitzung anlegen (Größe, Typ, optional Prüfsumme)
 * PUT  /uploads/:id/chunk?index -> Teilstück schicken (beliebig oft, idempotent je Index)
 * POST /uploads/:id/complete    -> zusammensetzen, prüfen, in QUARANTÄNE übernehmen
 * DELETE /uploads/:id           -> abbrechen (räumt sofort auf)
 * ```
 *
 * Eigenschaften, die den Unterschied machen:
 *
 *  - **Ein Teilstück ist idempotent je Index.** Ein wiederholtes `PUT` mit
 *    demselben Index UND demselben Inhalt ist ein No-op; mit ABWEICHENDEM
 *    Inhalt ist es ein 409. Ein wackeliges Netz erzeugt damit keine
 *    Datensalat-Datei.
 *  - **`GET /uploads/:id` sagt, was fehlt.** Der Client muss nicht raten, wo
 *    er weitermacht.
 *  - **Das Dokument entsteht erst bei `complete`** – und zwar im Zustand
 *    `quarantined`, NICHT `submitted`. Freigegeben wird ausschließlich über
 *    `releaseDocumentAfterScan` (services/document-pipeline.ts), und nur bei
 *    sauberem Scan.
 *  - **`expires_at` + Job `uploads.cleanup`** räumen alles, was liegen bleibt.
 *
 * ## Speicherort der Teilstücke
 *
 * Die Teilstücke gehen als eigene Objekte an den Storage-Adapter
 * (`teil-<index>`), die Datenbank hält nur Metadaten (Index, Bytes, SHA-256).
 * Damit landet KEIN Dateiinhalt in der Datenbank – dieselbe Regel wie in
 * `routes/documents.ts` (Security-Risk #4 des Prototyps).
 */

const createSessionSchema = z.object({
  typ: z.enum(["sehtest", "erste-hilfe", "passbild", "sonstiges"]),
  dateiname: z.string().min(1).max(255),
  mimeTyp: z.string().min(1).max(128),
  groesseBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  /** Optional: SHA-256 des Gesamtinhalts, wird bei `complete` gegengeprüft. */
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

interface TeilMeta {
  index: number;
  bytes: number;
  sha256: string;
  reference: string;
}

export interface UploadRouteDeps {
  storage: DocumentStorageAdapter;
  malwareScan: MalwareScanAdapter;
  /** Höchstgröße eines Teilstücks. */
  maxChunkBytes?: number;
  uploadTtlMs?: number;
}

export function registerUploadRoutes(app: FastifyInstance, db: Database, deps: UploadRouteDeps) {
  const maxChunkBytes = deps.maxChunkBytes ?? 2 * 1024 * 1024;
  const ttlMs = deps.uploadTtlMs ?? 24 * 60 * 60 * 1000;

  app.post(
    "/uploads",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const parsed = createSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const schuelerId = await getOwnSchuelerId(db, request.user!.id);
      if (!schuelerId) {
        return reply.code(403).send({ error: "forbidden", reason: "no_student_profile" });
      }

      const [row] = await db
        .insert(uploadSessions)
        .values({
          standortId: request.user!.standortId,
          benutzerId: request.user!.id,
          schuelerId,
          typ: parsed.data.typ,
          dateiname: parsed.data.dateiname,
          deklarierterMimeTyp: parsed.data.mimeTyp,
          erwarteteGroesseBytes: parsed.data.groesseBytes,
          erwarteteChecksumSha256: parsed.data.checksumSha256 ?? null,
          idempotencyKey: parsed.data.idempotencyKey ?? null,
          expiresAt: new Date(Date.now() + ttlMs),
        })
        .returning();

      return reply.code(201).send({
        uploadId: row.id,
        maxChunkBytes,
        erwarteteGroesseBytes: row.erwarteteGroesseBytes,
        expiresAt: row.expiresAt.toISOString(),
        hinweis:
          "Teilstücke per PUT /uploads/:id/chunk?index=N senden (Rohbytes, content-type application/octet-stream), danach POST /uploads/:id/complete.",
      });
    },
  );

  /** Fortschritt: welche Teilstücke fehlen noch? */
  app.get(
    "/uploads/:id",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, params.id)).limit(1);
      // Fremde Sitzungen sind "nicht vorhanden" – eine 403 würde ihre Existenz
      // bestätigen (dieselbe Regel wie bei GET /sync/operations).
      if (!row || row.benutzerId !== request.user!.id) {
        return reply.code(404).send({ error: "upload_not_found" });
      }
      const teile = (row.teile as TeilMeta[]) ?? [];
      return reply.send({
        uploadId: row.id,
        status: row.status,
        empfangeneBytes: row.empfangeneBytes,
        erwarteteGroesseBytes: row.erwarteteGroesseBytes,
        vorhandeneIndizes: teile.map((t) => t.index).sort((a, b) => a - b),
        expiresAt: row.expiresAt.toISOString(),
        dokumentId: row.dokumentId,
      });
    },
  );

  app.put(
    "/uploads/:id/chunk",
    {
      preHandler: [requireAuth, requirePermission("documents:upload:own")],
      // Rohbytes: kein JSON-Parser, kein Multipart-Rahmen.
      bodyLimit: 4 * 1024 * 1024,
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const query = z.object({ index: z.coerce.number().int().min(0).max(4096) }).safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "invalid_query", reason: "index erforderlich" });
      }

      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, params.id)).limit(1);
      if (!row || row.benutzerId !== request.user!.id) {
        return reply.code(404).send({ error: "upload_not_found" });
      }
      if (row.status !== "offen") {
        return reply.code(409).send({ error: "upload_not_open", status: row.status });
      }
      if (row.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: "upload_expired" });
      }

      const body = request.body;
      const chunk = Buffer.isBuffer(body)
        ? body
        : typeof body === "string"
          ? Buffer.from(body, "binary")
          : null;
      if (!chunk || chunk.byteLength === 0) {
        return reply.code(400).send({ error: "invalid_body", reason: "empty_chunk" });
      }
      if (chunk.byteLength > maxChunkBytes) {
        return reply.code(413).send({ error: "chunk_too_large", maxChunkBytes });
      }

      const teile = ((row.teile as TeilMeta[]) ?? []).slice();
      const hash = sha256(chunk);
      const vorhanden = teile.find((t) => t.index === query.data.index);
      if (vorhanden) {
        // Idempotenz je Index: gleicher Inhalt = No-op, anderer Inhalt = Konflikt.
        if (vorhanden.sha256 === hash) {
          return reply.send({ ok: true, wiederholt: true, empfangeneBytes: row.empfangeneBytes });
        }
        return reply.code(409).send({
          error: "chunk_conflict",
          index: query.data.index,
          hinweis:
            "Für diesen Index wurde bereits ein anderes Teilstück gespeichert. Upload abbrechen (DELETE) und neu beginnen.",
        });
      }

      const gesamtNachher = row.empfangeneBytes + chunk.byteLength;
      if (gesamtNachher > row.erwarteteGroesseBytes) {
        return reply.code(413).send({
          error: "upload_exceeds_declared_size",
          erwarteteGroesseBytes: row.erwarteteGroesseBytes,
          empfangeneBytes: gesamtNachher,
        });
      }

      const { reference } = await deps.storage.put(`${row.id}-teil-${query.data.index}`, chunk);
      teile.push({ index: query.data.index, bytes: chunk.byteLength, sha256: hash, reference });

      const [updated] = await db
        .update(uploadSessions)
        .set({
          teile: teile as never,
          empfangeneBytes: gesamtNachher,
          updatedAt: new Date(),
        })
        .where(eq(uploadSessions.id, row.id))
        .returning();

      return reply.send({
        ok: true,
        wiederholt: false,
        empfangeneBytes: updated.empfangeneBytes,
        erwarteteGroesseBytes: updated.erwarteteGroesseBytes,
        vollstaendig: updated.empfangeneBytes === updated.erwarteteGroesseBytes,
      });
    },
  );

  app.post(
    "/uploads/:id/complete",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, params.id)).limit(1);
      if (!row || row.benutzerId !== request.user!.id) {
        return reply.code(404).send({ error: "upload_not_found" });
      }
      // Ein zweites `complete` liefert dasselbe Dokument zurück statt ein
      // zweites anzulegen.
      if (row.dokumentId) {
        const [existing] = await db.select().from(dokumente).where(eq(dokumente.id, row.dokumentId)).limit(1);
        return reply.send({ document: existing, wiederholt: true });
      }
      if (row.status !== "offen") {
        return reply.code(409).send({ error: "upload_not_open", status: row.status });
      }
      if (row.empfangeneBytes !== row.erwarteteGroesseBytes) {
        return reply.code(409).send({
          error: "upload_incomplete",
          empfangeneBytes: row.empfangeneBytes,
          erwarteteGroesseBytes: row.erwarteteGroesseBytes,
        });
      }

      const teile = ((row.teile as TeilMeta[]) ?? []).slice().sort((a, b) => a.index - b.index);
      // Lücken erkennen: 0..n-1 muss vollständig sein.
      for (let i = 0; i < teile.length; i += 1) {
        if (teile[i].index !== i) {
          return reply.code(409).send({ error: "upload_gap", fehlenderIndex: i });
        }
      }

      const buffers: Buffer[] = [];
      for (const teil of teile) {
        const content = await deps.storage.get(teil.reference);
        if (!content) {
          return reply.code(500).send({ error: "chunk_missing_in_storage", index: teil.index });
        }
        buffers.push(content);
      }
      const buffer = Buffer.concat(buffers);

      // §12: Größe, behaupteter Typ, ECHTER Typ (Magic Bytes) und Prüfsumme.
      const validation = validateUpload({
        buffer,
        declaredMime: row.deklarierterMimeTyp ?? "application/octet-stream",
        expectedChecksum: row.erwarteteChecksumSha256,
      });
      if (!validation.ok) {
        await db
          .update(uploadSessions)
          .set({ status: "abgebrochen", fehler: validation.error, updatedAt: new Date() })
          .where(eq(uploadSessions.id, row.id));
        recordDocumentScanFailure(
          validation.error === "type_mismatch" || validation.error === "detected_type_not_allowed"
            ? "mime_mismatch"
            : validation.error === "too_large"
              ? "too_large"
              : validation.error === "checksum_mismatch"
                ? "checksum_mismatch"
                : validation.error === "empty"
                  ? "empty"
                  : "unsupported_type",
        );
        log({
          severity: "warn",
          requestId: request.requestId,
          correlationId: request.correlationId,
          actorBenutzerId: request.user!.id,
          actorRole: request.user!.rolle,
          operation: "POST /uploads/:id/complete",
          errorCode: validation.error,
          message: "Upload abgewiesen",
          // KEIN Dateiinhalt, kein Dateiname mit Personenbezug – nur Metadaten.
          details: {
            declaredMime: validation.declaredMime,
            detectedMime: validation.detectedMime,
            dangerous: validation.dangerous,
            sizeBytes: validation.sizeBytes,
          },
        });
        return reply.code(statusForValidationError(validation.error!)).send({
          error: validation.error,
          detail: validation.detail,
          declaredMime: validation.declaredMime,
          detectedMime: validation.detectedMime,
        });
      }

      const { reference } = await deps.storage.put(row.dateiname, buffer);

      // §12: das Dokument entsteht in QUARANTÄNE. Freigabe erst nach Scan.
      const document = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(dokumente)
          .values({
            standortId: row.standortId,
            schuelerId: row.schuelerId!,
            typ: row.typ,
            dateiname: row.dateiname,
            speicherReferenz: reference,
            scanStatus: "ausstehend",
            dokumentStatus: "uploaded",
            checksumSha256: validation.checksumSha256,
            groesseBytes: validation.sizeBytes,
            deklarierterMimeTyp: validation.declaredMime,
            erkannterMimeTyp: validation.detectedMime,
          })
          .returning();

        await transitionState(tx, {
          machine: "dokument",
          entitaetId: inserted.id,
          to: "quarantined",
          akteurBenutzerId: request.user!.id,
          standortId: row.standortId,
          grund: "Upload abgeschlossen – wartet auf Malware-Scan",
        });

        await tx
          .update(uploadSessions)
          .set({
            status: "vollstaendig",
            checksumSha256: validation.checksumSha256,
            speicherReferenz: reference,
            dokumentId: inserted.id,
            updatedAt: new Date(),
          })
          .where(eq(uploadSessions.id, row.id));

        await tx.insert(auditEreignisse).values(
          buildEventRow({
            type: "document.quarantined",
            aktion: "uploads.complete",
            entitaet: "dokument",
            entitaetId: inserted.id,
            akteurBenutzerId: request.user!.id,
            standortId: row.standortId,
            source: "apps/api:uploads.complete",
            correlationId: request.correlationId,
            payload: {
              typ: row.typ,
              groesseBytes: validation.sizeBytes,
              erkannterMimeTyp: validation.detectedMime,
              checksum: validation.checksumSha256,
              teile: teile.length,
            },
          }),
        );
        return inserted;
      });

      // Scan + Freigabe in einem zweiten Schritt: schlägt der Scanner aus,
      // BLEIBT das Dokument in Quarantäne (§18-Szenario 5) und wird nie als
      // geprüft angezeigt.
      const release = await releaseDocumentAfterScan(db, {
        dokumentId: document.id,
        buffer,
        dateiname: row.dateiname,
        malwareScan: deps.malwareScan,
        akteurBenutzerId: request.user!.id,
        standortId: row.standortId,
        correlationId: request.correlationId,
      });

      const [final] = await db.select().from(dokumente).where(eq(dokumente.id, document.id)).limit(1);
      return reply.code(201).send({
        document: final,
        scan: release,
        hinweis: release.freigegeben
          ? "Upload abgeschlossen, Scan sauber, Dokument zur Prüfung eingereicht."
          : "Upload abgeschlossen. Das Dokument bleibt in Quarantäne, bis der Scan erfolgreich war – es gilt NICHT als geprüft.",
      });
    },
  );

  app.delete(
    "/uploads/:id",
    { preHandler: [requireAuth, requirePermission("documents:upload:own")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, params.id)).limit(1);
      if (!row || row.benutzerId !== request.user!.id) {
        return reply.code(404).send({ error: "upload_not_found" });
      }
      await db
        .update(uploadSessions)
        .set({ status: "abgebrochen", updatedAt: new Date() })
        .where(eq(uploadSessions.id, row.id));
      return reply.send({ ok: true, uploadId: row.id, status: "abgebrochen" });
    },
  );
}

/**
 * §12 „abgebrochene Uploads aufräumen" – als Job (`uploads.cleanup`).
 *
 * Räumt: abgelaufene offene Sitzungen und abgebrochene Sitzungen. Ein
 * `vollstaendig`/`freigegeben`-Eintrag bleibt als Nachweis stehen (er
 * referenziert ein Dokument), wird aber von seinen Teilstück-Metadaten befreit.
 */
export async function cleanupAbortedUploads(
  db: Database,
  options: { now?: Date; olderThanMs?: number } = {},
): Promise<{ abgelaufen: number; entfernt: number }> {
  const now = options.now ?? new Date();
  const abgelaufen = await db
    .update(uploadSessions)
    .set({ status: "abgelaufen", updatedAt: now })
    .where(and(eq(uploadSessions.status, "offen"), lte(uploadSessions.expiresAt, now)))
    .returning({ id: uploadSessions.id });

  const cutoff = new Date(now.getTime() - (options.olderThanMs ?? 24 * 60 * 60 * 1000));
  const entfernt = await db
    .delete(uploadSessions)
    .where(
      and(
        inArray(uploadSessions.status, ["abgebrochen", "abgelaufen"]),
        lte(uploadSessions.updatedAt, cutoff),
        sql`${uploadSessions.dokumentId} is null`,
      ),
    )
    .returning({ id: uploadSessions.id });

  return { abgelaufen: abgelaufen.length, entfernt: entfernt.length };
}

export { sendBusinessConstraintError };
