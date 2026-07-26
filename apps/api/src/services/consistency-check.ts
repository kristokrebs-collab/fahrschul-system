import {
  consistencyCheckRuns,
  consistencyFindings,
} from "@fahrschul/database";
import type { Database } from "@fahrschul/database";
import { eq, sql } from "drizzle-orm";
import { emitAlarm } from "../workers/alarm.js";

/**
 * PROMPT -1 §19 – Täglicher Konsistenzcheck als lauffähiger Job mit Bericht.
 *
 * NICHT-VERHANDELBAR: riskante Reparaturen sind AUSSCHLIESSLICH Vorschläge.
 * Es gibt in dieser Datei keinen einzigen UPDATE/DELETE auf fachliche Daten –
 * jeder Befund trägt einen Vorschlagstext, `vorschlag_angewendet` bleibt
 * `false`, und es existiert kein Codepfad, der ihn auf `true` setzt.
 *
 * Die elf geforderten Prüfungen sind unten als `CHECKS` deklariert. Jede ist
 * eine reine SELECT-Abfrage, damit sie auch auf einer Nur-Lese-Replik laufen
 * kann (§14-Vorbereitung).
 */

export type Severity = "niedrig" | "mittel" | "hoch" | "kritisch";

export interface Finding {
  pruefung: string;
  schweregrad: Severity;
  entitaet: string;
  entitaetId: string | null;
  beschreibung: string;
  vorschlag: string;
  vorschlagRiskant: boolean;
  kontext: Record<string, unknown>;
}

interface CheckDefinition {
  key: string;
  titel: string;
  schweregrad: Severity;
  entitaet: string;
  /** true, wenn ein automatischer Fix Daten zerstören/verfälschen könnte. */
  riskant: boolean;
  vorschlag: string;
  query: (db: Database) => Promise<Array<Record<string, unknown>>>;
  beschreibung: (row: Record<string, unknown>) => string;
}

