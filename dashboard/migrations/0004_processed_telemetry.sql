CREATE TABLE IF NOT EXISTS processing_leases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_processing_leases_expiry
  ON processing_leases(expires_at);

CREATE TABLE IF NOT EXISTS processed_streams (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  latest_activity TEXT,
  next_action TEXT,
  blocker_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  cost_json TEXT NOT NULL DEFAULT '{}',
  linked_streams_json TEXT NOT NULL DEFAULT '[]',
  deterministic_version TEXT NOT NULL,
  model_version TEXT,
  prompt_hash TEXT,
  processed_through_sequence INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_processed_streams_project_activity
  ON processed_streams(project_slug, latest_activity DESC);
CREATE INDEX IF NOT EXISTS idx_processed_streams_project_processed
  ON processed_streams(project_slug, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_processed_streams_kind
  ON processed_streams(stream_kind, processed_at DESC);

CREATE TABLE IF NOT EXISTS project_memory (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  memory_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_strength TEXT NOT NULL,
  model_confidence TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_project_memory_project_updated
  ON project_memory(project_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_memory_project_kind
  ON project_memory(project_slug, memory_kind, superseded_by);

CREATE TABLE IF NOT EXISTS processing_runs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  chunks_seen INTEGER NOT NULL DEFAULT 0,
  chunks_processed INTEGER NOT NULL DEFAULT 0,
  streams_updated INTEGER NOT NULL DEFAULT 0,
  memories_updated INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_project_started
  ON processing_runs(project_slug, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_runs_status
  ON processing_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS account_usage_snapshots (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  source_id TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  weekly_remaining_json TEXT,
  rolling_5h_remaining_json TEXT,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  reset_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_account_usage_project_collected
  ON account_usage_snapshots(project_slug, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_usage_source_collected
  ON account_usage_snapshots(source_id, collected_at DESC);
