import {
  ausbildungen,
  auditEreignisse,
  dokumente,
  fahrlehrer,
  fahrzeuge,
  fahrzeugmaengel,
  leads,
  nachrichten,
  pruefungen,
  raeume,
  rechnungen,
  schueler,
  simulatorgeraete,
  terminangebote,
  terminbuchungen,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { and, desc, eq, gt, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../middleware/auth.js";

interface QueueItem {
  id: string;
  bucket: "sofort" | "heute" | "diese_woche";
  grund: string;
  prioritaet: "hoch" | "mittel" | "niedrig";
  frist: string | null;
  verantwortlicher: string;
  aktion: string;
  entitaet: string;
  entitaetId: string;
  /**
   * PROMPT -1 §4 (Phase 3): Version des referenzierten Datensatzes, wenn er
   * versioniert ist. NEU – und die Voraussetzung dafür, dass §4 verpflichtend
   * werden konnte.
   *
   * Phase 2 hat dokumentiert, warum es ohne diese Angabe nicht ging: die
   * Büro-Oberfläche liest ihre Arbeitsliste hier, ruft danach z. B.
   * `POST /documents/:id/review` auf und hätte ohne gelesene Version ein 428
   * bekommen. Ein Listenendpunkt kann keinen einzelnen `ETag`-Header tragen –
   * er beschreibt viele Datensätze –, deshalb steht die Version je Zeile im
   * Körper, im selben Format wie ein ETag (`W/"<version>"`).
   *
   * `null` bedeutet: dieser Eintrag verweist auf eine Entität ohne
   * Versionsspalte (z. B. `lead`, `nachricht`). Das ist eine ehrliche Angabe
   * und kein Fehler – für diese Entitäten fordert §4 keine Version.
   */
  version: number | null;
  etag: string | null;
}

/** Hilfsfunktion: Version -> ETag-Form, oder beides null. */
function versionOf(row: { version?: number | null } | null | undefined): {
  version: number | null;
  etag: string | null;
} {
  const version = typeof row?.version === "number" ? row.version : null;
  return { version, etag: version === null ? null : `W/"${version}"` };
}

/**
 * Heute-Queue/Planung/Schüler-360/Auswertungen/Audit für die Büro-Zentrale.
 * Jeder Queue-Eintrag trägt Grund/Priorität/Frist/Verantwortlicher/Aktion
 * (Spec-Vorgabe) und referenziert den Quelldatensatz für Drill-down + Audit.
 *
 * Einige Buckets sind fachlich NICHT vollständig modelliert (z. B.
 * "Ressourcenkonflikt" als eigenständige Prüfung, "Kapazitätsengpass",
 * "Firmenkunden") – dort wird eine best-effort Annäherung aus vorhandenen
 * Daten berechnet UND das im Response-Feld `hinweis` klar markiert, statt
 * eine erfundene Kennzahl als vollständig auszugeben (Non-Negotiable:
 * ehrliche Kennzeichnung von Annahmen, siehe docs/fachliche-bestaetigungen.md).
 */
export function registerOfficeDashboardRoutes(app: FastifyInstance, db: Database) {
  app.get(
    "/office/heute",
    { preHandler: [requireAuth, requirePermission("office:dashboard:read")] },
    async (request, reply) => {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const standortId = request.user!.standortId;

      const items: QueueItem[] = [];

      // --- Sofort ---------------------------------------------------------
      const krankeFahrlehrer = await db.select().from(fahrlehrer).where(eq(fahrlehrer.status, "krank"));
      for (const f of krankeFahrlehrer) {
        items.push({
          id: `fahrlehrerausfall-${f.id}`,
          bucket: "sofort",
          grund: `Fahrlehrerausfall: ${f.vorname} ${f.nachname} krankgemeldet`,
          prioritaet: "hoch",
          frist: now.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Betroffene Termine umbuchen / Storno-Retter auslösen",
          entitaet: "fahrlehrer",
          entitaetId: f.id,
          ...versionOf(f),
        });
      }

      const offeneMaengel = await db.select().from(fahrzeugmaengel).where(eq(fahrzeugmaengel.status, "offen"));
      for (const m of offeneMaengel) {
        items.push({
          id: `fahrzeugausfall-${m.id}`,
          bucket: "sofort",
          grund: `Fahrzeugausfall: ${m.grund}`,
          prioritaet: "hoch",
          frist: now.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Ersatzfahrzeug zuweisen oder betroffene Termine stornieren",
          entitaet: "fahrzeugmangel",
          entitaetId: m.id,
          ...versionOf(m),
        });
      }

      const blockiertePruefungen = await db
        .select()
        .from(pruefungen)
        .where(eq(pruefungen.status, "voraussetzungen_fehlen"));
      for (const p of blockiertePruefungen) {
        items.push({
          id: `pruefung-blockiert-${p.id}`,
          bucket: "sofort",
          grund: "Prüfung blockiert: Voraussetzungen fehlen",
          prioritaet: "hoch",
          frist: null,
          verantwortlicher: "Büro/Fahrlehrer",
          aktion: "Fehlende Voraussetzungen klären",
          entitaet: "pruefung",
          entitaetId: p.id,
          ...versionOf(p),
        });
      }

      const fehlgeschlageneNachrichten = await db.select().from(nachrichten).where(eq(nachrichten.status, "fehlgeschlagen"));
      for (const n of fehlgeschlageneNachrichten) {
        items.push({
          id: `nachricht-fehlgeschlagen-${n.id}`,
          bucket: "sofort",
          grund: `Wichtige Nachricht fehlgeschlagen (${n.kanal}): ${n.fehlergrund ?? "unbekannter Fehler"}`,
          prioritaet: "hoch",
          frist: now.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Erneut versenden oder alternativen Kanal nutzen",
          entitaet: "nachricht",
          entitaetId: n.id,
          ...versionOf(n),
        });
      }

      // --- Heute ------------------------------------------------------------
      const neueLeads = await db.select().from(leads).where(eq(leads.status, "neu"));
      for (const l of neueLeads) {
        items.push({
          id: `lead-neu-${l.id}`,
          bucket: "heute",
          grund: `Neuer Lead: ${l.vorname} ${l.nachname}`,
          prioritaet: "mittel",
          frist: in24h.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Kontaktieren",
          entitaet: "lead",
          entitaetId: l.id,
          ...versionOf(l),
        });
      }

      const rueckrufe = await db.select().from(leads).where(eq(leads.status, "kontaktiert"));
      for (const l of rueckrufe) {
        items.push({
          id: `rueckruf-${l.id}`,
          bucket: "heute",
          grund: `Rückruf ausstehend: ${l.vorname} ${l.nachname}`,
          prioritaet: "mittel",
          frist: in24h.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Zurückrufen",
          entitaet: "lead",
          entitaetId: l.id,
          ...versionOf(l),
        });
      }

      const zuPruefendeDokumente = await db.select().from(dokumente).where(eq(dokumente.status, "eingereicht"));
      for (const d of zuPruefendeDokumente) {
        items.push({
          id: `dokument-${d.id}`,
          bucket: "heute",
          grund: `Dokumentprüfung: ${d.typ} (${d.dateiname})`,
          prioritaet: "mittel",
          frist: in24h.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Prüfen/Freigeben",
          entitaet: "dokument",
          entitaetId: d.id,
          // Die wichtigste Zeile dieser Datei für §4: die Büro-Oberfläche
          // ruft mit dieser Version `POST /documents/:id/review` auf.
          ...versionOf(d),
        });
      }

      const auslaufendeAngebote = await db
        .select()
        .from(terminangebote)
        .where(
          and(
            eq(terminangebote.status, "offen"),
            sql`${terminangebote.ablaufAt} IS NOT NULL`,
            lt(terminangebote.ablaufAt, in24h),
            gt(terminangebote.ablaufAt, now),
          ),
        );
      for (const a of auslaufendeAngebote) {
        items.push({
          id: `angebot-laueft-aus-${a.id}`,
          bucket: "heute",
          grund: `Terminangebot läuft bald ab (${a.art})`,
          prioritaet: "niedrig",
          frist: a.ablaufAt ? new Date(a.ablaufAt).toISOString() : null,
          verantwortlicher: "Büro",
          aktion: "Angebot verlängern oder gezielt anbieten",
          entitaet: "terminangebot",
          entitaetId: a.id,
          ...versionOf(a),
        });
      }

      const alleSchueler = await db.select({ id: schueler.id, vorname: schueler.vorname, nachname: schueler.nachname }).from(schueler);
      const kommendeBuchungen = await db
        .select({ schuelerId: terminbuchungen.schuelerId })
        .from(terminbuchungen)
        .where(and(ne(terminbuchungen.status, "cancelled"), gt(terminbuchungen.beginnAt, now)));
      const schuelerMitTermin = new Set(kommendeBuchungen.map((b) => b.schuelerId));
      for (const s of alleSchueler) {
        if (!schuelerMitTermin.has(s.id)) {
          items.push({
            id: `ohne-termin-${s.id}`,
            bucket: "heute",
            grund: `${s.vorname} ${s.nachname} hat keinen nächsten Termin`,
            prioritaet: "niedrig",
            frist: null,
            verantwortlicher: "Büro",
            aktion: "Termin anbieten",
            entitaet: "schueler",
            entitaetId: s.id,
            // `alleSchueler` selektiert nur Namensfelder – Version daher null.
            version: null,
            etag: null,
          });
        }
      }

      // Simulator-/Theorieanfragen: Annäherung über offene Simulator-/
      // Theorie-Terminangebote (kein separates "Anfrage"-Objekt modelliert –
      // siehe Modul-Kommentar "hinweis").
      const simTheorieAngebote = await db
        .select()
        .from(terminangebote)
        .where(and(eq(terminangebote.status, "offen"), or(eq(terminangebote.art, "Simulator"), eq(terminangebote.art, "Theorie"))));
      for (const a of simTheorieAngebote) {
        items.push({
          id: `sim-theorie-${a.id}`,
          bucket: "heute",
          grund: `Offenes ${a.art}-Angebot ohne Buchung`,
          prioritaet: "niedrig",
          frist: null,
          verantwortlicher: "Büro",
          aktion: "Passenden Schüler zuweisen",
          entitaet: "terminangebot",
          entitaetId: a.id,
          ...versionOf(a),
        });
      }

      // --- Diese Woche --------------------------------------------------
      const pruefungsanmeldungen = await db.select().from(pruefungen).where(eq(pruefungen.status, "termin_angefragt"));
      for (const p of pruefungsanmeldungen) {
        items.push({
          id: `pruefungsanmeldung-${p.id}`,
          bucket: "diese_woche",
          grund: "Prüfungsanmeldung offen",
          prioritaet: "mittel",
          frist: in7d.toISOString(),
          verantwortlicher: "Büro",
          aktion: "Prüfungstermin bestätigen",
          entitaet: "pruefung",
          entitaetId: p.id,
          ...versionOf(p),
        });
      }

      const ablaufendeDokumente = await db
        .select()
        .from(dokumente)
        .where(and(sql`${dokumente.gueltigBis} IS NOT NULL`, lt(dokumente.gueltigBis, in7d.toISOString().slice(0, 10))));
      for (const d of ablaufendeDokumente) {
        items.push({
          id: `dokument-laueft-aus-${d.id}`,
          bucket: "diese_woche",
          grund: `Dokument läuft bald ab: ${d.typ}`,
          prioritaet: "niedrig",
          frist: d.gueltigBis ? new Date(d.gueltigBis).toISOString() : null,
          verantwortlicher: "Büro",
          aktion: "Erneuerung anfordern",
          entitaet: "dokument",
          entitaetId: d.id,
          ...versionOf(d),
        });
      }

      const wartung = await db.select().from(fahrzeuge).where(eq(fahrzeuge.status, "wartung"));
      for (const f of wartung) {
        items.push({
          id: `wartung-fahrzeug-${f.id}`,
          bucket: "diese_woche",
          grund: `Fahrzeug in Wartung: ${f.kennzeichen}`,
          prioritaet: "niedrig",
          frist: null,
          verantwortlicher: "Büro",
          aktion: "Wartungsstatus verfolgen",
          entitaet: "fahrzeug",
          entitaetId: f.id,
          ...versionOf(f),
        });
      }

      const forderungen = await db
        .select()
        .from(rechnungen)
        .where(
          and(
            eq(rechnungen.status, "offen"),
            sql`${rechnungen.faelligAm} IS NOT NULL`,
            lt(rechnungen.faelligAm, now.toISOString().slice(0, 10)),
          ),
        );
      for (const r of forderungen) {
        items.push({
          id: `forderung-${r.id}`,
          bucket: "diese_woche",
          grund: `Überfällige Forderung: ${(r.betragCent / 100).toFixed(2)} €`,
          prioritaet: "mittel",
          frist: r.faelligAm ? new Date(r.faelligAm).toISOString() : null,
          verantwortlicher: "Büro (Sichtprüfung) / Finanzen (Mahnung)",
          aktion: "An Finanzen weiterleiten",
          entitaet: "rechnung",
          entitaetId: r.id,
          ...versionOf(r),
        });
      }

      return reply.send({
        items,
        counts: {
          sofort: items.filter((i) => i.bucket === "sofort").length,
          heute: items.filter((i) => i.bucket === "heute").length,
          diese_woche: items.filter((i) => i.bucket === "diese_woche").length,
        },
        dataAsOf: now.toISOString(),
        hinweis:
          "Ressourcenkonflikt/Kapazitätsengpass/Firmenkunden sind fachlich nicht als eigene Entität modelliert (siehe docs/fachliche-bestaetigungen.md) und daher hier NICHT enthalten, statt eine erfundene Zahl zu zeigen.",
      });
    },
  );

  /**
   * Planung: exakte Start-/Endzeiten je Ressource (Schüler/Fahrlehrer/
   * Fahrzeug/Raum/Simulator/Standort). `von`/`bis` sind Pflicht-Query-Parameter.
   */
  app.get(
    "/office/planung",
    { preHandler: [requireAuth, requirePermission("office:dashboard:read")] },
    async (request, reply) => {
      const query = request.query as { von?: string; bis?: string };
      if (!query.von || !query.bis) {
        return reply.code(400).send({ error: "invalid_query", reason: "von/bis erforderlich" });
      }
      const von = new Date(query.von);
      const bis = new Date(query.bis);
      const rows = await db
        .select()
        .from(terminbuchungen)
        .where(and(ne(terminbuchungen.status, "cancelled"), lt(terminbuchungen.beginnAt, bis), gt(terminbuchungen.endeAt, von)));
      return reply.send({ termine: rows, dataAsOf: new Date().toISOString() });
    },
  );

  app.get(
    "/office/schueler",
    { preHandler: [requireAuth, requirePermission("students:read:any")] },
    async (request, reply) => {
      const query = request.query as { page?: string; pageSize?: string };
      const page = Math.max(1, Number(query.page ?? "1") || 1);
      const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? "50") || 50));

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schueler);
      const rows = await db
        .select()
        .from(schueler)
        .orderBy(desc(schueler.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return reply.send({ schueler: rows, page, pageSize, total: count });
    },
  );

  /**
   * Schüler-360. Der Header (nächstes Ziel/Blocker/nächster Termin/
   * empfohlene Aktion) wird gezielt aus dem vollständigen Datensatz
   * abgeleitet, statt separat gepflegt zu werden – single source of truth
   * bleibt die Fachdaten, nicht ein redundantes Header-Feld.
   */
  app.get(
    "/office/schueler/:id",
    { preHandler: [requireAuth, requirePermission("students:read:any")] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const [s] = await db.select().from(schueler).where(eq(schueler.id, params.id)).limit(1);
      if (!s) return reply.code(404).send({ error: "not_found" });

      const [ausbildungRows, dokumentRows, rechnungRows, buchungRows, pruefungRows] = await Promise.all([
        db.select().from(ausbildungen).where(eq(ausbildungen.schuelerId, s.id)),
        db.select().from(dokumente).where(eq(dokumente.schuelerId, s.id)),
        db.select().from(rechnungen).where(eq(rechnungen.schuelerId, s.id)),
        db.select().from(terminbuchungen).where(eq(terminbuchungen.schuelerId, s.id)),
        db.select().from(pruefungen).where(eq(pruefungen.schuelerId, s.id)),
      ]);

      const now = new Date();
      const kommendeTermine = buchungRows
        .filter((b) => b.status !== "cancelled" && new Date(b.beginnAt) > now)
        .sort((a, b) => new Date(a.beginnAt).getTime() - new Date(b.beginnAt).getTime());
      const naechsterTermin = kommendeTermine[0] ?? null;

      const offeneDokumente = dokumentRows.filter((d) => d.status === "eingereicht" || d.status === "abgelehnt");
      const laufendeAusbildung = ausbildungRows.find((a) => a.status === "laufend") ?? ausbildungRows[0] ?? null;
      const offenePruefung = pruefungRows.find((p) => p.status !== "ergebnis_dokumentiert") ?? null;

      const blocker: string[] = [];
      if (offeneDokumente.length > 0) blocker.push(`${offeneDokumente.length} offene Dokumente`);
      if (!naechsterTermin) blocker.push("Kein nächster Termin");
      if (offenePruefung?.status === "voraussetzungen_fehlen") blocker.push("Prüfungsvoraussetzungen fehlen");

      let empfohleneAktion = "Keine Aktion notwendig";
      if (offeneDokumente.length > 0) empfohleneAktion = "Dokumente prüfen";
      else if (!naechsterTermin) empfohleneAktion = "Termin anbieten";
      else if (offenePruefung?.status === "unterlagen_vollstaendig") empfohleneAktion = "Prüfungstermin beantragen";

      return reply.send({
        header: {
          naechstesZiel: laufendeAusbildung ? `Klasse ${laufendeAusbildung.klasse}` : "Kein aktives Ausbildungsziel",
          blocker,
          naechsterTermin,
          empfohleneAktion,
        },
        schueler: s,
        ausbildungen: ausbildungRows,
        dokumente: dokumentRows,
        rechnungen: rechnungRows,
        termine: buchungRows,
        pruefungen: pruefungRows,
        dataAsOf: now.toISOString(),
      });
    },
  );

  app.get(
    "/office/auswertungen",
    { preHandler: [requireAuth, requirePermission("reports:management")] },
    async (_request, reply) => {
      const [[{ count: schuelerCount }], [{ count: offeneBuchungenCount }], [{ count: offeneDokumenteCount }], [{ count: offeneRechnungenCount }]] =
        await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(schueler),
          db.select({ count: sql<number>`count(*)::int` }).from(terminbuchungen).where(ne(terminbuchungen.status, "cancelled")),
          db.select({ count: sql<number>`count(*)::int` }).from(dokumente).where(eq(dokumente.status, "eingereicht")),
          db.select({ count: sql<number>`count(*)::int` }).from(rechnungen).where(eq(rechnungen.status, "offen")),
        ]);

      return reply.send({
        kpis: {
          schuelerGesamt: schuelerCount,
          aktiveTermine: offeneBuchungenCount,
          offeneDokumentpruefungen: offeneDokumenteCount,
          offeneRechnungen: offeneRechnungenCount,
        },
        dataAsOf: new Date().toISOString(),
      });
    },
  );

  /**
   * Audit-Log für Büro: `audit:read:office` ist enger als `audit:read`
   * (Geschäftsführung/Systemdienst) – hier gefiltert auf den eigenen
   * Standort statt organisationsweit.
   */
  app.get(
    "/office/audit",
    { preHandler: [requireAuth, requirePermission("audit:read:office")] },
    async (request, reply) => {
      const standortId = request.user!.standortId;
      const query = request.query as { limit?: string };
      const limit = Math.min(500, Math.max(1, Number(query.limit ?? "100") || 100));
      const rows = standortId
        ? await db.select().from(auditEreignisse).where(eq(auditEreignisse.standortId, standortId)).orderBy(desc(auditEreignisse.createdAt)).limit(limit)
        : await db.select().from(auditEreignisse).orderBy(desc(auditEreignisse.createdAt)).limit(limit);
      return reply.send({ events: rows });
    },
  );
}
