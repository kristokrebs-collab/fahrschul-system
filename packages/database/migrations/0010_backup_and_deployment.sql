-- ===========================================================================
-- PROMPT -1 / Phase 4 – Backup-Nachweis und Deployment-Protokoll
--
-- Abschnitte: §14 (Backup, Wiederherstellung, Integritätsprüfung),
--             §15 (sichere Deployments, Rollback, kein zerstörender
--                  Migrationsschritt ohne Backup und Freigabe).
--
-- EXPAND-CONTRACT (§14): ausschließlich ZWEI NEUE Tabellen. Keine bestehende
-- Spalte wird angefasst, umbenannt, verengt oder entfernt. Eine ältere
-- Anwendungsversion läuft mit diesem Schema unverändert weiter – sie kennt
-- diese Tabellen einfach nicht.
--
-- WARUM DIESE TABELLEN ÜBERHAUPT IN DER DATENBANK LIEGEN
--
-- Beide könnten Dateien auf einem Betriebsserver sein. Sie liegen hier, weil
-- sie GEPRÜFT werden müssen und nicht nur gelesen:
--
--  * `backup_runs` ist die Nachweisquelle des §15-Tors "keine zerstörende
--    Migration ohne Backup". Der Migrationsläufer (packages/database/src/
--    migrate.ts, assertDestructiveAllowed) fragt diese Tabelle ab. Eine
--    Umgebungsvariable, die ein Backup BEHAUPTET, ist kein Nachweis; ein
--    Eintrag mit `verified_at` ist einer, weil ihn nur ein tatsächlich
--    gelaufener Wiederherstellungstest setzt (scripts/restore-verify.sh).
--
--  * `deployments` ist die Grundlage des Rollback-Plans: welche Fassung lief
--    ab wann, welche Migrationen kamen mit, auf welches Backup wurde sich
--    dabei gestützt. Ohne diese Verkettung ist "wir rollen zurück" eine
--    Absicht ohne Zielangabe.
--
-- BEWUSSTE ABWESENHEIT: es gibt keinen Trigger und keine Invariante auf diesen
-- Tabellen. Sie sind Betriebsprotokoll, nicht Fachzustand – eine Zeile hier
-- macht keine Buchung gültig oder ungültig. Aus demselben Grund tragen sie
-- KEINE `version`-Spalte (§4 gilt für Fachdaten) und lösen KEINE Outbox-
-- Ereignisse aus (§5 gilt für fachliche Ereignisse).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §14 Backup-Läufe
--
-- `kind` unterscheidet die drei Verfahren, weil sie verschiedene RPO/RTO
-- liefern und nicht gegeneinander austauschbar sind:
--   logical   – pg_dump: portabel, versionsübergreifend, langsam beim Restore
--   physical  – pg_basebackup: Grundlage für PITR, schnell, versionsgebunden
--   wal       – archivierte WAL-Segmente: das, was PITR zwischen zwei
--               Basissicherungen überhaupt erst möglich macht
--
-- `verified_at` ist der Kern dieser Tabelle. Ein Backup, das nie
-- zurückgespielt wurde, ist eine Hoffnung. Erst ein Wiederherstellungstest
-- setzt dieses Feld – und nur dann öffnet das §15-Tor.
-- ---------------------------------------------------------------------------
create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  -- Menschenlesbares, eindeutiges Label. Das ist der Wert, den
  -- MIGRATION_BACKUP_REF trägt.
  label text not null unique,
  kind text not null,
  -- Wo liegt es? Bewusst freier Text: in dieser Umgebung ein Pfad, im
  -- Produktivbetrieb eine Objektspeicher-URL an einem ANDEREN Ort als die
  -- Datenbank (§14 verlangt einen getrennten Speicherort).
  location text not null,
  -- Verschlüsselung: Verfahren + Schlüsselkennung, NIE der Schlüssel selbst.
  encryption text,
  key_id text,
  size_bytes bigint,
  checksum_sha256 text,
  -- Konsistenzpunkt des Backups: die WAL-Position bzw. der Zeitstempel, auf
  -- den eine Wiederherstellung führt. Grundlage der RPO-Aussage.
  consistent_at timestamptz,
  wal_lsn text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  status text not null default 'laufend',
  -- Der Beweis, nicht die Behauptung.
  verified_at timestamptz,
  verify_method text,
  verify_details jsonb,
  restore_duration_ms integer,
  error text,
  -- Welches Deployment/welche Person hat es ausgelöst.
  ausgeloest_von text,
  deployment_id text,
  created_at timestamptz not null default now(),
  constraint backup_runs_kind_chk check (kind in ('logical', 'physical', 'wal')),
  constraint backup_runs_status_chk
    check (status in ('laufend', 'erfolgreich', 'fehlgeschlagen', 'verworfen')),
  -- Ein verifiziertes Backup muss auch erfolgreich gewesen sein. Verhindert
  -- den einen Fall, der das §15-Tor unterlaufen könnte: eine fehlgeschlagene
  -- Sicherung, die per Hand als "verifiziert" markiert wird.
  constraint backup_runs_verified_needs_success
    check (verified_at is null or status = 'erfolgreich')
);

