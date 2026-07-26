-- 0007_reliability_core.sql
-- PROMPT -1 / Phase 1: VERBINDLICHE SYNCHRONISATIONS-, AUSFALL- UND
-- SICHERHEITSARCHITEKTUR – Zuverlässigkeitskern (Backend).
--
-- Umfang dieser Migration:
--   §2  generische Idempotenz-Tabelle für alle kritischen Schreibvorgänge
--   §3  restliche DB-Invarianten als echte Constraints/Trigger
--   §4  Versions-/updated_at-Automatik als Basis für optimistische Sperren
--   §5  transaktionaler Outbox + Consumer-Inbox + Cursor
--   §10 vier persistierte State Machines mit den EXAKTEN Zustandsmengen
--   §13 persistenter Job-Store mit Lease/Heartbeat + Dead-Letter-Queue
--   §19 Läufe/Befunde der täglichen Konsistenzprüfung
--
-- EXPAND-CONTRACT (§14): Diese Migration ist rein additiv. Kein bestehender
-- Spaltenname/Typ wird geändert oder entfernt, damit apps/student,
-- apps/office, apps/instructor und apps/finance während des Rollouts
-- unverändert weiterlesen können. Die neuen State-Machine-Spalten
-- (`angebot_status`, `dokument_status`, `zahlung_status`, `mangel_status`)
-- sind die neue Quelle der Wahrheit; die alten `status`-Spalten werden per
-- Trigger BEIDSEITIG synchron gehalten (neuer Code schreibt die neue Spalte,
-- Alt-Code die alte). Die CONTRACT-Phase (Entfernen der Alt-Spalten) ist
-- bewusst NICHT Teil dieser Migration.

-- ===========================================================================
-- §2  Idempotenz für jeden kritischen Schreibvorgang
-- ===========================================================================
-- Ein Mechanismus für ALLE Operationen (kein per-Route-Sonderweg mehr).
-- `operation` + `key` ist eindeutig; `request_hash` erkennt denselben
-- Schlüssel mit ABWEICHENDEM Body (-> HTTP 409, siehe
-- apps/api/src/lib/idempotency.ts). Ergebnis (`response_status`/
-- `response_body`) wird gespeichert, damit ein Retry exakt dieselbe Antwort
-- ohne erneute Ausführung erhält.
create table idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  key text not null,
  benutzer_id uuid references benutzer(id),
  standort_id uuid references standorte(id),
  request_hash text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  entitaet text,
  entitaet_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation, key)
);
create index idempotency_keys_expires_idx on idempotency_keys(expires_at);
create index idempotency_keys_benutzer_idx on idempotency_keys(benutzer_id);

-- ===========================================================================
-- §5  Transaktionaler Outbox + Consumer-Inbox + Cursor
-- ===========================================================================
-- Versionierung der Ereignis-Schemata. Nur Ereignistypen, die HIER eingetragen
-- sind, werden in die Outbox gespiegelt – reine Sicherheits-/Verwaltungs-
-- Audits (login, logout, ...) bleiben ausschließlich in audit_events.
-- Rückwärtskompatibilität: eine neue Version eines Ereignistyps erhöht
-- `version`; Konsumenten MÜSSEN kleinere Versionen weiter verarbeiten
-- (siehe docs/sync-architecture.md "Ereignisversionierung").
create table event_schema_versions (
  event_type text primary key,
  version integer not null default 1,
  beschreibung text,
  created_at timestamptz not null default now()
);

insert into event_schema_versions (event_type, version) values
  ('lead.created', 1),
  ('student.enrolled', 1),
  ('availability.updated', 1),
  ('lesson.offer.created', 1),
  ('lesson.offer.accepted', 1),
  ('lesson.offer.declined', 1),
  ('lesson.offer.expired', 1),
  ('lesson.booked', 1),
  ('lesson.cancelled', 1),
  ('lesson.started', 1),
  ('lesson.completed', 1),
  ('document.submitted', 1),
  ('document.verified', 1),
  ('document.rejected', 1),
  ('document.reuploaded', 1),
  ('document.quarantined', 1),
  ('exam.clearance.granted', 1),
  ('exam.registered', 1),
  ('invoice.issued', 1),
  ('invoice.inquiry.raised', 1),
  ('payment.matched', 1),
  ('payment.reversed', 1),
  ('feedback.given', 1),
  ('feedback.self_assessment.set', 1),
  ('flex.opt_in', 1),
  ('flex.offer.accepted', 1),
  ('vehicle_issue.reported', 1),
  ('vehicle.blocked', 1),
  ('voice_log.confirmed', 1),
  ('competency.observed', 1),
  ('communication.message_sent', 1),
  ('export.requested', 1),
  ('export.downloaded', 1);

