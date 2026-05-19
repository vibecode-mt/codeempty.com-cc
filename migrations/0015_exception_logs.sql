CREATE TABLE IF NOT EXISTS exception_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  error_name TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_exception_logs_created_at
  ON exception_logs(created_at DESC);
