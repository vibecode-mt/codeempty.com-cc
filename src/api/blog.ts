import { Hono } from 'hono';
import type { Env, BlogEntry } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireAdmin, requireOAuthOrSession } from './middleware';
import { pagesWithWidget } from '../renderer/widgets';
import { regenerateSitemap } from '../sitemap';

export const blogRoutes = new Hono<{ Bindings: Env }>();

blogRoutes.get('/', requireOAuthOrSession, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM blog_entries ORDER BY entry_date DESC, created_at DESC',
  ).all<BlogEntry>();
  return c.json(rows.results);
});

blogRoutes.get('/public', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM blog_entries WHERE published = 1 ORDER BY entry_date DESC',
  ).all<BlogEntry>();
  return c.json(rows.results);
});

blogRoutes.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<BlogEntry>>();
  if (!body.title || !body.entry_date) return c.json({ error: 'title and entry_date are required' }, 400);

  const id = uuid();
  const ts = now();
  const slug = body.slug ?? slugify(body.title) + '-' + body.entry_date;

  await c.env.DB.prepare(
    'INSERT INTO blog_entries (id, slug, title, seo_title, seo_description, entry_date, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, slug, body.title, body.seo_title ?? null, body.seo_description ?? null, body.entry_date, body.published ?? 1, ts, ts)
    .run();

  await invalidateBlogListCaches(c.env);
  await regenerateSitemap(c.env, new URL(c.req.url).origin);

  return c.json(
    await c.env.DB.prepare('SELECT * FROM blog_entries WHERE id = ?').bind(id).first<BlogEntry>(),
    201,
  );
});

blogRoutes.get('/:id', requireOAuthOrSession, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM blog_entries WHERE id = ? OR slug = ?')
    .bind(c.req.param('id'), c.req.param('id'))
    .first<BlogEntry>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

blogRoutes.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<BlogEntry>>();
  const existing = await c.env.DB.prepare('SELECT * FROM blog_entries WHERE id = ?')
    .bind(id)
    .first<BlogEntry>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const resolvedTitle = body.title?.trim() || existing.title;
  const resolvedDate = body.entry_date || existing.entry_date;
  const slug = body.slug?.trim()
    ? slugify(body.slug)
    : existing.slug?.trim() || slugify(resolvedTitle) + '-' + resolvedDate;
  await c.env.DB.prepare(
    'UPDATE blog_entries SET slug=?, title=?, seo_title=?, seo_description=?, entry_date=?, published=?, updated_at=? WHERE id=?',
  )
    .bind(
      slug,
      resolvedTitle,
      'seo_title' in body ? (body.seo_title ?? null) : existing.seo_title,
      'seo_description' in body ? (body.seo_description ?? null) : existing.seo_description,
      resolvedDate,
      body.published ?? existing.published,
      now(),
      id,
    )
    .run();

  await invalidateBlogCache(c.env, existing.slug);
  if (slug !== existing.slug) await invalidateBlogCache(c.env, slug);
  await invalidateBlogListCaches(c.env);
  await regenerateSitemap(c.env, new URL(c.req.url).origin);

  return c.json(await c.env.DB.prepare('SELECT * FROM blog_entries WHERE id = ?').bind(id).first<BlogEntry>());
});

blogRoutes.delete('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT slug FROM blog_entries WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ slug: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM blog_entries WHERE id = ?').bind(c.req.param('id')).run();
  await invalidateBlogCache(c.env, existing.slug);
  await invalidateBlogListCaches(c.env);
  await regenerateSitemap(c.env, new URL(c.req.url).origin);
  return c.json({ ok: true });
});

async function invalidateBlogCache(env: Env, slug: string) {
  const keyPrefix = `blog:${slug}`;
  const keys = await env.DB.prepare('SELECT cache_key FROM cache_keys WHERE cache_key LIKE ?')
    .bind(`${keyPrefix}%`)
    .all<{ cache_key: string }>();
  await Promise.all([
    ...keys.results.map((r) => env.PAGES_KV.delete(r.cache_key)),
    env.DB.prepare('DELETE FROM cache_keys WHERE cache_key LIKE ?').bind(`${keyPrefix}%`).run(),
  ]);
}

// Drops the legacy 'blog:index' KV key plus any Page that embeds a blog_list widget.
async function invalidateBlogListCaches(env: Env) {
  const slugs = await pagesWithWidget(env, 'blog_list');
  await Promise.all([
    env.PAGES_KV.delete('blog:index'),
    ...slugs.flatMap((slug) => {
      const key = `page:${slug}`;
      return [
        env.PAGES_KV.delete(key),
        env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run(),
      ];
    }),
  ]);
}
