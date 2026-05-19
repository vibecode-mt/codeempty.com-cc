export interface MigrationEntry {
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    name: '0001_initial.sql',
    sql: `-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions (admin UI cookie auth)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth apps (for MCP / external API consumers)
CREATE TABLE IF NOT EXISTS oauth_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  client_secret_salt TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'read',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth bearer tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Portfolio projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Steps within a project
CREATE TABLE IF NOT EXISTS project_steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Static CMS pages (e.g. about)
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Blog / diary entries
CREATE TABLE IF NOT EXISTS blog_entries (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Content elements (polymorphic: project_step | page | blog_entry)
CREATE TABLE IF NOT EXISTS content_elements (
  id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_content_elements_parent
  ON content_elements(parent_type, parent_id, sort_order);

-- Common scripts (Google Analytics, Clarity, etc.)
CREATE TABLE IF NOT EXISTS common_scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  html_snippet TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'head',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- KV cache tracking for invalidation
CREATE TABLE IF NOT EXISTS cache_keys (
  cache_key TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);`,
  },
  {
    name: '0002_pages_show_in_menu.sql',
    sql: `ALTER TABLE pages ADD COLUMN show_in_menu INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    name: '0003_project_video.sql',
    sql: `ALTER TABLE projects ADD COLUMN video_key TEXT;
ALTER TABLE projects ADD COLUMN video_url TEXT;
ALTER TABLE project_steps ADD COLUMN video_timestamp_ms INTEGER;
ALTER TABLE content_elements ADD COLUMN video_timestamp_ms INTEGER;`,
  },
  {
    name: '0004_tags.sql',
    sql: `ALTER TABLE project_steps ADD COLUMN tags TEXT;
ALTER TABLE content_elements ADD COLUMN tags TEXT;`,
  },
  {
    name: '0005_render_style.sql',
    sql: `ALTER TABLE content_elements ADD COLUMN render_style TEXT;`,
  },
  {
    name: '0006_hidden.sql',
    sql: `ALTER TABLE project_steps ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_elements ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    name: '0007_youtube_url.sql',
    sql: `ALTER TABLE projects ADD COLUMN youtube_url TEXT;`,
  },
  {
    name: '0008_publish_versioning.sql',
    sql: `CREATE TABLE project_versions (
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
);`,
  },
  {
    name: '0009_publish_jobs.sql',
    sql: `CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'create',
  target_project_id TEXT,
  label TEXT,
  status TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_label TEXT,
  result_project_id TEXT,
  result_slug TEXT,
  error TEXT,
  state_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_publish_jobs_project ON publish_jobs(project_id, created_at DESC);
CREATE INDEX idx_publish_jobs_status ON publish_jobs(status, updated_at);`,
  },
  {
    name: '0010_pages_home_and_widgets.sql',
    sql: `ALTER TABLE pages ADD COLUMN is_home INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_is_home_one
  ON pages(is_home) WHERE is_home = 1;

INSERT INTO pages (id, slug, title, published, show_in_menu, is_home, created_at, updated_at)
SELECT 'seed-home-page', 'home', 'Projects', 1, 0, 1, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE is_home = 1)
  AND NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'home');

INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, created_at, updated_at)
SELECT 'seed-home-widget', 'page', 'seed-home-page', 'widget', '{"kind":"project_list"}', 0, datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM pages WHERE id = 'seed-home-page')
  AND NOT EXISTS (SELECT 1 FROM content_elements WHERE id = 'seed-home-widget');

INSERT INTO pages (id, slug, title, published, show_in_menu, is_home, created_at, updated_at)
SELECT 'seed-blog-page', 'blog', 'Blog', 1, 1, 0, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'blog');

INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, created_at, updated_at)
SELECT 'seed-blog-widget', 'page', 'seed-blog-page', 'widget', '{"kind":"blog_list"}', 0, datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM pages WHERE id = 'seed-blog-page')
  AND NOT EXISTS (SELECT 1 FROM content_elements WHERE id = 'seed-blog-widget');`,
  },
  {
    name: '0011_contact_form.sql',
    sql: `CREATE TABLE IF NOT EXISTS contact_form_settings (
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
  ON contact_submissions(created_at DESC);`,
  },
  {
    name: '0012_forms_generic.sql',
    sql: `CREATE TABLE IF NOT EXISTS forms (
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
  ON form_submissions(form_id, created_at DESC);`,
  },
  {
    name: '0013_drop_contact_tables.sql',
    sql: `DROP TABLE IF EXISTS contact_submissions;
DROP TABLE IF EXISTS contact_form_settings;`,
  },
  {
    name: '0014_i18n_and_seo.sql',
    sql: `ALTER TABLE projects ADD COLUMN seo_title TEXT;
ALTER TABLE projects ADD COLUMN seo_description TEXT;

ALTER TABLE pages ADD COLUMN seo_title TEXT;
ALTER TABLE pages ADD COLUMN seo_description TEXT;

ALTER TABLE blog_entries ADD COLUMN seo_title TEXT;
ALTER TABLE blog_entries ADD COLUMN seo_description TEXT;

CREATE TABLE IF NOT EXISTS site_i18n_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_language TEXT NOT NULL DEFAULT 'en',
  supported_languages_json TEXT NOT NULL DEFAULT '["en"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site_i18n_settings (id, default_language, supported_languages_json)
VALUES (1, 'en', '["en"]');

CREATE TABLE IF NOT EXISTS project_translations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT,
  description TEXT,
  seo_title TEXT,
  seo_description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, language)
);

CREATE TABLE IF NOT EXISTS page_translations (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT,
  seo_title TEXT,
  seo_description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, language)
);

CREATE TABLE IF NOT EXISTS blog_entry_translations (
  blog_entry_id TEXT NOT NULL REFERENCES blog_entries(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT,
  seo_title TEXT,
  seo_description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blog_entry_id, language)
);

CREATE TABLE IF NOT EXISTS project_step_translations (
  step_id TEXT NOT NULL REFERENCES project_steps(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  title TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (step_id, language)
);

CREATE TABLE IF NOT EXISTS content_element_translations (
  content_element_id TEXT NOT NULL REFERENCES content_elements(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  content TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (content_element_id, language)
);

CREATE INDEX IF NOT EXISTS idx_project_translations_language ON project_translations(language);
CREATE INDEX IF NOT EXISTS idx_page_translations_language ON page_translations(language);
CREATE INDEX IF NOT EXISTS idx_blog_entry_translations_language ON blog_entry_translations(language);
CREATE INDEX IF NOT EXISTS idx_project_step_translations_language ON project_step_translations(language);
CREATE INDEX IF NOT EXISTS idx_content_element_translations_language ON content_element_translations(language);`,
  },
  {
    name: '0015_exception_logs.sql',
    sql: `CREATE TABLE IF NOT EXISTS exception_logs (
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
  ON exception_logs(created_at DESC);`,
  },
];