-- Die Outbox-Zeile entsteht in DERSELBEN Transaktion wie die fachliche
-- Änderung – erzwungen durch einen Trigger auf audit_events (siehe unten),
-- damit das verbotene Muster "DB geändert und danach hoffentlich Nachricht
-- gesendet" strukturell unmöglich ist: es gibt keinen Codepfad, der ein
-- Ereignis schreibt, ohne die Outbox-Zeile mitzucommitten.
create table event_outbox (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null unique,
  audit_event_id uuid not null references audit_events(id) on delete cascade,
  event_type text not null,
  event_version integer not null default 1,
  aggregate_type text,
  aggregate_id uuid,
  correlation_id uuid,
  standort_id uuid references standorte(id),
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'in_flight', 'delivered', 'dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  error_class text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_outbox_ready_idx on event_outbox(status, next_attempt_at, seq);
create index event_outbox_lease_idx on event_outbox(status, lease_expires_at);
create index event_outbox_type_idx on event_outbox(event_type);

-- Consumer-Inbox: verarbeitete Ereignis-IDs pro Konsument. Der Unique-Index
-- IST die Deduplizierung – ein zweiter Zustellversuch desselben Ereignisses
-- an denselben Konsumenten schlägt beim Insert fehl und wird als "bereits
-- verarbeitet" behandelt (at-least-once-Zustellung, effektiv exactly-once
-- Verarbeitung).
create table event_inbox (
  id uuid primary key default gen_random_uuid(),
  consumer text not null,
  event_id uuid not null,
  event_type text not null,
  event_version integer not null default 1,
  outcome text not null default 'processed'
    check (outcome in ('processed', 'skipped', 'failed')),
  result jsonb,
  processed_at timestamptz not null default now(),
  unique (consumer, event_id)
);
create index event_inbox_consumer_idx on event_inbox(consumer, processed_at);

-- Cursor je Konsument: bis zu welcher Outbox-Sequenznummer wurde zugestellt.
-- Erlaubt Wiederaufnahme nach Neustart ohne die gesamte Inbox zu scannen.
create table event_cursors (
  consumer text primary key,
  last_seq bigint not null default 0,
  last_event_id uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Der Outbox-Trigger: JEDES fachliche Audit-Ereignis erzeugt atomar eine
-- Outbox-Zeile. Kein Anwendungscode kann das umgehen.
-- ---------------------------------------------------------------------------
create or replace function fs_audit_event_to_outbox() returns trigger as $$
declare
  v_version integer;
begin
  select version into v_version from event_schema_versions where event_type = new.type;
  if v_version is null then
    -- Kein fachliches Ereignis (z. B. login/logout/role.changed): bleibt
    -- reines Sicherheits-Audit, wird nicht zugestellt.
    return new;
  end if;

  insert into event_outbox (
    audit_event_id, event_type, event_version, aggregate_type, aggregate_id,
    correlation_id, standort_id, payload
  ) values (
    new.id, new.type, v_version, new.entitaet, new.entitaet_id,
    new.correlation_id, new.standort_id,
    jsonb_build_object(
      'aktion', new.aktion,
      'entitaet', new.entitaet,
      'entitaetId', new.entitaet_id,
      'akteurBenutzerId', new.akteur_benutzer_id,
      'source', new.source,
      'idempotencyKey', new.idempotency_key,
      'occurredAt', new.created_at,
      'payload', new.payload
    )
  );
  return new;
end;
$$ language plpgsql;

create trigger audit_events_outbox_trg
  after insert on audit_events
  for each row execute function fs_audit_event_to_outbox();

-- ===========================================================================
-- §13 Persistenter Job-Store (Lease/Lock + Ablauf, Heartbeat, Max-Laufzeit,
--     gespeichertes Ergebnis/Fehler) + Dead-Letter-Queue (§9 Serverseite)
-- ===========================================================================
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  -- Idempotente Einplanung: derselbe dedupe_key darf nur EINEN nicht
  -- abgeschlossenen Job haben (partieller Unique-Index unten).
  dedupe_key text,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'in_flight', 'succeeded', 'failed', 'dead', 'cancelled')),
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  max_runtime_seconds integer not null default 60,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  last_error text,
  error_class text,
  correlation_id uuid,
  standort_id uuid references standorte(id),
  akteur_benutzer_id uuid references benutzer(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs(status, run_at, priority);
create index jobs_lease_idx on jobs(status, lease_expires_at);
create index jobs_type_idx on jobs(job_type, status);
create unique index jobs_dedupe_active_idx
  on jobs (job_type, dedupe_key)
  where dedupe_key is not null and status in ('pending', 'in_flight');

-- Dead-Letter-Queue: nach Erschöpfung der Versuche ODER bei einem dauerhaften
-- (nicht wiederholbaren) Fehler. Enthält vollen Audit-Kontext und einen
-- manuellen Wiederaufnahmepfad (`resumed_at`/`resumed_job_id`).
create table dead_letters (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('job', 'outbox')),
  source_id uuid not null,
  kind text not null,               -- job_type bzw. event_type
  payload jsonb not null default '{}',
  attempts integer not null default 0,
  error_class text,
  last_error text,
  audit_kontext jsonb not null default '{}',
  alarm_emitted_at timestamptz,
  resumed_at timestamptz,
  resumed_by_benutzer_id uuid references benutzer(id),
  resumed_job_id uuid,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);
create index dead_letters_open_idx on dead_letters(resumed_at, created_at);

-- ===========================================================================
-- §10 Vier persistierte State Machines + auditiertes Übergangsprotokoll
-- ===========================================================================
-- Jeder Übergang landet hier – auch der eines Roh-SQL-Schreibvorgangs, weil
-- das Protokoll per Trigger geschrieben wird, nicht im Anwendungscode.
-- `akteur_benutzer_id` kommt aus der Sitzungsvariablen
-- `fahrschul.akteur_benutzer_id`, die apps/api pro Transaktion setzt
-- (siehe apps/api/src/lib/state-machine.ts).
create table state_transitions (
  id uuid primary key default gen_random_uuid(),
  machine text not null
    check (machine in ('terminangebot', 'dokument', 'zahlung', 'fahrzeugmangel')),
  entitaet_id uuid not null,
  von_status text,
  nach_status text not null,
  akteur_benutzer_id uuid references benutzer(id),
  grund text,
  correlation_id uuid,
  quelle text,
  created_at timestamptz not null default now()
);
create index state_transitions_entity_idx on state_transitions(machine, entitaet_id, created_at);

