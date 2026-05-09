-- Add is_home flag to pages
ALTER TABLE pages ADD COLUMN is_home INTEGER NOT NULL DEFAULT 0;

-- At most one page may be flagged as home
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_is_home_one
  ON pages(is_home) WHERE is_home = 1;

-- Seed default home Page (with project_list widget) if no home exists yet.
-- We use deterministic IDs prefixed with 'seed-' so re-running this migration
-- (which D1 migrations don't actually do) wouldn't double-insert.
INSERT INTO pages (id, slug, title, published, show_in_menu, is_home, created_at, updated_at)
SELECT 'seed-home-page', 'home', 'Projects', 1, 0, 1, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE is_home = 1)
  AND NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'home');

INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, created_at, updated_at)
SELECT 'seed-home-widget', 'page', 'seed-home-page', 'widget', '{"kind":"project_list"}', 0, datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM pages WHERE id = 'seed-home-page')
  AND NOT EXISTS (SELECT 1 FROM content_elements WHERE id = 'seed-home-widget');

-- Seed blog Page (with blog_list widget) if a page with slug 'blog' doesn't exist yet.
INSERT INTO pages (id, slug, title, published, show_in_menu, is_home, created_at, updated_at)
SELECT 'seed-blog-page', 'blog', 'Blog', 1, 1, 0, datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'blog');

INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, created_at, updated_at)
SELECT 'seed-blog-widget', 'page', 'seed-blog-page', 'widget', '{"kind":"blog_list"}', 0, datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM pages WHERE id = 'seed-blog-page')
  AND NOT EXISTS (SELECT 1 FROM content_elements WHERE id = 'seed-blog-widget');