create index backup_runs_kind_started_idx on backup_runs (kind, started_at desc);
create index backup_runs_verified_idx on backup_runs (verified_at desc nulls last);

comment on table backup_runs is
  'PROMPT -1 §14: ausgeführte Sicherungen samt Verifikationsnachweis. '
  'Quelle des §15-Tors "keine zerstörende Migration ohne verifiziertes Backup".';

-- ---------------------------------------------------------------------------
-- §15 Deployment-Protokoll
--
-- Ein Eintrag je Rollout, nicht je Prozess. `instance_id` gehört bewusst NICHT
-- hierher: bei einem Rolling-Deployment gibt es n Instanzen zu einem Rollout,
-- und die Instanz-Zuordnung steht im Log (siehe apps/api/src/lib/
-- deployment.ts). Diese Tabelle beantwortet "was wurde ausgeliefert und mit
-- welchem Ergebnis", nicht "welcher Prozess hat geantwortet".
-- ---------------------------------------------------------------------------
create table deployments (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null,
  release_channel text not null,
  version text,
  git_commit text,
  -- Welche Migrationsdateien dieser Rollout angewendet hat. Für den Rollback
  -- die entscheidende Angabe: Code zurückrollen ist billig, ein Schemaschritt
  -- nicht.
  migrations_applied jsonb not null default '[]'::jsonb,
  -- Enthielt der Rollout einen zerstörenden Schritt? Dann ist ein
  -- Code-Rollback allein NICHT ausreichend.
  destructive boolean not null default false,
  -- Auf welches Backup hat sich der Rollout gestützt (§15-Tor).
  backup_ref text,
  approved_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'laufend',
  -- Rollback-Spur.
  rolled_back_at timestamptz,
  rollback_reason text,
  rollback_to text,
  notes text,
  created_at timestamptz not null default now(),
  constraint deployments_status_chk
    check (status in ('laufend', 'erfolgreich', 'fehlgeschlagen', 'zurueckgerollt')),
  constraint deployments_channel_chk
    check (release_channel in ('production', 'staging', 'pilot', 'development', 'unknown')),
  -- Ein zurückgerollter Rollout muss einen Grund nennen. Ohne Grund ist die
  -- Spur wertlos für die nächste Entscheidung.
  constraint deployments_rollback_needs_reason
    check (rolled_back_at is null or rollback_reason is not null)
);

create index deployments_started_idx on deployments (started_at desc);
create index deployments_deployment_id_idx on deployments (deployment_id, started_at desc);

comment on table deployments is
  'PROMPT -1 §15: ein Eintrag je Rollout – Fassung, Migrationen, Freigabe, '
  'Backupbezug und Rollback-Spur.';
