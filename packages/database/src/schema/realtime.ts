import { bigint, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { standorte } from "./core.js";
import { eventOutbox } from "./reliability.js";

/**
 * PROMPT -1 / Phase 2 §6 – Echtzeit-Fanout. Rohe DDL in
 * packages/database/migrations/0008_realtime_sync.sql; diese Datei ist die
 * getypte Abbildung für Query-Builder-Zugriffe aus apps/api.
 *
 * WICHTIG: Zeilen entstehen NICHT durch beliebigen Anwendungscode, sondern
 * ausschließlich im Outbox-Konsumenten `realtime-fanout`
 * (apps/api/src/workers/consumers.ts). Damit reitet der Realtime-Kanal auf der
 * bestehenden transaktionalen Outbox und ist kein zweiter, konkurrierender
 * Zustellpfad.
 */

/**
 * Dichter Cursor-Zähler je Empfänger. Getrennte Tabelle (statt `max(seq)+1`),
 * weil `insert … on conflict do update set next_seq = next_seq + 1 returning`
 * die Vergabe atomar und ohne Lücken macht.
 */
export const realtimeAudienceCounters = pgTable("realtime_audience_counters", {
  audienceKey: text("audience_key").primaryKey(),
  nextSeq: bigint("next_seq", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Eine Zeile = "Empfänger X darf wissen, dass Ereignis E passiert ist".
 * Trägt bewusst KEINE Nutzlast: nur `event_id`, `event_type` und das grobe
 * `data_type`-Thema. Die fachlichen Daten holt der Client anschließend über
 * die normalen, autorisierten GET-Endpunkte (§6: "the client refetches the
 * authoritative state").
 */
export const realtimeDeliveries = pgTable(
  "realtime_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audienceKey: text("audience_key").notNull(),
    audienceSeq: bigint("audience_seq", { mode: "number" }).notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventOutbox.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    dataType: text("data_type").notNull(),
    standortId: uuid("standort_id").references(() => standorte.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cursorUnique: unique("realtime_deliveries_audience_key_audience_seq_key").on(
      t.audienceKey,
      t.audienceSeq,
    ),
    eventUnique: unique("realtime_deliveries_audience_key_event_id_key").on(
      t.audienceKey,
      t.eventId,
    ),
  }),
);
