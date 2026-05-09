import { Hono } from 'hono';
import type { Env, SiteI18nSettings } from '../types';
import { requireAdmin, requireOAuthOrSession } from './middleware';
import {
  ensureI18nSchema,
  getSiteI18nSettings,
  normalizeLanguageCode,
  parseSupportedLanguages,
  saveSiteI18nSettings,
} from '../i18n';

export const i18nRoutes = new Hono<{ Bindings: Env }>();

i18nRoutes.get('/settings', requireOAuthOrSession, async (c) => {
  const settings = await getSiteI18nSettings(c.env);
  return c.json(settings);
});

i18nRoutes.put('/settings', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<SiteI18nSettings>>();
  const defaultLanguage = normalizeLanguageCode(body.default_language);
  if (!defaultLanguage) return c.json({ error: 'default_language is required' }, 400);
  const supportedLanguages = parseSupportedLanguages(body.supported_languages ?? []);
  const settings = await saveSiteI18nSettings(c.env, {
    default_language: defaultLanguage,
    supported_languages: supportedLanguages,
  });
  await invalidateAllCaches(c.env);
  return c.json(settings);
});

i18nRoutes.get('/translations/export', requireOAuthOrSession, async (c) => {
  await ensureI18nSchema(c.env);
  const settings = await getSiteI18nSettings(c.env);
  const language = normalizeLanguageCode(c.req.query('language'));
  if (!language) return c.json({ error: 'language query param is required' }, 400);
  if (!settings.supported_languages.includes(language)) {
    return c.json({ error: `language "${language}" is not enabled` }, 400);
  }
  if (language === settings.default_language) {
    return c.json({ error: 'Export language must differ from default_language' }, 400);
  }

  const [projects, pages, blogEntries, steps, elements] = await Promise.all([
    c.env.DB.prepare('SELECT id, slug, title, description, seo_title, seo_description FROM projects').all<{
      id: string; slug: string; title: string; description: string; seo_title: string | null; seo_description: string | null;
    }>(),
    c.env.DB.prepare('SELECT id, slug, title, seo_title, seo_description FROM pages').all<{
      id: string; slug: string; title: string; seo_title: string | null; seo_description: string | null;
    }>(),
    c.env.DB.prepare('SELECT id, slug, title, seo_title, seo_description, entry_date FROM blog_entries').all<{
      id: string; slug: string; title: string; seo_title: string | null; seo_description: string | null; entry_date: string;
    }>(),
    c.env.DB.prepare('SELECT id, project_id, title FROM project_steps').all<{
      id: string; project_id: string; title: string;
    }>(),
    c.env.DB.prepare("SELECT id, parent_type, parent_id, type, content FROM content_elements WHERE type != 'widget'").all<{
      id: string; parent_type: string; parent_id: string; type: string; content: string;
    }>(),
  ]);

  const [projectTr, pageTr, blogTr, stepTr, elementTr] = await Promise.all([
    c.env.DB.prepare(
      'SELECT project_id, title, description, seo_title, seo_description FROM project_translations WHERE language = ?',
    ).bind(language).all<{ project_id: string; title: string | null; description: string | null; seo_title: string | null; seo_description: string | null }>(),
    c.env.DB.prepare(
      'SELECT page_id, title, seo_title, seo_description FROM page_translations WHERE language = ?',
    ).bind(language).all<{ page_id: string; title: string | null; seo_title: string | null; seo_description: string | null }>(),
    c.env.DB.prepare(
      'SELECT blog_entry_id, title, seo_title, seo_description FROM blog_entry_translations WHERE language = ?',
    ).bind(language).all<{ blog_entry_id: string; title: string | null; seo_title: string | null; seo_description: string | null }>(),
    c.env.DB.prepare(
      'SELECT step_id, title FROM project_step_translations WHERE language = ?',
    ).bind(language).all<{ step_id: string; title: string | null }>(),
    c.env.DB.prepare(
      'SELECT content_element_id, content FROM content_element_translations WHERE language = ?',
    ).bind(language).all<{ content_element_id: string; content: string | null }>(),
  ]);

  const forms = await c.env.DB.prepare('SELECT form_id, name, success_message, fields_json FROM form_translations WHERE language = ?')
    .bind(language)
    .all<{ form_id: string; name: string | null; success_message: string | null; fields_json: string | null }>();
  const site = await c.env.DB.prepare('SELECT site_key, title FROM site_translations WHERE language = ?')
    .bind(language)
    .all<{ site_key: string; title: string | null }>();

  const projectMap = new Map(projectTr.results.map((r) => [r.project_id, r]));
  const pageMap = new Map(pageTr.results.map((r) => [r.page_id, r]));
  const blogMap = new Map(blogTr.results.map((r) => [r.blog_entry_id, r]));
  const stepMap = new Map(stepTr.results.map((r) => [r.step_id, r]));
  const elementMap = new Map(elementTr.results.map((r) => [r.content_element_id, r]));
  const formMap = new Map(forms.results.map((r) => [r.form_id, r]));
  const siteMap = new Map(site.results.map((r) => [r.site_key, r]));

  return c.json({
    source_language: settings.default_language,
    target_language: language,
    projects: projects.results.map((p) => ({
      id: p.id,
      slug: p.slug,
      source: {
        title: p.title,
        description: p.description,
        seo_title: p.seo_title,
        seo_description: p.seo_description,
      },
      translation: projectMap.get(p.id) ?? null,
    })),
    pages: pages.results.map((p) => ({
      id: p.id,
      slug: p.slug,
      source: {
        title: p.title,
        seo_title: p.seo_title,
        seo_description: p.seo_description,
      },
      translation: pageMap.get(p.id) ?? null,
    })),
    blog_entries: blogEntries.results.map((b) => ({
      id: b.id,
      slug: b.slug,
      entry_date: b.entry_date,
      source: {
        title: b.title,
        seo_title: b.seo_title,
        seo_description: b.seo_description,
      },
      translation: blogMap.get(b.id) ?? null,
    })),
    project_steps: steps.results.map((s) => ({
      id: s.id,
      project_id: s.project_id,
      source: { title: s.title },
      translation: stepMap.get(s.id) ?? null,
    })),
    content_elements: elements.results.map((e) => ({
      id: e.id,
      parent_type: e.parent_type,
      parent_id: e.parent_id,
      type: e.type,
      source: { content: e.content },
      translation: elementMap.get(e.id) ?? null,
    })),
    forms: (await c.env.DB.prepare('SELECT id, name, success_message, fields_json FROM forms').all<{
      id: string; name: string; success_message: string; fields_json: string;
    }>()).results.map((f) => ({
      id: f.id,
      source: {
        name: f.name,
        success_message: f.success_message,
        fields_json: f.fields_json,
      },
      translation: formMap.get(f.id) ?? null,
    })),
    site: {
      id: 'global',
      source: { title: 'CodeEmpty' },
      translation: siteMap.get('global') ?? null,
    },
  });
});

