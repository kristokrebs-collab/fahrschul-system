import { auditEreignisse, dokumente } from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { MalwareScanAdapter } from "@fahrschul/integrations";
import { eq } from "drizzle-orm";
import { transitionState } from "../lib/state-machine.js";
import { recordDocumentScanFailure } from "../lib/metrics.js";
import { log } from "../lib/observability.js";
import { emitAlarm } from "../workers/alarm.js";
import { guardFor, type IntegrationServiceOptions } from "./integrations.js";

/**
 * PROMPT -1 §12 / §18-Szenario 5 – die Freigabe eines Dokuments.
 *
 * ## Die eine Regel
 *
 * **Ein Dokument wird NIEMALS als geprüft angezeigt, solange der Scan nicht
 * sauber durchgelaufen ist.** Diese Datei ist der einzige Weg von
 * `quarantined` nach `submitted`, und sie hat drei Ausgänge – keinen vierten:
 *
 * | Scan | Zustand danach | Sichtbarkeit für den Schüler |
 * | --- | --- | --- |
 * | sauber | `submitted` | "beim Büro in Prüfung" |
 * | verdächtig | `quarantined` (bleibt) | "abgelehnt – bitte neue Datei" |
 * | Scanner ausgefallen | `quarantined` (bleibt) | "Prüfung dauert länger" |
 *
 * Der dritte Fall ist §18-Szenario 5. Er ist der gefährliche: ein
 * ausgefallener Scanner darf NICHT zu "durchgelassen" führen (fail open wäre
 * hier eine Sicherheitslücke) und auch nicht zu "abgelehnt" (das wäre eine
 * falsche Aussage über die Datei des Schülers). Er führt zu "bleibt liegen,
 * wird erneut versucht" – und das ist auch die einzige ehrliche Aussage.
 *
 * Zusätzlich abgesichert auf DB-Ebene: Migration 0009 verbietet per CHECK die
 * Kombination `dokument_status = 'verified'` mit `scan_status <> 'sauber'`.
 * Selbst ein fehlerhafter Codepfad kann ein ungescanntes Dokument nicht als
 * geprüft speichern.
 */

export interface ReleaseInput {
  dokumentId: string;
  buffer: Buffer;
  dateiname: string;
  malwareScan: MalwareScanAdapter;
  akteurBenutzerId: string | null;
  standortId: string | null;
  correlationId?: string;
  /** §11: der Scanner läuft unter Breaker/Zeitlimit, wenn die Optionen da sind. */
  resilience?: IntegrationServiceOptions;
}

export interface ReleaseResult {
  freigegeben: boolean;
  scanStatus: "sauber" | "verdaechtig" | "ausstehend";
  status: string;
  scannerName: string | null;
  grund: string;
  /** true, wenn der Scanner selbst nicht erreichbar war (§18-Szenario 5). */
  scannerAusgefallen: boolean;
}

