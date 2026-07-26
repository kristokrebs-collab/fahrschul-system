-- ===========================================================================
-- PROMPT -1 / Phase 3 – Defense in Depth, Beobachtbarkeit, degradierter Betrieb
--
-- Abschnitte: §17 (manipulationssicheres Audit, Brute-Force-Schutz, Step-up),
--             §12 (Upload-Härtung: Prüfsumme, Quarantäne, resumable),
--             §11 (Ausfallsicherheit externer Schnittstellen: Circuit-Breaker-
--                  Zustand, letzter Erfolg, Fehler-/Pufferwarteschlange).
--
-- EXPAND-CONTRACT (§14): ausschließlich ADD COLUMN mit Default/NULL und NEUE
-- Tabellen. Keine Spalte wird umbenannt, entfernt oder verengt. Eine ältere
-- Anwendungsversion läuft mit diesem Schema unverändert weiter.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §17 Manipulationssicheres Audit
--
-- Zwei unabhängige Schichten, weil beide je eine andere Angreiferklasse
-- abdecken:
--
--  1. APPEND-ONLY-WÄCHTER. Zwei Trigger verbieten UPDATE und DELETE auf
--     `audit_events` – für JEDE Rolle, auch für den Eigentümer und für
--     Superuser, solange die Trigger aktiv sind. Ein reines `revoke
--     update, delete` würde beim Tabelleneigentümer (und damit bei genau der
--     Rolle, mit der diese Anwendung verbindet) nicht greifen. Das Kommando
--     `revoke` ist trotzdem dokumentiert (siehe docs/security-architecture.md,
--     "Least Privilege der Datenbankrollen") – es ist die zweite Verteidigung
--     für eine getrennte Anwendungs-/Migrationsrolle im echten Betrieb.
--
--  2. HASH-KETTE. Jede Zeile trägt `row_hash = sha256(Inhalt || prev_hash)`.
--     Damit wird auch eine Manipulation erkannt, die die Trigger umgeht
--     (`alter table ... disable trigger`, Restore einer manipulierten
--     Sicherung, Schreiben auf Dateiebene): der Inhalt passt dann nicht mehr
--     zum gespeicherten Hash, oder ein Vorgänger fehlt.
--
-- BEWUSSTE, DOKUMENTIERTE EINSCHRÄNKUNG (keine Behauptung einer perfekten
-- linearen Kette): `prev_hash` wird OHNE Sperre aus dem zum Insert-Zeitpunkt
-- sichtbaren Kettenkopf gelesen. Zwei gleichzeitige Transaktionen können
-- deshalb denselben Vorgänger referenzieren – die Kette ist ein Baum, keine
-- Linie. Das ist Absicht: die Alternative (Advisory-Lock oder Kopfzeile mit
-- UPDATE ... RETURNING) würde jede auditierte Transaktion serialisieren und
-- damit gegen die bestehenden Nebenläufigkeitszusagen arbeiten (EXCLUDE-
-- Constraint gegen Doppelbuchung, "zwei Schüler nehmen dasselbe Angebot an").
-- Erkannt werden mit dem Baum: (a) jede Änderung an einer Zeile
-- (Inhaltshash), (b) das Löschen jeder Zeile, auf die eine andere zeigt.
-- NICHT erkannt wird das Löschen eines Blattes – dagegen wirkt Schicht 1.
-- ---------------------------------------------------------------------------

alter table audit_events add column chain_seq bigserial;
alter table audit_events add column prev_hash text;
alter table audit_events add column row_hash text;

create unique index audit_events_chain_seq_idx on audit_events(chain_seq);
create index audit_events_row_hash_idx on audit_events(row_hash);