-- Erlaubte Übergänge als DATEN (nicht als Code), damit die Datenbank selbst
-- die Allow-List durchsetzt und Phase 2/3 sie ohne Migration erweitern kann.
-- Spiegelbild von packages/domain/src/statemachines.ts (dort mit
-- Rollenprüfung; hier ohne, als Verteidigung in der Tiefe).
create table state_machine_transitions (
  machine text not null,
  von_status text not null,
  nach_status text not null,
  primary key (machine, von_status, nach_status)
);

insert into state_machine_transitions (machine, von_status, nach_status) values
  -- Terminangebot: created, sent, delivered, accepted, booking_pending,
  -- confirmed, rejected, expired, cancelled, failed_review
  ('terminangebot', 'created', 'sent'),
  ('terminangebot', 'created', 'cancelled'),
  ('terminangebot', 'created', 'expired'),
  ('terminangebot', 'created', 'failed_review'),
  ('terminangebot', 'sent', 'delivered'),
  ('terminangebot', 'sent', 'accepted'),
  ('terminangebot', 'sent', 'rejected'),
  ('terminangebot', 'sent', 'expired'),
  ('terminangebot', 'sent', 'cancelled'),
  ('terminangebot', 'sent', 'failed_review'),
  ('terminangebot', 'delivered', 'accepted'),
  ('terminangebot', 'delivered', 'rejected'),
  ('terminangebot', 'delivered', 'expired'),
  ('terminangebot', 'delivered', 'cancelled'),
  ('terminangebot', 'accepted', 'booking_pending'),
  ('terminangebot', 'accepted', 'failed_review'),
  ('terminangebot', 'accepted', 'cancelled'),
  ('terminangebot', 'booking_pending', 'confirmed'),
  ('terminangebot', 'booking_pending', 'failed_review'),
  ('terminangebot', 'booking_pending', 'cancelled'),
  ('terminangebot', 'confirmed', 'cancelled'),
  ('terminangebot', 'rejected', 'sent'),
  ('terminangebot', 'rejected', 'expired'),
  ('terminangebot', 'rejected', 'cancelled'),
  ('terminangebot', 'failed_review', 'sent'),
  ('terminangebot', 'failed_review', 'cancelled'),
  -- Dokument: uploaded, quarantined, scanning, submitted, in_review,
  -- verified, rejected, expired, deleted
  ('dokument', 'uploaded', 'scanning'),
  ('dokument', 'uploaded', 'quarantined'),
  ('dokument', 'uploaded', 'deleted'),
  ('dokument', 'scanning', 'submitted'),
  ('dokument', 'scanning', 'quarantined'),
  ('dokument', 'scanning', 'deleted'),
  ('dokument', 'quarantined', 'scanning'),
  ('dokument', 'quarantined', 'deleted'),
  ('dokument', 'submitted', 'in_review'),
  ('dokument', 'submitted', 'quarantined'),
  ('dokument', 'submitted', 'expired'),
  ('dokument', 'submitted', 'deleted'),
  ('dokument', 'in_review', 'verified'),
  ('dokument', 'in_review', 'rejected'),
  ('dokument', 'in_review', 'expired'),
  ('dokument', 'in_review', 'deleted'),
  ('dokument', 'verified', 'expired'),
  ('dokument', 'verified', 'deleted'),
  ('dokument', 'rejected', 'in_review'),
  ('dokument', 'rejected', 'deleted'),
  ('dokument', 'expired', 'deleted'),
  -- Zahlung (Zahlungseingang/Banktransaktion): imported, matching,
  -- suggested, review_required, matched, partially_matched, reversed, failed
  ('zahlung', 'imported', 'matching'),
  ('zahlung', 'imported', 'failed'),
  ('zahlung', 'matching', 'suggested'),
  ('zahlung', 'matching', 'review_required'),
  ('zahlung', 'matching', 'matched'),
  ('zahlung', 'matching', 'partially_matched'),
  ('zahlung', 'matching', 'failed'),
  ('zahlung', 'suggested', 'matched'),
  ('zahlung', 'suggested', 'partially_matched'),
  ('zahlung', 'suggested', 'review_required'),
  ('zahlung', 'suggested', 'failed'),
  ('zahlung', 'review_required', 'matched'),
  ('zahlung', 'review_required', 'partially_matched'),
  ('zahlung', 'review_required', 'failed'),
  ('zahlung', 'matched', 'reversed'),
  ('zahlung', 'partially_matched', 'matched'),
  ('zahlung', 'partially_matched', 'review_required'),
  ('zahlung', 'partially_matched', 'reversed'),
  ('zahlung', 'reversed', 'matching'),
  ('zahlung', 'failed', 'matching'),
  -- Fahrzeugmangel: reported, triaged, vehicle_blocked,
  -- replacement_pending, resolved, reopened
  ('fahrzeugmangel', 'reported', 'triaged'),
  ('fahrzeugmangel', 'reported', 'vehicle_blocked'),
  ('fahrzeugmangel', 'reported', 'resolved'),
  ('fahrzeugmangel', 'triaged', 'vehicle_blocked'),
  ('fahrzeugmangel', 'triaged', 'replacement_pending'),
  ('fahrzeugmangel', 'triaged', 'resolved'),
  ('fahrzeugmangel', 'vehicle_blocked', 'replacement_pending'),
  ('fahrzeugmangel', 'vehicle_blocked', 'resolved'),
  ('fahrzeugmangel', 'replacement_pending', 'vehicle_blocked'),
  ('fahrzeugmangel', 'replacement_pending', 'resolved'),
  ('fahrzeugmangel', 'resolved', 'reopened'),
  ('fahrzeugmangel', 'reopened', 'triaged'),
  ('fahrzeugmangel', 'reopened', 'vehicle_blocked'),
  ('fahrzeugmangel', 'reopened', 'replacement_pending'),
  ('fahrzeugmangel', 'reopened', 'resolved');

