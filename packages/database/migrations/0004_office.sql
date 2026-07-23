-- 0004_office.sql
-- Prompt 2: Erweiterungen für apps/office (Büro-Zentrale). Ergänzt das
-- Datenmodell um die für Prompt 2 fachlich benötigten Ressourcen/Entitäten,
-- die in Prompt 0/1 bewusst noch nicht modelliert waren (siehe
-- docs/architecture-report.md "Nicht in Prompt 0 modelliert": Raum,
-- Fahrzeugmangel, Lead/Firma, Nachricht, Prüfung/Prüfungsfreigabe-Pipeline,
-- Aufgabe/Mitarbeiter-Arbeitszeit).

-- ---------------------------------------------------------------------------
-- Ressourcen: Raum / Simulatorgerät als First-Class-Ressourcen für die
-- Terminplanung (Spec: "Raum/Simulatorgerät als First-Class-Ressourcen").
-- ---------------------------------------------------------------------------
create table raeume (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  name text not null,
  ausstattung jsonb not null default '[]',
  status text not null default 'verfuegbar' check (status in ('verfuegbar','wartung','gesperrt')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table simulatorgeraete (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  name text not null,
  status text not null default 'verfuegbar' check (status in ('verfuegbar','wartung','gesperrt')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Terminangebote/-buchungen können optional einen Raum und/oder ein
-- Simulatorgerät belegen (Theorie/Simulator-Einheiten), zusätzlich zu
-- Fahrlehrer/Fahrzeug.
alter table terminangebote
  add column raum_id uuid references raeume(id),
  add column simulatorgeraet_id uuid references simulatorgeraete(id);

alter table terminbuchungen
  add column raum_id uuid references raeume(id),
  add column simulatorgeraet_id uuid references simulatorgeraete(id);

-- Handicap-Ausstattung: Fahrzeuge tragen die Ausstattungsmerkmale, die sie
-- bieten (z. B. "handschaltung_hilfe", "rollstuhlrampe"); Ausbildungen tragen
-- den Bedarf des Schülers. Beides jsonb-Arrays von freien Codes, da die
-- genaue Taxonomie fachlich unbestätigt ist (siehe
-- docs/fachliche-bestaetigungen.md).
alter table fahrzeuge
  add column handicap_ausstattung jsonb not null default '[]',
  add column automatik boolean not null default false;

alter table ausbildungen
  add column handicap_bedarf jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- Fahrzeugmangel (Fahrzeugausfall) – für Heute-Queue "Sofort: Fahrzeugausfall"
-- und die harte Matching-Regel "Fahrzeug einsatzbereit".
-- ---------------------------------------------------------------------------
create table fahrzeugmaengel (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  fahrzeug_id uuid not null references fahrzeuge(id),
  grund text not null,
  status text not null default 'offen' check (status in ('offen','behoben')),
  gemeldet_at timestamptz not null default now(),
  behoben_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fahrzeugmaengel_fahrzeug_idx on fahrzeugmaengel(fahrzeug_id);

-- Ein offener Mangel setzt das Fahrzeug automatisch auf "wartung"/"defekt" –
-- Büro pflegt den Fahrzeugstatus weiterhin manuell über die vorhandene
-- fahrzeuge.status-Spalte, dieser Trigger ist bewusst NICHT vorhanden (keine
-- automatische Personalaktion, Spec "Arbeitszeit" gilt sinngemäß auch hier:
-- Büro sieht eine Warnung/den offenen Mangel, entscheidet aber selbst über
-- den Fahrzeugstatus).

-- ---------------------------------------------------------------------------
-- Arbeitszeitregeln (Fahrlehrer) – nur zur Anzeige/Warnung, KEINE
-- automatische Personalaktion (Spec "Arbeitszeit").
-- ---------------------------------------------------------------------------
create table arbeitszeitregeln (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  fahrlehrer_id uuid not null references fahrlehrer(id) unique,
  max_stunden_pro_tag numeric not null default 8,
  max_stunden_pro_woche numeric not null default 40,
  min_pause_minuten integer not null default 15,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Leads/CRM
-- ---------------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  vorname text not null,
  nachname text not null,
  email text,
  telefon text,
  quelle text not null default 'webseite',
  interesse_klasse text,
  kommentar text,
  status text not null default 'neu' check (status in ('neu','kontaktiert','termin_vereinbart','konvertiert','verloren')),
  konvertiert_zu_schueler_id uuid references schueler(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on leads(status);

-- ---------------------------------------------------------------------------
-- Kommunikation: Vorlagen + Sende-Log
-- ---------------------------------------------------------------------------
create table nachrichten_vorlagen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  name text not null,
  kanal text not null check (kanal in ('email','sms','push')),
  betreff text,
  inhalt text not null,
  status text not null default 'aktiv' check (status in ('aktiv','archiviert')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table nachrichten (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  vorlage_id uuid references nachrichten_vorlagen(id),
  schueler_id uuid references schueler(id),
  lead_id uuid references leads(id),
  kanal text not null check (kanal in ('email','sms','push')),
  betreff text,
  inhalt text not null,
  status text not null default 'warteschlange' check (status in ('warteschlange','gesendet','fehlgeschlagen')),
  fehlergrund text,
  gesendet_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nachrichten_schueler_idx on nachrichten(schueler_id);

-- ---------------------------------------------------------------------------
-- Prüfungs-Pipeline (explizite State Machine)
-- ---------------------------------------------------------------------------
create table pruefungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  ausbildung_id uuid not null references ausbildungen(id),
  schueler_id uuid not null references schueler(id),
  klasse text not null,
  status text not null default 'in_vorbereitung' check (status in (
    'in_vorbereitung',
    'voraussetzungen_fehlen',
    'fahrlehrer_go',
    'bueroprüfung',
    'unterlagen_vollstaendig',
    'termin_angefragt',
    'termin_bestaetigt',
    'durchgefuehrt',
    'ergebnis_dokumentiert'
  )),
  termin_beginn_at timestamptz,
  ergebnis text check (ergebnis in ('bestanden','nicht_bestanden')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pruefungen_status_idx on pruefungen(status);

-- ---------------------------------------------------------------------------
-- Storno-Retter (11-Schritt-Flow)
-- ---------------------------------------------------------------------------
create table storno_events (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  terminbuchung_id uuid not null references terminbuchungen(id) unique,
  klasse text not null,
  status text not null default 'empfangen' check (status in (
    'empfangen',
    'slot_gesperrt',
    'kandidaten_berechnet',
    'angebote_gesendet',
    'gebucht',
    'abgelaufen',
    'geschlossen'
  )),
  angebotsmodus text check (angebotsmodus in ('sequenziell','broadcast')),
  ausgeloest_at timestamptz not null default now(),
  geschlossen_at timestamptz,
  gerettete_minuten integer,
  geretteter_umsatz_cent integer,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table storno_angebote (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  storno_event_id uuid not null references storno_events(id),
  schueler_id uuid not null references schueler(id),
  status text not null default 'offen' check (status in ('offen','angenommen','abgelehnt','abgelaufen','geschlossen')),
  ablauf_at timestamptz not null,
  angenommen_at timestamptz,
  terminbuchung_id uuid references terminbuchungen(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index storno_angebote_event_idx on storno_angebote(storno_event_id);
