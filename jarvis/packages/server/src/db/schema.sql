-- JARVIS core schema. Applied once, tracked in _migrations.
-- Design notes:
--  * Every row that can be shown to the owner carries provenance + timestamps.
--  * Deletes are soft where the owner may need to audit them, hard where the
--    owner asked to forget (memories support both: soft-delete then purge).
--  * FTS5 is the lexical half of hybrid retrieval; vectors live in `embeddings`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS _migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

/* ── Identity ─────────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','guest')),
  totp_secret   TEXT,                 -- encrypted at rest
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,        -- sha256 of the cookie token, never the token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

/* ── Knowledge base ───────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,      -- immutable, derived from canonical uri
  uri           TEXT NOT NULL UNIQUE,  -- file:///... or https://... or note://...
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,         -- markdown|pdf|docx|xlsx|csv|text|image|html|chat_export
  domain        TEXT NOT NULL DEFAULT 'general-jarvis',
  content_hash  TEXT NOT NULL,
  bytes         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  modified_at   TEXT,
  indexed_at    TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',   -- JSON array of owner tags
  meta          TEXT NOT NULL DEFAULT '{}',   -- JSON: pages, sheets, exif, author...
  sensitivity   TEXT NOT NULL DEFAULT 'internal',
  trust         TEXT NOT NULL DEFAULT 'owner', -- owner|third_party|web  (injection posture)
  superseded_by TEXT REFERENCES sources(id) ON DELETE SET NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(active, modified_at DESC);

CREATE TABLE IF NOT EXISTS chunks (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  loc        TEXT NOT NULL DEFAULT '',   -- "Seite 3" / "Zeile 12-40" / "Blatt X!A1"
  token_est  INTEGER NOT NULL DEFAULT 0,
  hash       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id, ord);

-- External-content FTS index over chunks.text. `prefix` indexes help with the
-- long compound nouns German throws at us (Fahrschul|verwaltungs|software).
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='seq',
  tokenize="unicode61 remove_diacritics 2",
  prefix='2 3 4'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.seq, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.seq, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.seq, new.text);
END;

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id  TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  provider  TEXT NOT NULL,
  model     TEXT NOT NULL,
  dim       INTEGER NOT NULL,
  vec       BLOB NOT NULL,            -- Float32Array, L2-normalised
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(provider, model);

-- Typed edges between sources: the "relationship-aware" half of ranking.
CREATE TABLE IF NOT EXISTS relations (
  id        TEXT PRIMARY KEY,
  from_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  to_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,            -- links_to|same_folder|supersedes|mentions|attached_to
  weight    REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  UNIQUE (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);

/* ── Conversation ─────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL, -- branching
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content         TEXT NOT NULL,       -- JSON: Anthropic content blocks
  text            TEXT NOT NULL DEFAULT '',  -- flattened, for search/summaries
  citations       TEXT NOT NULL DEFAULT '[]',
  mode            TEXT,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

/* ── Memory ───────────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  content     TEXT NOT NULL,          -- encrypted when sensitivity in (private,secret)
  encrypted   INTEGER NOT NULL DEFAULT 0,
  sensitivity TEXT NOT NULL,
  confidence  REAL NOT NULL DEFAULT 0.8,
  provenance  TEXT NOT NULL,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  expires_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_live ON memories(deleted_at, kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject);

CREATE TABLE IF NOT EXISTS memory_revisions (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL,
  revision   INTEGER NOT NULL,
  snapshot   TEXT NOT NULL,           -- JSON of the row BEFORE the change
  changed_by TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memrev ON memory_revisions(memory_id, revision DESC);

CREATE TABLE IF NOT EXISTS memory_proposals (
  id          TEXT PRIMARY KEY,
  op          TEXT NOT NULL CHECK (op IN ('create','update','delete')),
  target_id   TEXT,
  draft       TEXT NOT NULL,          -- JSON
  rationale   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  conversation_id TEXT,
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_memprop_status ON memory_proposals(status, created_at DESC);

-- Narrow, owner-authored automation rules. Only ever widen `reversible_write`
-- and `read_only`; the API refuses to create a rule for any other risk class.
CREATE TABLE IF NOT EXISTS memory_rules (
  id         TEXT PRIMARY KEY,
  pattern    TEXT NOT NULL,           -- matched against memory.subject (LIKE, case-insens.)
  kind       TEXT NOT NULL,
  max_sensitivity TEXT NOT NULL DEFAULT 'internal',
  auto_approve INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

/* ── Projects / chief of staff ────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'allgemein',
  objective     TEXT NOT NULL DEFAULT '',
  current_state TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  domain        TEXT NOT NULL DEFAULT 'general-jarvis',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',
  priority     INTEGER NOT NULL DEFAULT 3,
  due_at       TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);

CREATE TABLE IF NOT EXISTS project_notes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('decision','open_question','risk','next_action')),
  body       TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pnotes ON project_notes(project_id, kind, resolved);

CREATE TABLE IF NOT EXISTS project_sources (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, source_id)
);

/* ── Actions & approvals ──────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS actions (
  id              TEXT PRIMARY KEY,
  tool            TEXT NOT NULL,
  risk            TEXT NOT NULL,
  domain          TEXT NOT NULL,
  target          TEXT NOT NULL,
  payload         TEXT NOT NULL,      -- JSON, exactly what will be executed
  effects         TEXT NOT NULL DEFAULT '[]',
  reversible      INTEGER NOT NULL DEFAULT 0,
  rollback        TEXT,
  safety_review   TEXT NOT NULL,      -- JSON verdict from the Action Safety Reviewer
  status          TEXT NOT NULL DEFAULT 'pending',
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  decided_at      TEXT,
  decided_by      TEXT,
  executed_at     TEXT,
  result          TEXT,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status, created_at DESC);

/* ── Durable job queue ────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|dead|cancelled
  priority        INTEGER NOT NULL DEFAULT 5,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  run_at          TEXT NOT NULL,
  lease_until     TEXT,
  lease_owner     TEXT,
  timeout_ms      INTEGER NOT NULL DEFAULT 120000,
  idempotency_key TEXT UNIQUE,
  last_error      TEXT,
  result          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_at, priority);

/* ── Tamper-evident audit log ─────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS audit_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,           -- user:<id> | system | job:<kind>
  action     TEXT NOT NULL,
  domain     TEXT NOT NULL DEFAULT 'general-jarvis',
  subject    TEXT NOT NULL DEFAULT '',
  outcome    TEXT NOT NULL,           -- ok|denied|error
  detail     TEXT NOT NULL DEFAULT '{}',
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, at DESC);

/* ── Evaluation & controlled improvement ──────────────────────────────────── */