-- ---------------------------------------------------------------------------
-- Neue State-Machine-Spalten (EXAKTE Zustandsmengen aus §10).
--
-- Der Spalten-DEFAULT ist bewusst der Sentinel '__legacy__': damit kann der
-- Synchronisations-Trigger unterscheiden, ob ein Schreibvorgang die NEUE
-- Spalte gesetzt hat (dann ist sie die Quelle der Wahrheit und die alte
-- `status`-Spalte wird abgeleitet) oder ob es ein Alt-/Roh-SQL-Pfad ist, der
-- nur `status` kennt (dann wird die neue Spalte aus `status` abgeleitet).
-- Der Sentinel wird NIE persistiert – der BEFORE-Trigger ersetzt ihn immer,
-- bevor die CHECK-Constraint ausgewertet wird.
-- ---------------------------------------------------------------------------
alter table terminangebote
  add column angebot_status text not null default '__legacy__'
    check (angebot_status in (
      'created', 'sent', 'delivered', 'accepted', 'booking_pending',
      'confirmed', 'rejected', 'expired', 'cancelled', 'failed_review'
    ));

alter table dokumente
  add column dokument_status text not null default '__legacy__'
    check (dokument_status in (
      'uploaded', 'quarantined', 'scanning', 'submitted', 'in_review',
      'verified', 'rejected', 'expired', 'deleted'
    )),
  add column pruefprotokoll jsonb,
  add column geprueft_durch_benutzer_id uuid references benutzer(id),
  add column geprueft_at timestamptz;

alter table banktransaktionen
  add column zahlung_status text not null default '__legacy__'
    check (zahlung_status in (
      'imported', 'matching', 'suggested', 'review_required', 'matched',
      'partially_matched', 'reversed', 'failed'
    ));

alter table fahrzeugmaengel
  add column mangel_status text not null default '__legacy__'
    check (mangel_status in (
      'reported', 'triaged', 'vehicle_blocked', 'replacement_pending',
      'resolved', 'reopened'
    ));

-- Datenmigration der Bestandszeilen gemäß dokumentiertem Mapping
-- (docs/sync-architecture.md "§10 Zustandsabbildung").
update terminangebote set angebot_status = case status
  when 'offen' then 'sent'
  when 'gebucht' then 'confirmed'
  when 'abgelehnt' then 'rejected'
  when 'abgelaufen' then 'expired'
  when 'storniert' then 'cancelled'
  else 'created' end;

update dokumente set dokument_status = case status
  when 'eingereicht' then 'submitted'
  when 'geprueft' then 'verified'
  when 'abgelehnt' then 'rejected'
  else 'uploaded' end;

update banktransaktionen set zahlung_status = case status
  when 'gebucht' then 'matched'
  when 'abgelehnt' then 'failed'
  when 'ignoriert' then 'failed'
  else 'imported' end;

update fahrzeugmaengel set mangel_status = case status
  when 'behoben' then 'resolved'
  else 'reported' end;

-- ---------------------------------------------------------------------------
-- Bidirektionale Synchronisation neue <-> alte Statusspalte + Durchsetzung
-- der Allow-List + Protokollierung. Ein Trigger pro Tabelle, aber eine
-- gemeinsame Hilfsfunktion für Allow-List/Protokoll.
-- ---------------------------------------------------------------------------
create or replace function fs_assert_transition(
  p_machine text, p_entity uuid, p_from text, p_to text, p_quelle text
) returns void as $$
declare
  v_akteur uuid;
  v_ok boolean;
begin
  if p_from is null or p_from = p_to then
    return;
  end if;
  select true into v_ok from state_machine_transitions
    where machine = p_machine and von_status = p_from and nach_status = p_to;
  if v_ok is not true then
    raise exception 'Ungültiger Übergang %: % -> %', p_machine, p_from, p_to
      using errcode = 'FS007';
  end if;
  begin
    v_akteur := nullif(current_setting('fahrschul.akteur_benutzer_id', true), '')::uuid;
  exception when others then
    v_akteur := null;
  end;
  -- clock_timestamp() statt now(): mehrere Übergänge INNERHALB einer
  -- Transaktion (z. B. accepted -> booking_pending -> confirmed) müssen
  -- unterscheidbar geordnet bleiben; now() wäre für alle identisch.
  insert into state_transitions (machine, entitaet_id, von_status, nach_status, akteur_benutzer_id, grund, quelle, created_at)
  values (
    p_machine, p_entity, p_from, p_to, v_akteur,
    nullif(current_setting('fahrschul.transition_grund', true), ''),
    p_quelle, clock_timestamp()
  );
end;
$$ language plpgsql;

-- Terminangebot -------------------------------------------------------------
create or replace function fs_terminangebot_legacy(p text) returns text as $$
  select case p
    when 'created' then 'offen'
    when 'sent' then 'offen'
    when 'delivered' then 'offen'
    when 'accepted' then 'gebucht'
    when 'booking_pending' then 'gebucht'
    when 'confirmed' then 'gebucht'
    when 'rejected' then 'abgelehnt'
    when 'expired' then 'abgelaufen'
    when 'cancelled' then 'storniert'
    when 'failed_review' then 'pruefung_erforderlich'
  end;
