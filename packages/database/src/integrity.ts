import postgres from "postgres";

/**
 * PROMPT -1 §14 (Phase 4) – Datenintegritätsprüfung.
 *
 * ## Wofür das gebraucht wird
 *
 * §14 verlangt zwei Dinge, die zusammengehören: einen **echten
 * Wiederherstellungstest** und **Datenintegritätsprüfungen**. Ein
 * Wiederherstellungstest, der nur „pg_restore ist mit 0 beendet" prüft, belegt
 * nichts: `pg_restore` kann erfolgreich sein und trotzdem eine Datenbank
 * hinterlassen, in der Trigger fehlen (`--data-only`), Constraints nicht
 * greifen (`--disable-triggers`) oder halbe Tabellen leer sind.
 *
 * Diese Datei ist deshalb die gemeinsame Prüfung für zwei Aufrufer:
 *
 *  1. `scripts/restore-verify.sh` – gegen die wiederhergestellte Datenbank in
 *     der isolierten Umgebung (Chaos-Szenario 15).
 *  2. `apps/api/src/__tests__/chaos.test.ts` – gegen die Testdatenbank, damit
 *     die Prüfung selbst getestet ist und nicht nur im Skript existiert.
 *
 * ## Warum die Prüfung STRUKTUR misst, nicht nur Zeilenzahlen
 *
 * Zeilenzahlen allein sind ein schwacher Beweis: eine Wiederherstellung, die
 * jede Zeile mitbringt aber die EXCLUDE-Constraints verliert, sieht in einer
 * Zählung perfekt aus – und lässt danach Doppelbuchungen zu. Deshalb prüft
 * `checkDatabaseIntegrity` vier Ebenen:
 *
 *  | Ebene | Was schiefgehen kann, ohne dass Zeilen fehlen |
 *  |---|---|
 *  | Migrationsstand | Wiederherstellung eines älteren Dumps |
 *  | Tabellen | `--table=`-Teilmenge, abgebrochener Restore |
 *  | Constraints/Trigger/Indizes | `--disable-triggers`, `--data-only`, Reihenfolgefehler |
 *  | referenzielle Waisen | Restore ohne Constraints, danach reaktiviert |
 *
 * ## Die geprüften Non-Negotiables
 *
 * `REQUIRED_CONSTRAINTS` und `REQUIRED_TRIGGERS` sind bewusst die Zusagen, die
 * dieses Projekt als unverhandelbar führt – die beiden GiST-EXCLUDE-Constraints
 * gegen Doppelbuchung, die Invarianten FS001–FS009, das Append-only-Audit und
 * die Outbox-Kopplung. Eine wiederhergestellte Datenbank, in der eine davon
 * fehlt, ist NICHT wiederhergestellt, auch wenn sie sich benutzen lässt.
 */

export interface IntegrityFinding {
  check: string;
  severity: "kritisch" | "hoch" | "hinweis";
  message: string;
  details?: Record<string, unknown>;
}

export interface IntegrityReport {
  ok: boolean;
  checkedAt: string;
  database: string;
  migrationCount: number;
  latestMigration: string | null;
  tableCount: number;
  rowCounts: Record<string, number>;
  findings: IntegrityFinding[];
  /** Rein informativ für den Bericht: Größe der Datenbank. */
  databaseSizeBytes: number | null;
}

/**
 * Tabellen, ohne die das Fachmodell nicht vollständig ist. Bewusst nicht
 * „alle" – die Liste soll eine unvollständige Wiederherstellung erkennen, nicht
 * bei jeder neuen Migration brechen.
 */
export const REQUIRED_TABLES: readonly string[] = [
  // Fachkern
  "organisationen",
  "standorte",
  "benutzer",
  "sessions",
  "schueler",
  "fahrlehrer",
  "fahrzeuge",
  "ausbildungen",
  "terminbuchungen",
  "terminangebote",
  "dokumente",
  "rechnungen",
  "rechnungspositionen",
  "zahlungen",
  "banktransaktionen",
  // Zuverlässigkeitskern (Phase 1)
  "idempotency_keys",
  "audit_events",
  "event_outbox",
  "event_inbox",
  "event_cursors",
  "jobs",
  "dead_letters",
  "state_transitions",
  "state_machine_transitions",
  "consistency_check_runs",
  "consistency_findings",
  // Realtime (Phase 2)
  "realtime_deliveries",
  "realtime_audience_counters",
  // Defense in Depth (Phase 3)
  "auth_throttle",
  "upload_sessions",
  "integration_health",
  "integration_outbound_calls",
  // Betrieb (Phase 4)
  "backup_runs",
  "deployments",
];

