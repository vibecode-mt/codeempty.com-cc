CREATE TABLE project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_num INTEGER NOT NULL,
  label TEXT,
  snapshot_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, version_num)
);
CREATE INDEX idx_project_versions_project ON project_versions(project_id, version_num DESC);

CREATE TABLE publish_destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'write',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE upload_sessions (
  upload_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (upload_id, r2_key)
);

CREATE TABLE idempotency_log (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
