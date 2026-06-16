CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  task_id TEXT NOT NULL,
  session_name TEXT,
  observer_session_name TEXT,
  remote_host TEXT,
  status TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_activity TEXT NOT NULL,
  is_stuck INTEGER NOT NULL DEFAULT 0,
  progress_percent REAL,
  progress_confidence TEXT NOT NULL,
  eta_minutes_min REAL,
  eta_minutes_max REAL,
  eta_confidence TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  status_json TEXT NOT NULL,
  log_file TEXT,
  log_tail TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project_slug ON jobs(project_slug);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  generated_at TEXT,
  summary_json TEXT NOT NULL,
  status_json TEXT NOT NULL,
  log_tail TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_summaries_job_received ON summaries(job_id, received_at DESC);
