import { nachrichten, terminangebote } from "@fahrschul/database";
import type { NotificationsAdapter } from "@fahrschul/integrations";
import { eq } from "drizzle-orm";
import { transitionState } from "../lib/state-machine.js";
import type { EventConsumer } from "./outbox.js";

/**
 * PROMPT -1 §5 – Die Konsumenten der Outbox.
 *
 * Jeder Konsument
 *   - deklariert die Ereignistypen, die ihn interessieren,
 *   - deklariert die höchste Ereignisversion, die er versteht
 *     (Rückwärtskompatibilität: ältere Versionen MÜSSEN weiter verarbeitet
 *     werden; eine unbekannt hohe Version wird NICHT stillschweigend
 *     verworfen, sondern führt zu Dead-Letter, damit nichts verloren geht),
 *   - ist idempotent, weil der Worker jede (consumer, event_id)-Kombination
 *     über `event_inbox` genau einmal zulässt.
 */

/**
 * Benachrichtigungen. Legt Nachrichten in die `nachrichten`-Warteschlange
 * (Status 'warteschlange'); der eigentliche Versand ist ein Job (§13), damit
 * ein Ausfall des Providers die Ereigniszustellung nicht blockiert.
 */
export function notificationsConsumer(_adapter: NotificationsAdapter): EventConsumer {
  return {
    name: "notifications",
    maxEventVersion: 1,
    eventTypes: [
      "lesson.booked",
      "lesson.cancelled",
      "lesson.offer.created",
      "lesson.offer.accepted",
      "lesson.offer.expired",
      "document.verified",
      "document.rejected",
      "invoice.issued",
      "payment.matched",
      "exam.clearance.granted",
      "exam.registered",
      "vehicle.blocked",
    ],
    async handle(envelope, { db }) {
      const payload = envelope.payload as { entitaetId?: string; aktion?: string };
      await db.insert(nachrichten).values({
        standortId: envelope.standortId,
        kanal: "email",
        betreff: `Systemereignis: ${envelope.eventType}`,
        inhalt: `Ereignis ${envelope.eventType} (v${envelope.eventVersion}) zu ${
          envelope.aggregateType ?? "unbekannt"
        } ${payload.entitaetId ?? envelope.aggregateId ?? ""}`.trim(),
        status: "warteschlange",
      });
      return { queued: true, eventType: envelope.eventType };
    },
  };
}

/**
 * Projektion: schaltet Folgezustände, die aus einem Ereignis zwingend folgen.
 * Beispiel: nach `lesson.offer.created` gilt das Angebot als zugestellt
 * (`delivered`) – der Zustand steht in der DB, nicht im Speicher, damit der
 * Prozess nach einem Neustart genau dort weiterläuft.
 */
export function projectionConsumer(): EventConsumer {
  return {
    name: "projection",
    maxEventVersion: 1,
    eventTypes: ["lesson.offer.created"],
    async handle(envelope, { db }) {
      const offerId = (envelope.payload as { entitaetId?: string }).entitaetId ?? envelope.aggregateId;
      if (!offerId) return { skipped: "keine Angebots-ID im Ereignis" };
      const [offer] = await db
        .select({ state: terminangebote.angebotStatus })
        .from(terminangebote)
        .where(eq(terminangebote.id, offerId))
        .limit(1);
      if (!offer || offer.state !== "sent") {
        return { skipped: `Angebot nicht im Zustand 'sent' (${offer?.state ?? "fehlt"})` };
      }
      await db.transaction(async (tx) => {
        await transitionState(tx, {
          machine: "terminangebot",
          entitaetId: offerId,
          to: "delivered",
          standortId: envelope.standortId,
          grund: "Zustellung durch Outbox-Worker bestätigt",
        });
      });
      return { delivered: offerId };
    },
  };
}

/**
 * Integrationssync. GAP: alle externen Systeme laufen im mock-Modus
 * (docs/integration-gaps.md), deshalb protokolliert dieser Konsument nur, was
 * er an ein Zielsystem senden WÜRDE. SEAM: Phase 3 (§11) legt einen Circuit
 * Breaker um den echten Adapteraufruf; die Inbox-Dedup bleibt unverändert.
 */
export function integrationSyncConsumer(): EventConsumer {
  return {
    name: "integration-sync",
    maxEventVersion: 1,
    eventTypes: ["*"],
    async handle(envelope) {
      return {
        wouldSync: envelope.eventType,
        eventVersion: envelope.eventVersion,
        mode: "mock",
      };
    },
  };
}

export function buildConsumers(notifications: NotificationsAdapter): EventConsumer[] {
  return [notificationsConsumer(notifications), projectionConsumer(), integrationSyncConsumer()];
}
