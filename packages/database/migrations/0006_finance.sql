-- 0006_finance.sql
-- PROMPT 4: Finanz-/Flotten-/Geschäftsführer-Cockpit.
--
-- Erweitert Prompt 0s Rechnung/Zahlung um Brutto/Netto/Steuersatz und
-- Leistungszeitpunkt (Periodenabgrenzung), fügt eine echte
-- Banktransaktions-Tabelle + Review-Queue für den Bankabgleich hinzu
-- (Kaskade-Logik in packages/finance, hier nur Persistenz), eine
-- Produkt/Preisliste-Entität (kein fest codiertes Preis-Array,
-- Non-Negotiable), Fahrzeug-Wirtschaftlichkeitsfelder auf Prompt 2/3s
-- `fahrzeuge`/`fahrzeugmaengel`, und eine Export-Audit-Tabelle.

-- ---------------------------------------------------------------------------
-- Standorte: Bad Hersfeld war bislang nicht geseedet (nur Fulda, siehe
-- packages/database/src/seed.ts) – beide sind laut Aufgabenstellung
-- "confirmed Standorte". Idempotent per WHERE NOT EXISTS, da Migrationen
-- wiederholt gegen dieselbe DB laufen können.
-- ---------------------------------------------------------------------------
insert into standorte (organisation_id, name, adresse)
select o.id, 'Bad Hersfeld', 'Platzhalter-Adresse Bad Hersfeld'
from organisationen o
where not exists (select 1 from standorte s where s.name = 'Bad Hersfeld')
limit 1;

-- ---------------------------------------------------------------------------
-- Rechnung/Zahlung: Brutto/Netto/Steuersatz + Leistungszeitpunkt ergänzen.
-- `betrag_cent` (Prompt 0) bleibt als Brutto-Gesamtbetrag bestehen, damit
-- apps/student und apps/office (read-only Views) unverändert weiterlaufen.
-- ---------------------------------------------------------------------------
alter table rechnungen
  add column if not exists steuersatz numeric(4,3) not null default 0.19,
  add column if not exists netto_cent integer,
  add column if not exists leistungszeitraum_von date,
  add column if not exists leistungszeitraum_bis date,
  add column if not exists rechnungsnummer text;

update rechnungen set netto_cent = round(betrag_cent / (1 + steuersatz)) where netto_cent is null;
-- Bewusst NICHT NOT NULL: bestehende Testfixtures/Prompt-1..3-Codepfade
-- fügen Rechnungen teils per Rohinsert ohne netto_cent ein. Die Anwendung
-- (packages/finance nettoVonBrutto) berechnet Netto bei Bedarf aus Brutto,
-- eine fehlende Spalte ist also nie ein Datenverlust, nur ein
-- Datenqualitäts-Hinweis (siehe /finance/data-quality).

create unique index if not exists rechnungen_rechnungsnummer_idx on rechnungen(rechnungsnummer) where rechnungsnummer is not null;

alter table zahlungen
  add column if not exists zahlungsart text not null default 'ueberweisung'
    check (zahlungsart in ('ueberweisung','lastschrift','bar','karte')),
  add column if not exists banktransaktion_id uuid;

-- ---------------------------------------------------------------------------
-- Banktransaktionen: reale Persistenz für Feeds aus dem Mock-Bank-Adapter
-- (packages/integrations/src/bank), damit der Abgleich (packages/finance
-- Matching-Kaskade) nachvollziehbar und wiederholbar ist.
-- ---------------------------------------------------------------------------
create table banktransaktionen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  external_id text not null unique, -- ID aus dem Bank-Feed-Adapter
  amount_cent integer not null,
  booked_at date not null,
  reference text not null default '',
  counterparty text not null default '',
  zahlungsart text not null default 'ueberweisung'
    check (zahlungsart in ('ueberweisung','lastschrift','bar','karte')),
  ist_ruecklastschrift_von text,
  konfidenz text not null default 'unklar'
    check (konfidenz in ('sicher','wahrscheinlich','unklar','konflikt')),
  grund text,
  rechnung_ids jsonb not null default '[]',
  aufteilung jsonb not null default '{}',
  hinweis text,
  status text not null default 'offen' check (status in ('offen','gebucht','abgelehnt','ignoriert')),
  auto_gebucht boolean not null default false,
  bearbeitet_durch_benutzer_id uuid references benutzer(id),
  bearbeitet_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banktransaktionen_status_idx on banktransaktionen(status);
create index banktransaktionen_standort_idx on banktransaktionen(standort_id);

alter table zahlungen
  add constraint zahlungen_banktransaktion_fk foreign key (banktransaktion_id) references banktransaktionen(id);