CREATE TABLE IF NOT EXISTS interactions (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  message_id      TEXT,
  mode            TEXT,
  model           TEXT,
  prompt_version  TEXT,
  question_hash   TEXT NOT NULL,      -- hash only: we do not store the question body here
  citations_count INTEGER NOT NULL DEFAULT 0,
  grounded        INTEGER,
  used_web        INTEGER NOT NULL DEFAULT 0,
  used_tools      TEXT NOT NULL DEFAULT '[]',
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  flags           TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_at ON interactions(created_at DESC);

CREATE TABLE IF NOT EXISTS corrections (
  id             TEXT PRIMARY KEY,
  interaction_id TEXT,
  message_id     TEXT,
  category       TEXT NOT NULL,
  what_went_wrong TEXT NOT NULL,
  expected       TEXT NOT NULL DEFAULT '',
  severity       TEXT NOT NULL DEFAULT 'medium',
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  resolved_by_proposal TEXT
);

CREATE TABLE IF NOT EXISTS regression_cases (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  question   TEXT NOT NULL,
  expectation TEXT NOT NULL,          -- JSON: {must_cite:[], must_contain:[], must_not_contain:[], must_refuse:bool}
  origin     TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  config      TEXT NOT NULL,          -- JSON: which prompt version / model
  passed      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  score       REAL NOT NULL DEFAULT 0,
  detail      TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL,           -- e.g. 'system.core'
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  UNIQUE (key, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_active ON prompt_versions(key, active);

CREATE TABLE IF NOT EXISTS improvement_proposals (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  rationale   TEXT NOT NULL,
  diff        TEXT NOT NULL,
  target      TEXT NOT NULL,
  target_key  TEXT NOT NULL,
  evidence    TEXT NOT NULL DEFAULT '[]',
  eval_before REAL,
  eval_after  REAL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT
);

/* ── Integrations & research ──────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS integrations (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,          -- social_autopilot|finance_crypto|imap|caldav|webdav
  label       TEXT NOT NULL,
  base_url    TEXT NOT NULL DEFAULT '',
  credentials TEXT,                   -- AES-256-GCM envelope, never returned by the API
  scopes      TEXT NOT NULL DEFAULT '[]',
  read_only   INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'unknown',
  last_ok_at  TEXT,
  last_error  TEXT,
  expires_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_reports (
  id         TEXT PRIMARY KEY,
  question   TEXT NOT NULL,
  summary    TEXT NOT NULL,
  findings   TEXT NOT NULL DEFAULT '[]',  -- JSON: [{claim, sources:[{url,title,fetched_at}]}]
  sources    TEXT NOT NULL DEFAULT '[]',
  conflicts  TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  created_at TEXT NOT NULL
);
