/**
 * Datenbankschema als versionierte, vorwaertsgerichtete Migrationen.
 *
 * Regeln:
 *  - Migrationen werden nie nachtraeglich editiert. Eine bereits angewandte
 *    Migration mit geaenderter Pruefsumme laesst den Start fehlschlagen.
 *  - Jede Migration ist in eine Transaktion eingeschlossen (siehe db/index.ts).
 *  - Fachliche Invarianten (Freigabepflicht, Rechtestatus) werden zusaetzlich
 *    auf DB-Ebene durch CHECK-Constraints und Trigger abgesichert, damit sie
 *    auch bei einem Fehler in der Anwendungsschicht halten.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core_identity_and_audit',
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  disabled_at   TEXT
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- Unveraenderliches Ereignisprotokoll. Updates und Deletes sind per Trigger
-- verboten; das Protokoll ist die Beweisgrundlage fuer Freigaben und Aenderungen.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('debug','info','warn','error','critical')),
  actor       TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  message     TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_at ON events(at);
CREATE INDEX idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX idx_events_kind ON events(kind);

CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events ist ein unveraenderliches Protokoll: UPDATE nicht erlaubt');
END;
CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events ist ein unveraenderliches Protokoll: DELETE nicht erlaubt');
END;

CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },

  {
    version: 2,
    name: 'brand_knowledge_base',
    sql: `
-- Jede Tatsache traegt einen Verifikationsstatus. Nur VERIFIED darf in
-- veroeffentlichbaren Text einfliessen (durchgesetzt im Fact Verifier Agent).
CREATE TABLE brand_facts (
  id                  TEXT PRIMARY KEY,
  category            TEXT NOT NULL,
  fact_key            TEXT NOT NULL,
  value               TEXT NOT NULL,
  verification_status TEXT NOT NULL
                        CHECK (verification_status IN
                          ('VERIFIED','NEEDS_OWNER_CONFIRMATION','EXPIRED','REJECTED')),
  source              TEXT NOT NULL,
  source_url          TEXT,
  verified_by         TEXT,
  verified_at         TEXT,
  expires_at          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (category, fact_key)
);
CREATE INDEX idx_brand_facts_status ON brand_facts(verification_status);

CREATE TABLE brand_voice_versions (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL UNIQUE,
  markdown       TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  change_summary TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL
);

CREATE TABLE brand_phrases (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('preferred','forbidden','local_term')),
  text       TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, text)
);

CREATE TABLE content_pillars (
  id           TEXT PRIMARY KEY,
  pillar_key   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  target_share REAL NOT NULL CHECK (target_share >= 0 AND target_share <= 1),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE audience_segments (
  id             TEXT PRIMARY KEY,
  segment_key    TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  objections_json TEXT NOT NULL DEFAULT '[]',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

-- Onboarding-Interview: eine Frage nach der anderen, Antworten nachvollziehbar.
CREATE TABLE onboarding_answers (
  id          TEXT PRIMARY KEY,
  question_key TEXT NOT NULL UNIQUE,
  question    TEXT NOT NULL,
  answer      TEXT,
  challenged  INTEGER NOT NULL DEFAULT 0 CHECK (challenged IN (0,1)),
  challenge_note TEXT,
  answered_at TEXT,
  answered_by TEXT
);
`,
  },

  {
    version: 3,
    name: 'media_archive',
    sql: `
CREATE TABLE media_assets (
  id                 TEXT PRIMARY KEY,
  source             TEXT NOT NULL,          -- higgsfield | upload | drive | local
  source_ref         TEXT,                   -- externe ID beim Quellsystem
  kind               TEXT NOT NULL CHECK (kind IN ('image','video','audio')),
  url                TEXT,
  local_path         TEXT,
  mime               TEXT,
  width              INTEGER,
  height             INTEGER,
  duration_s         REAL,
  orientation        TEXT CHECK (orientation IN ('portrait','landscape','square', NULL)),
  capture_date       TEXT,
  capture_location   TEXT,
  quality_score      REAL NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),

  -- Rechte- und Einwilligungsstatus. Beide muessen CLEARED sein, damit ein
  -- Asset veroeffentlicht werden darf. Default ist bewusst UNKNOWN:
  -- die blosse Existenz einer Datei ist keine Einwilligung.
  consent_status     TEXT NOT NULL DEFAULT 'UNKNOWN'
                       CHECK (consent_status IN ('UNKNOWN','NOT_REQUIRED','PENDING','CLEARED','REFUSED','WITHDRAWN')),
  rights_status      TEXT NOT NULL DEFAULT 'UNKNOWN'
                       CHECK (rights_status IN ('UNKNOWN','OWNED','LICENSED','PLATFORM_AUTHORIZED','RESTRICTED','FORBIDDEN')),
  licence            TEXT,
  licence_expires_at TEXT,

  plate_visible      TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (plate_visible IN ('UNKNOWN','YES','NO','BLURRED')),
  minors_present     TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (minors_present IN ('UNKNOWN','YES','NO')),
  faces_present      TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (faces_present IN ('UNKNOWN','YES','NO')),
  people_json        TEXT NOT NULL DEFAULT '[]',
  tags_json          TEXT NOT NULL DEFAULT '[]',
  search_text        TEXT NOT NULL DEFAULT '',
  restriction_notes  TEXT,
  checksum           TEXT,
  review_status      TEXT NOT NULL DEFAULT 'QUEUED'
                       CHECK (review_status IN ('QUEUED','IN_REVIEW','APPROVED','BLOCKED')),
  indexed_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  last_used_at       TEXT,
  use_count          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, source_ref)
);
CREATE INDEX idx_media_kind ON media_assets(kind);
CREATE INDEX idx_media_review ON media_assets(review_status);
CREATE INDEX idx_media_last_used ON media_assets(last_used_at);

-- Volltextindex fuer die semantische/lexikalische Archivsuche.
CREATE VIRTUAL TABLE media_fts USING fts5(
  asset_id UNINDEXED,
  search_text,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE media_reviews (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  reviewer_user_id TEXT REFERENCES users(id),
  reviewer_agent   TEXT,
  decision         TEXT NOT NULL CHECK (decision IN ('APPROVED','BLOCKED','NEEDS_INFO')),
  findings_json    TEXT NOT NULL DEFAULT '[]',
  note             TEXT,
  at               TEXT NOT NULL
);
CREATE INDEX idx_media_reviews_asset ON media_reviews(asset_id);

CREATE TABLE media_usage (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL,
  at              TEXT NOT NULL
);
CREATE INDEX idx_media_usage_asset ON media_usage(asset_id);
`,
  },

  {
    version: 4,
    name: 'research_planning_production',
    sql: `
CREATE TABLE opportunities (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('durable_brand_topic','local_opportunity','platform_trend','short_lived_trend','regulatory_topic')),
  summary         TEXT NOT NULL,
  evidence_json   TEXT NOT NULL DEFAULT '[]',
  scores_json     TEXT NOT NULL DEFAULT '{}',
  total_score     REAL NOT NULL DEFAULT 0,
  shelf_life_days INTEGER NOT NULL DEFAULT 30,
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0,1)),
  status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','shortlisted','planned','rejected','expired')),
  reject_reason   TEXT,
  source          TEXT NOT NULL,
  discovered_at   TEXT NOT NULL,
  expires_at      TEXT
);
CREATE INDEX idx_opportunities_status ON opportunities(status, total_score);

CREATE TABLE strategies (
  id           TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  markdown     TEXT NOT NULL,
  goals_json   TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at   TEXT NOT NULL
);

CREATE TABLE plan_items (
  id                  TEXT PRIMARY KEY,
  strategy_id         TEXT REFERENCES strategies(id) ON DELETE SET NULL,
  opportunity_id      TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  platform            TEXT NOT NULL,
  objective           TEXT NOT NULL,
  audience_segment    TEXT NOT NULL,
  pillar              TEXT NOT NULL,
  hook                TEXT NOT NULL,
  angle               TEXT NOT NULL,
  format              TEXT NOT NULL,
  duration_s          INTEGER,
  required_media_json TEXT NOT NULL DEFAULT '[]',
  script_json         TEXT NOT NULL DEFAULT '{}',
  cta                 TEXT NOT NULL,
  proposed_publish_at TEXT NOT NULL,
  hypothesis          TEXT NOT NULL,
  risk_flags_json     TEXT NOT NULL DEFAULT '[]',
  experiment_id       TEXT,
  status              TEXT NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','in_production','produced','dropped')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_plan_items_publish ON plan_items(proposed_publish_at);
CREATE INDEX idx_plan_items_status ON plan_items(status);

CREATE TABLE content_items (
  id                 TEXT PRIMARY KEY,
  plan_item_id       TEXT REFERENCES plan_items(id) ON DELETE SET NULL,
  platform           TEXT NOT NULL,
  account_id         TEXT,
  format             TEXT NOT NULL,
  title              TEXT NOT NULL,
  hook_variants_json TEXT NOT NULL DEFAULT '[]',
  script             TEXT NOT NULL DEFAULT '',
  shot_list_json     TEXT NOT NULL DEFAULT '[]',
  edl_json           TEXT NOT NULL DEFAULT '[]',
  on_screen_text_json TEXT NOT NULL DEFAULT '[]',
  subtitles_srt      TEXT,
  caption            TEXT NOT NULL DEFAULT '',
  cover_concept      TEXT,
  alt_text           TEXT NOT NULL DEFAULT '',
  cta                TEXT NOT NULL DEFAULT '',
  hashtags_json      TEXT NOT NULL DEFAULT '[]',
  story_followup_json TEXT NOT NULL DEFAULT '[]',
  pin_comment        TEXT,
  first_hour_plan    TEXT,
  asset_ids_json     TEXT NOT NULL DEFAULT '[]',
  content_hash       TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  state              TEXT NOT NULL DEFAULT 'draft' CHECK (state IN
                       ('draft','in_review','rejected','awaiting_approval','approved',
                        'scheduled','publishing','published','failed','cancelled')),
  scheduled_for      TEXT,
  experiment_id      TEXT,
  experiment_variant TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_content_state ON content_items(state);
CREATE INDEX idx_content_scheduled ON content_items(scheduled_for);

CREATE TABLE content_versions (
  id              TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  snapshot_json   TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  change_summary  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  UNIQUE (content_item_id, version)
);

CREATE TABLE review_findings (
  id              TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  agent           TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warn','block')),
  code            TEXT NOT NULL,
  message         TEXT NOT NULL,
  blocking        INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0,1)),
  evidence_json   TEXT NOT NULL DEFAULT '{}',
  resolved_at     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_findings_item ON review_findings(content_item_id);
`,
  },

  {
    version: 5,
    name: 'approval_gate',
    sql: `
-- Eine Freigabe ist immer an einen konkreten Inhalts-Hash gebunden.
-- Aendert sich Medium, Aussage, CTA, Plattform oder Zeitpunkt, aendert sich
-- der Hash und die Freigabe passt nicht mehr - erneute Freigabe erforderlich.
CREATE TABLE approvals (
  id              TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  content_hash    TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN
                    ('approve_once','approve_with_edits','reject','return_to_concept','schedule','publish_now','cancel')),
  decided_by      TEXT NOT NULL REFERENCES users(id),
  decided_at      TEXT NOT NULL,
  note            TEXT,
  edits_json      TEXT NOT NULL DEFAULT '[]',
  scheduled_for   TEXT,
  revoked_at      TEXT,
  revoked_reason  TEXT
);
CREATE INDEX idx_approvals_item ON approvals(content_item_id);
CREATE INDEX idx_approvals_hash ON approvals(content_hash);

CREATE TRIGGER trg_approvals_no_delete BEFORE DELETE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'Freigabe-Entscheidungen duerfen nicht geloescht werden (Widerruf statt Loeschung)');
END;
`,
  },

  {
    version: 6,
    name: 'accounts_and_publishing',
    sql: `
CREATE TABLE credentials (
  id         TEXT PRIMARY KEY,
  ref        TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT
);

CREATE TABLE platform_accounts (
  id               TEXT PRIMARY KEY,
  platform         TEXT NOT NULL CHECK (platform IN ('instagram','facebook','tiktok','youtube','sandbox')),
  handle           TEXT NOT NULL,
  external_id      TEXT,
  display_name     TEXT NOT NULL,
  credential_ref   TEXT REFERENCES credentials(ref),
  -- is_public=0 kennzeichnet Ziele, die nichts oeffentlich machen (Sandbox).
  -- Diese Kennzeichnung wird in der Oberflaeche und im Audit-Log gefuehrt,
  -- damit ein Sandbox-Lauf niemals als echte Veroeffentlichung gilt.
  is_public        INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  scopes_json      TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'unconfigured'
                     CHECK (status IN ('unconfigured','connected','token_expired','error','disabled')),
  connected_at     TEXT,
  token_expires_at TEXT,
  last_check_at    TEXT,
  last_check_error TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (platform, handle)
);

CREATE TABLE publish_jobs (
  id               TEXT PRIMARY KEY,
  content_item_id  TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  approval_id      TEXT NOT NULL REFERENCES approvals(id),
  platform         TEXT NOT NULL,
  account_id       TEXT NOT NULL REFERENCES platform_accounts(id),
  -- Verhindert Doppelveroeffentlichung ueber Neustarts und Wiederholungen.
  idempotency_key  TEXT NOT NULL UNIQUE,
  approved_hash    TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'queued' CHECK (state IN
                     ('queued','running','awaiting_verification','succeeded','failed','dead_letter','cancelled')),
  run_at           TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  next_retry_at    TEXT,
  last_error       TEXT,
  last_error_class TEXT,
  external_post_id TEXT,
  external_url     TEXT,
  locked_by        TEXT,
  locked_at        TEXT,
  verified_at      TEXT,
  dead_lettered_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_jobs_state_runat ON publish_jobs(state, run_at);
CREATE INDEX idx_jobs_item ON publish_jobs(content_item_id);

CREATE TABLE job_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  state       TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_job_events_job ON job_events(job_id);

CREATE TABLE system_alerts (
  id              TEXT PRIMARY KEY,
  at              TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('warn','error','critical')),
  code            TEXT NOT NULL,
  message         TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT
);
CREATE INDEX idx_alerts_open ON system_alerts(acknowledged_at, at);
`,
  },

  {
    version: 7,
    name: 'analytics_experiments',
    sql: `
CREATE TABLE metric_snapshots (
  id               TEXT PRIMARY KEY,
  content_item_id  TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  external_post_id TEXT,
  window_key       TEXT NOT NULL CHECK (window_key IN ('t2h','t24h','t72h','t7d','manual')),
  collected_at     TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('platform_api','manual_import','sandbox')),
  metrics_json     TEXT NOT NULL,
  UNIQUE (content_item_id, window_key, source)
);
CREATE INDEX idx_metrics_item ON metric_snapshots(content_item_id);

CREATE TABLE scores (
  id               TEXT PRIMARY KEY,
  content_item_id  TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  window_key       TEXT NOT NULL,
  virality_score   REAL,
  business_score   REAL,
  virality_confidence TEXT NOT NULL DEFAULT 'low',
  business_confidence TEXT NOT NULL DEFAULT 'low',
  explanation_json TEXT NOT NULL DEFAULT '{}',
  computed_at      TEXT NOT NULL,
  UNIQUE (content_item_id, window_key)
);

CREATE TABLE experiments (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  hypothesis     TEXT NOT NULL,
  variable       TEXT NOT NULL CHECK (variable IN
                   ('hook','opening_visual','duration','cover','caption_length','cta','publish_time','topic_framing')),
  variants_json  TEXT NOT NULL,
  min_sample_per_variant INTEGER NOT NULL DEFAULT 5,
  primary_metric TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','running','concluded','abandoned')),
  started_at     TEXT,
  concluded_at   TEXT,
  conclusion     TEXT,
  confounders    TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE experiment_assignments (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  variant         TEXT NOT NULL,
  assigned_at     TEXT NOT NULL,
  UNIQUE (experiment_id, content_item_id)
);
`,
  },

  {
    version: 8,
    name: 'community_and_leads',
    sql: `
CREATE TABLE inbox_messages (
  id                 TEXT PRIMARY KEY,
  platform           TEXT NOT NULL,
  account_id         TEXT REFERENCES platform_accounts(id),
  external_id        TEXT NOT NULL,
  thread_id          TEXT,
  kind               TEXT NOT NULL CHECK (kind IN ('comment','dm','mention')),
  -- Kein Klarname-Speicher ohne Notwendigkeit: der Handle wird gehasht
  -- gespeichert, der Anzeigename nur solange die Konversation offen ist.
  author_handle_hash TEXT NOT NULL,
  author_display     TEXT,
  body               TEXT NOT NULL,
  received_at        TEXT NOT NULL,
  classification     TEXT CHECK (classification IN
                       ('general_question','pricing_availability','licence_class','complaint',
                        'urgent_safety','spam','partnership','high_value_lead', NULL)),
  confidence         REAL,
  lead_score         REAL,
  status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','triaged','answered','ignored','escalated')),
  content_item_id    TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  redacted_at        TEXT,
  UNIQUE (platform, external_id)
);
CREATE INDEX idx_inbox_status ON inbox_messages(status, received_at);

CREATE TABLE reply_drafts (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_by_agent TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'awaiting_approval'
                 CHECK (state IN ('awaiting_approval','approved','rejected','sent','failed')),
  approved_by  TEXT REFERENCES users(id),
  approved_at  TEXT,
  sent_at      TEXT,
  external_id  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE leads (
  id                     TEXT PRIMARY KEY,
  message_id             TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  source_content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  stage                  TEXT NOT NULL DEFAULT 'new'
                           CHECK (stage IN ('new','qualified','appointment','registered','lost')),
  licence_class          TEXT,
  location               TEXT,
  note                   TEXT,
  appointment_at         TEXT,
  registered_at          TEXT,
  revenue_cents          INTEGER,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_source ON leads(source_content_item_id);
`,
  },

  {
    version: 9,
    name: 'learning_and_governance',
    sql: `
CREATE TABLE prompt_versions (
  id             TEXT PRIMARY KEY,
  agent_key      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  body           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  change_summary TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  UNIQUE (agent_key, version)
);

CREATE TABLE postmortems (
  id                     TEXT PRIMARY KEY,
  content_item_id        TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  predicted_json         TEXT NOT NULL DEFAULT '{}',
  actual_json            TEXT NOT NULL DEFAULT '{}',
  wrong_assumptions      TEXT,
  failure_class          TEXT CHECK (failure_class IN
                           ('strategic','creative','factual','operational','technical','measurement','none')),
  contributing_component TEXT,
  evidence_json          TEXT NOT NULL DEFAULT '{}',
  smallest_safe_change   TEXT,
  proposal_id            TEXT,
  created_at             TEXT NOT NULL
);

-- Aenderungsvorschlaege. Der Weg in die Produktion fuehrt ausschliesslich
-- ueber: Evidenz -> Vorschlag -> Tests -> keine Regression -> Owner-Freigabe.
CREATE TABLE change_proposals (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  target_kind       TEXT NOT NULL CHECK (target_kind IN
                      ('prompt','rule','schedule','pillar_mix','hashtag_strategy','scoring_weight','other')),
  target_ref        TEXT NOT NULL,
  current_value     TEXT NOT NULL,
  proposed_value    TEXT NOT NULL,
  evidence_json     TEXT NOT NULL DEFAULT '{}',
  test_results_json TEXT NOT NULL DEFAULT '{}',
  risk_class        TEXT NOT NULL DEFAULT 'medium' CHECK (risk_class IN ('low','medium','high','forbidden')),
  state             TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN
                      ('proposed','testing','tests_failed','ready_for_owner','approved','applied','rejected','rolled_back')),
  created_at        TEXT NOT NULL,
  decided_at        TEXT,
  decided_by        TEXT REFERENCES users(id),
  applied_at        TEXT,
  rolled_back_at    TEXT,
  rollback_ref      TEXT
);

CREATE TABLE learning_reports (
  id           TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  markdown     TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

-- Benchmark-Beispiele (stark/schwach) fuer Regressionstests der Textqualitaet.
CREATE TABLE benchmark_examples (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL CHECK (label IN ('strong','weak')),
  platform   TEXT NOT NULL,
  format     TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },

  {
    version: 10,
    name: 'publishing_invariants',
    sql: `
-- Letzte Verteidigungslinie auf Datenbankebene: ein Job darf nur angelegt
-- werden, wenn das Content-Item freigegeben ist UND der freigegebene Hash
-- exakt dem aktuellen Inhalt entspricht. Ein Fehler in der Anwendungsschicht
-- kann diese Regel nicht umgehen.
CREATE TRIGGER trg_publish_requires_approval BEFORE INSERT ON publish_jobs
BEGIN
  SELECT CASE
    WHEN (SELECT state FROM content_items WHERE id = NEW.content_item_id)
         NOT IN ('approved','scheduled')
      THEN RAISE(ABORT, 'Veroeffentlichung abgelehnt: Content-Item ist nicht freigegeben')
    WHEN (SELECT content_hash FROM content_items WHERE id = NEW.content_item_id) <> NEW.approved_hash
      THEN RAISE(ABORT, 'Veroeffentlichung abgelehnt: Inhalt hat sich seit der Freigabe geaendert')
    WHEN (SELECT COUNT(*) FROM approvals
          WHERE id = NEW.approval_id
            AND content_item_id = NEW.content_item_id
            AND content_hash = NEW.approved_hash
            AND decision IN ('approve_once','approve_with_edits','schedule','publish_now')
            AND revoked_at IS NULL) = 0
      THEN RAISE(ABORT, 'Veroeffentlichung abgelehnt: keine gueltige Freigabe fuer diesen Inhalts-Hash')
  END;
END;

-- Ein Content-Item darf nur dann in 'approved' wechseln, wenn keine
-- blockierende, ungeloeste Pruefmeldung offen ist.
CREATE TRIGGER trg_no_approve_with_blocking_findings BEFORE UPDATE OF state ON content_items
WHEN NEW.state = 'approved' AND OLD.state <> 'approved'
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM review_findings
          WHERE content_item_id = NEW.id AND blocking = 1 AND resolved_at IS NULL) > 0
      THEN RAISE(ABORT, 'Freigabe abgelehnt: offene blockierende Pruefmeldungen vorhanden')
  END;
END;
`,
  },

  {
    version: 11,
    name: 'opportunity_topic_binding',
    sql: `
-- Eine Themenchance entsteht immer aus einer bestimmten Saeule und fuer eine
-- bestimmte Zielgruppe. Ohne diese Bindung hat der Wochenplan Hook, Saeule und
-- Zielgruppe unabhaengig voneinander vergeben - das ergab Beitraege, deren
-- Aufhaenger, Thema und Adressat nicht zusammenpassten.
ALTER TABLE opportunities ADD COLUMN pillar_key TEXT;
ALTER TABLE opportunities ADD COLUMN segment_key TEXT;
ALTER TABLE opportunities ADD COLUMN objection TEXT;
`,
  },
];
