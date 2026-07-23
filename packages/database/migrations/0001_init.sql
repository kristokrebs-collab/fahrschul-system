-- 0001_init.sql
-- Grundschema: Organisation, Standort, Benutzer, Sessions, Stammdaten,
-- Terminwesen, Abrechnung, Audit-/Event-Log.
-- Numerierte, handgeschriebene Migration (statt drizzle-kit generate), damit
-- der Migrationslauf in dieser Sandbox ohne zusätzliche Introspektion
-- deterministisch reproduzierbar ist. Das Drizzle-Schema in src/schema/*.ts
-- ist die getypte Abbildung derselben Struktur für Query-Builder-Zugriffe.

create extension if not exists "pgcrypto";

create table organisationen (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table standorte (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisationen(id),
  name text not null,
  adresse text,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table benutzer (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  email text not null unique,
  password_hash text not null,
  rolle text not null check (rolle in ('schueler','fahrlehrer','buero','finanzen','geschaeftsfuehrung','systemdienst')),
  vorname text not null,
  nachname text not null,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  benutzer_id uuid not null references benutzer(id) on delete cascade,
  token_hash text not null unique,
  mfa_verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_benutzer_id_idx on sessions(benutzer_id);

create table schueler (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  benutzer_id uuid references benutzer(id),
  vorname text not null,
  nachname text not null,
  geburtsdatum date,
  email text,
  telefon text,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fahrlehrer (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  benutzer_id uuid references benutzer(id),
  vorname text not null,
  nachname text not null,
  klassen jsonb not null default '[]',
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ausbildungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  klasse text not null,
  status text not null default 'laufend',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table verfuegbarkeiten (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  wochentag integer not null check (wochentag between 0 and 6),
  startzeit text not null,
  endzeit text not null,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fahrzeuge (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  kennzeichen text not null,
  klasse text not null,
  bezeichnung text,
  status text not null default 'verfuegbar',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table terminangebote (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  fahrzeug_id uuid references fahrzeuge(id),
  beginn_at timestamptz not null,
  ende_at timestamptz not null,
  klasse text,
  status text not null default 'offen',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (beginn_at < ende_at)
);

create table terminbuchungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  terminangebot_id uuid references terminangebote(id),
  schueler_id uuid not null references schueler(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  fahrzeug_id uuid references fahrzeuge(id),
  beginn_at timestamptz not null,
  ende_at timestamptz not null,
  art text not null,
  status text not null default 'bestaetigt',
  idempotency_key text unique,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (beginn_at < ende_at)
);
create index terminbuchungen_fahrlehrer_zeitraum_idx on terminbuchungen(fahrlehrer_id, beginn_at, ende_at);
create index terminbuchungen_fahrzeug_zeitraum_idx on terminbuchungen(fahrzeug_id, beginn_at, ende_at);

create table rechnungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  betrag_cent integer not null,
  faellig_am date,
  status text not null default 'offen',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table zahlungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  rechnung_id uuid references rechnungen(id),
  betrag_cent integer not null,
  eingegangen_am date,
  zugeordnet boolean not null default false,
  status text not null default 'offen',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dokumente (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  typ text not null,
  dateiname text not null,
  speicher_referenz text not null,
  geprueft boolean not null default false,
  status text not null default 'eingereicht',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  aktion text not null,
  entitaet text not null,
  entitaet_id uuid,
  akteur_benutzer_id uuid references benutzer(id),
  standort_id uuid references standorte(id),
  source text not null,
  correlation_id uuid not null,
  idempotency_key text,
  vorher jsonb,
  nachher jsonb,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_type_idx on audit_events(type);
create index audit_events_entitaet_idx on audit_events(entitaet, entitaet_id);
