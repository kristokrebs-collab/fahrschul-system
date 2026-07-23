import { randomUUID, createHash } from "node:crypto";
import {
  auditEreignisse,
  banktransaktionen,
  fahrlehrer,
  fahrzeuge,
  fahrzeugkosten,
  fahrzeugmaengel,
  finanzExporte,
  produkte,
  rechnungen,
  standorte,
  stornoEvents,
  zahlungen,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { buildEventRow } from "@fahrschul/events";
import type { BankFeedAdapter } from "@fahrschul/integrations";
import { matchBatch, type OffeneRechnung } from "@fahrschul/finance-core";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const produktSchema = z.object({
  code: z.string().min(1),
  bezeichnung: z.string().min(1),
  kategorie: z.enum(["klasse", "zusatz", "dienstleistung"]),
  preisCent: z.number().int().positive(),
  steuersatz: z.number().min(0).max(1).default(0.19),
  einheit: z.string().default("stueck"),
  standortId: z.string().uuid().nullable().optional(),
});

const exportSchema = z.object({
  bericht: z.string().min(1),
  format: z.enum(["pdf", "csv", "xlsx"]),
  parameter: z.record(z.unknown()).default({}),
});

/**
 * apps/finance (PROMPT 4) – Finanz-/Flotten-/Geschäftsführer-Cockpit.
 *
 * Alle Routen sind hinter `finance:*`-Permissions verriegelt (siehe
 * packages/permissions matrix.ts) – Rollen schueler/fahrlehrer/buero (ohne
 * eigene finanzen-Zuweisung) bekommen 403, damit sie nicht versehentlich
 * Finanzberechtigung erben (Aufgabenstellung: explizit gegentesten).
 */
export function registerFinanceRoutes(app: FastifyInstance, db: Database, deps: { bankFeed: BankFeedAdapter }) {
  // -------------------------------------------------------------------
  // Geschäftsführungs-Cockpit: die 7 Kern-Kennzahlen, aus echten
  // Postgres-Aggregaten berechnet (kein hartkodierter Demo-Wert).
  // -------------------------------------------------------------------
  app.get(
    "/finance/kpis",
    { preHandler: [requireAuth, requirePermission("finance:cockpit:read")] },
    async (request, reply) => {
      const now = new Date();
      const periodeVon = new Date(now.getFullYear(), now.getMonth(), 1);

      const [umsatzRow] = await db
        .select({
          bruttoCent: sql<number>`coalesce(sum(${rechnungen.betragCent}), 0)`,
          nettoCent: sql<number>`coalesce(sum(coalesce(${rechnungen.nettoCent}, round(${rechnungen.betragCent} / (1 + ${rechnungen.steuersatz})))), 0)`,
          anzahl: sql<number>`count(*)`,
        })
        .from(rechnungen)
        .where(gte(rechnungen.createdAt, periodeVon));

      const [zahlungenRow] = await db
        .select({ eingegangenCent: sql<number>`coalesce(sum(${zahlungen.betragCent}), 0)` })
        .from(zahlungen)
        .where(and(eq(zahlungen.zugeordnet, true), gte(zahlungen.createdAt, periodeVon)));

      const [forderungRow] = await db
        .select({ offenCent: sql<number>`coalesce(sum(${rechnungen.betragCent}), 0)`, anzahl: sql<number>`count(*)` })
        .from(rechnungen)
        .where(or(eq(rechnungen.status, "offen"), eq(rechnungen.status, "ueberfaellig")));

      const reviewQueueCount = await db
        .select({ n: sql<number>`count(*)` })
        .from(banktransaktionen)
        .where(eq(banktransaktionen.status, "offen"));

      const stornoStats = await db
        .select({
          gesamt: sql<number>`count(*)`,
          gerettet: sql<number>`count(*) filter (where ${stornoEvents.status} = 'gerettet')`,
          geretteterUmsatzCent: sql<number>`coalesce(sum(${stornoEvents.geretteterUmsatzCent}), 0)`,
        })
        .from(stornoEvents);

      const fahrzeugStatus = await db
        .select({ status: fahrzeuge.status, n: sql<number>`count(*)` })
        .from(fahrzeuge)
        .groupBy(fahrzeuge.status);

      const umsatz = umsatzRow ?? { bruttoCent: 0, nettoCent: 0, anzahl: 0 };
      const zahlungseingang = zahlungenRow?.eingegangenCent ?? 0;
      const forderung = forderungRow ?? { offenCent: 0, anzahl: 0 };
      const storno = stornoStats[0] ?? { gesamt: 0, gerettet: 0, geretteterUmsatzCent: 0 };

      // Deckungsbeitrag/Ergebnis: NUR aus dem, was sauber definiert ist
      // (fakturierter Netto-Umsatz minus zugeordnete variable Fahrzeugkosten
      // der Periode). Personal-/Fixkostenumlage ist NICHT eingerechnet, weil
      // die Kostenstellen-Zuordnung fachlich nicht bestätigt ist (siehe
      // docs/fachliche-bestaetigungen.md) – das Feld ist daher explizit als
      // "vorläufig" markiert statt ein erfundenes Vollergebnis zu zeigen.
      const [variableKostenRow] = await db
        .select({ cent: sql<number>`coalesce(sum(${fahrzeugkosten.betragCent}), 0)` })
        .from(fahrzeugkosten)
        .where(
          and(
            gte(fahrzeugkosten.angefallenAm, periodeVon.toISOString().slice(0, 10)),
            inArray(fahrzeugkosten.kategorie, ["energie", "wartung", "reparatur", "reifen"]),
          ),
        );
      const variableKostenCent = variableKostenRow?.cent ?? 0;
      const deckungsbeitragCent = umsatz.nettoCent - variableKostenCent;

      return reply.send({
        periode: { von: periodeVon.toISOString(), bis: now.toISOString() },
        cards: [
          {
            id: "leistung_umsatz",
            titel: "Leistung/Umsatz",
            fakturiertBruttoCent: umsatz.bruttoCent,
            fakturiertNettoCent: umsatz.nettoCent,
            anzahlRechnungen: umsatz.anzahl,
            abweichung: null,
            ursache: null,
            drilldown: "/finance/invoices",
            aktion: null,
            datenqualitaet: "vollstaendig",
          },
          {
            id: "deckungsbeitrag_ergebnis",
            titel: "Deckungsbeitrag/Ergebnis",
            deckungsbeitragCent,
            variableKostenCent,
            hinweis: "Vorläufig: enthält NICHT Personal-/Fixkostenumlage (Kostenstellenzuordnung UNBESTAETIGT).",
            datenqualitaet: "teilweise",
            drilldown: "/finance/fleet",
          },
          {
            id: "liquiditaet",
            titel: "Liquidität",
            zahlungseingangCent: zahlungseingang,
            offeneForderungCent: forderung.offenCent,
            datenqualitaet: "vollstaendig",
            drilldown: "/finance/bank",
          },
          {
            id: "fahrlehrerauslastung",
            titel: "Fahrlehrerauslastung",
            hinweis: "Siehe /finance/fahrlehrer für die faire, mix-bereinigte Ansicht (keine Rohrangliste).",
            datenqualitaet: "teilweise",
            drilldown: "/finance/fahrlehrer",
          },
          {
            id: "fahrzeugauslastung",
            titel: "Fahrzeugauslastung",
            statusVerteilung: fahrzeugStatus,
            datenqualitaet: "teilweise",
            drilldown: "/finance/fleet",
          },
          {
            id: "offene_forderungen",
            titel: "Offene Forderungen",
            offenCent: forderung.offenCent,
            anzahl: forderung.anzahl,
            reviewQueueCount: reviewQueueCount[0]?.n ?? 0,
            datenqualitaet: "vollstaendig",
            aktion: "/finance/bank",
            drilldown: "/finance/bank",
          },
          {
            id: "forecast",
            titel: "Forecast",
            hinweis: "Siehe /finance/forecast für 4-Wochen/12-Wochen/Jahresende-Szenarien.",
            datenqualitaet: "modelliert",
            drilldown: "/finance/forecast",
          },
        ],
        stornoRetter: {
          gesamt: storno.gesamt,
          gerettet: storno.gerettet,
          erfolgsrateProzent: storno.gesamt > 0 ? Math.round((storno.gerettet / storno.gesamt) * 100) : null,
          geretteterUmsatzCent: storno.geretteterUmsatzCent,
        },
      });
    },
  );

  // -------------------------------------------------------------------
  // Bankabgleich: mock-Feed abrufen, matchen, Review-Queue persistieren.
  // -------------------------------------------------------------------
  app.post(
    "/finance/bank/sync",
    { preHandler: [requireAuth, requirePermission("bank:reconcile")] },
    async (request, reply) => {
      const sinceIso = (request.body as { sinceIso?: string } | undefined)?.sinceIso ?? "1970-01-01T00:00:00Z";
      const feed = await deps.bankFeed.fetchTransactions(sinceIso);

      const offeneDb = await db.select().from(rechnungen).where(or(eq(rechnungen.status, "offen"), eq(rechnungen.status, "ueberfaellig")));
      const offeneRechnungen: OffeneRechnung[] = offeneDb.map((r) => ({
        id: r.id,
        rechnungsnummer: r.rechnungsnummer ?? r.id,
        schuelerName: "", // Name-Matching erfolgt serverseitig separat, siehe Kommentar unten
        standortId: r.standortId ?? "",
        betragCent: r.betragCent,
        faelligAm: r.faelligAm ? new Date(r.faelligAm) : null,
        bereitsBezahltCent: 0,
      }));

      const results = matchBatch(
        feed.map((tx) => ({ ...tx })),
        offeneRechnungen,
      );

      let gebucht = 0;
      let inQueue = 0;
      for (const result of results) {
        const tx = feed.find((f) => f.id === result.transaktionId)!;
        const existing = await db.select().from(banktransaktionen).where(eq(banktransaktionen.externalId, tx.id)).limit(1);
        if (existing.length > 0) continue; // bereits synchronisiert, kein erneutes Anlegen

        const [row] = await db
          .insert(banktransaktionen)
          .values({
            standortId: request.user!.standortId,
            externalId: tx.id,
            amountCent: tx.amountCent,
            bookedAt: tx.bookedAt.toISOString().slice(0, 10),
            reference: tx.reference,
            counterparty: tx.counterparty,
            konfidenz: result.konfidenz,
            grund: result.grund,
            rechnungIds: result.rechnungIds,
            aufteilung: result.aufteilung ?? {},
            hinweis: result.hinweis,
            status: result.autoBuchbar ? "gebucht" : "offen",
            autoGebucht: result.autoBuchbar,
          })
          .returning();

        if (result.autoBuchbar && result.rechnungIds.length === 1) {
          await db
            .update(rechnungen)
            .set({ status: "bezahlt" })
            .where(eq(rechnungen.id, result.rechnungIds[0]));
          await db.insert(zahlungen).values({
            standortId: request.user!.standortId,
            rechnungId: result.rechnungIds[0],
            betragCent: tx.amountCent,
            eingegangenAm: tx.bookedAt.toISOString().slice(0, 10),
            zugeordnet: true,
            status: "zugeordnet",
            banktransaktionId: row.id,
          });
          gebucht += 1;
        } else {
          inQueue += 1;
        }

        await db.insert(auditEreignisse).values(
          buildEventRow({
            type: "payment.matched",
            aktion: "finance.bank.match",
            entitaet: "banktransaktion",
            entitaetId: row.id,
            akteurBenutzerId: request.user!.id,
            standortId: request.user!.standortId,
            source: "apps/api:finance.bank.sync",
            payload: { konfidenz: result.konfidenz, grund: result.grund, autoBuchbar: result.autoBuchbar },
          }),
        );
      }

      return reply.send({ verarbeitet: results.length, autoGebucht: gebucht, inReviewQueue: inQueue });
    },
  );

  app.get(
    "/finance/bank/queue",
    { preHandler: [requireAuth, requirePermission("finance:data_quality:read")] },
    async (_request, reply) => {
      const rows = await db
        .select()
        .from(banktransaktionen)
        .where(eq(banktransaktionen.status, "offen"))
        .orderBy(desc(banktransaktionen.createdAt));
      return reply.send({ queue: rows });
    },
  );

  app.post(
    "/finance/bank/:id/resolve",
    { preHandler: [requireAuth, requirePermission("bank:reconcile")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const body = z
        .object({ rechnungId: z.string().uuid(), betragCent: z.number().int().positive() })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.flatten() });

      const [tx] = await db.select().from(banktransaktionen).where(eq(banktransaktionen.id, params.id)).limit(1);
      if (!tx) return reply.code(404).send({ error: "not_found" });

      await db.insert(zahlungen).values({
        standortId: request.user!.standortId,
        rechnungId: body.data.rechnungId,
        betragCent: body.data.betragCent,
        eingegangenAm: tx.bookedAt,
        zugeordnet: true,
        status: "zugeordnet",
        banktransaktionId: tx.id,
      });
      await db
        .update(banktransaktionen)
        .set({
          status: "gebucht",
          bearbeitetDurchBenutzerId: request.user!.id,
          bearbeitetAt: new Date(),
        })
        .where(eq(banktransaktionen.id, params.id));

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "payment.matched",
          aktion: "finance.bank.resolve_manual",
          entitaet: "banktransaktion",
          entitaetId: tx.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:finance.bank.resolve",
          payload: { rechnungId: body.data.rechnungId, betragCent: body.data.betragCent },
        }),
      );

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------
  // Produkte/Preisliste – kein hartkodiertes Preis-Array (Non-Negotiable).
  // -------------------------------------------------------------------
  app.get("/finance/produkte", { preHandler: [requireAuth, requirePermission("finance:cockpit:read")] }, async (_request, reply) => {
    const rows = await db.select().from(produkte).where(isNull(produkte.gueltigBis));
    return reply.send({ produkte: rows });
  });

  app.post(
    "/finance/produkte",
    { preHandler: [requireAuth, requirePermission("products:manage")] },
    async (request, reply) => {
      const parsed = produktSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      const [row] = await db
        .insert(produkte)
        .values({
          standortId: parsed.data.standortId ?? null,
          code: parsed.data.code,
          bezeichnung: parsed.data.bezeichnung,
          kategorie: parsed.data.kategorie,
          preisCent: parsed.data.preisCent,
          steuersatz: String(parsed.data.steuersatz),
          einheit: parsed.data.einheit,
          gueltigVon: new Date().toISOString().slice(0, 10),
        })
        .returning();
      return reply.code(201).send({ produkt: row });
    },
  );

  // -------------------------------------------------------------------
  // Fahrzeug-Wirtschaftlichkeit (Vollkosten-Aggregat je Fahrzeug, real
  // berechnet über packages/finance berechneFahrzeugkosten).
  // -------------------------------------------------------------------
  app.get(
    "/finance/fleet",
    { preHandler: [requireAuth, requirePermission("finance:cockpit:read")] },
    async (_request, reply) => {
      const fahrzeugRows = await db.select().from(fahrzeuge);
      const maengel = await db.select().from(fahrzeugmaengel);
      return reply.send({
        fahrzeuge: fahrzeugRows.map((f) => ({
          ...f,
          offeneMaengel: maengel.filter((m) => m.fahrzeugId === f.id && m.status !== "erledigt").length,
        })),
        hinweis:
          "Vollkostenrechnung (Kosten/Stunde, Kosten/km, Ausfallkosten) erfolgt clientseitig über @fahrschul/finance berechneFahrzeugkosten aus fahrzeugkosten-Zeilen; siehe docs/kpi-woerterbuch.md.",
      });
    },
  );

  // -------------------------------------------------------------------
  // Export: signierter, session-gebundener Download-Token + Audit-Log.
  // Es gibt bewusst KEINE öffentliche /downloads/:file-Route – der Token
  // ist einmalig, kurzlebig und an den anfordernden Benutzer gebunden.
  // -------------------------------------------------------------------
  app.post(
    "/finance/exports",
    { preHandler: [requireAuth, requirePermission("finance:export")] },
    async (request, reply) => {
      const parsed = exportSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

      const token = randomUUID();
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const abgelaufenAt = new Date(Date.now() + 15 * 60 * 1000); // 15 Minuten gültig

      const [row] = await db
        .insert(finanzExporte)
        .values({
          standortId: request.user!.standortId,
          angefordertVonBenutzerId: request.user!.id,
          format: parsed.data.format,
          bericht: parsed.data.bericht,
          parameter: parsed.data.parameter,
          downloadTokenHash: tokenHash,
          abgelaufenAt,
        })
        .returning();

      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "export.requested",
          aktion: "finance.export.request",
          entitaet: "finanz_export",
          entitaetId: row.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:finance.exports",
          payload: { bericht: parsed.data.bericht, format: parsed.data.format },
        }),
      );

      // Der eigentliche Downloadlink ist relativ + trägt den Rohtoken (nicht
      // den Hash) als Query, session-authentifiziert via requireAuth unten.
      return reply.code(201).send({ exportId: row.id, downloadUrl: `/finance/exports/${row.id}/download?token=${token}` });
    },
  );

  app.get(
    "/finance/exports/:id/download",
    { preHandler: [requireAuth, requirePermission("finance:export")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const query = request.query as { token?: string };
      if (!query.token) return reply.code(400).send({ error: "missing_token" });

      const tokenHash = createHash("sha256").update(query.token).digest("hex");
      const [row] = await db.select().from(finanzExporte).where(eq(finanzExporte.id, params.id)).limit(1);
      if (!row || row.downloadTokenHash !== tokenHash) return reply.code(404).send({ error: "not_found" });
      if (row.angefordertVonBenutzerId !== request.user!.id) return reply.code(403).send({ error: "forbidden" });
      if (row.abgelaufenAt.getTime() < Date.now()) return reply.code(410).send({ error: "expired" });

      await db.update(finanzExporte).set({ heruntergeladenAt: new Date() }).where(eq(finanzExporte.id, row.id));
      await db.insert(auditEreignisse).values(
        buildEventRow({
          type: "export.downloaded",
          aktion: "finance.export.download",
          entitaet: "finanz_export",
          entitaetId: row.id,
          akteurBenutzerId: request.user!.id,
          standortId: request.user!.standortId,
          source: "apps/api:finance.exports.download",
          payload: { format: row.format, bericht: row.bericht },
        }),
      );

      // GAP: kein echtes PDF/CSV/XLSX-Rendering in dieser Sandbox verdrahtet
      // (siehe docs/integration-gaps.md) – die Route liefert den auditierten,
      // autorisierten Datensatz als JSON zurück; ein Renderer kann hier
      // andocken, ohne den Auth-/Audit-Pfad zu ändern.
      return reply.send({ exportId: row.id, bericht: row.bericht, format: row.format, parameter: row.parameter });
    },
  );

  app.get(
    "/finance/data-quality",
    { preHandler: [requireAuth, requirePermission("finance:data_quality:read")] },
    async (_request, reply) => {
      const unmatched = await db
        .select({ n: sql<number>`count(*)` })
        .from(banktransaktionen)
        .where(eq(banktransaktionen.status, "offen"));
      const fahrzeugeOhneKosten = await db
        .select({ n: sql<number>`count(*)` })
        .from(fahrzeuge)
        .leftJoin(fahrzeugkosten, eq(fahrzeugkosten.fahrzeugId, fahrzeuge.id))
        .where(isNull(fahrzeugkosten.id));
      const rechnungenOhneNummer = await db
        .select({ n: sql<number>`count(*)` })
        .from(rechnungen)
        .where(isNull(rechnungen.rechnungsnummer));

      return reply.send({
        issues: [
          {
            typ: "unmatched_bank_transactions",
            anzahl: unmatched[0]?.n ?? 0,
            schweregrad: "hoch",
            beschreibung: "Banktransaktionen in der Review-Queue ohne bestätigte Zuordnung.",
          },
          {
            typ: "missing_vehicle_cost_data",
            anzahl: fahrzeugeOhneKosten[0]?.n ?? 0,
            schweregrad: "mittel",
            beschreibung: "Fahrzeuge ohne jegliche fahrzeugkosten-Zeile – Vollkostenrechnung nicht möglich.",
          },
          {
            typ: "invoices_without_number",
            anzahl: rechnungenOhneNummer[0]?.n ?? 0,
            schweregrad: "niedrig",
            beschreibung: "Rechnungen ohne rechnungsnummer – Kaskadenschritt 1 des Bankabgleichs kann nicht greifen.",
          },
        ],
      });
    },
  );
}