-- Kanonische Serialisierung einer Audit-Zeile. Absichtlich explizit
-- aufgezählt statt `to_jsonb(new)`: eine später hinzugefügte Spalte darf die
-- Hashes bestehender Zeilen nicht rückwirkend ungültig machen (§14).
create or replace function fs_audit_event_canonical(
  p_id uuid, p_type text, p_aktion text, p_entitaet text, p_entitaet_id uuid,
  p_akteur uuid, p_standort uuid, p_source text, p_correlation uuid,
  p_idempotency text, p_vorher jsonb, p_nachher jsonb, p_payload jsonb,
  p_created_at timestamptz
) returns text as $$
  select concat_ws(
    '|',
    p_id::text,
    coalesce(p_type, ''),
    coalesce(p_aktion, ''),
    coalesce(p_entitaet, ''),
    coalesce(p_entitaet_id::text, ''),
    coalesce(p_akteur::text, ''),
    coalesce(p_standort::text, ''),
    coalesce(p_source, ''),
    coalesce(p_correlation::text, ''),
    coalesce(p_idempotency, ''),
    coalesce(p_vorher::text, ''),
    coalesce(p_nachher::text, ''),
    coalesce(p_payload::text, ''),
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
$$ language sql immutable;

create or replace function fs_audit_event_hash_chain() returns trigger as $$
declare
  v_prev text;
begin
  -- Kettenkopf: die zuletzt eingefügte, sichtbare Zeile.
  select row_hash into v_prev
    from audit_events
    where row_hash is not null
    order by chain_seq desc
    limit 1;

  new.prev_hash := v_prev;  -- NULL = Genesis
  new.row_hash := encode(
    digest(
      fs_audit_event_canonical(
        new.id, new.type, new.aktion, new.entitaet, new.entitaet_id,
        new.akteur_benutzer_id, new.standort_id, new.source, new.correlation_id,
        new.idempotency_key, new.vorher, new.nachher, new.payload, new.created_at
      ) || '|' || coalesce(v_prev, 'GENESIS'),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$ language plpgsql;

-- BEFORE INSERT, damit die Werte Teil derselben Zeile sind (kein zweiter
-- Schreibvorgang, der einzeln zurückgerollt werden könnte).
create trigger audit_events_hash_chain_trg
  before insert on audit_events
  for each row execute function fs_audit_event_hash_chain();

create or replace function fs_audit_events_append_only() returns trigger as $$
begin
  raise exception
    'audit_events ist append-only (PROMPT -1 §17): % ist auf dieser Tabelle nicht erlaubt',
    tg_op
    using errcode = 'FS008';
end;
$$ language plpgsql;

create trigger audit_events_no_update_trg
  before update on audit_events
  for each row execute function fs_audit_events_append_only();

create trigger audit_events_no_delete_trg
  before delete on audit_events
  for each row execute function fs_audit_events_append_only();

-- ---------------------------------------------------------------------------
-- §17 Brute-Force-Schutz für die Anmeldung
--
-- Persistiert, NICHT im Prozessspeicher: ein Neustart darf einen laufenden
-- Angriff nicht zurücksetzen. Zwei Geltungsbereiche (`scope`):
--   'account' -> Schlüssel ist die (kleingeschriebene) E-Mail
--   'ip'      -> Schlüssel ist die Client-IP
--
-- Der Kompromiss "Sperre vs. triviale Kontoblockade" ist in
-- docs/security-architecture.md begründet: der Account-Zweig verzögert
-- progressiv und sperrt nur zeitlich begrenzt; die harte, längere Sperre
-- hängt am IP-Zweig. `unlocked_*` protokolliert die Entsperrung.
-- ---------------------------------------------------------------------------
create table auth_throttle (
  scope text not null,
  key text not null,
  failures integer not null default 0,
  first_failure_at timestamptz not null default now(),
  last_failure_at timestamptz not null default now(),
  locked_until timestamptz,
  lock_count integer not null default 0,
  unlocked_at timestamptz,
  unlocked_by_benutzer_id uuid references benutzer(id),
  updated_at timestamptz not null default now(),
  primary key (scope, key),
  constraint auth_throttle_scope_check check (scope in ('account', 'ip'))
);
create index auth_throttle_locked_idx on auth_throttle(locked_until)
  where locked_until is not null;

-- ---------------------------------------------------------------------------
-- §17 Step-up-Authentisierung
--
-- Eine frische Wiederanmeldung wird an der SESSION vermerkt, nicht an einem
-- separaten Token: damit endet sie zwingend mit der Sitzung und kann per
-- `POST /auth/logout-all` sofort entzogen werden.
-- ---------------------------------------------------------------------------
alter table sessions add column step_up_verified_at timestamptz;
alter table sessions add column step_up_scope text;

-- ---------------------------------------------------------------------------
-- §12 Upload-Härtung
--
-- `checksum_sha256`, `groesse_bytes` und `erkannter_mime_typ` sind neu:
-- der zuvor gespeicherte MIME-Typ war der VOM CLIENT BEHAUPTETE. Jetzt wird
-- der tatsächlich erkannte (Magic Bytes) mitgeführt und ist Grundlage der
-- Freigabe.
-- ---------------------------------------------------------------------------
alter table dokumente add column checksum_sha256 text;
alter table dokumente add column groesse_bytes integer;
alter table dokumente add column deklarierter_mime_typ text;
alter table dokumente add column erkannter_mime_typ text;
alter table dokumente add column quarantaene_grund text;
alter table dokumente add column freigegeben_at timestamptz;

-- ---------------------------------------------------------------------------
-- §3/§12 Neue Fachinvariante FS009: "verified" verlangt einen SAUBEREN Scan.
--
-- Ein Dokument darf NIE als geprüft gelten, solange die Virenprüfung nicht
-- sauber durchgelaufen ist. Das ist eine DATENBANKREGEL, nicht nur eine
-- Anwendungsregel: selbst ein fehlerhafter Codepfad oder Roh-SQL kann ein
-- ungescanntes Dokument nicht als geprüft speichern.
--
-- Als TRIGGER und nicht als CHECK-Constraint, aus zwei Gründen:
--  1. Konsistenz: FS001–FS007 sind ebenfalls Trigger mit eigenem SQLSTATE.
--     Ein Aufrufer klassifiziert Fachverstöße über den SQLSTATE
--     (packages/events/src/retry.ts, BUSINESS_SQLSTATE) – ein anonymer
--     CHECK-Verstoß (23514) wäre dort nicht unterscheidbar.
--  2. Reihenfolge: der Name beginnt mit `c`, damit er NACH
--     `dokumente_a_status_sync_trg` (FS007, unzulässiger Übergang) und
--     `dokumente_b_pruefprotokoll_trg` (FS006, fehlendes Prüfprotokoll)
--     feuert. Ein Aufrufer bekommt so weiterhin den spezifischsten Fehler.
-- ---------------------------------------------------------------------------
create or replace function fs_dokument_scan_pflicht() returns trigger as $$
begin
  if new.dokument_status = 'verified'
     and (old.dokument_status is null or old.dokument_status <> 'verified')
     and coalesce(new.scan_status, '') <> 'sauber' then
    raise exception
      'Dokument % kann nicht als geprüft gelten: Virenprüfung ist "%" statt "sauber"',
      new.id, coalesce(new.scan_status, 'unbekannt')
      using errcode = 'FS009';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger dokumente_c_scan_pflicht_trg
  before insert or update on dokumente
  for each row execute function fs_dokument_scan_pflicht();

/**
 * Resumable Uploads. Der Upload landet in Teilstücken; erst wenn alle
 * Teilstücke da sind und Größe/Prüfsumme stimmen, entsteht ein
 * `dokumente`-Datensatz (in Quarantäne). Abgebrochene Sitzungen werden vom
 * Job `uploads.cleanup` entfernt – "keine verwaisten Teil-Uploads".
 */
create table upload_sessions (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  benutzer_id uuid not null references benutzer(id) on delete cascade,
  schueler_id uuid references schueler(id),
  typ text not null,
  dateiname text not null,
  deklarierter_mime_typ text,
  erwartete_groesse_bytes integer not null,
  empfangene_bytes integer not null default 0,
  /** Vom Client angekündigte Prüfsumme (optional; wird gegengeprüft). */
  erwartete_checksum_sha256 text,
  /** Tatsächlich berechnete Prüfsumme nach dem Zusammensetzen. */
  checksum_sha256 text,
  status text not null default 'offen',
  idempotency_key text,
  /** Teilstücke: [{index, bytes, sha256}] – nur Metadaten, kein Inhalt. */
  teile jsonb not null default '[]'::jsonb,
  /** Referenz des Storage-Adapters auf den zusammengesetzten Inhalt. */
  speicher_referenz text,
  dokument_id uuid references dokumente(id),
  fehler text,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upload_sessions_status_check
    check (status in ('offen', 'vollstaendig', 'freigegeben', 'abgebrochen', 'abgelaufen')),
  constraint upload_sessions_groesse_check check (erwartete_groesse_bytes > 0)
);
create index upload_sessions_benutzer_idx on upload_sessions(benutzer_id, status);
create index upload_sessions_expiry_idx on upload_sessions(expires_at) where status = 'offen';

-- ---------------------------------------------------------------------------
-- §11 Ausfallsicherheit externer Schnittstellen
--
-- `integration_health` ist der PERSISTIERTE Circuit-Breaker-Zustand. Warum
-- nicht nur im Prozessspeicher? Weil §11 "Gesundheitsstatus" und "Zeitpunkt
-- der letzten erfolgreichen Synchronisation" als sichtbare Betriebsangaben
-- verlangt – die dürfen einen Neustart überleben, sonst zeigt die
-- Betriebsoberfläche nach jedem Deployment "alles gut".
-- ---------------------------------------------------------------------------
create table integration_health (
  integration text primary key,
  mode text not null default 'mock',
  /** closed | open | half_open */
  breaker_state text not null default 'closed',
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  opened_at timestamptz,
  /** Frühester Zeitpunkt für eine Sondierung (half-open). */
  probe_after timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_error_class text,
  /** Vom Anbieter gemeldete Rate-Limit-Sperre (Retry-After). */
  rate_limited_until timestamptz,
  total_calls bigint not null default 0,
  total_failures bigint not null default 0,
  total_short_circuited bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint integration_health_breaker_check
    check (breaker_state in ('closed', 'open', 'half_open')),
  constraint integration_health_mode_check check (mode in ('mock', 'sandbox', 'live'))
);

/**
 * Puffer + Fehlerwarteschlange für ausgehende Aufrufe. Fällt ein externes
 * System aus, wird die Änderung hier GEPUFFERT (Status 'buffered') statt
 * verloren zu gehen oder einen falschen Erfolg zu melden. `idempotency_key`
 * ist der Schlüssel, den der ausgehende Aufruf trägt – ein Wiederaufsetzen
 * darf beim Zielsystem nicht doppelt wirken.
 */
create table integration_outbound_calls (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  operation text not null,
  /** Idempotenzschlüssel des AUSGEHENDEN Aufrufs (§11). */
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'buffered',
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_error_class text,
  correlation_id uuid,
  standort_id uuid references standorte(id),
  akteur_benutzer_id uuid references benutzer(id),
  resolved_at timestamptz,
  resolved_by_benutzer_id uuid references benutzer(id),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_outbound_status_check
    check (status in ('buffered', 'in_flight', 'succeeded', 'failed', 'abandoned')),
  unique (integration, operation, idempotency_key)
);
create index integration_outbound_pending_idx
  on integration_outbound_calls(integration, next_attempt_at)
  where status in ('buffered', 'in_flight');
create index integration_outbound_failed_idx
  on integration_outbound_calls(integration, created_at)
  where status = 'failed';

-- Die neun Integrationen aus docs/integration-gaps.md als Startbestand.
-- Alle im mock-Modus, Breaker geschlossen – ehrlicher Ausgangszustand.
insert into integration_health (integration, mode) values
  ('notifications', 'mock'),
  ('calendar', 'mock'),
  ('bank', 'mock'),
  ('storage', 'mock'),
  ('crm', 'mock'),
  ('malware-scan', 'mock'),
  ('payments', 'mock'),
  ('transcription', 'mock'),
  ('ai-suggestions', 'mock'),
  ('fahrschulverwaltung', 'mock')
on conflict (integration) do nothing;
