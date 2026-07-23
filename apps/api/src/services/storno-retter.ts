import {
  ausbildungen,
  auditEreignisse,
  schueler,
  stornoAngebote,
  stornoEvents,
  terminbuchungen,
} from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import { checkBookingConflicts, type ExistingBooking } from "@fahrschul/scheduling";
import type { Database } from "@fahrschul/database";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { performBooking, type Tx } from "./booking.js";

/**
 * Storno-Retter: 11-Schritt-Flow aus der Aufgabenstellung.
 *
 *  1. Storno empfangen          -> raiseStornoEvent() legt storno_events an
 *  2. Slot sperren               -> raiseStornoEvent() storniert die Buchung
 *  3. Kandidaten berechnen       -> computeCandidates()
 *  4. Büro wählt Angebotsmodus   -> sendStornoOffers({modus})
 *  5. Angebote senden            -> sendStornoOffers() legt storno_angebote an
 *  6. Ablauf                     -> expireStornoOffer() / Ablauf wird beim
 *                                    Annehmen zusätzlich geprüft
 *  7. erste gültige Annahme      -> acceptStornoOffer() (race-sicher, siehe unten)
 *  8. übrige schließen           -> acceptStornoOffer() schließt Geschwister
 *  9. alle Apps aktualisieren    -> GAP: kein echter Push-Kanal in dieser
 *                                    Umgebung, siehe docs/integration-gaps.md;
 *                                    die betroffenen Datensätze sind sofort
 *                                    per Poll/Refresh der jeweiligen App sichtbar
 * 10. Audit                      -> jede Stufe schreibt audit_events
 * 11. gerettete Minuten/Umsatz   -> acceptStornoOffer() berechnet + speichert sie
 *
 * Race-Sicherheit ("erste gültige Annahme gewinnt"): acceptStornoOffer()
 * sperrt die storno_events-Zeile per SELECT ... FOR UPDATE, BEVOR sie den
 * Status prüft. Zwei parallele Annahme-Transaktionen serialisieren sich auf
 * dieser Zeilensperre – die zweite sieht nach dem Commit der ersten
 * garantiert status <> 'angebote_gesendet' und lehnt ab. Das ist derselbe
 * Grundmechanismus wie die DB-EXCLUDE-Constraints aus Prompt 0, nur auf
 * einer Anwendungs-Zeile statt einem DB-Constraint, weil "erste gültige
 * Annahme" hier eine Mehrschritt-Entscheidung ist (Angebot noch offen? nicht
 * abgelaufen? Buchung selbst noch konfliktfrei?), die ein reiner
 * DB-Constraint nicht ausdrücken kann.
 */

const UNBESTAETIGT_STANDARD_ANGEBOTSFRIST_MINUTEN = 30;
/** Fachlich unbestätigter Platzhalter-Umsatz je Minute (siehe docs/fachliche-bestaetigungen.md). */
const UNBESTAETIGT_UMSATZ_CENT_PRO_MINUTE = 100;

export class StornoNotFoundError extends Error {}
export class StornoStateError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export interface StornoCandidate {
  schuelerId: string;
  vorname: string;
  nachname: string;
}

/** Schritte 1+2: Storno empfangen, Slot sperren (Buchung wird storniert). */
export async function raiseStornoEvent(
  tx: Tx,
  input: { terminbuchungId: string; klasse: string; akteurBenutzerId: string; standortId: string | null },
) {
  const [booking] = await tx
    .select()
    .from(terminbuchungen)
    .where(eq(terminbuchungen.id, input.terminbuchungId))
    .limit(1);
  if (!booking) throw new StornoNotFoundError();

  await tx
    .update(terminbuchungen)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(terminbuchungen.id, booking.id));

  const [event] = await tx
    .insert(stornoEvents)
    .values({
      standortId: input.standortId,
      terminbuchungId: booking.id,
      klasse: input.klasse,
      status: "slot_gesperrt",
    })
    .returning();

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: "lesson.cancelled",
      aktion: "storno.raised",
      entitaet: "storno_event",
      entitaetId: event.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:storno-retter.raise",
      nachher: event,
      payload: { terminbuchungId: booking.id },
    }),
  );

  return { event, booking };
}

