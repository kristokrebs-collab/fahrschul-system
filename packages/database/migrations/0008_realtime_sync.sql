-- 0008_realtime_sync.sql
-- PROMPT -1 / Phase 2: ECHTZEIT-SYNCHRONISATION UND CLIENT-SYNCHRONISATIONS-
-- ZUSTÄNDE (§1 Anzeigehälfte, §6, §7, §8, §9-Client).
--
-- Umfang dieser Migration (nur der SERVER-Anteil von §6 – §7/§8/§9 leben im
-- Client und brauchen kein Schema):
--   * realtime_deliveries        Fanout der Outbox auf AUTORISIERTE Empfänger
--   * realtime_audience_counters dichter Cursor JE EMPFÄNGER
--
-- EXPAND-CONTRACT (§14): rein additiv. Keine bestehende Spalte wird
-- umbenannt, umtypisiert oder entfernt; keine bestehende Tabelle wird
-- verändert. Alle vier Frontends laufen unverändert weiter, wenn diese
-- Migration angewendet ist, und der Realtime-Kanal ist ein rein zusätzlicher
-- Lesepfad. Ein Rollback der Anwendung ohne Rollback des Schemas ist
-- gefahrlos möglich (die Tabellen werden dann nur nicht mehr gefüllt).
--
-- ===========================================================================
-- §6 Warum ein Fanout-Projektion und keine direkte Abfrage von event_outbox?
-- ===========================================================================
-- Der Kanal darf einem Abonnenten NUR Ereignis-IDs von Datensätzen zeigen,
-- die er auch lesen darf. Zwei Anforderungen fallen dabei zusammen:
--
--  1. AUTORISIERUNG. `event_outbox` kennt nur `standort_id` und
--     `aggregate_id`. Ob ein bestimmter Schüler einen bestimmten Termin
--     lesen darf, steht dort nicht. Die Entscheidung braucht einen Blick in
--     die Fachtabellen und wird deshalb EINMAL beim Fanout getroffen
--     (apps/api/src/services/realtime-audience.ts) und als Zeile pro
--     Empfänger materialisiert – nicht bei jedem Abruf neu geraten.
--
--  2. METADATEN-LECK. `event_outbox.seq` ist eine GLOBALE Sequenz. Würde der
--     Client sie als Cursor bekommen, könnte er aus den Lücken ablesen, wie
--     viele Ereignisse anderer Nutzer dazwischen lagen – eine echte, wenn
--     auch schwache Informationspreisgabe. `realtime_deliveries.audience_seq`
--     ist deshalb eine DICHTE Sequenz JE EMPFÄNGER (1, 2, 3, …). Sie leckt
--     kein Volumen und macht zusätzlich Lückenerkennung exakt: fehlt eine
--     Nummer, fehlt ein Ereignis.
--
-- Nutzlast: KEINE. Die Zeile trägt bewusst nur `event_id`, `event_type` und
-- ein grobes `data_type`-Thema (z. B. 'termine'), damit der Client weiß, WAS
-- er neu laden soll. Die fachlichen Daten holt er anschließend über die
-- normalen, autorisierten GET-Endpunkte.
-- ===========================================================================

-- Dichter Zähler je Empfänger ('benutzer:<uuid>'). Ein eigener Zähler (statt
-- max(seq)+1) macht die Vergabe unter Parallelität atomar: `insert ... on
-- conflict do update set next_seq = next_seq + 1 returning next_seq` sperrt
-- genau eine Zeile.
create table realtime_audience_counters (
  audience_key text primary key,
  next_seq bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table realtime_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- ZUSTELLADRESSE, immer 'benutzer:<uuid>'. Zwei Schichten (siehe
  -- apps/api/src/services/realtime-audience.ts):
  --   1. Fach-Zielgruppe = AUTORISIERUNGSREGEL ('schueler:<id>',
  --      'standort:<id>:buero', 'rolle:geschaeftsfuehrung', …)
  --   2. Auflösung auf konkrete Benutzer = ZUSTELLADRESSE (hier)
  -- Grund: nur so hat ein Abonnent EINEN dichten Cursor statt eines Vektors
  -- aus Cursorn je Zielgruppe. Wird ausschließlich serverseitig gebildet,
  -- nie aus Clienteingaben.
  audience_key text not null,
  -- Dichter Cursor je Empfänger. Client speichert ihn und setzt damit fort.
  audience_seq bigint not null,
  event_id uuid not null references event_outbox(id) on delete cascade,
  event_type text not null,
  -- Grobes Thema ohne jede Kennung – der Client leitet daraus ab, welche
  -- Abfrage er erneuern muss. NIE eine Datensatz-ID, nie Fachinhalt.
  data_type text not null,
  standort_id uuid references standorte(id),
  created_at timestamptz not null default now(),
  -- Cursor ist eindeutig je Empfänger (dichte Folge).
  unique (audience_key, audience_seq),
  -- Doppelter Fanout desselben Ereignisses an denselben Empfänger ist
  -- wirkungslos. Der Outbox-Konsument ist über event_inbox schon
  -- dedupliziert; das hier ist die zweite Sperre auf DB-Ebene.
  unique (audience_key, event_id)
);

-- Der Lesepfad des Kanals: "alles ab meinem Cursor, aufsteigend".
create index realtime_deliveries_cursor_idx
  on realtime_deliveries(audience_key, audience_seq);
-- Aufräumen nach Alter (Job `realtime.prune`).
create index realtime_deliveries_created_idx on realtime_deliveries(created_at);

comment on table realtime_deliveries is
  'PROMPT -1 §6: autorisierter Fanout der Outbox. Traegt NUR Ereignis-ID und grobes data_type – niemals Nutzlast. audience_seq ist ein dichter Cursor je Empfaenger (kein globales Volumen-Leck, exakte Lueckenerkennung).';
