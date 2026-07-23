-- 0002_conflict_constraints.sql
-- Non-Negotiable: "Keine Terminbuchung ohne serverseitige Konfliktprüfung."
-- Diese Migration erzwingt die Konfliktfreiheit zusätzlich zur Prüfung in
-- apps/api DIREKT über einen Datenbank-Constraint (PostgreSQL EXCLUDE via
-- btree_gist), sodass selbst ein Bug in der Anwendungslogik oder eine
-- Race Condition zwischen zwei gleichzeitigen Requests keine doppelte
-- Buchung desselben Fahrlehrers bzw. Fahrzeugs in überschneidender Zeit
-- erzeugen kann. Ein Verstoß führt zu einem Postgres-Fehler
-- (SQLSTATE 23P01 exclusion_violation), den apps/api abfängt und als
-- HTTP 409 beantwortet.

create extension if not exists "btree_gist";

alter table terminbuchungen
  add constraint terminbuchungen_no_overlap_fahrlehrer
  exclude using gist (
    fahrlehrer_id with =,
    tstzrange(beginn_at, ende_at) with &&
  )
  where (status <> 'cancelled');

alter table terminbuchungen
  add constraint terminbuchungen_no_overlap_fahrzeug
  exclude using gist (
    fahrzeug_id with =,
    tstzrange(beginn_at, ende_at) with &&
  )
  where (status <> 'cancelled' and fahrzeug_id is not null);