-- ---------------------------------------------------------------------------
-- Produkt/Preisliste: konfigurierbare Produkte statt hartkodierter Preise
-- (Non-Negotiable aus Prompt 0). `gueltig_von`/`gueltig_bis` erlaubt
-- Preisänderungs-Historie für den Forecast-Szenario "Preisänderung".
-- ---------------------------------------------------------------------------
create table produkte (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id), -- null = organisationsweit
  code text not null, -- z.B. 'B', 'BF17', 'B197', 'BE', 'B96', 'A', 'C', 'CE', 'C1', 'C1E', 'D', 'DE', 'BKF', 'GRUNDQUALIFIKATION', 'SIMULATOR', 'HANDICAP', 'ASF_FES', 'ERSTE_HILFE', 'UNTERNEHMERPRUEFUNG'
  bezeichnung text not null,
  kategorie text not null check (kategorie in ('klasse','zusatz','dienstleistung')),
  preis_cent integer not null,
  steuersatz numeric(4,3) not null default 0.19,
  einheit text not null default 'stueck', -- 'stueck','minute','stunde'
  gueltig_von date not null default current_date,
  gueltig_bis date,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index produkte_code_idx on produkte(code);

-- ---------------------------------------------------------------------------
-- Fahrzeug-Wirtschaftlichkeit: Prompt 2/3 modellierten nur die operative
-- Seite von `fahrzeuge` (Kennzeichen/Klasse/Bezeichnung). Hier die
-- finanziellen/Stammdaten-Felder ergänzen, die packages/finance's
-- Vollkostenrechnung als Input braucht.
-- ---------------------------------------------------------------------------
-- Hinweis: Getriebe (Schaltung/Automatik) und Handicap-Ausstattung existieren
-- bereits als `automatik` (boolean) / `handicap_ausstattung` (jsonb) aus
-- Prompt 2 (siehe packages/database/src/schema/scheduling.ts) – hier NICHT
-- doppelt anlegen, nur die fehlenden Wirtschaftlichkeits-/Stammdatenfelder
-- ergänzen.
alter table fahrzeuge
  add column if not exists kilometerstand integer not null default 0,
  add column if not exists finanzierungsart text check (finanzierungsart in ('leasing','kauf','miete')),
  add column if not exists leasingrate_cent integer,
  add column if not exists leasingende date,
  add column if not exists versicherung_cent_jahr integer,
  add column if not exists steuer_cent_jahr integer,
  add column if not exists naechste_inspektion date,
  add column if not exists naechste_hu date,
  -- eigene Spalte statt der bestehenden `status` (Prompt 2: 'verfuegbar' etc.,
  -- operativer Zustand) – `fahrzeug_status` ist der wirtschaftliche
  -- Lebenszyklus-Status, bewusst getrennt.
  add column if not exists fahrzeug_status text not null default 'aktiv'
    check (fahrzeug_status in ('aktiv','werkstatt','ausser_dienst','ersatzbeschaffung'));

create table fahrzeugkosten (
  id uuid primary key default gen_random_uuid(),
  fahrzeug_id uuid not null references fahrzeuge(id),
  standort_id uuid references standorte(id),
  kategorie text not null check (kategorie in ('energie','wartung','reparatur','reifen','versicherung','steuer','leasing','sonstiges')),
  betrag_cent integer not null,
  angefallen_am date not null,
  beleg_referenz text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fahrzeugkosten_fahrzeug_idx on fahrzeugkosten(fahrzeug_id);

create table fahrzeugausfalltage (
  id uuid primary key default gen_random_uuid(),
  fahrzeug_id uuid not null references fahrzeuge(id),
  fahrzeugmangel_id uuid references fahrzeugmaengel(id),
  datum date not null,
  grund text,
  created_at timestamptz not null default now(),
  unique(fahrzeug_id, datum)
);

-- ---------------------------------------------------------------------------
-- Export-Audit: jeder Finanz-Export (PDF/CSV/XLSX) wird protokolliert. Kein
-- öffentlicher Downloadpfad – die eigentliche Datei bleibt hinter einer
-- session-authentifizierten API-Route (siehe apps/api/src/routes/finance.ts),
-- diese Tabelle ist nur das Audit-Log + der Signatur-Token-Verweis.
-- ---------------------------------------------------------------------------
create table finanz_exporte (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  angefordert_von_benutzer_id uuid not null references benutzer(id),
  format text not null check (format in ('pdf','csv','xlsx')),
  bericht text not null, -- z.B. 'gf_cockpit','offene_forderungen','fahrzeug_wirtschaftlichkeit'
  parameter jsonb not null default '{}',
  download_token_hash text not null unique,
  abgelaufen_at timestamptz not null,
  heruntergeladen_at timestamptz,
  created_at timestamptz not null default now()
);
create index finanz_exporte_benutzer_idx on finanz_exporte(angefordert_von_benutzer_id);
