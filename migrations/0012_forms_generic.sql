CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  fields_json TEXT NOT NULL,
  captcha_json TEXT NOT NULL,
  delivery_json TEXT NOT NULL,
  submit_action_type TEXT NOT NULL DEFAULT 'message',
  submit_action_value TEXT,
  success_message TEXT NOT NULL DEFAULT 'Thanks! Your submission has been saved.',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  source_page_slug TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created
  ON form_submissions(form_id, created_at DESC);
