import { Hono } from 'hono';
import type { Env, Page } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireAdmin, requireOAuthOrSession } from './middleware';

export const pageRoutes = new Hono<{ Bindings: Env }>();

pageRoutes.get('/', requireOAuthOrSession, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM pages ORDER BY slug ASC').all<PageRow>();
  return c.json(rows.results.map(normalizePage));
});

pageRoutes.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<Page>>();
  if (!body.title) return c.json({ error: 'title is required' }, 400);

  const id = uuid();
  const ts = now();
  const hasHomeColumn = await hasIsHomeColumn(c.env);
  const isHome = body.is_home ? 1 : 0;
  const slugInput = (body.slug ?? '').trim();
  const slug = slugify(slugInput || (isHome ? 'home' : ''));
  if (!slug) return c.json({ error: 'slug is required unless this is the home page' }, 400);

  if (hasHomeColumn && isHome) {
    // Enforce single-home: clear existing home flag(s) before inserting.
    await c.env.DB.prepare('UPDATE pages SET is_home = 0 WHERE is_home = 1').run();
  }

  if (hasHomeColumn) {
    await c.env.DB.prepare(
      'INSERT INTO pages (id, slug, title, seo_title, seo_description, published, show_in_menu, is_home, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        slug,
        body.title,
        body.seo_title ?? null,
        body.seo_description ?? null,
        body.published ?? 1,
        body.show_in_menu ?? 0,
        isHome,
        ts,
        ts,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO pages (id, slug, title, seo_title, seo_description, published, show_in_menu, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        id,
        slug,
        body.title,
        body.seo_title ?? null,
        body.seo_description ?? null,
        body.published ?? 1,
        body.show_in_menu ?? 0,
        ts,
        ts,
      )
      .run();
  }

  if (isHome) await invalidateHomeCache(c.env);
  const created = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>();
  return c.json(created ? normalizePage(created) : null, 201);
});

pageRoutes.get('/:id', requireOAuthOrSession, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ? OR slug = ?')
    .bind(c.req.param('id'), c.req.param('id'))
    .first<PageRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(normalizePage(row));
});

pageRoutes.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Page>>();
  const hasHomeColumn = await hasIsHomeColumn(c.env);
  const existing = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const normalizedExisting = normalizePage(existing);
  const slugInput = body.slug != null ? body.slug : existing.slug;
  const slug = slugify((slugInput ?? '').trim() || ((body.is_home ?? normalizedExisting.is_home) ? 'home' : ''));
  if (!slug) return c.json({ error: 'slug is required unless this is the home page' }, 400);
  const showInMenu = body.show_in_menu ?? existing.show_in_menu;
  const isHome = body.is_home != null ? (body.is_home ? 1 : 0) : normalizedExisting.is_home;

  if (hasHomeColumn && isHome === 1 && normalizedExisting.is_home !== 1) {
    // Clear any other home before promoting this page (the partial unique index
    // would otherwise reject the update).
    await c.env.DB.prepare('UPDATE pages SET is_home = 0 WHERE is_home = 1 AND id != ?').bind(id).run();
  }

  if (hasHomeColumn) {
    await c.env.DB.prepare(
      'UPDATE pages SET slug=?, title=?, seo_title=?, seo_description=?, published=?, show_in_menu=?, is_home=?, updated_at=? WHERE id=?',
    )
      .bind(
        slug,
        body.title ?? existing.title,
        'seo_title' in body ? (body.seo_title ?? null) : existing.seo_title,
        'seo_description' in body ? (body.seo_description ?? null) : existing.seo_description,
        body.published ?? existing.published,
        showInMenu,
        isHome,
        now(),
        id,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      'UPDATE pages SET slug=?, title=?, seo_title=?, seo_description=?, published=?, show_in_menu=?, updated_at=? WHERE id=?',
    )
      .bind(
        slug,
        body.title ?? existing.title,
        'seo_title' in body ? (body.seo_title ?? null) : existing.seo_title,
        'seo_description' in body ? (body.seo_description ?? null) : existing.seo_description,
        body.published ?? existing.published,
        showInMenu,
        now(),
        id,
      )
      .run();
  }

  await invalidatePageCache(c.env, existing.slug);
  if (slug !== existing.slug) await invalidatePageCache(c.env, slug);
  if (showInMenu !== existing.show_in_menu) await invalidateNavCaches(c.env);
  if (isHome !== normalizedExisting.is_home) await invalidateHomeCache(c.env);

  const updated = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>();
  return c.json(updated ? normalizePage(updated) : null);
});

pageRoutes.delete('/:id', requireAdmin, async (c) => {
  const hasHomeColumn = await hasIsHomeColumn(c.env);
  const existing = hasHomeColumn
    ? await c.env.DB.prepare('SELECT slug, is_home FROM pages WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ slug: string; is_home: number }>()
    : await c.env.DB.prepare('SELECT slug FROM pages WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ slug: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(c.req.param('id')).run();
  // Also drop the page's content elements so we don't leave orphan widgets.
  await c.env.DB.prepare('DELETE FROM content_elements WHERE parent_type = ? AND parent_id = ?')
    .bind('page', c.req.param('id'))
    .run();
  await invalidatePageCache(c.env, existing.slug);
  if ('is_home' in existing && existing.is_home) await invalidateHomeCache(c.env);
  return c.json({ ok: true });
});

async function invalidatePageCache(env: Env, slug: string) {
  const keyPrefix = `page:${slug}`;
  const keys = await env.DB.prepare('SELECT cache_key FROM cache_keys WHERE cache_key LIKE ?')
    .bind(`${keyPrefix}%`)
    .all<{ cache_key: string }>();
  await Promise.all([
    ...keys.results.map((r) => env.PAGES_KV.delete(r.cache_key)),
    env.DB.prepare('DELETE FROM cache_keys WHERE cache_key LIKE ?').bind(`${keyPrefix}%`).run(),
  ]);
}

async function invalidateHomeCache(env: Env) {
  // Drop the legacy 'home' KV key plus every cached home-by-slug entry. Cheap.
  await env.PAGES_KV.delete('home');
  if (await hasIsHomeColumn(env)) {
    const homeRow = await env.DB.prepare('SELECT slug FROM pages WHERE is_home = 1').first<{ slug: string }>();
    if (homeRow) await invalidatePageCache(env, homeRow.slug);
  } else {
    await invalidatePageCache(env, 'home');
  }
}

async function invalidateNavCaches(env: Env) {
  const keys = await env.DB.prepare('SELECT cache_key FROM cache_keys').all<{ cache_key: string }>();
  await Promise.all([
    env.PAGES_KV.delete('home'),
    env.PAGES_KV.delete('blog:index'),
    ...keys.results.map((r) => env.PAGES_KV.delete(r.cache_key)),
    env.DB.prepare('DELETE FROM cache_keys').run(),
  ]);
}

type PageRow = Omit<Page, 'is_home'> & { is_home?: number };

function normalizePage(row: PageRow): Page {
  return { ...row, is_home: row.is_home ?? (row.slug === 'home' ? 1 : 0) };
}

async function hasIsHomeColumn(env: Env): Promise<boolean> {
  const info = await env.DB.prepare('PRAGMA table_info(pages)').all<{ name: string }>();
  return info.results.some((col) => col.name === 'is_home');
}