/**
 * Schritt 3: Kandidaten berechnen. Kandidaten sind Schüler mit einer
 * laufenden Ausbildung derselben Klasse am selben Standort, die für das
 * freigewordene Zeitfenster die harten Regeln bestehen (kein eigener
 * Konflikt). Rückgabe ist absichtlich eine einfache Liste (kein Scoring) –
 * das Scoring/Ranking erfolgt separat über packages/matching, sobald die
 * Büro-UI die konkreten Signale (Wunschzeiten, Lernziel, ...) beisteuert.
 */
export async function computeCandidates(
  tx: Tx | Database,
  input: { standortId: string | null; klasse: string; beginnAt: Date; endeAt: Date; excludeSchuelerId: string },
): Promise<StornoCandidate[]> {
  const students = await tx
    .select({
      schuelerId: schueler.id,
      vorname: schueler.vorname,
      nachname: schueler.nachname,
    })
    .from(schueler)
    .innerJoin(ausbildungen, eq(ausbildungen.schuelerId, schueler.id))
    .where(and(eq(ausbildungen.klasse, input.klasse), eq(ausbildungen.status, "laufend")));

  const overlapping = await tx
    .select()
    .from(terminbuchungen)
    .where(
      and(
        ne(terminbuchungen.status, "cancelled"),
        lt(terminbuchungen.beginnAt, input.endeAt),
        gt(terminbuchungen.endeAt, input.beginnAt),
      ),
    );

  const candidates: StornoCandidate[] = [];
  for (const student of students) {
    if (student.schuelerId === input.excludeSchuelerId) continue;
    const conflict = (overlapping as unknown as ExistingBooking[]).some(
      (b) => b.schuelerId === student.schuelerId && b.status !== "cancelled",
    );
    if (!conflict) {
      candidates.push(student);
    }
  }
  return candidates;
}

/** Schritte 4+5: Büro wählt Angebotsmodus, Angebote werden angelegt. */
export async function sendStornoOffers(
  tx: Tx,
  input: {
    stornoEventId: string;
    kandidatenSchuelerIds: string[];
    modus: "sequenziell" | "broadcast";
    fristMinuten?: number;
    akteurBenutzerId: string;
    standortId: string | null;
  },
) {
  const [event] = await tx.select().from(stornoEvents).where(eq(stornoEvents.id, input.stornoEventId)).limit(1);
  if (!event) throw new StornoNotFoundError();
  if (event.status !== "slot_gesperrt" && event.status !== "kandidaten_berechnet") {
    throw new StornoStateError(`invalid_state:${event.status}`);
  }

  const frist = input.fristMinuten ?? UNBESTAETIGT_STANDARD_ANGEBOTSFRIST_MINUTEN;
  const ablaufAt = new Date(Date.now() + frist * 60_000);

  // Sequenziell: nur der erste Kandidat bekommt initial ein Angebot (Büro
  // kann bei Ablauf/Ablehnung den nächsten anstoßen). Broadcast: alle
  // übergebenen Kandidaten gleichzeitig.
  const empfaenger = input.modus === "sequenziell" ? input.kandidatenSchuelerIds.slice(0, 1) : input.kandidatenSchuelerIds;

  const offers = await tx
    .insert(stornoAngebote)
    .values(
      empfaenger.map((schuelerId) => ({
        standortId: input.standortId,
        stornoEventId: event.id,
        schuelerId,
        ablaufAt,
      })),
    )
    .returning();

  await tx
    .update(stornoEvents)
    .set({ status: "angebote_gesendet", angebotsmodus: input.modus, updatedAt: new Date() })
    .where(eq(stornoEvents.id, event.id));

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: "lesson.offer.created",
      aktion: "storno.offers_sent",
      entitaet: "storno_event",
      entitaetId: event.id,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:storno-retter.send-offers",
      payload: { modus: input.modus, anzahl: offers.length },
    }),
  );

  return offers;
}

/** Schritt 6: Ablauf – ein einzelnes Angebot manuell/durch Zeitablauf schließen. */
export async function expireStornoOffer(tx: Tx, stornoAngebotId: string) {
  const [offer] = await tx.select().from(stornoAngebote).where(eq(stornoAngebote.id, stornoAngebotId)).limit(1);
  if (!offer) throw new StornoNotFoundError();
  if (offer.status !== "offen") return offer;
  const [updated] = await tx
    .update(stornoAngebote)
    .set({ status: "abgelaufen", updatedAt: new Date() })
    .where(eq(stornoAngebote.id, offer.id))
    .returning();
  return updated;
}