$$ language sql immutable;

create or replace function fs_terminangebot_reverse(p_legacy text, p_current text) returns text as $$
  select case p_legacy
    when 'gebucht' then 'confirmed'
    when 'abgelehnt' then 'rejected'
    when 'abgelaufen' then 'expired'
    when 'storniert' then 'cancelled'
    when 'offen' then coalesce(p_current, 'created')
    else coalesce(p_current, 'created') end;
$$ language sql immutable;

create or replace function fs_terminangebot_status_sync() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.angebot_status = '__legacy__' then
      -- Alt-/Roh-SQL-Pfad: nur `status` gesetzt -> neue Spalte ableiten.
      new.angebot_status := fs_terminangebot_reverse(new.status, 'created');
    else
      new.status := fs_terminangebot_legacy(new.angebot_status);
    end if;
    return new;
  end if;

  if new.angebot_status is distinct from old.angebot_status then
    perform fs_assert_transition('terminangebot', new.id, old.angebot_status, new.angebot_status, 'db:trigger');
    new.status := fs_terminangebot_legacy(new.angebot_status);
  elsif new.status is distinct from old.status then
    -- Alt-Pfad schreibt nur `status`: neue Spalte nachziehen (mit Allow-List).
    new.angebot_status := fs_terminangebot_reverse(new.status, old.angebot_status);
    if new.angebot_status is distinct from old.angebot_status then
      perform fs_assert_transition('terminangebot', new.id, old.angebot_status, new.angebot_status, 'db:legacy-status');
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger terminangebote_a_status_sync_trg
  before insert or update on terminangebote
  for each row execute function fs_terminangebot_status_sync();

-- Dokument ------------------------------------------------------------------
create or replace function fs_dokument_legacy(p text) returns text as $$
  select case p
    when 'uploaded' then 'hochgeladen'
    when 'quarantined' then 'quarantaene'
    when 'scanning' then 'pruefung_laeuft'
    when 'submitted' then 'eingereicht'
    when 'in_review' then 'in_pruefung'
    when 'verified' then 'geprueft'
    when 'rejected' then 'abgelehnt'
    when 'expired' then 'abgelaufen'
    when 'deleted' then 'geloescht'
  end;
$$ language sql immutable;

create or replace function fs_dokument_reverse(p_legacy text, p_current text) returns text as $$
  select case p_legacy
    when 'eingereicht' then 'submitted'
    when 'geprueft' then 'verified'
    when 'abgelehnt' then 'rejected'
    when 'in_pruefung' then 'in_review'
    when 'quarantaene' then 'quarantined'
    when 'pruefung_laeuft' then 'scanning'
    when 'hochgeladen' then 'uploaded'
    when 'abgelaufen' then 'expired'
    when 'geloescht' then 'deleted'
    else coalesce(p_current, 'uploaded') end;
$$ language sql immutable;

create or replace function fs_dokument_status_sync() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.dokument_status = '__legacy__' then
      new.dokument_status := fs_dokument_reverse(new.status, 'uploaded');
    else
      new.status := fs_dokument_legacy(new.dokument_status);
    end if;
    return new;
  end if;

  if new.dokument_status is distinct from old.dokument_status then
    perform fs_assert_transition('dokument', new.id, old.dokument_status, new.dokument_status, 'db:trigger');
    new.status := fs_dokument_legacy(new.dokument_status);
  elsif new.status is distinct from old.status then
    new.dokument_status := fs_dokument_reverse(new.status, old.dokument_status);
    if new.dokument_status is distinct from old.dokument_status then
      perform fs_assert_transition('dokument', new.id, old.dokument_status, new.dokument_status, 'db:legacy-status');
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger dokumente_a_status_sync_trg
  before insert or update on dokumente
  for each row execute function fs_dokument_status_sync();

-- §3: Dokumentstatus "verified"/"rejected" NUR mit Prüfprotokoll. Damit ist
-- der §19-Befund "Dokumentstatus ohne Prüfprotokoll" auf DB-Ebene verhindert
-- statt nur berichtet.
create or replace function fs_dokument_pruefprotokoll_pflicht() returns trigger as $$
begin
  if new.dokument_status in ('verified', 'rejected')
     and (old.dokument_status is null or old.dokument_status not in ('verified', 'rejected'))
     and (new.pruefprotokoll is null or new.geprueft_durch_benutzer_id is null) then
    raise exception 'Dokumentstatus % erfordert ein Prüfprotokoll und einen Prüfer', new.dokument_status
      using errcode = 'FS006';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger dokumente_b_pruefprotokoll_trg
  before update on dokumente
  for each row execute function fs_dokument_pruefprotokoll_pflicht();

-- Zahlung -------------------------------------------------------------------
create or replace function fs_zahlung_legacy(p text) returns text as $$
  select case p
    when 'imported' then 'offen'
    when 'matching' then 'offen'
    when 'suggested' then 'offen'
    when 'review_required' then 'offen'
    when 'matched' then 'gebucht'
    when 'partially_matched' then 'offen'
    when 'reversed' then 'abgelehnt'
    when 'failed' then 'abgelehnt'
  end;
$$ language sql immutable;

create or replace function fs_zahlung_reverse(p_legacy text, p_current text) returns text as $$
  select case p_legacy
    when 'gebucht' then 'matched'
    when 'abgelehnt' then 'failed'
    when 'ignoriert' then 'failed'
    when 'offen' then coalesce(p_current, 'imported')
    else coalesce(p_current, 'imported') end;