export async function releaseDocumentAfterScan(
  db: Database,
  input: ReleaseInput,
): Promise<ReleaseResult> {
  // §11: Zeitlimit + Breaker um den Scanner. Ohne `resilience` (z. B. in
  // einfachen Tests) wird direkt aufgerufen – der Vertrag bleibt derselbe.
  let scanStatus: "sauber" | "verdaechtig" | null = null;
  let scannerName: string | null = null;
  let scanError: string | null = null;

  if (input.resilience) {
    const guard = guardFor("malware-scan", input.resilience);
    const call = await guard.call(() => input.malwareScan.scan(input.buffer, input.dateiname), {
      operation: "scan",
      // Der Idempotenzschlüssel des ausgehenden Aufrufs ist die Dokument-ID:
      // ein Wiederholversuch scannt dieselbe Datei, nicht eine zweite.
      idempotencyKey: `dokument:${input.dokumentId}`,
    });
    if (call.ok && call.value) {
      scanStatus = call.value.status;
      scannerName = call.value.scannerName;
    } else {
      scanError = call.error ?? "Scanner nicht erreichbar";
    }
  } else {
    try {
      const result = await input.malwareScan.scan(input.buffer, input.dateiname);
      scanStatus = result.status;
      scannerName = result.scannerName;
    } catch (err) {
      scanError = (err as Error).message;
    }
  }

  // --- Fall 3: Scanner ausgefallen -------------------------------------
  if (scanStatus === null) {
    recordDocumentScanFailure("scanner_unavailable");
    await db
      .update(dokumente)
      .set({
        scanStatus: "ausstehend",
        quarantaeneGrund: "Malware-Scanner nicht erreichbar – Prüfung wird wiederholt",
      })
      .where(eq(dokumente.id, input.dokumentId));
    await emitAlarm({
      kind: "document_scan_unavailable",
      source: "documents",
      sourceId: input.dokumentId,
      subject: "Malware-Scanner nicht erreichbar – Dokument bleibt in Quarantäne",
      message: scanError ?? undefined,
      correlationId: input.correlationId,
    });
    log({
      severity: "warn",
      requestId: `doc-${input.dokumentId}`,
      correlationId: input.correlationId ?? input.dokumentId,
      actorBenutzerId: input.akteurBenutzerId,
      operation: "documents.scan",
      errorCode: "SCANNER_UNAVAILABLE",
      message: "Dokument bleibt in Quarantäne",
      details: { dokumentId: input.dokumentId },
    });
    return {
      freigegeben: false,
      scanStatus: "ausstehend",
      status: "quarantined",
      scannerName: null,
      scannerAusgefallen: true,
      grund:
        "Die Virenprüfung ist derzeit nicht erreichbar. Das Dokument ist gespeichert, bleibt aber in Quarantäne und wird automatisch erneut geprüft. Es gilt NICHT als geprüft.",
    };
  }

  // --- Fall 2: Scan schlägt an ----------------------------------------
  if (scanStatus === "verdaechtig") {
    recordDocumentScanFailure("malware_flagged");
    await db.transaction(async (tx) => {
      await tx
        .update(dokumente)
        .set({ scanStatus: "verdaechtig", quarantaeneGrund: "Malware-Scan hat angeschlagen" })
        .where(eq(dokumente.id, input.dokumentId));
      await tx.insert(auditEreignisse).values(
        buildEventRow({
          type: "document.quarantined",
          aktion: "documents.scan.flagged",
          entitaet: "dokument",
          entitaetId: input.dokumentId,
          akteurBenutzerId: input.akteurBenutzerId,
          standortId: input.standortId,
          source: "apps/api:documents.scan",
          correlationId: input.correlationId,
          payload: { scanner: scannerName },
        }),
      );
    });
    return {
      freigegeben: false,
      scanStatus: "verdaechtig",
      status: "quarantined",
      scannerName,
      scannerAusgefallen: false,
      grund:
        "Die Virenprüfung hat bei dieser Datei angeschlagen. Sie wird nicht verarbeitet. Bitte eine andere Datei hochladen.",
    };
  }

  // --- Fall 1: sauber -> freigeben ------------------------------------
  const row = await db.transaction(async (tx) => {
    await tx
      .update(dokumente)
      .set({ scanStatus: "sauber", quarantaeneGrund: null, freigegebenAt: new Date() })
      .where(eq(dokumente.id, input.dokumentId));

    // quarantined -> scanning -> submitted. Die Zwischenstufe ist persistiert,
    // damit ein abgebrochener Lauf im §19-Bericht auftaucht.
    await transitionState(tx, {
      machine: "dokument",
      entitaetId: input.dokumentId,
      to: "scanning",
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      grund: "Malware-Scan gestartet",
    });
    const submitted = await transitionState(tx, {
      machine: "dokument",
      entitaetId: input.dokumentId,
      to: "submitted",
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      grund: "Scan sauber – zur Prüfung eingereicht",
      eventType: "document.submitted",
      aktion: "documents.release",
      source: "apps/api:documents.release",
      payload: { scanner: scannerName },
    });
    return submitted.row as { dokumentStatus?: string } | null;
  });

  return {
    freigegeben: true,
    scanStatus: "sauber",
    status: row?.dokumentStatus ?? "submitted",
    scannerName,
    scannerAusgefallen: false,
    grund: "Scan sauber – das Dokument liegt jetzt beim Büro zur Prüfung.",
  };
}

/**
 * §18-Szenario 5, Wiederaufnahme: erneuter Scanversuch für alles, was wegen
 * eines ausgefallenen Scanners in Quarantäne liegt. Wird vom Job
 * `documents.review` mitgetrieben.
 */
export async function retryQuarantinedScans(
  db: Database,
  input: {
    malwareScan: MalwareScanAdapter;
    storageGet: (reference: string) => Promise<Buffer | null>;
    limit?: number;
    resilience?: IntegrationServiceOptions;
  },
): Promise<{ geprueft: number; freigegeben: number; weiterhinQuarantaene: number }> {
  const rows = await db
    .select({
      id: dokumente.id,
      standortId: dokumente.standortId,
      dateiname: dokumente.dateiname,
      speicherReferenz: dokumente.speicherReferenz,
    })
    .from(dokumente)
    .where(eq(dokumente.dokumentStatus, "quarantined"))
    .limit(input.limit ?? 50);

  let freigegeben = 0;
  let weiterhinQuarantaene = 0;
  for (const doc of rows) {
    const buffer = await input.storageGet(doc.speicherReferenz);
    if (!buffer) {
      weiterhinQuarantaene += 1;
      continue;
    }
    const result = await releaseDocumentAfterScan(db, {
      dokumentId: doc.id,
      buffer,
      dateiname: doc.dateiname,
      malwareScan: input.malwareScan,
      akteurBenutzerId: null,
      standortId: doc.standortId,
      resilience: input.resilience,
    });
    if (result.freigegeben) freigegeben += 1;
    else weiterhinQuarantaene += 1;
  }
  return { geprueft: rows.length, freigegeben, weiterhinQuarantaene };
}