/**
 * Die Constraints, deren Verlust die Non-Negotiables bricht.
 * Format: `tabelle.constraint_name`.
 */
export const REQUIRED_CONSTRAINTS: readonly string[] = [
  // Die beiden GiST-EXCLUDE-Constraints gegen Doppelbuchung. Ohne sie ist
  // "keine Doppelbuchung" nur noch Anwendungscode.
  "terminbuchungen.terminbuchungen_no_overlap_fahrlehrer",
  "terminbuchungen.terminbuchungen_no_overlap_fahrzeug",
];

/** Trigger, die Invarianten durchsetzen (FS001–FS009, Audit, Outbox, Version). */
export const REQUIRED_TRIGGERS: readonly string[] = [
  // §5: kein Fachvorgang ohne Outbox-Zeile.
  "audit_events_outbox_trg",
  // §17: append-only + Hash-Kette.
  "audit_events_no_update_trg",
  "audit_events_no_delete_trg",
  "audit_events_hash_chain_trg",
  // §4: Versionsfortschreibung – ohne sie ist die optimistische Sperre blind.
  "terminbuchungen_z_version_trg",
  // §3: die Invarianten mit eigenem SQLSTATE.
  "terminbuchungen_b_fahrzeug_gesperrt_trg",
  "terminbuchungen_a_completed_once_trg",
  "dokumente_c_scan_pflicht_trg",
];

/**
 * Referenzielle Prüfungen, die auch ohne Fremdschlüssel greifen müssen. Sie
 * finden genau den Schaden, den ein Restore mit abgeschalteten Constraints
 * hinterlässt.
 */
type OrphanQuery = (sql: postgres.Sql) => Promise<Array<{ n: number }>>;

/**
 * Bewusst als getaggte Templates und NICHT als SQL-Zeichenketten mit
 * `sql.unsafe()`: Phase 4 hat genau dieses Muster in `claimJobs` als Befund
 * behandelt, und eine neue Datei darf es nicht wieder einführen – auch nicht
 * dort, wo die Werte statisch sind.
 */
const ORPHAN_CHECKS: ReadonlyArray<{ name: string; run: OrphanQuery }> = [
  {
    name: "terminbuchung_ohne_schueler",
    run: (sql) => sql`select count(*)::int as n from terminbuchungen t
        left join schueler s on s.id = t.schueler_id
       where t.schueler_id is not null and s.id is null`,
  },
  {
    name: "terminbuchung_ohne_fahrlehrer",
    run: (sql) => sql`select count(*)::int as n from terminbuchungen t
        left join fahrlehrer f on f.id = t.fahrlehrer_id
       where t.fahrlehrer_id is not null and f.id is null`,
  },
  {
    name: "rechnungsposition_ohne_rechnung",
    run: (sql) => sql`select count(*)::int as n from rechnungspositionen p
        left join rechnungen r on r.id = p.rechnung_id
       where r.id is null`,
  },
  {
    name: "zahlung_ohne_rechnung",
    run: (sql) => sql`select count(*)::int as n from zahlungen z
        left join rechnungen r on r.id = z.rechnung_id
       where z.rechnung_id is not null and r.id is null`,
  },
  {
    name: "session_ohne_benutzer",
    run: (sql) => sql`select count(*)::int as n from sessions s
        left join benutzer b on b.id = s.benutzer_id
       where b.id is null`,
  },
  {
    name: "outbox_ereignis_ohne_audit",
    run: (sql) => sql`select count(*)::int as n from event_outbox o
        left join audit_events a on a.id = o.audit_event_id
       where o.audit_event_id is not null and a.id is null`,
  },
];

/** Tabellen, deren Zeilenzahl in den Bericht kommt (Vergleich Quelle/Ziel). */
export const COUNTED_TABLES: readonly string[] = [
  "organisationen",
  "standorte",
  "benutzer",
  "schueler",
  "fahrlehrer",
  "fahrzeuge",
  "ausbildungen",
  "terminbuchungen",
  "terminangebote",
  "dokumente",
  "rechnungen",
  "zahlungen",
  "banktransaktionen",
  "audit_events",
  "event_outbox",
  "jobs",
  "idempotency_keys",
  "schema_migrations",
];

