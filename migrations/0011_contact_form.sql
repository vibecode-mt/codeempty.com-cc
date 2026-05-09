CREATE TABLE IF NOT EXISTS contact_form_settings (
  id TEXT PRIMARY KEY,
  fields_json TEXT NOT NULL,
  captcha_json TEXT NOT NULL,
  delivery_json TEXT NOT NULL,
  submit_button_label TEXT NOT NULL DEFAULT 'Send message',
  success_message TEXT NOT NULL DEFAULT 'Thanks! Your message has been sent.',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  source_page_slug TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at
  ON contact_submissions(created_at DESC);