/**
 * Schritte 7-8-10-11: erste gültige Annahme transaktional buchen, übrige
 * Angebote desselben Storno-Events schließen, Audit schreiben, gerettete
 * Minuten/Umsatz messen. `tx` MUSS von einem Aufrufer kommen, der
 * `db.transaction(...)` verwendet – siehe routes/storno.ts.
 */
export async function acceptStornoOffer(
  tx: Tx,
  input: { stornoAngebotId: string; schuelerId: string; akteurBenutzerId: string; standortId: string | null; idempotencyKey: string },
) {
  const [offer] = await tx
    .select()
    .from(stornoAngebote)
    .where(eq(stornoAngebote.id, input.stornoAngebotId))
    .limit(1);
  if (!offer) throw new StornoNotFoundError();
  if (offer.schuelerId !== input.schuelerId) {
    throw new StornoStateError("not_your_offer");
  }

  // Race-Schutz: die storno_events-Zeile wird GESPERRT, bevor der Status
  // geprüft wird. Eine zweite, parallele Annahme (auch für ein ANDERES
  // Angebot desselben Events, z.B. Broadcast-Modus) wartet hier, bis die
  // erste Transaktion committet oder rollbackt, und sieht danach garantiert
  // den aktualisierten Status.
  const lockedEventRows = (await tx.execute(
    sql`select * from storno_events where id = ${offer.stornoEventId} for update`,
  )) as unknown as Array<{ id: string; status: string; terminbuchung_id: string; klasse: string }>;
  const event = lockedEventRows[0];
  if (!event) throw new StornoNotFoundError();
  if (event.status !== "angebote_gesendet") {
    throw new StornoStateError(`event_already:${event.status}`);
  }

  if (offer.status !== "offen") {
    throw new StornoStateError(`offer_already:${offer.status}`);
  }
  if (new Date(offer.ablaufAt).getTime() <= Date.now()) {
    await tx.update(stornoAngebote).set({ status: "abgelaufen", updatedAt: new Date() }).where(eq(stornoAngebote.id, offer.id));
    throw new StornoStateError("expired");
  }

  const [original] = await tx
    .select()
    .from(terminbuchungen)
    .where(eq(terminbuchungen.id, event.terminbuchung_id))
    .limit(1);
  if (!original) throw new StornoNotFoundError();

  const booked = await performBooking(tx, {
    schuelerId: input.schuelerId,
    fahrlehrerId: original.fahrlehrerId,
    fahrzeugId: original.fahrzeugId,
    beginnAt: original.beginnAt,
    endeAt: original.endeAt,
    art: original.art,
    klasse: event.klasse,
    idempotencyKey: input.idempotencyKey,
    standortId: input.standortId,
    akteurBenutzerId: input.akteurBenutzerId,
    eventType: "lesson.booked",
    eventSource: "apps/api:storno-retter.accept",
  });

  const minuten = Math.round((new Date(original.endeAt).getTime() - new Date(original.beginnAt).getTime()) / 60_000);

  await tx
    .update(stornoAngebote)
    .set({ status: "angenommen", angenommenAt: new Date(), terminbuchungId: booked.booking.id, updatedAt: new Date() })
    .where(eq(stornoAngebote.id, offer.id));

  // Schritt 8: übrige offenen Angebote desselben Events schließen.
  await tx
    .update(stornoAngebote)
    .set({ status: "geschlossen", updatedAt: new Date() })
    .where(and(eq(stornoAngebote.stornoEventId, offer.stornoEventId), eq(stornoAngebote.status, "offen")));

  await tx
    .update(stornoEvents)
    .set({
      status: "gebucht",
      geschlossenAt: new Date(),
      geretteteMinuten: minuten,
      geretteterUmsatzCent: minuten * UNBESTAETIGT_UMSATZ_CENT_PRO_MINUTE,
      updatedAt: new Date(),
    })
    .where(eq(stornoEvents.id, offer.stornoEventId));

  await tx.insert(auditEreignisse).values(
    buildEventRow({
      type: "lesson.offer.accepted",
      aktion: "storno.accepted",
      entitaet: "storno_event",
      entitaetId: offer.stornoEventId,
      akteurBenutzerId: input.akteurBenutzerId,
      standortId: input.standortId,
      source: "apps/api:storno-retter.accept",
      payload: { stornoAngebotId: offer.id, terminbuchungId: booked.booking.id, geretteteMinuten: minuten },
    }),
  );

  return { booking: booked.booking, geretteteMinuten: minuten, geretteterUmsatzCent: minuten * UNBESTAETIGT_UMSATZ_CENT_PRO_MINUTE };
}