$$ language sql immutable;

create or replace function fs_zahlung_status_sync() returns trigger as $$
declare
  v_next text;
begin
  if tg_op = 'INSERT' then
    if new.zahlung_status = '__legacy__' then
      new.zahlung_status := fs_zahlung_reverse(new.status, 'imported');
    else
      new.status := fs_zahlung_legacy(new.zahlung_status);
    end if;
    return new;
  end if;

  if new.zahlung_status is distinct from old.zahlung_status then
    v_next := new.zahlung_status;
  elsif new.status is distinct from old.status then
    v_next := fs_zahlung_reverse(new.status, old.zahlung_status);
  else
    return new;
  end if;

  if v_next is distinct from old.zahlung_status then
    -- §3: eine Banktransaktion darf nicht ZWEIMAL vollständig zugeordnet
    -- werden. Aus 'matched' führt einzig 'reversed' heraus – jeder andere
    -- Versuch, sie erneut zuzuordnen, wird mit dem spezifischen Fehlercode
    -- FS003 abgelehnt (vor der generischen Allow-List-Prüfung, damit
    -- apps/api die Ursache genau benennen kann).
    if old.zahlung_status = 'matched' and v_next <> 'reversed' then
      raise exception 'Banktransaktion % ist bereits vollständig zugeordnet', new.id
        using errcode = 'FS003';
    end if;
    perform fs_assert_transition('zahlung', new.id, old.zahlung_status, v_next, 'db:trigger');
  end if;
  new.zahlung_status := v_next;
  new.status := fs_zahlung_legacy(v_next);
  return new;
end;
$$ language plpgsql;

create trigger banktransaktionen_a_status_sync_trg
  before insert or update on banktransaktionen
  for each row execute function fs_zahlung_status_sync();

-- Fahrzeugmangel ------------------------------------------------------------
create or replace function fs_fahrzeugmangel_legacy(p text) returns text as $$
  select case when p = 'resolved' then 'behoben' else 'offen' end;
$$ language sql immutable;

create or replace function fs_fahrzeugmangel_status_sync() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.mangel_status = '__legacy__' then
      new.mangel_status := case new.status when 'behoben' then 'resolved' else 'reported' end;
    else
      new.status := fs_fahrzeugmangel_legacy(new.mangel_status);
    end if;
    return new;
  end if;

  if new.mangel_status is distinct from old.mangel_status then
    perform fs_assert_transition('fahrzeugmangel', new.id, old.mangel_status, new.mangel_status, 'db:trigger');
    new.status := fs_fahrzeugmangel_legacy(new.mangel_status);
  elsif new.status is distinct from old.status then
    new.mangel_status := case new.status
      when 'behoben' then 'resolved'
      when 'offen' then case when old.mangel_status = 'resolved' then 'reopened' else old.mangel_status end
      else old.mangel_status end;
    if new.mangel_status is distinct from old.mangel_status then
      perform fs_assert_transition('fahrzeugmangel', new.id, old.mangel_status, new.mangel_status, 'db:legacy-status');
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger fahrzeugmaengel_a_status_sync_trg
  before insert or update on fahrzeugmaengel
  for each row execute function fs_fahrzeugmangel_status_sync();

-- ===========================================================================
-- §4  Optimistische Sperren: version/updated_at werden bei JEDEM Update
--     automatisch fortgeschrieben, damit kein Codepfad die Erkennung
--     veralteter Schreibvorgänge umgehen kann.
-- ===========================================================================
create or replace function fs_bump_version() returns trigger as $$
begin
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  if new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

-- Trigger-Namen sind mit _a_/_b_/_z_ präfigiert, weil PostgreSQL Trigger
-- derselben Phase in ALPHABETISCHER Reihenfolge feuert: die Statussynchronisation
-- (_a_) muss vor den Invarianten-Wächtern (_b_) laufen, die Versionsfortschreibung
-- (_z_) zuletzt.
create trigger verfuegbarkeiten_z_version_trg before update on verfuegbarkeiten
  for each row execute function fs_bump_version();
create trigger schueler_verfuegbarkeiten_z_version_trg before update on schueler_verfuegbarkeiten
  for each row execute function fs_bump_version();
create trigger terminbuchungen_z_version_trg before update on terminbuchungen
  for each row execute function fs_bump_version();
create trigger terminangebote_z_version_trg before update on terminangebote
  for each row execute function fs_bump_version();
create trigger fahrstunden_feedback_z_version_trg before update on fahrstunden_feedback
  for each row execute function fs_bump_version();
create trigger dokumente_z_version_trg before update on dokumente
  for each row execute function fs_bump_version();
create trigger rechnungen_z_version_trg before update on rechnungen
  for each row execute function fs_bump_version();
create trigger zahlungen_z_version_trg before update on zahlungen
  for each row execute function fs_bump_version();
create trigger banktransaktionen_z_version_trg before update on banktransaktionen
  for each row execute function fs_bump_version();
create trigger fahrzeuge_z_version_trg before update on fahrzeuge
  for each row execute function fs_bump_version();
create trigger fahrzeugmaengel_z_version_trg before update on fahrzeugmaengel
  for each row execute function fs_bump_version();
create trigger pruefungen_z_version_trg before update on pruefungen
  for each row execute function fs_bump_version();
create trigger pruefungsfreigaben_z_version_trg before update on pruefungsfreigaben
  for each row execute function fs_bump_version();

-- ===========================================================================
-- §3  Restliche DB-Invarianten
-- ===========================================================================

