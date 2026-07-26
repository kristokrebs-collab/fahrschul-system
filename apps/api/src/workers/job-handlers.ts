import {
  auditEreignisse,
  banktransaktionen,
  dokumente,
  eventOutbox,
  flexAngebote,
  nachrichten,
  rechnungen,
  stornoAngebote,
  terminangebote,
  terminbuchungen,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { NotificationsAdapter } from "@fahrschul/integrations";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { purgeExpiredIdempotencyKeys } from "../lib/idempotency.js";
import { transitionState } from "../lib/state-machine.js";
import { runConsistencyCheck } from "../services/consistency-check.js";
import { JOB_TYPES } from "./job-store.js";
import { runOutboxOnce, type EventConsumer } from "./outbox.js";

/**
 * PROMPT -1 §13 – Handler für die verpflichtend abzudeckenden Job-Arten:
 * Benachrichtigungen, Bankimport, Dokumentprüfung, Reporting,
 * Integrationssync, Erinnerungen und Ablauf von Terminangeboten.
 *
 * ALLE Handler sind idempotent: ein Wiederholungslauf nach einem Absturz
 * erzeugt denselben Endzustand. Erreicht wird das über
 *   a) Zustandsfilter in der Abfrage ("nur was noch offen ist"),
 *   b) die State-Machine-Allow-Lists (ein zweiter Übergang in denselben
 *      Zustand ist ein No-Op statt eines Fehlers),
 *   c) die Consumer-Inbox für ereignisgetriebene Arbeit.
 */

export interface JobContext {
  db: Database;
  notifications: NotificationsAdapter;
  consumers: readonly EventConsumer[];
  heartbeat: () => Promise<void>;
}

export type JobHandler = (
  payload: Record<string, unknown>,
  ctx: JobContext,
) => Promise<Record<string, unknown>>;

/**
 * Ablauf von Terminangeboten. VORHER war das KEIN Job: `GET /appointment-offers`
 * filterte abgelaufene Angebote nur beim Lesen aus, und `flex_angebote`/
 * `storno_angebote` behielten ihren Status 'offen' für immer. Damit war der
 * Ablauf nicht nachvollziehbar, nicht auditiert und nach einem Neustart nicht
 * wiederaufnehmbar. Jetzt ist er ein echter, persistierter Übergang.
 */
export const expireAppointmentOffers: JobHandler = async (_payload, { db }) => {
  const now = new Date();
  const faellig = await db
    .select({ id: terminangebote.id, status: terminangebote.angebotStatus, standortId: terminangebote.standortId })
    .from(terminangebote)
    .where(
      and(
        inArray(terminangebote.angebotStatus, ["created", "sent", "delivered", "rejected"]),
        lte(terminangebote.ablaufAt, now),
      ),
    );

  let expired = 0;
  for (const offer of faellig) {
    await db.transaction(async (tx) => {
      const res = await transitionState(tx, {
        machine: "terminangebot",
        entitaetId: offer.id,
        to: "expired",
        standortId: offer.standortId,
        grund: "Ablaufzeitpunkt erreicht",
        eventType: "lesson.offer.expired",
        aktion: "appointment-offer.expire",
        source: `apps/api:job.${JOB_TYPES.offerExpiry}`,
      });
      if (res.changed) expired += 1;
    });
  }

  // Flex-/Storno-Angebote nutzen eigene, ältere Statusmengen (Prompt 1/2) und
  // werden hier über ihre Alt-Spalte abgelaufen – bewusst KEINE fünfte State
  // Machine, §10 nennt genau vier.
  const flexExpired = await db
    .update(flexAngebote)
    .set({ status: "abgelaufen", updatedAt: now })
    .where(and(eq(flexAngebote.status, "offen"), lte(flexAngebote.ablaufAt, now)))
    .returning({ id: flexAngebote.id });

  const stornoExpired = await db
    .update(stornoAngebote)
    .set({ status: "abgelaufen", updatedAt: now })
    .where(and(eq(stornoAngebote.status, "offen"), lte(stornoAngebote.ablaufAt, now)))
    .returning({ id: stornoAngebote.id });

  return {
    terminangeboteAbgelaufen: expired,
    flexAngeboteAbgelaufen: flexExpired.length,
    stornoAngeboteAbgelaufen: stornoExpired.length,
  };
};

/**
 * Benachrichtigungen: verschickt Nachrichten, die im Status 'warteschlange'
 * liegen. Idempotent, weil nur 'warteschlange' selektiert wird und der Status
 * im selben Schritt fortgeschrieben wird.
 */
export const dispatchNotifications: JobHandler = async (payload, { db, notifications, heartbeat }) => {
  const limit = typeof payload.limit === "number" ? payload.limit : 50;
  const queued = await db
    .select()
    .from(nachrichten)
    .where(eq(nachrichten.status, "warteschlange"))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  for (const message of queued) {
    await heartbeat();
    try {
      const result = await notifications.send({
        to: message.schuelerId ?? message.leadId ?? "unbekannt",
        channel: message.kanal === "sms" ? "push" : (message.kanal as "email" | "push"),
        subject: message.betreff ?? message.kanal,
        body: message.inhalt,
      });
      await db
        .update(nachrichten)
        .set({
          status: result.delivered ? "gesendet" : "fehlgeschlagen",
          gesendetAt: new Date(),
          fehlergrund: result.delivered ? null : "Adapter meldete delivered=false",
        })
        .where(eq(nachrichten.id, message.id));
      if (result.delivered) sent += 1;
      else failed += 1;
    } catch (err) {
      await db
        .update(nachrichten)
        .set({ status: "fehlgeschlagen", fehlergrund: (err as Error).message })
        .where(eq(nachrichten.id, message.id));
      failed += 1;
    }
  }
  return { verarbeitet: queued.length, gesendet: sent, fehlgeschlagen: failed };
};

/**
 * Bankimport: schaltet importierte Banktransaktionen durch die
 * Zahlungs-State-Machine. Non-Negotiable: NUR `konfidenz = 'sicher'` darf
 * automatisch nach 'matched'; alles andere landet in 'suggested' bzw.
 * 'review_required' und wartet auf einen Menschen der Rolle "finanzen".
 */
export const runBankImport: JobHandler = async (_payload, { db, heartbeat }) => {
  const frisch = await db
    .select()
    .from(banktransaktionen)
    .where(eq(banktransaktionen.zahlungStatus, "imported"))
    .limit(200);

  let matched = 0;
  let suggested = 0;
  let review = 0;
  for (const tx of frisch) {
    await heartbeat();
    await db.transaction(async (t) => {
      await transitionState(t, {
        machine: "zahlung",
        entitaetId: tx.id,
        to: "matching",
        standortId: tx.standortId,
        grund: "Bankimport gestartet",
      });

      const rechnungIds = (tx.rechnungIds as string[] | null) ?? [];
      if (tx.konfidenz === "sicher" && tx.autoGebucht && rechnungIds.length === 1) {
        await transitionState(t, {
          machine: "zahlung",
          entitaetId: tx.id,
          to: "matched",
          standortId: tx.standortId,
          grund: "Konfidenz 'sicher' – automatische Buchung erlaubt",
          eventType: "payment.matched",
          aktion: "bank.import.auto_match",
          source: `apps/api:job.${JOB_TYPES.bankImport}`,
        });
        matched += 1;
      } else if (tx.konfidenz === "wahrscheinlich") {
        await transitionState(t, {
          machine: "zahlung",
          entitaetId: tx.id,
          to: "suggested",
          standortId: tx.standortId,
          grund: "Konfidenz 'wahrscheinlich' – Vorschlag, keine Automatik",
        });
        suggested += 1;
      } else {
        await transitionState(t, {
          machine: "zahlung",
          entitaetId: tx.id,
          to: "review_required",
          standortId: tx.standortId,
          grund: `Konfidenz '${tx.konfidenz}' – manuelle Prüfung erforderlich`,
        });
        review += 1;
      }
    });
  }
  return { verarbeitet: frisch.length, automatischGebucht: matched, vorgeschlagen: suggested, zurPruefung: review };
};

/**
 * Dokumentprüfung (Vorstufe): frisch hochgeladene Dokumente durch den
 * Scan-Zustand in 'submitted' bringen bzw. abgelaufene Dokumente auf
 * 'expired' setzen. Die inhaltliche Prüfung bleibt beim Büro (kein
 * automatisches "verified" – siehe §3-Invariante FS006, die ein
 * Prüfprotokoll verlangt).
 */
export const runDocumentReview: JobHandler = async (_payload, { db }) => {
  const heute = new Date().toISOString().slice(0, 10);

  const scanning = await db
    .select({ id: dokumente.id, standortId: dokumente.standortId, scanStatus: dokumente.scanStatus })
    .from(dokumente)
    .where(inArray(dokumente.dokumentStatus, ["uploaded", "scanning"]))
    .limit(200);

  let submitted = 0;
  let quarantined = 0;
  for (const doc of scanning) {
    await db.transaction(async (tx) => {
      const current = (
        await tx
          .select({ state: dokumente.dokumentStatus })
          .from(dokumente)
          .where(eq(dokumente.id, doc.id))
          .limit(1)
      )[0];
      if (current?.state === "uploaded") {
        await transitionState(tx, {
          machine: "dokument",
          entitaetId: doc.id,
          to: "scanning",
          standortId: doc.standortId,
          grund: "Malware-Scan gestartet",
        });
      }
      if (doc.scanStatus === "verdaechtig") {
        await transitionState(tx, {
          machine: "dokument",
          entitaetId: doc.id,
          to: "quarantined",
          standortId: doc.standortId,
          grund: "Malware-Scan hat angeschlagen",
          eventType: "document.quarantined",
          aktion: "document.quarantine",
          source: `apps/api:job.${JOB_TYPES.documentReview}`,
        });
        quarantined += 1;
      } else {
        await transitionState(tx, {
          machine: "dokument",
          entitaetId: doc.id,
          to: "submitted",
          standortId: doc.standortId,
          grund: "Scan sauber – zur Prüfung eingereicht",
          eventType: "document.submitted",
          aktion: "document.submit",
          source: `apps/api:job.${JOB_TYPES.documentReview}`,
        });
        submitted += 1;
      }
    });
  }

  const abgelaufen = await db
    .select({ id: dokumente.id, standortId: dokumente.standortId })
    .from(dokumente)
    .where(
      and(
        inArray(dokumente.dokumentStatus, ["submitted", "in_review", "verified"]),
        lte(dokumente.gueltigBis, heute),
      ),
    );
  let expired = 0;
  for (const doc of abgelaufen) {
    await db.transaction(async (tx) => {
      const res = await transitionState(tx, {
        machine: "dokument",
        entitaetId: doc.id,
        to: "expired",
        standortId: doc.standortId,
        grund: "Gültigkeit abgelaufen",
      });
      if (res.changed) expired += 1;
    });
  }

  return { zurPruefungEingereicht: submitted, inQuarantaene: quarantined, abgelaufen: expired };
};

/** Reporting: einfache Tageskennzahlen, als Job-Ergebnis gespeichert. */
export const runReporting: JobHandler = async (_payload, { db }) => {
  const seit = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [buchungen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(terminbuchungen)
    .where(gte(terminbuchungen.createdAt, seit));
  const [abgeschlossen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(terminbuchungen)
    .where(and(eq(terminbuchungen.status, "abgeschlossen"), gte(terminbuchungen.updatedAt, seit)));
  const [offeneRechnungen] = await db
    .select({ n: sql<number>`count(*)`, cent: sql<number>`coalesce(sum(${rechnungen.betragCent}),0)` })
    .from(rechnungen)
    .where(eq(rechnungen.status, "offen"));
  const [unverarbeitet] = await db
    .select({ n: sql<number>`count(*)` })
    .from(eventOutbox)
    .where(inArray(eventOutbox.status, ["pending", "in_flight"]));

  return {
    periodeSeit: seit.toISOString(),
    neueBuchungen: Number(buchungen?.n ?? 0),
    abgeschlosseneStunden: Number(abgeschlossen?.n ?? 0),
    offeneRechnungen: Number(offeneRechnungen?.n ?? 0),
    offeneForderungCent: Number(offeneRechnungen?.cent ?? 0),
    unverarbeiteteEreignisse: Number(unverarbeitet?.n ?? 0),
  };
};

/**
 * Integrationssync: in dieser Umgebung laufen alle externen Systeme im
 * mock-Modus (docs/integration-gaps.md). Der Job existiert trotzdem echt,
 * weil §13 ihn verlangt und er die Zustellung der Outbox an den
 * `integration-sync`-Konsumenten anstößt – die Anbindung an ein echtes
 * Zielsystem ist ein reiner Adaptertausch.
 * SEAM: Phase 3 (§11 Circuit Breaker) legt sich um diesen Aufruf.
 */
export const runIntegrationSync: JobHandler = async (_payload, { db, consumers }) => {
  const result = await runOutboxOnce(
    db,
    consumers.filter((c) => c.name === "integration-sync"),
    { limit: 50 },
  );
  return { ...result, hinweis: "Alle externen Integrationen laufen im mock-Modus (docs/integration-gaps.md)." };
};

/**
 * Erinnerungen: legt Nachrichten in die Warteschlange für Termine der
 * nächsten 24-48 h. Idempotent über `nachrichten`-Duplikatprüfung auf
 * (schuelerId, inhalt) – ein zweiter Lauf erzeugt keine zweite Erinnerung.
 */
export const dispatchReminders: JobHandler = async (_payload, { db }) => {
  const von = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const bis = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const bevorstehend = await db
    .select()
    .from(terminbuchungen)
    .where(
      and(
        eq(terminbuchungen.status, "bestaetigt"),
        gte(terminbuchungen.beginnAt, von),
        lte(terminbuchungen.beginnAt, bis),
      ),
    );

  let erstellt = 0;
  for (const booking of bevorstehend) {
    const inhalt = `Erinnerung: Fahrstunde am ${booking.beginnAt.toISOString()} (Termin ${booking.id}).`;
    const vorhanden = await db
      .select({ id: nachrichten.id })
      .from(nachrichten)
      .where(and(eq(nachrichten.schuelerId, booking.schuelerId), eq(nachrichten.inhalt, inhalt)))
      .limit(1);
    if (vorhanden.length > 0) continue;
    await db.insert(nachrichten).values({
      standortId: booking.standortId,
      schuelerId: booking.schuelerId,
      kanal: "email",
      betreff: "Erinnerung an Ihre Fahrstunde",
      inhalt,
      status: "warteschlange",
    });
    erstellt += 1;
  }
  return { termineGeprueft: bevorstehend.length, erinnerungenEingeplant: erstellt };
};

/** §19: täglicher Konsistenzcheck als Job. */
export const runConsistencyCheckJob: JobHandler = async (payload, { db }) => {
  const run = await runConsistencyCheck(db, {
    ausgeloestDurch: "job",
    akteurBenutzerId: (payload.akteurBenutzerId as string | undefined) ?? null,
  });
  return { runId: run.runId, anzahlBefunde: run.findings.length, zusammenfassung: run.zusammenfassung };
};

/** §2: abgelaufene Idempotenzschlüssel aufräumen. */
export const cleanupIdempotencyKeys: JobHandler = async (_payload, { db }) => {
  const removed = await purgeExpiredIdempotencyKeys(db);
  return { entfernt: removed };
};

/** §5: Outbox-Zustellung als regulärer Job (damit ein Scheduler sie treiben kann). */
export const dispatchOutbox: JobHandler = async (payload, { db, consumers }) => {
  const result = await runOutboxOnce(db, consumers, {
    limit: typeof payload.limit === "number" ? payload.limit : 50,
  });
  return { ...result };
};

export const JOB_HANDLERS: Record<string, JobHandler> = {
  [JOB_TYPES.notifications]: dispatchNotifications,
  [JOB_TYPES.bankImport]: runBankImport,
  [JOB_TYPES.documentReview]: runDocumentReview,
  [JOB_TYPES.reporting]: runReporting,
  [JOB_TYPES.integrationSync]: runIntegrationSync,
  [JOB_TYPES.reminders]: dispatchReminders,
  [JOB_TYPES.offerExpiry]: expireAppointmentOffers,
  [JOB_TYPES.consistencyCheck]: runConsistencyCheckJob,
  [JOB_TYPES.idempotencyCleanup]: cleanupIdempotencyKeys,
  [JOB_TYPES.outboxDispatch]: dispatchOutbox,
};

/**
 * Testhilfe/Seam: ein Handler, der absichtlich einen bestimmten Fehlertyp
 * wirft, damit die Retry-/Dead-Letter-/Lease-Pfade nachweisbar sind, ohne
 * einen echten Fachjob zu sabotieren. Er ist NUR aktiv, wenn
 * `FAHRSCHUL_ENABLE_TEST_JOBS=1` gesetzt ist – die Prüfung erfolgt bewusst
 * zur LAUFZEIT (`resolveJobHandler`), nicht beim Modulimport, damit ein Test
 * die Variable auch nach dem Laden des Moduls noch setzen kann.
 */
export const TEST_JOB_TYPE = "test.controlled_failure";

const TEST_JOB_HANDLERS: Record<string, JobHandler> = {
  [TEST_JOB_TYPE]: async (payload) => {
    const mode = String(payload.mode ?? "transient");
    if (mode === "ok") return { ok: true };
    if (mode === "permanent") {
      throw Object.assign(new Error("dauerhafter Testfehler"), { errorClass: "VALIDATION" as const });
    }
    if (mode === "hang") {
      // Simuliert einen Job, der länger als seine Maximallaufzeit braucht.
      await new Promise((resolve) => setTimeout(resolve, Number(payload.ms ?? 200)));
      return { ok: true };
    }
    throw Object.assign(new Error("transienter Testfehler"), { errorClass: "TIMEOUT" as const });
  },
};

/** Die einzige Stelle, an der ein Job-Typ auf seinen Handler abgebildet wird. */
export function resolveJobHandler(jobType: string): JobHandler | undefined {
  const handler = JOB_HANDLERS[jobType];
  if (handler) return handler;
  if (process.env.FAHRSCHUL_ENABLE_TEST_JOBS === "1") return TEST_JOB_HANDLERS[jobType];
  return undefined;
}

/** Audit-Ereignis für einen Job-Lauf (nur für Läufe mit fachlicher Wirkung). */
export async function auditJobRun(
  db: Database,
  input: { jobId: string; jobType: string; result: Record<string, unknown>; akteurBenutzerId: string | null; standortId: string | null },
): Promise<void> {
  await db.insert(auditEreignisse).values(
    buildEventRow({
      type: `job.${input.jobType}`,
      aktion: "job.run",
      entitaet: "job",
      entitaetId: input.jobId,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:job-runner",
      payload: input.result,
    }),
  );
}