/**
 * Prüft eine Datenbank auf strukturelle und referenzielle Integrität.
 *
 * `ok` ist genau dann `true`, wenn KEIN Befund der Schwere `kritisch` oder
 * `hoch` vorliegt. Hinweise (z. B. leere Tabellen) machen den Bericht nicht
 * ungültig: eine frisch wiederhergestellte, aber inhaltlich leere
 * Testdatenbank ist strukturell in Ordnung.
 */
export async function checkDatabaseIntegrity(databaseUrl: string): Promise<IntegrityReport> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const findings: IntegrityFinding[] = [];
  const rowCounts: Record<string, number> = {};
  let migrationCount = 0;
  let latestMigration: string | null = null;
  let tableCount = 0;
  let databaseSizeBytes: number | null = null;
  let database = "?";

  try {
    const [meta] = await sql<Array<{ db: string; size: string }>>`
      select current_database() as db, pg_database_size(current_database())::text as size`;
    database = meta.db;
    databaseSizeBytes = Number(meta.size);

    // ---- Ebene 1: Migrationsstand ----------------------------------------
    try {
      const rows = await sql<Array<{ filename: string }>>`
        select filename from schema_migrations order by filename`;
      migrationCount = rows.length;
      latestMigration = rows.length > 0 ? rows[rows.length - 1].filename : null;
      if (migrationCount === 0) {
        findings.push({
          check: "schema_migrations",
          severity: "kritisch",
          message: "schema_migrations ist leer – die Wiederherstellung enthält kein Schema-Protokoll.",
        });
      }
    } catch {
      findings.push({
        check: "schema_migrations",
        severity: "kritisch",
        message: "Tabelle schema_migrations fehlt – dies ist keine wiederherstellte Fahrschul-Datenbank.",
      });
    }

    // ---- Ebene 2: Tabellen ------------------------------------------------
    const vorhandene = await sql<Array<{ tablename: string }>>`
      select tablename from pg_tables where schemaname = 'public'`;
    const tabellen = new Set(vorhandene.map((r) => r.tablename));
    tableCount = tabellen.size;
    const fehlend = REQUIRED_TABLES.filter((t) => !tabellen.has(t));
    if (fehlend.length > 0) {
      findings.push({
        check: "required_tables",
        severity: "kritisch",
        message: `${fehlend.length} erforderliche Tabellen fehlen.`,
        details: { fehlend },
      });
    }

    // ---- Ebene 3: Constraints, Trigger -----------------------------------
    const constraints = await sql<Array<{ tabelle: string; name: string; typ: string }>>`
      select rel.relname as tabelle, con.conname as name, con.contype::text as typ
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
       where ns.nspname = 'public'`;
    const constraintSchluessel = new Set(constraints.map((c) => `${c.tabelle}.${c.name}`));
    const fehlendeConstraints = REQUIRED_CONSTRAINTS.filter((c) => !constraintSchluessel.has(c));
    if (fehlendeConstraints.length > 0) {
      findings.push({
        check: "required_constraints",
        severity: "kritisch",
        message:
          "Non-Negotiable verletzt: EXCLUDE-Constraint(s) gegen Doppelbuchung fehlen in dieser Datenbank.",
        details: { fehlend: fehlendeConstraints },
      });
    }
    // Die EXCLUDE-Constraints müssen auch WIRKLICH vom Typ 'x' sein – ein
    // gleichnamiger Unique-Index wäre nicht dasselbe.
    for (const key of REQUIRED_CONSTRAINTS) {
      const eintrag = constraints.find((c) => `${c.tabelle}.${c.name}` === key);
      if (eintrag && eintrag.typ !== "x") {
        findings.push({
          check: "constraint_type",
          severity: "kritisch",
          message: `${key} existiert, ist aber kein EXCLUDE-Constraint (contype='${eintrag.typ}').`,
        });
      }
    }

    const trigger = await sql<Array<{ name: string }>>`
      select tgname as name from pg_trigger where not tgisinternal`;
    const triggerNamen = new Set(trigger.map((t) => t.name));
    const fehlendeTrigger = REQUIRED_TRIGGERS.filter((t) => !triggerNamen.has(t));
    if (fehlendeTrigger.length > 0) {
      findings.push({
        check: "required_triggers",
        severity: "kritisch",
        message: "Invarianten-/Audit-Trigger fehlen – Constraints greifen nicht.",
        details: { fehlend: fehlendeTrigger },
      });
    }
    // Ein deaktivierter Trigger ist genauso schlimm wie ein fehlender und
    // genau das, was `pg_restore --disable-triggers` hinterlassen kann.
    const deaktiviert = await sql<Array<{ name: string; tabelle: string }>>`
      select t.tgname as name, c.relname as tabelle
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname = 'public' and t.tgenabled = 'D'`;
    if (deaktiviert.length > 0) {
      findings.push({
        check: "disabled_triggers",
        severity: "kritisch",
        message: `${deaktiviert.length} Trigger sind DEAKTIVIERT (tgenabled='D') – Invarianten greifen nicht.`,
        details: { trigger: deaktiviert },
      });
    }

    // ---- Ebene 4: referenzielle Waisen -----------------------------------
    for (const check of ORPHAN_CHECKS) {
      try {
        const [row] = await check.run(sql);
        if (row && row.n > 0) {
          findings.push({
            check: check.name,
            severity: "hoch",
            message: `${row.n} verwaiste Zeilen in ${check.name}.`,
            details: { anzahl: row.n },
          });
        }
      } catch (err) {
        // Eine Prüfung, die selbst scheitert, ist ein Befund – sie darf nicht
        // still ausfallen und den Bericht grün lassen.
        findings.push({
          check: check.name,
          severity: "hoch",
          message: `Prüfung nicht ausführbar: ${(err as Error).message}`,
        });
      }
    }

    // ---- Zeilenzahlen für den Vergleich Quelle/Ziel ------------------------
    for (const tabelle of COUNTED_TABLES) {
      if (!tabellen.has(tabelle)) continue;
      try {
        // `sql(tabelle)` ist postgres.js' BEZEICHNER-Helfer: er zitiert und
        // maskiert den Namen, statt ihn in den Abfragetext zu kleben. Der Wert
        // stammt zusätzlich ausschließlich aus der Konstante COUNTED_TABLES und
        // ist gegen die tatsächlich vorhandenen Tabellen geprüft – aber der
        // Helfer ist der Grund, warum das hier sicher ist, nicht die Konstante.
        const [row] = await sql<Array<{ n: number }>>`
          select count(*)::int as n from ${sql(tabelle)}`;
        rowCounts[tabelle] = row?.n ?? 0;
      } catch {
        rowCounts[tabelle] = -1;
      }
    }
  } finally {
    await sql.end();
  }

  return {
    ok: !findings.some((f) => f.severity === "kritisch" || f.severity === "hoch"),
    checkedAt: new Date().toISOString(),
    database,
    migrationCount,
    latestMigration,
    tableCount,
    rowCounts,
    findings,
    databaseSizeBytes,
  };
}

/**
 * Vergleicht die Zeilenzahlen zweier Berichte. Für den
 * Wiederherstellungstest die eigentliche Aussage: „dieselben Daten", nicht nur
 * „eine funktionierende Datenbank".
 *
 * `toleranz` erlaubt es, Tabellen zu benennen, die zwischen Sicherung und
 * Vergleich wachsen dürfen (die Quelle läuft weiter). Ohne diese Möglichkeit
 * wäre ein Vergleich gegen eine LEBENDE Quelle grundsätzlich rot – und der
 * Test damit wertlos.
 */
export function compareRowCounts(
  quelle: IntegrityReport,
  ziel: IntegrityReport,
  toleranz: readonly string[] = [],
): { gleich: boolean; abweichungen: Array<{ tabelle: string; quelle: number; ziel: number }> } {
  const abweichungen: Array<{ tabelle: string; quelle: number; ziel: number }> = [];
  for (const [tabelle, n] of Object.entries(quelle.rowCounts)) {
    if (toleranz.includes(tabelle)) continue;
    const m = ziel.rowCounts[tabelle];
    if (m !== n) abweichungen.push({ tabelle, quelle: n, ziel: m ?? -1 });
  }
  return { gleich: abweichungen.length === 0, abweichungen };
}
