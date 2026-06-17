ALTER TABLE jobs ADD COLUMN last_raw_telemetry_at TEXT;
ALTER TABLE jobs ADD COLUMN raw_chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN raw_payload_available INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN raw_status TEXT;

CREATE TABLE IF NOT EXISTS telemetry_sources (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_telemetry_sources_project_seen
  ON telemetry_sources(project_slug, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_sources_kind
  ON telemetry_sources(source_kind);

CREATE TABLE IF NOT EXISTS telemetry_streams (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  task_id TEXT,
  title TEXT,
  status TEXT NOT NULL,
  latest_activity TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  latest_telemetry_at TEXT NOT NULL,
  latest_raw_telemetry_at TEXT,
  terminal_at TEXT,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  linked_job_id TEXT,
  FOREIGN KEY (source_id) REFERENCES telemetry_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telemetry_streams_project_updated
  ON telemetry_streams(project_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_streams_kind
  ON telemetry_streams(stream_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_streams_linked_job
  ON telemetry_streams(linked_job_id);

CREATE TABLE IF NOT EXISTS telemetry_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  task_id TEXT,
  sequence INTEGER NOT NULL,
  r2_key TEXT,
  byte_size INTEGER NOT NULL,
  uncompressed_byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  terminal_status TEXT,
  payload_inline_json TEXT,
  FOREIGN KEY (source_id) REFERENCES telemetry_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (stream_id) REFERENCES telemetry_streams(id) ON DELETE CASCADE,
  UNIQUE(stream_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_chunks_stream_sequence
  ON telemetry_chunks(stream_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_chunks_project_created
  ON telemetry_chunks(project_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_chunks_runner_task
  ON telemetry_chunks(project_slug, task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_conflicts (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  existing_chunk_id TEXT,
  existing_sha256 TEXT NOT NULL,
  received_sha256 TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_telemetry_conflicts_stream
  ON telemetry_conflicts(stream_id, sequence, created_at DESC);

CREATE TABLE IF NOT EXISTS local_threads (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  stream_kind TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  latest_activity TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_telemetry_at TEXT NOT NULL,
  latest_raw_telemetry_at TEXT,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  linked_runner_job_id TEXT,
  raw_chunk_count INTEGER NOT NULL DEFAULT 0,
  raw_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_local_threads_project_updated
  ON local_threads(project_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_threads_source
  ON local_threads(source_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_threads_linked_runner
  ON local_threads(linked_runner_job_id);