i18nRoutes.post('/translations/import', requireAdmin, async (c) => {
  await ensureI18nSchema(c.env);
  const body = await c.req.json<{
    language?: string;
    projects?: Array<{ id: string; title?: string | null; description?: string | null; seo_title?: string | null; seo_description?: string | null }>;
    pages?: Array<{ id: string; title?: string | null; seo_title?: string | null; seo_description?: string | null }>;
    blog_entries?: Array<{ id: string; title?: string | null; seo_title?: string | null; seo_description?: string | null }>;
    project_steps?: Array<{ id: string; title?: string | null }>;
    content_elements?: Array<{ id: string; content?: string | null }>;
    forms?: Array<{ id: string; name?: string | null; success_message?: string | null; fields_json?: string | null }>;
    site?: { title?: string | null };
  }>();

  const language = normalizeLanguageCode(body.language);
  if (!language) return c.json({ error: 'language is required' }, 400);

  const settings = await getSiteI18nSettings(c.env);
  if (!settings.supported_languages.includes(language)) {
    return c.json({ error: `language "${language}" is not enabled` }, 400);
  }
  if (language === settings.default_language) {
    return c.json({ error: 'Cannot import translations into default_language' }, 400);
  }

  const stmts: D1PreparedStatement[] = [];

  for (const item of body.projects ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO project_translations (project_id, language, title, description, seo_title, seo_description, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id, language) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           seo_title = excluded.seo_title,
           seo_description = excluded.seo_description,
           updated_at = excluded.updated_at`,
      ).bind(item.id, language, normalizeField(item.title), normalizeField(item.description), normalizeField(item.seo_title), normalizeField(item.seo_description)),
    );
  }

  for (const item of body.pages ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO page_translations (page_id, language, title, seo_title, seo_description, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(page_id, language) DO UPDATE SET
           title = excluded.title,
           seo_title = excluded.seo_title,
           seo_description = excluded.seo_description,
           updated_at = excluded.updated_at`,
      ).bind(item.id, language, normalizeField(item.title), normalizeField(item.seo_title), normalizeField(item.seo_description)),
    );
  }

  for (const item of body.blog_entries ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO blog_entry_translations (blog_entry_id, language, title, seo_title, seo_description, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(blog_entry_id, language) DO UPDATE SET
           title = excluded.title,
           seo_title = excluded.seo_title,
           seo_description = excluded.seo_description,
           updated_at = excluded.updated_at`,
      ).bind(item.id, language, normalizeField(item.title), normalizeField(item.seo_title), normalizeField(item.seo_description)),
    );
  }

  for (const item of body.project_steps ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO project_step_translations (step_id, language, title, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(step_id, language) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at`,
      ).bind(item.id, language, normalizeField(item.title)),
    );
  }

  for (const item of body.content_elements ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO content_element_translations (content_element_id, language, content, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(content_element_id, language) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at`,
      ).bind(item.id, language, normalizeField(item.content)),
    );
  }

  for (const item of body.forms ?? []) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO form_translations (form_id, language, name, success_message, fields_json, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(form_id, language) DO UPDATE SET
           name = excluded.name,
           success_message = excluded.success_message,
           fields_json = excluded.fields_json,
           updated_at = excluded.updated_at`,
      ).bind(
        item.id,
        language,
        normalizeField(item.name),
        normalizeField(item.success_message),
        normalizeField(item.fields_json),
      ),
    );
  }

  if (body.site) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO site_translations (site_key, language, title, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(site_key, language) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at`,
      ).bind('global', language, normalizeField(body.site.title)),
    );
  }

  if (stmts.length > 0) await c.env.DB.batch(stmts);
  if (stmts.length > 0) await invalidateAllCaches(c.env);

  return c.json({ ok: true, language, upserts: stmts.length });
});

i18nRoutes.get('/translations/:entity/:id', requireOAuthOrSession, async (c) => {
  await ensureI18nSchema(c.env);
  const language = normalizeLanguageCode(c.req.query('language'));
  if (!language) return c.json({ error: 'language query param is required' }, 400);
  const cfg = getEntityConfig(c.req.param('entity'));
  if (!cfg) return c.json({ error: 'Unsupported entity type' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT * FROM ${cfg.table} WHERE ${cfg.idColumn} = ? AND language = ?`,
  ).bind(c.req.param('id'), language).first<Record<string, unknown>>();
  return c.json(row ?? {});
});