const CHECKS: CheckDefinition[] = [
  {
    key: "termin_ohne_gueltige_referenz",
    titel: "Termin ohne gültigen Schüler/Fahrlehrer/Fahrzeug",
    schweregrad: "kritisch",
    entitaet: "terminbuchung",
    riskant: true,
    vorschlag:
      "Referenz manuell prüfen und den Termin entweder korrekt verknüpfen oder stornieren. NICHT automatisch löschen – der Termin kann bereits abgerechnet sein.",
    query: (db) =>
      db.execute(sql`
        select t.id, t.schueler_id, t.fahrlehrer_id, t.fahrzeug_id, t.status,
               (s.id is null) as schueler_fehlt,
               (f.id is null) as fahrlehrer_fehlt,
               (t.fahrzeug_id is not null and fz.id is null) as fahrzeug_fehlt,
               (s.status is distinct from 'aktiv') as schueler_inaktiv,
               (f.status is distinct from 'aktiv') as fahrlehrer_inaktiv
          from terminbuchungen t
          left join schueler s on s.id = t.schueler_id
          left join fahrlehrer f on f.id = t.fahrlehrer_id
          left join fahrzeuge fz on fz.id = t.fahrzeug_id
         where t.status <> 'cancelled'
           and (s.id is null or f.id is null or (t.fahrzeug_id is not null and fz.id is null)
                or s.status is distinct from 'aktiv' or f.status is distinct from 'aktiv')
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Termin ${r.id} verweist auf ungültige/inaktive Stammdaten (Schüler fehlt: ${r.schueler_fehlt}, Fahrlehrer fehlt: ${r.fahrlehrer_fehlt}, Fahrzeug fehlt: ${r.fahrzeug_fehlt}, Schüler inaktiv: ${r.schueler_inaktiv}, Fahrlehrer inaktiv: ${r.fahrlehrer_inaktiv}).`,
  },
  {
    key: "terminueberschneidung",
    titel: "Überschneidungen",
    schweregrad: "kritisch",
    entitaet: "terminbuchung",
    riskant: true,
    vorschlag:
      "Einen der beiden Termine verlegen oder stornieren. Nur manuell – welcher Termin weichen soll, ist eine fachliche Entscheidung. (Neuentstehung ist durch die EXCLUDE-Constraints aus Migration 0002 ausgeschlossen; ein Befund hier deutet auf Altdaten VOR der Constraint hin.)",
    query: (db) =>
      db.execute(sql`
        select a.id, b.id as anderer_termin_id, a.fahrlehrer_id, a.fahrzeug_id,
               a.beginn_at, a.ende_at
          from terminbuchungen a
          join terminbuchungen b
            on a.id < b.id
           and a.status <> 'cancelled' and b.status <> 'cancelled'
           and tstzrange(a.beginn_at, a.ende_at) && tstzrange(b.beginn_at, b.ende_at)
           and (a.fahrlehrer_id = b.fahrlehrer_id
                or (a.fahrzeug_id is not null and a.fahrzeug_id = b.fahrzeug_id)
                or a.schueler_id = b.schueler_id)
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) => `Termin ${r.id} überschneidet sich mit Termin ${r.anderer_termin_id}.`,
  },
  {
    key: "bestaetigtes_angebot_ohne_termin",
    titel: "Bestätigtes Angebot ohne Termin",
    schweregrad: "hoch",
    entitaet: "terminangebot",
    riskant: true,
    vorschlag:
      "Prüfen, ob die Buchung fehlgeschlagen ist. Entweder den Termin nachtragen oder das Angebot auf 'failed_review' setzen. Nicht automatisch buchen – die Ressourcen können inzwischen belegt sein.",
    query: (db) =>
      db.execute(sql`
        select o.id, o.angebot_status, o.beginn_at, o.ende_at, o.fahrlehrer_id
          from terminangebote o
         where o.angebot_status in ('accepted', 'booking_pending', 'confirmed')
           and not exists (
             select 1 from terminbuchungen t
              where t.terminangebot_id = o.id and t.status <> 'cancelled'
           )
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Angebot ${r.id} steht auf '${r.angebot_status}', es existiert aber keine aktive Terminbuchung dazu.`,
  },
  {
    key: "leistung_ohne_rechnung",
    titel: "Leistung ohne Rechnung",
    schweregrad: "mittel",
    entitaet: "terminbuchung",
    riskant: false,
    vorschlag:
      "Rechnung über POST /invoices mit leistungTerminbuchungId erzeugen (idempotent). Der Vorschlag ist ungefährlich, wird aber trotzdem nicht automatisch ausgeführt – Fakturierung bleibt eine Entscheidung der Rolle 'finanzen'.",
    query: (db) =>
      db.execute(sql`
        select t.id, t.schueler_id, t.beendet_at, t.art
          from terminbuchungen t
         where t.status = 'abgeschlossen'
           and not exists (
             select 1 from rechnungspositionen p
              where p.leistung_terminbuchung_id = t.id and p.storniert = false
           )
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Abgeschlossene Fahrstunde ${r.id} (${r.art}) hat keine nicht-stornierte Rechnungsposition.`,
  },
  {
    key: "doppelte_rechnung_fuer_leistung",
    titel: "Doppelte Rechnung für Leistung",
    schweregrad: "hoch",
    entitaet: "rechnungsposition",
    riskant: true,
    vorschlag:
      "Eine der Rechnungen stornieren. Manuell – die falsche Stornierung würde eine bereits bezahlte Rechnung entwerten. (Neuentstehung ist durch den partiellen Unique-Index rechnungspositionen_leistung_once_idx ausgeschlossen.)",
    query: (db) =>
      db.execute(sql`
        select p.leistung_terminbuchung_id as id,
               count(*) as anzahl,
               array_agg(p.rechnung_id::text) as rechnung_ids
          from rechnungspositionen p
         where p.leistung_terminbuchung_id is not null and p.storniert = false
         group by p.leistung_terminbuchung_id
        having count(*) > 1
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Leistung ${r.id} ist ${r.anzahl}-fach fakturiert (Rechnungen: ${JSON.stringify(r.rechnung_ids)}).`,
  },
  {
    key: "zahlung_ueber_restbetrag",
    titel: "Zahlung über Restbetrag",
    schweregrad: "hoch",
    entitaet: "rechnung",
    riskant: true,
    vorschlag:
      "Überzahlung prüfen: Gutschrift erstellen oder Zuordnung korrigieren. Keine automatische Rückbuchung – das wäre ein Geldfluss ohne menschliche Freigabe.",
    query: (db) =>
      db.execute(sql`
        select r.id, r.betrag_cent, coalesce(sum(z.betrag_cent), 0) as zugeordnet_cent
          from rechnungen r
          join zahlungen z on z.rechnung_id = r.id and z.zugeordnet = true and z.status <> 'storniert'
         where r.status <> 'storniert'
         group by r.id, r.betrag_cent
        having coalesce(sum(z.betrag_cent), 0) > r.betrag_cent
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Rechnung ${r.id}: ${r.zugeordnet_cent} Cent zugeordnet, aber nur ${r.betrag_cent} Cent gefordert.`,
  },
  {
    key: "blockiertes_fahrzeug_mit_zukunftstermin",
    titel: "Blockiertes Fahrzeug mit zukünftigem Termin",
    schweregrad: "hoch",
    entitaet: "terminbuchung",
    riskant: true,
    vorschlag:
      "Ersatzfahrzeug zuweisen oder Termin über den Storno-Retter neu vergeben. Bewusst NICHT automatisch: das Sperren eines Fahrzeugs darf bestehende Termine nicht stillschweigend stornieren.",
    query: (db) =>
      db.execute(sql`
        select t.id, t.fahrzeug_id, fz.status as fahrzeug_status, t.beginn_at
          from terminbuchungen t
          join fahrzeuge fz on fz.id = t.fahrzeug_id
         where t.status not in ('cancelled', 'abgeschlossen')
           and t.beginn_at > now()
           and fz.status <> 'verfuegbar'
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Zukünftiger Termin ${r.id} nutzt Fahrzeug ${r.fahrzeug_id} im Status '${r.fahrzeug_status}'.`,
  },
  {
    key: "pruefungsstatus_ohne_freigabe",
    titel: "Prüfungsstatus ohne Freigabe",
    schweregrad: "kritisch",
    entitaet: "pruefung",
    riskant: true,
    vorschlag:
      "Freigabekette nachvollziehen und den Prüfungsstatus zurücksetzen ODER die fehlende Freigabe korrekt erteilen. NIEMALS automatisch freigeben (Non-Negotiable: keine automatische Prüfungsfreigabe).",
    query: (db) =>
      db.execute(sql`
        select p.id, p.status, p.ausbildung_id,
               coalesce(pf.status, 'fehlt') as fahrlehrer_freigabe,
               coalesce(pf.buerofreigabe_status, 'fehlt') as buero_freigabe
          from pruefungen p
          left join pruefungsfreigaben pf on pf.ausbildung_id = p.ausbildung_id
         where p.status in ('termin_angefragt', 'termin_bestaetigt', 'durchgefuehrt', 'ergebnis_dokumentiert')
           and (pf.id is null
                or pf.status is distinct from 'freigegeben'
                or pf.buerofreigabe_status is distinct from 'freigegeben')
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Prüfung ${r.id} steht auf '${r.status}', Freigabekette unvollständig (Fahrlehrer: ${r.fahrlehrer_freigabe}, Büro: ${r.buero_freigabe}).`,
  },
  {
    key: "dokumentstatus_ohne_pruefprotokoll",
    titel: "Dokumentstatus ohne Prüfprotokoll",
    schweregrad: "hoch",
    entitaet: "dokument",
    riskant: false,
    vorschlag:
      "Dokument erneut in die Prüfung geben (Übergang nach 'in_review'), damit ein Prüfprotokoll entsteht. Nicht automatisch – ein nachträglich erfundenes Protokoll wäre eine Falschaussage.",
    query: (db) =>
      db.execute(sql`
        select d.id, d.dokument_status, d.typ
          from dokumente d
         where d.dokument_status in ('verified', 'rejected')
           and (d.pruefprotokoll is null or d.geprueft_durch_benutzer_id is null)
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Dokument ${r.id} (${r.typ}) steht auf '${r.dokument_status}', hat aber kein vollständiges Prüfprotokoll.`,
  },
  {
    key: "verwaiste_uploads",
    titel: "Verwaiste Uploads",
    schweregrad: "niedrig",
    entitaet: "dokument",
    riskant: false,
    vorschlag:
      "Dokumente, die länger als 24 h in 'uploaded'/'scanning'/'quarantined' hängen, über den Job document.review erneut verarbeiten oder auf 'deleted' setzen. Erst nach Sichtprüfung – ein Löschen wäre unumkehrbar.",
    query: (db) =>
      db.execute(sql`
        select d.id, d.dokument_status, d.created_at, d.speicher_referenz
          from dokumente d
         where d.dokument_status in ('uploaded', 'scanning', 'quarantined')
           and d.created_at < now() - interval '24 hours'
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Upload ${r.id} hängt seit ${r.created_at} im Zustand '${r.dokument_status}' (Speicherreferenz ${r.speicher_referenz}).`,
  },
  {
    key: "unverarbeitete_ereignisse",
    titel: "Unverarbeitete Ereignisse",
    schweregrad: "hoch",
    entitaet: "event_outbox",
    riskant: false,
    vorschlag:
      "Outbox-Worker prüfen (POST /ops/outbox/dispatch) bzw. Dead-Letter-Einträge über POST /ops/dead-letters/:id/resume wiederaufnehmen. Ungefährlich, wird aber nicht automatisch ausgelöst, damit ein Dauerfehler nicht endlos wiederholt wird.",
    query: (db) =>
      db.execute(sql`
        select o.id, o.event_type, o.status, o.attempts, o.last_error, o.created_at
          from event_outbox o
         where (o.status in ('pending', 'in_flight') and o.created_at < now() - interval '15 minutes')
            or o.status = 'dead'
      `) as Promise<Array<Record<string, unknown>>>,
    beschreibung: (r) =>
      `Ereignis ${r.id} (${r.event_type}) ist seit ${r.created_at} nicht zugestellt (Status '${r.status}', ${r.attempts} Versuche, letzter Fehler: ${r.last_error ?? "keiner"}).`,
  },
];

export interface ConsistencyRunResult {
  runId: string;
  findings: Finding[];
  zusammenfassung: Array<{ pruefung: string; titel: string; anzahl: number; schweregrad: Severity }>;
  fehlerhaftePruefungen: Array<{ pruefung: string; fehler: string }>;
}

export async function runConsistencyCheck(
  db: Database,
  options: { ausgeloestDurch?: string; akteurBenutzerId?: string | null } = {},
): Promise<ConsistencyRunResult> {
  const [run] = await db
    .insert(consistencyCheckRuns)
    .values({
      status: "laufend",
      ausgeloestDurch: options.ausgeloestDurch ?? "job",
      akteurBenutzerId: options.akteurBenutzerId ?? null,
    })
    .returning();

  const findings: Finding[] = [];
  const zusammenfassung: ConsistencyRunResult["zusammenfassung"] = [];
  const fehlerhaftePruefungen: Array<{ pruefung: string; fehler: string }> = [];

  for (const check of CHECKS) {
    try {
      const rows = await check.query(db);
      for (const row of rows) {
        findings.push({
          pruefung: check.key,
          schweregrad: check.schweregrad,
          entitaet: check.entitaet,
          entitaetId: typeof row.id === "string" ? row.id : null,
          beschreibung: check.beschreibung(row),
          vorschlag: check.vorschlag,
          vorschlagRiskant: check.riskant,
          kontext: row,
        });
      }
      zusammenfassung.push({
        pruefung: check.key,
        titel: check.titel,
        anzahl: rows.length,
        schweregrad: check.schweregrad,
      });
    } catch (err) {
      // Eine fehlerhafte Einzelprüfung darf den gesamten Bericht nicht
      // verhindern – der Bericht nennt die Lücke stattdessen explizit.
      fehlerhaftePruefungen.push({ pruefung: check.key, fehler: (err as Error).message });
      zusammenfassung.push({
        pruefung: check.key,
        titel: check.titel,
        anzahl: -1,
        schweregrad: check.schweregrad,
      });
    }
  }

  if (findings.length > 0) {
    await db.insert(consistencyFindings).values(
      findings.map((f) => ({
        runId: run.id,
        pruefung: f.pruefung,
        schweregrad: f.schweregrad,
        entitaet: f.entitaet,
        entitaetId: f.entitaetId,
        beschreibung: f.beschreibung,
        vorschlag: f.vorschlag,
        vorschlagRiskant: f.vorschlagRiskant,
        // vorschlagAngewendet bleibt bei false – es gibt keinen Codepfad, der es setzt.
        kontext: f.kontext as never,
      })),
    );
  }

  await db
    .update(consistencyCheckRuns)
    .set({
      status: "fertig",
      beendetAt: new Date(),
      anzahlBefunde: findings.length,
      bericht: { zusammenfassung, fehlerhaftePruefungen, pruefungen: CHECKS.length } as never,
    })
    .where(eq(consistencyCheckRuns.id, run.id));

  const kritisch = findings.filter((f) => f.schweregrad === "kritisch").length;
  if (kritisch > 0) {
    await emitAlarm({
      kind: "consistency_findings",
      subject: "Konsistenzprüfung mit kritischen Befunden",
      message: `${kritisch} kritische Befunde in Lauf ${run.id}`,
      details: { runId: run.id, gesamt: findings.length },
    });
  }

  return { runId: run.id, findings, zusammenfassung, fehlerhaftePruefungen };
}

/** Liste der definierten Prüfungen (für die Ops-Route und Phase-4-Dokumentation). */
export function consistencyCheckCatalog() {
  return CHECKS.map((c) => ({
    key: c.key,
    titel: c.titel,
    schweregrad: c.schweregrad,
    entitaet: c.entitaet,
    vorschlagRiskant: c.riskant,
    vorschlag: c.vorschlag,
  }));
}
