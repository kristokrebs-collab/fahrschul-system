-- 0003_student_app.sql
-- Prompt 1: Erweiterungen für apps/student (Fahrschüler-App). Ergänzt das
-- in Prompt 0 bewusst schlank gehaltene Datenmodell um die für die
-- Schüler-App fachlich benötigten Felder/Tabellen (siehe
-- docs/architecture-report.md "Nicht in Prompt 0 modelliert" und
-- packages/domain/src/curriculum.ts).

-- Ausbildung: Vorbesitz/Erweiterung/B197/Getriebeart
alter table ausbildungen
  add column vorbesitz_klasse text,
  add column ist_erweiterung boolean not null default false,
  add column getriebeart text not null default 'schaltung' check (getriebeart in ('schaltung','automatik')),
  add column b197 boolean not null default false;

-- Terminangebote: Art/Treffpunkt/Automatik/Ablauf (exaktes Zeitfenster statt
-- grober Tagesperioden, Angebots-Ablauf für "kurzfristig verfügbar" +
-- Termin-Angebots-Verfall).
alter table terminangebote
  add column art text not null default 'Übungsstunde',
  add column treffpunkt text,
  add column automatik boolean not null default false,
  add column ablauf_at timestamptz;

-- Dokumente: Ablehnungsgrund, Gültigkeit, Re-Upload-Kette, Mock-Malware-Scan.
alter table dokumente
  add column ablehnungsgrund text,
  add column gueltig_bis date,
  add column ersetzt_von_dokument_id uuid references dokumente(id),
  add column scan_status text not null default 'ausstehend' check (scan_status in ('ausstehend','sauber','verdaechtig'));

create table rechnungspositionen (
  id uuid primary key default gen_random_uuid(),
  rechnung_id uuid not null references rechnungen(id),
  bezeichnung text not null,
  menge_cent integer,
  einzelpreis_cent integer not null,
  gesamtpreis_cent integer not null,
  created_at timestamptz not null default now()
);
create index rechnungspositionen_rechnung_id_idx on rechnungspositionen(rechnung_id);

create table schueler_verfuegbarkeiten (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  wochentag integer not null check (wochentag between 0 and 6),
  startzeit text not null,
  endzeit text not null,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schueler_verfuegbarkeiten_schueler_idx on schueler_verfuegbarkeiten(schueler_id);

create table lernressourcen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  titel text not null,
  typ text not null check (typ in ('video','hoerbuch','simulator','kurs','gefahrentraining')),
  klassen jsonb not null default '[]',
  ort text,
  beschreibung text,
  url text,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lernfortschritte (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  ressource_id uuid not null references lernressourcen(id),
  status text not null default 'offen' check (status in ('offen','besucht')),
  besucht_am timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schueler_id, ressource_id)
);

create table fahrstunden_feedback (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  terminbuchung_id uuid not null references terminbuchungen(id),
  schueler_id uuid not null references schueler(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  went_well text,
  work_on text,
  next_goal text,
  resource_id uuid references lernressourcen(id),
  -- Interne Fahrlehrer-Notizen: NIE in einer schülerseitigen API-Antwort
  -- (apps/api/src/routes/feedback.ts filtert das serverseitig aus, nicht nur
  -- im UI).
  internal_notes text,
  released_fields jsonb not null default '[]',
  student_self_assessment text,
  status text not null default 'aktiv',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (terminbuchung_id)
);

create table pruefungsfreigaben (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  ausbildung_id uuid not null references ausbildungen(id),
  schueler_id uuid not null references schueler(id),
  status text not null default 'offen' check (status in ('offen','freigegeben','abgelehnt')),
  freigegeben_durch_benutzer_id uuid references benutzer(id),
  freigegeben_at timestamptz,
  buerofreigabe_status text not null default 'offen' check (buerofreigabe_status in ('offen','freigegeben','abgelehnt')),
  buerofreigabe_durch_benutzer_id uuid references benutzer(id),
  kommentar text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ausbildung_id)
);

-- Feature-Flags (Prompt 1 führt den Mechanismus erstmals ein). Default für
-- Krebs Flex ist "hidden", solange keine andere Anweisung vorliegt.
create table feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  state text not null default 'hidden' check (state in ('hidden','pilot','live')),
  standort_id uuid references standorte(id),
  updated_at timestamptz not null default now(),
  unique (key, standort_id)
);
insert into feature_flags (key, state, standort_id) values ('krebs_flex', 'hidden', null);

create table flex_angebote (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  terminangebot_id uuid not null references terminangebote(id),
  status text not null default 'offen' check (status in ('offen','angenommen','abgelaufen','storniert')),
  ablauf_at timestamptz not null,
  angenommen_von_schueler_id uuid references schueler(id),
  angenommen_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table flex_opt_ins (
  id uuid primary key default gen_random_uuid(),
  schueler_id uuid not null references schueler(id) unique,
  created_at timestamptz not null default now()
);

-- Terminangebote dürfen nur EINMAL erfolgreich angenommen werden. Der
-- eigentliche Race-Schutz gegen zwei PARALLELE Annahmen desselben Angebots
-- kommt weiterhin aus der Fahrlehrer/Fahrzeug-EXCLUDE-Constraint (Migration
-- 0002) auf terminbuchungen, da ein Angebot an genau einen Fahrlehrer/
-- Zeitraum gebunden ist; dieser Index verhindert zusätzlich, dass ein
-- bereits gebuchtes Angebot ein zweites Mal als "gebucht" markiert wird.
create unique index terminbuchungen_terminangebot_once_idx
  on terminbuchungen (terminangebot_id)
  where (status <> 'cancelled' and terminangebot_id is not null);
