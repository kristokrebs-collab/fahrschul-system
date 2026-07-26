import type { Database } from "@fahrschul/database";
import { sql } from "drizzle-orm";
import { emitAlarm } from "../workers/alarm.js";

/**
 * PROMPT -1 §17 – Manipulationserkennung im Audit-Log.
 *
 * Migration 0009 gibt jeder `audit_events`-Zeile
 *   `row_hash = sha256(kanonischer Inhalt || prev_hash)`
 * und verbietet UPDATE/DELETE per Trigger. Diese Datei ist die PRÜFUNG – ohne
 * sie wäre die Kette nur eine Behauptung.
 *
 * ## Drei Befundarten, drei Angreifermodelle
 *
 * | Befund | Bedeutung | Wie es entsteht |
 * | --- | --- | --- |
 * | `inhalt_veraendert` | `row_hash` passt nicht zum Inhalt der Zeile | jemand hat eine Zeile bearbeitet (mit deaktiviertem Trigger, per Restore einer manipulierten Sicherung, oder direkt auf Dateiebene) |
 * | `vorgaenger_fehlt` | `prev_hash` zeigt auf einen `row_hash`, den es nicht (mehr) gibt | jemand hat eine Zeile gelöscht |
 * | `mehrere_genesis` | mehr als eine Zeile ohne `prev_hash` | der Anfang der Kette wurde entfernt bzw. die Tabelle wurde geleert (nach `truncate` ist genau EIN neuer Genesis normal, mehr nicht) |
 *
 * ## Die Prüfung läuft in SQL, nicht in der Anwendung
 *
 * Absicht: die Neuberechnung des Hashes benutzt DIESELBE Funktion
 * (`fs_audit_event_canonical` + `digest`), die auch beim Einfügen benutzt
 * wurde. Eine zweite Implementierung in TypeScript würde bei jeder
 * Kanonisierungsabweichung Fehlalarme erzeugen und wäre damit wertlos.
 *
 * ## Ehrlicher Hinweis zur Nebenläufigkeit
 *
 * Die Kette ist ein Baum, nicht eine Linie (Begründung in Migration 0009):
 * zwei gleichzeitige Transaktionen können denselben Vorgänger referenzieren.
 * Deshalb prüft `vorgaenger_fehlt` auf EXISTENZ des Vorgängers, nicht auf
 * Eindeutigkeit. Das Löschen einer Zeile, auf die NIEMAND zeigt (ein
 * Kettenblatt), ist mit der Hash-Kette allein nicht erkennbar – dagegen wirkt
 * der Append-only-Trigger, und die Prüfung meldet den Zeilenzähler mit, damit
 * ein Rückgang gegenüber dem letzten Lauf auffällt.
 */

export type AuditChainFindingKind = "inhalt_veraendert" | "vorgaenger_fehlt" | "mehrere_genesis";

export interface AuditChainFinding {
  kind: AuditChainFindingKind;
  auditEventId: string | null;
  chainSeq: number | null;
  beschreibung: string;
}

export interface AuditChainVerification {
  geprueft: number;
  befunde: AuditChainFinding[];
  ok: boolean;
  /** Höchste geprüfte Kettennummer – Grundlage für einen Vergleich mit dem Vorlauf. */
  maxChainSeq: number;
  /** true, wenn die Append-only-Trigger tatsächlich aktiv sind. */
  appendOnlyTriggersActive: boolean;
  hinweis: string;
}

export interface VerifyAuditChainOptions {
  /** Nur die letzten N Zeilen prüfen (Standard: alle). */
  limit?: number;
  /** Alarm auslösen, wenn ein Befund entsteht (Standard: true). */
  alarm?: boolean;
}

