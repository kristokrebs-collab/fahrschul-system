-- 0005_instructor.sql
-- Prompt 3: Erweiterungen für apps/instructor (Fahrlehrer-App). Ergänzt den
-- Stunde-starten/beenden-Lebenszyklus auf terminbuchungen, das
-- Kompetenzraster, das Sprachprotokoll und eine erweiterte
-- Fahrzeug-Mangelmeldung (Prompt 2s fahrzeugmaengel bleibt die
-- Ziel-Entität, hier nur um Quick-Check-Felder ergänzt).

-- ---------------------------------------------------------------------------
-- Stunde starten/beenden: Lebenszyklus-Felder auf terminbuchungen. status
-- nimmt zusätzlich zu 'bestaetigt'/'cancelled' die Werte 'gestartet',
-- 'abgeschlossen', 'no_show' an (keine CHECK-Constraint auf status in
-- Prompt 0/2, daher hier ebenfalls keine neue Einschränkung nötig).
-- ---------------------------------------------------------------------------
alter table terminbuchungen
  add column gestartet_at timestamptz,
  add column beendet_at timestamptz,
  add column tatsaechliche_dauer_minuten integer,
  add column kurznotiz text,
  add column naechstes_ziel text,
  add column schuelerfeedback text,
  add column verspaetung_minuten integer;

-- ---------------------------------------------------------------------------
-- Kompetenzraster: 15 Felder x 5 Status je Beobachtung (siehe
-- packages/domain/src/instructor.ts KOMPETENZFELDER/KOMPETENZSTATUS).
-- ---------------------------------------------------------------------------
create table kompetenzbeobachtungen (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  schueler_id uuid not null references schueler(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  terminbuchung_id uuid references terminbuchungen(id),
  feld text not null,
  kompetenzstatus text not null,
  beobachtung text,
  datum timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kompetenzbeobachtungen_schueler_idx on kompetenzbeobachtungen(schueler_id);

-- ---------------------------------------------------------------------------
-- Sprachprotokoll (Voice-Log). status bleibt 'entwurf' bis Schritt 6
-- ("instructor confirms") – schülerseitige Inhalte werden erst bei
-- Bestätigung nach fahrstunden_feedback gespiegelt (kein Auto-Publish).
-- ---------------------------------------------------------------------------
create table sprachprotokolle (
  id uuid primary key default gen_random_uuid(),
  standort_id uuid references standorte(id),
  terminbuchung_id uuid not null references terminbuchungen(id),
  fahrlehrer_id uuid not null references fahrlehrer(id),
  schueler_id uuid not null references schueler(id),
  audio_referenz text,
  transcript_original text,
  transcript_bearbeitet text,
  ai_vorschlaege jsonb not null default '{}',
  intern_zusammenfassung text,
  schuelerseitig_zusammenfassung text,
  kompetenzvorschlaege jsonb not null default '[]',
  naechstes_ziel text,
  sprachprotokoll_status text not null default 'aufnahme' check (sprachprotokoll_status in ('aufnahme','transkribiert','entwurf','bestaetigt')),
  bestaetigt_at timestamptz,
  bestaetigt_durch_benutzer_id uuid references benutzer(id),
  gespiegeltes_feedback_id uuid references fahrstunden_feedback(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sprachprotokolle_terminbuchung_idx on sprachprotokolle(terminbuchung_id);

-- ---------------------------------------------------------------------------
-- Fahrzeug-Mangelmeldung: Quick-Check-Felder ergänzt auf Prompt 2s
-- fahrzeugmaengel (kein Duplikat-Tabelle, "instructor app is the reporting
-- side" derselben Entität, die Büro/Fuhrpark auflöst).
-- ---------------------------------------------------------------------------
alter table fahrzeugmaengel
  add column gemeldet_von_benutzer_id uuid references benutzer(id),
  add column kilometerstand integer,
  add column tank_ladung_prozent integer,
  add column warnleuchten jsonb not null default '[]',
  add column schweregrad text not null default 'mittel' check (schweregrad in ('gering','mittel','kritisch')),
  add column einsatzbereit boolean not null default true,
  add column foto_referenz text,
  add column sprachnotiz_referenz text,
  add column geroutet_an text not null default 'buero' check (geroutet_an in ('buero','fuhrpark'));