-- (a) Eine Fahrstunde kann nur EINMAL endgültig abgeschlossen werden.
--     Sobald status='abgeschlossen' mit beendet_at gesetzt ist, sind
--     Abschlussfelder eingefroren und der Status kann nicht zurückgesetzt
--     werden. Erzwungen in der Datenbank, nicht nur im Service.
create or replace function fs_lesson_completed_once() returns trigger as $$
begin
  if old.status = 'abgeschlossen' and old.beendet_at is not null then
    if new.beendet_at is distinct from old.beendet_at then
      raise exception 'Fahrstunde % ist bereits endgültig abgeschlossen (beendet_at unveränderlich)', old.id
        using errcode = 'FS001';
    end if;
    if new.status <> 'abgeschlossen' and new.status <> 'cancelled' then
      raise exception 'Fahrstunde % ist bereits abgeschlossen und kann nicht nach % zurückgesetzt werden', old.id, new.status
        using errcode = 'FS001';
    end if;
    if new.tatsaechliche_dauer_minuten is distinct from old.tatsaechliche_dauer_minuten then
      raise exception 'Abschlussdaten der Fahrstunde % sind eingefroren', old.id
        using errcode = 'FS001';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger terminbuchungen_a_completed_once_trg
  before update on terminbuchungen
  for each row execute function fs_lesson_completed_once();

-- (b) Keine doppelte Rechnung für dieselbe Leistung.
--     Leistungsbezug wird auf der Rechnungsposition modelliert; ein
--     partieller Unique-Index verbietet eine zweite, nicht stornierte
--     Position für dieselbe Leistung. `storniert` wird per Trigger von
--     rechnungen.status übernommen (denormalisiert, weil ein partieller
--     Index nicht über eine Fremdtabelle prüfen kann).
alter table rechnungspositionen
  add column leistung_terminbuchung_id uuid references terminbuchungen(id),
  add column leistung_ref text,
  add column storniert boolean not null default false;

create unique index rechnungspositionen_leistung_once_idx
  on rechnungspositionen (leistung_terminbuchung_id)
  where leistung_terminbuchung_id is not null and storniert = false;

create unique index rechnungspositionen_leistung_ref_once_idx
  on rechnungspositionen (leistung_ref)
  where leistung_ref is not null and storniert = false;

create or replace function fs_rechnung_storno_propagiert() returns trigger as $$
begin
  if new.status = 'storniert' and old.status <> 'storniert' then
    update rechnungspositionen set storniert = true where rechnung_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger rechnungen_storno_trg
  after update on rechnungen
  for each row execute function fs_rechnung_storno_propagiert();

-- (c) Eine Banktransaktion kann nicht mehrfach vollständig zugeordnet werden.
--     Zusätzlich zum Statuswächter oben: die Summe der zugeordneten
--     Zahlungen darf den Transaktionsbetrag nicht überschreiten.
create or replace function fs_banktransaktion_summe() returns trigger as $$
declare
  v_amount integer;
  v_zstatus text;
  v_sum integer;
begin
  if new.banktransaktion_id is null then
    return new;
  end if;
  select amount_cent, zahlung_status into v_amount, v_zstatus
    from banktransaktionen where id = new.banktransaktion_id for update;
  if v_amount is null then
    return new;
  end if;

  -- Eine bereits vollständig zugeordnete ('matched') Banktransaktion darf
  -- keine WEITERE Zahlungszuordnung erhalten. Das ist die eigentliche
  -- fachliche Bedeutung von "nicht mehrfach vollständig zugeordnet".
  if tg_op = 'INSERT' and v_zstatus = 'matched' then
    raise exception 'Banktransaktion % ist bereits vollständig zugeordnet, keine weitere Zahlung möglich',
      new.banktransaktion_id using errcode = 'FS003';
  end if;

  select coalesce(sum(betrag_cent), 0) into v_sum from zahlungen
    where banktransaktion_id = new.banktransaktion_id
      and status <> 'storniert'
      and (tg_op = 'INSERT' or id <> new.id);
  if v_sum + new.betrag_cent > v_amount then
    raise exception 'Banktransaktion % wuerde mit % Cent ueberbucht (Betrag %, bereits zugeordnet %)',
      new.banktransaktion_id, new.betrag_cent, v_amount, v_sum
      using errcode = 'FS003';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger zahlungen_a_banktransaktion_summe_trg
  before insert or update on zahlungen
  for each row execute function fs_banktransaktion_summe();

-- (d) Eine Prüfung darf nur mit gültiger Freigabekette angemeldet werden:
--     Fahrlehrer-Go (pruefungsfreigaben.status='freigegeben') UND
--     Büroprüfung (buerofreigabe_status='freigegeben'). Die Pipeline-Reihenfolge
--     selbst wird zusätzlich als Allow-List durchgesetzt (siehe unten) und in
--     packages/domain/pruefungspipeline.ts rollenbasiert geprüft.
--     Dieser Trigger GEWÄHRT niemals eine Freigabe, er verweigert nur
--     (Non-Negotiable "keine automatische Prüfungsfreigabe").
create table pruefung_transitions (
  von_status text not null,
  nach_status text not null,
  primary key (von_status, nach_status)
);
insert into pruefung_transitions (von_status, nach_status) values
  ('in_vorbereitung', 'voraussetzungen_fehlen'),
  ('voraussetzungen_fehlen', 'in_vorbereitung'),
  ('in_vorbereitung', 'fahrlehrer_go'),
  ('voraussetzungen_fehlen', 'fahrlehrer_go'),
  ('fahrlehrer_go', 'bueroprüfung'),
  ('bueroprüfung', 'unterlagen_vollstaendig'),
  ('bueroprüfung', 'voraussetzungen_fehlen'),
  ('unterlagen_vollstaendig', 'termin_angefragt'),
  ('termin_angefragt', 'termin_bestaetigt'),
  ('termin_bestaetigt', 'durchgefuehrt'),
  ('durchgefuehrt', 'ergebnis_dokumentiert');

