-- Server-side publish: a long-running job that copies a project to a remote
-- destination by walking individual media uploads + a final /import POST.
-- Long enough that one Worker invocation can't finish it on the free tier
-- (50 subrequests / 30s wall-clock), so the work is split across recursive
-- /process invocations and the job's progress is tracked here.
CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'create',
  target_project_id TEXT,
  label TEXT,
  status TEXT NOT NULL,                       -- pending | processing | done | failed
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_label TEXT,
  result_project_id TEXT,
  result_slug TEXT,
  error TEXT,
  state_json TEXT,                            -- {destApiUrl, destToken, keyMap, droppedKeys, prePublishVersionId}
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_publish_jobs_project ON publish_jobs(project_id, created_at DESC);
CREATE INDEX idx_publish_jobs_status ON publish_jobs(status, updated_at);
