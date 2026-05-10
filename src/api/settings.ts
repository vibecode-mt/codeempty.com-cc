import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from './middleware';
import { ensureI18nSchema } from '../i18n';
import { regenerateSitemap } from '../sitemap';

export const settingsRoutes = new Hono<{ Bindings: Env }>();

type ImportMode = 'replace' | 'merge';

interface SiteExportPayload {
  format_version: number;
  exported_at: string;
  includes_projects: boolean;
  media?: Array<{ key: string; url: string }>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

const EXPORT_TABLES_ALWAYS = [
  'pages',
  'blog_entries',
  'forms',
  'form_submissions',
  'common_scripts',
  'publish_destinations',
  'site_i18n_settings',
  'site_translations',
  'page_translations',
  'blog_entry_translations',
  'form_translations',
] as const;

const EXPORT_TABLES_PROJECTS = [
  'projects',
  'project_steps',
  'project_versions',
  'project_translations',
  'project_step_translations',
] as const;

settingsRoutes.get('/export', requireAdmin, async (c) => {
  await ensureI18nSchema(c.env);
  const includeProjects = c.req.query('include_projects') !== '0';
  const tables: Record<string, Array<Record<string, unknown>>> = {};

  for (const table of EXPORT_TABLES_ALWAYS) {
    tables[table] = await selectTable(c.env, table);
  }

  tables.content_elements = await c.env.DB
    .prepare(
      includeProjects
        ? 'SELECT * FROM content_elements'
        : "SELECT * FROM content_elements WHERE parent_type IN ('page', 'blog_entry')",
    )
    .all<Record<string, unknown>>()
    .then((r) => r.results);

  tables.content_element_translations = await c.env.DB
    .prepare(
      includeProjects
        ? 'SELECT * FROM content_element_translations'
        : `SELECT cet.*
             FROM content_element_translations cet
             JOIN content_elements ce ON ce.id = cet.content_element_id
            WHERE ce.parent_type IN ('page', 'blog_entry')`,
    )
    .all<Record<string, unknown>>()
    .then((r) => r.results);

  if (includeProjects) {
    for (const table of EXPORT_TABLES_PROJECTS) {
      tables[table] = await selectTable(c.env, table);
    }
  }

  const payload: SiteExportPayload = {
    format_version: 1,
    exported_at: new Date().toISOString(),
    includes_projects: includeProjects,
    media: includeProjects ? (await listAllMediaKeys(c.env)).map((key) => ({ key, url: `/api/media/${key}` })) : [],
    tables,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="site-export-${payload.exported_at.slice(0, 19).replace(/[:T]/g, '-')}.json"`,
    },
  });
});

settingsRoutes.post('/import', requireAdmin, async (c) => {
  await ensureI18nSchema(c.env);
  const body = await c.req.json<{ mode?: ImportMode; payload?: SiteExportPayload }>();
  const mode: ImportMode = body.mode === 'replace' ? 'replace' : 'merge';
  const payload = body.payload;
  if (!payload || payload.format_version !== 1 || !payload.tables || typeof payload.tables !== 'object') {
    return c.json({ error: 'Invalid site export payload' }, 400);
  }

  try {
    if (mode === 'replace') {
      await clearForImport(c.env, !!payload.includes_projects);
    }

    const inserted: Record<string, number> = {};
    const allTables = [
      ...EXPORT_TABLES_ALWAYS,
      'content_elements',
      'content_element_translations',
      ...(payload.includes_projects ? [...EXPORT_TABLES_PROJECTS] : []),
    ];

    for (const table of allTables) {
      const rows = payload.tables[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        inserted[table] = 0;
        continue;
      }
      const tableInfo = await c.env.DB.prepare(`PRAGMA table_info(${table})`).all<{
        name: string;
        pk: number;
      }>();
      const validColumns = new Set(tableInfo.results.map((col) => col.name));
      const pkColumns = tableInfo.results
        .filter((col) => col.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((col) => col.name);

      const stmts: D1PreparedStatement[] = [];
      for (const rawRow of rows) {
        const row = Object.fromEntries(
          Object.entries(rawRow).filter(([k]) => validColumns.has(k)),
        );
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((col) => row[col] ?? null);
        if (mode === 'replace' || pkColumns.length === 0) {
          stmts.push(
            c.env.DB.prepare(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
            ).bind(...values),
          );
          continue;
        }

        const updatable = columns.filter((col) => !pkColumns.includes(col));
        if (updatable.length === 0) {
          stmts.push(
            c.env.DB.prepare(
              `INSERT INTO ${table} (${columns.join(', ')})
               VALUES (${placeholders})
               ON CONFLICT(${pkColumns.join(', ')}) DO NOTHING`,
            ).bind(...values),
          );
        } else {
          stmts.push(
            c.env.DB.prepare(
              `INSERT INTO ${table} (${columns.join(', ')})
               VALUES (${placeholders})
               ON CONFLICT(${pkColumns.join(', ')}) DO UPDATE SET
               ${updatable.map((col) => `${col} = excluded.${col}`).join(', ')}`,
            ).bind(...values),
          );
        }
      }
      if (stmts.length > 0) await c.env.DB.batch(stmts);
      inserted[table] = stmts.length;
    }

    await invalidateAllCaches(c.env);
    await regenerateSitemap(c.env, new URL(c.req.url).origin);

    return c.json({
      ok: true,
      mode,
      includes_projects: payload.includes_projects,
      inserted,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

async function selectTable(env: Env, table: string): Promise<Array<Record<string, unknown>>> {
  const result = await env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
  return result.results;
}

async function clearForImport(env: Env, includeProjects: boolean): Promise<void> {
  const stmts: D1PreparedStatement[] = [];

  if (includeProjects) {
    stmts.push(
      env.DB.prepare('DELETE FROM content_element_translations'),
      env.DB.prepare('DELETE FROM project_step_translations'),
      env.DB.prepare('DELETE FROM project_translations'),
      env.DB.prepare('DELETE FROM page_translations'),
      env.DB.prepare('DELETE FROM blog_entry_translations'),
      env.DB.prepare('DELETE FROM form_translations'),
      env.DB.prepare('DELETE FROM content_elements'),
      env.DB.prepare('DELETE FROM project_versions'),
      env.DB.prepare('DELETE FROM project_steps'),
      env.DB.prepare('DELETE FROM projects'),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `DELETE FROM content_element_translations
          WHERE content_element_id IN (
            SELECT id FROM content_elements WHERE parent_type IN ('page', 'blog_entry')
          )`,
      ),
      env.DB.prepare("DELETE FROM content_elements WHERE parent_type IN ('page', 'blog_entry')"),
      env.DB.prepare('DELETE FROM page_translations'),
      env.DB.prepare('DELETE FROM blog_entry_translations'),
    );
  }

  stmts.push(
    env.DB.prepare('DELETE FROM form_submissions'),
    env.DB.prepare('DELETE FROM forms'),
    env.DB.prepare('DELETE FROM pages'),
    env.DB.prepare('DELETE FROM blog_entries'),
    env.DB.prepare('DELETE FROM common_scripts'),
    env.DB.prepare('DELETE FROM publish_destinations'),
    env.DB.prepare('DELETE FROM site_translations'),
    env.DB.prepare('DELETE FROM site_i18n_settings'),
  );

  await env.DB.batch(stmts);
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

async function listAllMediaKeys(env: Env): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed: R2Objects = await env.MEDIA.list({ cursor });
    keys.push(...listed.objects.map((obj) => obj.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}