export async function verifyAuditChain(
  db: Database,
  options: VerifyAuditChainOptions = {},
): Promise<AuditChainVerification> {
  const limit = options.limit ?? 100000;

  // 1) Inhaltsprüfung: row_hash gegen Neuberechnung.
  const tamperedRows = (await db.execute(sql`
    with kandidaten as (
      select id, chain_seq, prev_hash, row_hash, type, aktion, entitaet, entitaet_id,
             akteur_benutzer_id, standort_id, source, correlation_id, idempotency_key,
             vorher, nachher, payload, created_at
      from audit_events
      order by chain_seq desc
      limit ${limit}
    )
    select id, chain_seq
    from kandidaten
    where row_hash is null
       or row_hash <> encode(
            digest(
              fs_audit_event_canonical(
                id, type, aktion, entitaet, entitaet_id, akteur_benutzer_id, standort_id,
                source, correlation_id, idempotency_key, vorher, nachher, payload, created_at
              ) || '|' || coalesce(prev_hash, 'GENESIS'),
              'sha256'
            ),
            'hex'
          )
  `)) as unknown as Array<{ id: string; chain_seq: number }>;

  // 2) Verkettungsprüfung: prev_hash muss existieren.
  const brokenLinks = (await db.execute(sql`
    with kandidaten as (
      select id, chain_seq, prev_hash from audit_events order by chain_seq desc limit ${limit}
    )
    select k.id, k.chain_seq
    from kandidaten k
    where k.prev_hash is not null
      and not exists (select 1 from audit_events a where a.row_hash = k.prev_hash)
  `)) as unknown as Array<{ id: string; chain_seq: number }>;

  // 3) Genesis-Zählung.
  const genesisRows = (await db.execute(sql`
    select count(*)::int as n from audit_events where prev_hash is null
  `)) as unknown as Array<{ n: number }>;

  const totals = (await db.execute(sql`
    select count(*)::int as n, coalesce(max(chain_seq), 0)::bigint as max_seq from audit_events
  `)) as unknown as Array<{ n: number; max_seq: string | number }>;

  const triggerRows = (await db.execute(sql`
    select count(*)::int as n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'audit_events'
      and t.tgname in ('audit_events_no_update_trg', 'audit_events_no_delete_trg')
      and t.tgenabled <> 'D'
  `)) as unknown as Array<{ n: number }>;

  const befunde: AuditChainFinding[] = [];
  for (const row of tamperedRows) {
    befunde.push({
      kind: "inhalt_veraendert",
      auditEventId: row.id,
      chainSeq: Number(row.chain_seq),
      beschreibung:
        "Der gespeicherte Zeilen-Hash passt nicht zum Inhalt der Zeile. Die Zeile wurde nach dem Einfügen verändert.",
    });
  }
  for (const row of brokenLinks) {
    befunde.push({
      kind: "vorgaenger_fehlt",
      auditEventId: row.id,
      chainSeq: Number(row.chain_seq),
      beschreibung:
        "Der referenzierte Vorgänger-Hash existiert nicht mehr. Eine Zeile wurde aus der Kette entfernt.",
    });
  }
  const genesisCount = Number(genesisRows[0]?.n ?? 0);
  if (genesisCount > 1) {
    befunde.push({
      kind: "mehrere_genesis",
      auditEventId: null,
      chainSeq: null,
      beschreibung: `Die Kette hat ${genesisCount} Anfänge (erwartet: höchstens 1). Der Kettenanfang wurde entfernt oder ersetzt.`,
    });
  }

  const geprueft = Number(totals[0]?.n ?? 0);
  const maxChainSeq = Number(totals[0]?.max_seq ?? 0);
  const appendOnlyTriggersActive = Number(triggerRows[0]?.n ?? 0) === 2;

  const result: AuditChainVerification = {
    geprueft,
    befunde,
    ok: befunde.length === 0 && appendOnlyTriggersActive,
    maxChainSeq,
    appendOnlyTriggersActive,
    hinweis: appendOnlyTriggersActive
      ? "Append-only-Trigger sind aktiv; UPDATE/DELETE auf audit_events schlagen mit SQLSTATE FS008 fehl."
      : "WARNUNG: die Append-only-Trigger auf audit_events sind NICHT aktiv. Das ist selbst ein Sicherheitsvorfall.",
  };

  if (options.alarm !== false && !result.ok) {
    await emitAlarm({
      kind: "audit_tamper",
      source: "audit_chain",
      subject: "Manipulationsverdacht im Audit-Log",
      message: result.hinweis,
      details: {
        befunde: befunde.length,
        arten: [...new Set(befunde.map((b) => b.kind))],
        appendOnlyTriggersActive,
      },
    });
  }

  return result;
}
