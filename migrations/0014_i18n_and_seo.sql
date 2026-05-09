ALTER TABLE projects ADD COLUMN seo_title TEXT;
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
CREATE INDEX IF NOT EXISTS idx_content_element_translations_language ON content_element_translations(language);