create or replace function fs_pruefung_freigabekette() returns trigger as $$
declare
  v_fahrlehrer_go text;
  v_buero text;
  v_ok boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  select true into v_ok from pruefung_transitions
    where von_status = old.status and nach_status = new.status;
  if v_ok is not true then
    raise exception 'Ungültiger Prüfungs-Pipeline-Übergang % -> %', old.status, new.status
      using errcode = 'FS004';
  end if;

  if new.status in ('termin_angefragt', 'termin_bestaetigt', 'durchgefuehrt', 'ergebnis_dokumentiert') then
    select status, buerofreigabe_status into v_fahrlehrer_go, v_buero
      from pruefungsfreigaben where ausbildung_id = new.ausbildung_id;
    if v_fahrlehrer_go is distinct from 'freigegeben' then
      raise exception 'Prüfungsanmeldung ohne Fahrlehrer-Go (Ausbildung %)', new.ausbildung_id
        using errcode = 'FS004';
    end if;
    if v_buero is distinct from 'freigegeben' then
      raise exception 'Prüfungsanmeldung ohne Büroprüfung (Ausbildung %)', new.ausbildung_id
        using errcode = 'FS004';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger pruefungen_a_freigabekette_trg
  before update on pruefungen
  for each row execute function fs_pruefung_freigabekette();

-- (e) Ein gesperrtes/nicht einsatzbereites Fahrzeug kann NICHT verplant
--     werden – nicht nur in packages/scheduling checkBookingConflicts,
--     sondern auf Datenbankebene.
--     Bewusst NICHT umgekehrt: das Sperren eines Fahrzeugs mit bestehenden
--     Zukunftsterminen bleibt erlaubt und wird als §19-Befund BERICHTET
--     (riskante Reparaturen sind nur Vorschläge).
create or replace function fs_kein_gesperrtes_fahrzeug() returns trigger as $$
declare
  v_status text;
begin
  if new.fahrzeug_id is null or new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.fahrzeug_id is not distinct from old.fahrzeug_id
     and new.beginn_at is not distinct from old.beginn_at
     and new.ende_at is not distinct from old.ende_at then
    return new;
  end if;
  select status into v_status from fahrzeuge where id = new.fahrzeug_id;
  if v_status is not null and v_status <> 'verfuegbar' then
    raise exception 'Fahrzeug % ist gesperrt (Status %) und kann nicht verplant werden', new.fahrzeug_id, v_status
      using errcode = 'FS005';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger terminbuchungen_b_fahrzeug_gesperrt_trg
  before insert or update on terminbuchungen
  for each row execute function fs_kein_gesperrtes_fahrzeug();

-- Dasselbe für Terminangebote, die ein gesperrtes Fahrzeug anbieten würden.
create or replace function fs_kein_gesperrtes_fahrzeug_angebot() returns trigger as $$
declare
  v_status text;
begin
  if new.fahrzeug_id is null or new.angebot_status in ('cancelled', 'expired', 'rejected') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.fahrzeug_id is not distinct from old.fahrzeug_id then
    return new;
  end if;
  select status into v_status from fahrzeuge where id = new.fahrzeug_id;
  if v_status is not null and v_status <> 'verfuegbar' then
    raise exception 'Fahrzeug % ist gesperrt (Status %) und kann nicht angeboten werden', new.fahrzeug_id, v_status
      using errcode = 'FS005';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger terminangebote_b_fahrzeug_gesperrt_trg
  before insert or update on terminangebote
  for each row execute function fs_kein_gesperrtes_fahrzeug_angebot();

-- ===========================================================================
-- §19 Täglicher Konsistenzcheck: Läufe + Befunde. Reparaturvorschläge werden
--     GESPEICHERT, aber NIE automatisch angewendet (`vorschlag_angewendet`
--     bleibt false, es gibt keinen Codepfad, der ihn setzt).
-- ===========================================================================
create table consistency_check_runs (
  id uuid primary key default gen_random_uuid(),
  gestartet_at timestamptz not null default now(),
  beendet_at timestamptz,
  status text not null default 'laufend' check (status in ('laufend', 'fertig', 'fehlgeschlagen')),
  anzahl_befunde integer not null default 0,
  bericht jsonb,
  ausgeloest_durch text not null default 'job',
  akteur_benutzer_id uuid references benutzer(id),
  fehler text
);

create table consistency_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references consistency_check_runs(id) on delete cascade,
  pruefung text not null,
  schweregrad text not null check (schweregrad in ('niedrig', 'mittel', 'hoch', 'kritisch')),
  entitaet text not null,
  entitaet_id uuid,
  beschreibung text not null,
  vorschlag text,
  vorschlag_riskant boolean not null default true,
  vorschlag_angewendet boolean not null default false,
  kontext jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index consistency_findings_run_idx on consistency_findings(run_id, pruefung);

-- ===========================================================================
-- Basis-Cursor für die in Phase 1 registrierten Konsumenten.
-- ===========================================================================
insert into event_cursors (consumer, last_seq) values
  ('notifications', 0),
  ('projection', 0),
  ('integration-sync', 0);