i18nRoutes.put('/translations/:entity/:id', requireAdmin, async (c) => {
  await ensureI18nSchema(c.env);
  const cfg = getEntityConfig(c.req.param('entity'));
  if (!cfg) return c.json({ error: 'Unsupported entity type' }, 400);
  const body = await c.req.json<Record<string, unknown>>();
  const language = normalizeLanguageCode(body.language);
  if (!language) return c.json({ error: 'language is required' }, 400);
  const settings = await getSiteI18nSettings(c.env);
  if (!settings.supported_languages.includes(language)) {
    return c.json({ error: `language "${language}" is not enabled` }, 400);
  }
  if (language === settings.default_language) {
    return c.json({ error: 'Cannot store translations for default language' }, 400);
  }

  const fieldValues = cfg.fields.map((field) => normalizeField(body[field]));
  const placeholders = cfg.fields.map(() => '?').join(', ');
  const updateFields = cfg.fields.map((field) => `${field} = excluded.${field}`).join(', ');
  await c.env.DB.prepare(
    `INSERT INTO ${cfg.table} (${cfg.idColumn}, language, ${cfg.fields.join(', ')}, updated_at)
     VALUES (?, ?, ${placeholders}, datetime('now'))
     ON CONFLICT(${cfg.idColumn}, language) DO UPDATE SET
       ${updateFields},
       updated_at = excluded.updated_at`,
  ).bind(c.req.param('id'), language, ...fieldValues).run();

  await invalidateAllCaches(c.env);
  const updated = await c.env.DB.prepare(
    `SELECT * FROM ${cfg.table} WHERE ${cfg.idColumn} = ? AND language = ?`,
  ).bind(c.req.param('id'), language).first<Record<string, unknown>>();
  return c.json(updated ?? {});
});

type EntityConfig = {
  table: string;
  idColumn: string;
  fields: string[];
};

function getEntityConfig(entity: string): EntityConfig | null {
  if (entity === 'project') {
    return { table: 'project_translations', idColumn: 'project_id', fields: ['title', 'description', 'seo_title', 'seo_description'] };
  }
  if (entity === 'page') {
    return { table: 'page_translations', idColumn: 'page_id', fields: ['title', 'seo_title', 'seo_description'] };
  }
  if (entity === 'blog_entry') {
    return { table: 'blog_entry_translations', idColumn: 'blog_entry_id', fields: ['title', 'seo_title', 'seo_description'] };
  }
  if (entity === 'project_step') {
    return { table: 'project_step_translations', idColumn: 'step_id', fields: ['title'] };
  }
  if (entity === 'content_element') {
    return { table: 'content_element_translations', idColumn: 'content_element_id', fields: ['content'] };
  }
  if (entity === 'form') {
    return { table: 'form_translations', idColumn: 'form_id', fields: ['name', 'success_message', 'fields_json'] };
  }
  if (entity === 'site') {
    return { table: 'site_translations', idColumn: 'site_key', fields: ['title'] };
  }
  return null;
}

function normalizeField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  return value.trim();
}

async function invalidateAllCaches(env: Env): Promise<void> {
  const keys = await env.DB.prepare('SELECT cache_key FROM cache_keys').all<{ cache_key: string }>();
  await Promise.all([
    ...keys.results.map((r) => env.PAGES_KV.delete(r.cache_key)),
    env.PAGES_KV.delete('home'),
    env.PAGES_KV.delete('blog:index'),
    env.DB.prepare('DELETE FROM cache_keys').run(),
  ]);
}
