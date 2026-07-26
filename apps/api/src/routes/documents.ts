import { auditEreignisse, dokumente, schueler } from "@fahrschul/database";
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
  etagFor,
  requireExpectedVersion,
  readExpectedVersion,
  sendVersionConflict,
  VersionConflictError,
  withVersionHeaders,
} from "../lib/optimistic.js";
import { sendBusinessConstraintError, transitionState } from "../lib/state-machine.js";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  statusForValidationError,
  validateUpload,
} from "../lib/file-validation.js";
import { recordDocumentScanFailure } from "../lib/metrics.js";
import { log } from "../lib/observability.js";
import {
  DOCUMENT_ACCESS_TTL_MS,
  documentDownloadUrl,
  statusForSignatureFailure,
  verifyAccess,
} from "../lib/signed-access.js";
import { releaseDocumentAfterScan } from "../services/document-pipeline.js";
import type { IntegrationServiceOptions } from "../services/integrations.js";

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
  /** Signaturschlüssel für kurzlebige Zugriffs-URLs (§12). */
  signingSecret: string;
  /** §11: Breaker/Zeitlimit um den Scanner. */
  resilience?: IntegrationServiceOptions;
}

export function registerDocumentRoutes(app: FastifyInstance, db: Database, deps: DocumentRouteDeps) {
  /**
   * Upload via multipart/form-data.
   *
   * ## PROMPT -1 §12 – was Phase 3 hier geändert hat
   *
   * Vorher: `file.mimetype` (also der VOM CLIENT BEHAUPTETE Typ) wurde gegen
   * eine Allowlist geprüft, der Mock-Scanner meldete "sauber", und das
   * Dokument ging direkt nach `submitted`. Eine ausführbare Datei mit
   * `Content-Type: image/png` kam damit durch, und der Zustand `quarantined`
   * aus §10 hatte gar keinen Produzenten.
   *
   * Jetzt, in dieser Reihenfolge:
   *  1. Idempotenzschlüssel (unverändert, so früh wie möglich).
   *  2. Größe + behaupteter Typ.
   *  3. **Magic Bytes**: der tatsächliche Typ wird erkannt und muss zum
   *     behaupteten passen. Ein Widerspruch ist 415, nicht ein Hinweis.
   *  4. Prüfsumme (SHA-256) wird berechnet und GESPEICHERT.
   *  5. Das Dokument entsteht in **`quarantined`** – nicht `submitted`.
   *  6. Erst `releaseDocumentAfterScan` bringt es nach `submitted`, und nur bei
   *     sauberem Scan. Fällt der Scanner aus, BLEIBT es in Quarantäne
   *     (§18-Szenario 5) und gilt nie als geprüft.
   *
   * Der Dateiinhalt landet weiterhin ausschließlich beim Storage-Adapter,
   * niemals als Base64 in der Datenbank (Security-Risk #4 des Prototyps).
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
       * kommen darf und das Feld erst nach `request.file()` lesbar ist.
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

      const buffer = await file.toBuffer();
      const validation = validateUpload({
        buffer,
        declaredMime: file.mimetype,
        maxBytes: MAX_DOCUMENT_BYTES,
      });
      if (!validation.ok) {
        recordDocumentScanFailure(
          validation.error === "type_mismatch" || validation.error === "detected_type_not_allowed"
            ? "mime_mismatch"
            : validation.error === "too_large"
              ? "too_large"
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
          operation: "POST /documents",
          errorCode: validation.error,
          message: "Upload abgewiesen (§12)",
          // Nur Metadaten – NIE der Dateiinhalt (§16).
          details: {
            declaredMime: validation.declaredMime,
            detectedMime: validation.detectedMime,
            dangerous: validation.dangerous,
            sizeBytes: validation.sizeBytes,
          },
        });
        return reply.code(statusForValidationError(validation.error!)).send({
          error:
            validation.error === "declared_type_not_allowed" || validation.error === "detected_type_not_allowed"
              ? "unsupported_media_type"
              : validation.error === "too_large"
                ? "file_too_large"
                : validation.error === "type_mismatch"
                  ? "mime_type_mismatch"
                  : "invalid_body",
          reason: validation.error,
          detail: validation.detail,
          declaredMime: validation.declaredMime,
          detectedMime: validation.detectedMime,
          erlaubt: ALLOWED_DOCUMENT_MIME_TYPES,
          maxBytes: MAX_DOCUMENT_BYTES,
        });
      }

      const { reference } = await deps.storage.put(file.filename, buffer);

      const insertDocument = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
        const [inserted] = await tx
          .insert(dokumente)
          .values({
            standortId: request.user!.standortId,
            schuelerId,
            typ,
            dateiname: file.filename,
            speicherReferenz: reference,
            scanStatus: "ausstehend",
            dokumentStatus: "uploaded",
            checksumSha256: validation.checksumSha256,
            groesseBytes: validation.sizeBytes,
            deklarierterMimeTyp: validation.declaredMime,
            erkannterMimeTyp: validation.detectedMime,
          })
          .returning();

        // §12: ZUERST Quarantäne. Kein Codepfad führt direkt nach `submitted`.
        await transitionState(tx, {
          machine: "dokument",
          entitaetId: inserted.id,
          to: "quarantined",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Upload angenommen – wartet auf Malware-Scan",
          eventType: "document.quarantined",
          aktion: "documents.upload",
          source: "apps/api:documents.upload",
          payload: {
            typ: inserted.typ,
            groesseBytes: validation.sizeBytes,
            erkannterMimeTyp: validation.detectedMime,
          },
        });
        return inserted;
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
            inhaltHash: validation.checksumSha256,
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

        if (outcome.replayed) {
          return reply.code(200).send({ ...(outcome.body as object), replayed: true });
        }

        // Scan + Freigabe NACH der Idempotenztransaktion: der Scan ist ein
        // externer Aufruf und hat in einer DB-Transaktion nichts zu suchen
        // (er würde sie über sein Zeitlimit offen halten).
        const document = (outcome.body as { document: { id: string } }).document;
        const release = await releaseDocumentAfterScan(db, {
          dokumentId: document.id,
          buffer,
          dateiname: file.filename,
          malwareScan: deps.malwareScan,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          correlationId: request.correlationId,
          resilience: deps.resilience,
        });
        const [final] = await db.select().from(dokumente).where(eq(dokumente.id, document.id)).limit(1);

        return reply.code(201).send({
          document: final,
          replayed: false,
          scan: {
            status: release.scanStatus,
            freigegeben: release.freigegeben,
            scannerAusgefallen: release.scannerAusgefallen,
            hinweis: release.grund,
          },
        });
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
      /**
       * §12: keine öffentliche URL. Jeder Datensatz bekommt eine KURZLEBIGE,
       * an DIESEN Benutzer gebundene Signatur; der Abrufendpunkt prüft
       * trotzdem Sitzung UND Eigentum erneut gegen die Datenbank.
       *
       * §4 (Phase 3): jede Zeile trägt ihre Version mit, damit ein Client
       * `If-Match` senden kann.
       */
      const documents = rows.map((row) => ({
        ...row,
        etag: etagFor(row),
        zugriff:
          row.dokumentStatus === "quarantined" || row.scanStatus !== "sauber"
            ? null
            : documentDownloadUrl({
                dokumentId: row.id,
                benutzerId: request.user!.id,
                secret: deps.signingSecret,
              }),
      }));
      return reply.send({
        documents,
        zugriffGueltigSekunden: Math.round(DOCUMENT_ACCESS_TTL_MS / 1000),
      });
    },
  );

  /**
   * PROMPT -1 §12 – Abruf des Dokumentinhalts.
   *
   * DREI Prüfungen, in dieser Reihenfolge, und keine ist optional:
   *   1. **Sitzung** (`requireAuth`) – eine Signatur allein öffnet nichts.
   *   2. **Eigentum/Berechtigung gegen die DATENBANK** – ein Schüler nur
   *      eigene Dokumente; Büro/Geschäftsführung über `documents:read:any`.
   *      Das ist die Prüfung, die den Test "Signatur von Schüler A nutzt
   *      Schüler B nicht" gewinnt, denn …
   *   3. **Signatur**, die zusätzlich an `benutzerId` gebunden ist. Selbst ein
   *      Büro-Akteur, der eine für einen Schüler ausgestellte URL abfängt,
   *      kann sie nicht benutzen: der HMAC passt nicht zu seiner ID.
   *
   * Jeder Abruf wird auditiert. Ein Dokument in Quarantäne wird NICHT
   * ausgeliefert (es ist nicht gescannt – §12/§18-Szenario 5).
   */
  app.get(
    "/documents/:id/content",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const query = request.query as { sig?: string };
      if (!query.sig) {
        return reply.code(400).send({
          error: "missing_signature",
          hinweis: "Der Abruf verlangt die kurzlebige Signatur aus GET /documents/mine.",
        });
      }

      const [row] = await db.select().from(dokumente).where(eq(dokumente.id, params.id)).limit(1);
      if (!row) return reply.code(404).send({ error: "document_not_found" });

      // (2) Autorisierung gegen die Datenbank – VOR der Signaturprüfung, damit
      // ein fremder Datensatz gar nicht erst als "existiert" bestätigt wird.
      const eigenerSchuelerId = await getOwnSchuelerId(db, request.user!.id);
      const istEigenes = eigenerSchuelerId !== null && row.schuelerId === eigenerSchuelerId;
      const darfFremde =
        request.user!.rolle === "buero" ||
        request.user!.rolle === "geschaeftsfuehrung";
      // Standort-/Mandantentrennung: auch `documents:read:any` gilt nur im
      // eigenen Standort. Ein Dokument ohne Standort (Altbestand) bleibt
      // ausschließlich dem Eigentümer zugänglich.
      const gleicherStandort =
        row.standortId !== null && row.standortId === request.user!.standortId;
      if (!istEigenes && !(darfFremde && gleicherStandort)) {
        return reply.code(404).send({ error: "document_not_found" });
      }

      // (3) Signatur, gebunden an DIESEN Benutzer.
      const check = verifyAccess(
        query.sig,
        {
          resource: "dokument",
          resourceId: row.id,
          benutzerId: request.user!.id,
          purpose: "download",
        },
        deps.signingSecret,
      );
      if (!check.ok) {
        log({
          severity: "warn",
          requestId: request.requestId,
          correlationId: request.correlationId,
          actorBenutzerId: request.user!.id,
          actorRole: request.user!.rolle,
          operation: "GET /documents/:id/content",
          errorCode: `SIGNATURE_${check.reason?.toUpperCase()}`,
          message: "Signierter Dokumentabruf abgewiesen",
        });
        return reply.code(statusForSignatureFailure(check.reason!)).send({
          error: check.reason === "expired" ? "signature_expired" : "signature_invalid",
          hinweis:
            check.reason === "expired"
              ? "Der Zugriffslink ist abgelaufen. Bitte die Dokumentliste neu laden."
              : "Der Zugriffslink gehört nicht zu diesem Konto oder ist ungültig.",
        });
      }

      // §12/§18: nichts Ungescanntes ausliefern.
      if (row.dokumentStatus === "quarantined" || row.scanStatus !== "sauber") {
        return reply.code(409).send({
          error: "document_in_quarantine",
          scanStatus: row.scanStatus,
          hinweis:
            "Das Dokument ist noch nicht freigegeben (Virenprüfung ausstehend oder angeschlagen) und wird deshalb nicht ausgeliefert.",
        });
      }

      const content = await deps.storage.get(row.speicherReferenz);
      if (!content) return reply.code(404).send({ error: "content_missing" });

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "document.accessed",
          aktion: "documents.content.read",
          entitaet: "dokument",
          entitaetId: row.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:documents.content",
          correlationId: request.correlationId,
          // KEIN Inhalt, kein Dateiname – nur Metadaten (§16).
          payload: { typ: row.typ, groesseBytes: row.groesseBytes, eigenes: istEigenes },
        }),
      );

      reply.header("content-type", row.erkannterMimeTyp ?? "application/octet-stream");
      reply.header("content-disposition", `attachment; filename="dokument-${row.id}"`);
      reply.header("x-content-checksum-sha256", row.checksumSha256 ?? "");
      return reply.send(content);
    },
  );

  /**
   * Re-Upload nach Ablehnung: legt einen NEUEN Dokument-Datensatz an und
   * verkettet ihn mit dem alten (`ersetztVonDokumentId`), damit die
   * Audit-Historie erhalten bleibt statt den abgelehnten Datensatz zu
   * überschreiben. §12 gilt hier identisch (Magic Bytes + Quarantäne).
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
      const buffer = await file.toBuffer();
      const validation = validateUpload({ buffer, declaredMime: file.mimetype });
      if (!validation.ok) {
        recordDocumentScanFailure(
          validation.error === "type_mismatch" || validation.error === "detected_type_not_allowed"
            ? "mime_mismatch"
            : validation.error === "too_large"
              ? "too_large"
              : "unsupported_type",
        );
        return reply.code(statusForValidationError(validation.error!)).send({
          error:
            validation.error === "too_large"
              ? "file_too_large"
              : validation.error === "type_mismatch"
                ? "mime_type_mismatch"
                : "unsupported_media_type",
          reason: validation.error,
          detectedMime: validation.detectedMime,
        });
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
          entitaetId: replacement.id,
          to: "quarantined",
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          grund: "Re-Upload angenommen – wartet auf Malware-Scan",
        });
        await tx
          .update(dokumente)
          .set({ ersetztVonDokumentId: replacement.id })
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
          correlationId: request.correlationId,
          vorher: { id: original.id, status: original.status },
          nachher: { id: result.id },
        }),
      );

      const release = await releaseDocumentAfterScan(db, {
        dokumentId: result.id,
        buffer,
        dateiname: file.filename,
        malwareScan: deps.malwareScan,
        akteurBenutzerId: request.user!.id,
        standortId: request.user!.standortId,
        correlationId: request.correlationId,
        resilience: deps.resilience,
      });
      const [final] = await db.select().from(dokumente).where(eq(dokumente.id, result.id)).limit(1);

      return reply.code(201).send({
        document: final,
        scan: { status: release.scanStatus, freigegeben: release.freigegeben, hinweis: release.grund },
      });
    },
  );

  /**
   * Prüfung/Ablehnung durch das Büro (`documents:verify`).
   *
   * §4 (Phase 3): die Version ist jetzt PFLICHT. Voraussetzung dafür war, dass
   * die lesenden Endpunkte sie mitliefern – `GET /documents/mine` und
   * `GET /office/heute` tun das seit Phase 3 (`etag` je Zeile).
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
      const expected = requireExpectedVersion(readExpectedVersion(request), reply);
      if (expected === null) return reply;

      try {
        const updated = await db.transaction(async (tx) => {
          const [doc] = await tx.select().from(dokumente).where(eq(dokumente.id, params.id)).limit(1);
          if (!doc) return null;
          // Mandanten-/Standorttrennung serverseitig: das Büro prüft nur
          // Dokumente des eigenen Standorts.
          if (doc.standortId !== null && doc.standortId !== request.user!.standortId) {
            throw new ForeignStandortError();
          }
          assertVersion(doc, expected);

          // §12: ein Dokument in Quarantäne darf NICHT freigegeben werden.
          // Die DB verbietet es zusätzlich (CHECK aus Migration 0009), diese
          // Prüfung liefert nur die bessere Fehlermeldung.
          if (accepted && (doc.dokumentStatus === "quarantined" || doc.scanStatus !== "sauber")) {
            throw new QuarantinedDocumentError();
          }

          // §10: die Prüfung führt über `in_review` zum Ergebnis.
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
        if (err instanceof ForeignStandortError) {
          return reply.code(404).send({ error: "document_not_found" });
        }
        if (err instanceof QuarantinedDocumentError) {
          return reply.code(409).send({
            error: "document_in_quarantine",
            hinweis:
              "Ein Dokument in Quarantäne kann nicht freigegeben werden. Die Virenprüfung muss zuerst sauber durchlaufen.",
          });
        }
        if (err instanceof VersionConflictError) {
          return sendVersionConflict(err, reply, parsed.data as Record<string, unknown>);
        }
        if (sendBusinessConstraintError(err, reply)) return reply;
        throw err;
      }
    },
  );

  /**
   * §12: Dokumentliste für das Büro, mit Version je Zeile (§4-Voraussetzung)
   * und serverseitiger Standortfilterung.
   */
  app.get(
    "/documents",
    { preHandler: [requireAuth, requirePermission("documents:read:any")] },
    async (request, reply) => {
      const query = request.query as { status?: string; schuelerId?: string };
      const conditions = [];
      if (request.user!.standortId) {
        conditions.push(eq(dokumente.standortId, request.user!.standortId));
      }
      if (query.status) conditions.push(eq(dokumente.dokumentStatus, query.status));
      if (query.schuelerId) conditions.push(eq(dokumente.schuelerId, query.schuelerId));

      const rows = await db
        .select()
        .from(dokumente)
        .innerJoin(schueler, eq(dokumente.schuelerId, schueler.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(200);

      return reply.send({
        documents: rows.map((r) => ({
          ...r.dokumente,
          etag: etagFor(r.dokumente),
          schueler: { id: r.schueler.id, vorname: r.schueler.vorname, nachname: r.schueler.nachname },
        })),
      });
    },
  );
}

class ForeignStandortError extends Error {}
class QuarantinedDocumentError extends Error {}
