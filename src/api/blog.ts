import { Hono } from 'hono';
import type { Env, BlogEntry } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireSession, requireOAuthOrSession } from './middleware';

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

blogRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json<Partial<BlogEntry>>();
  if (!body.title || !body.entry_date) return c.json({ error: 'title and entry_date are required' }, 400);

  const id = uuid();
  const ts = now();
  const slug = body.slug ?? slugify(body.title) + '-' + body.entry_date;

  await c.env.DB.prepare(
    'INSERT INTO blog_entries (id, slug, title, entry_date, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, slug, body.title, body.entry_date, body.published ?? 1, ts, ts)
    .run();

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

blogRoutes.put('/:id', requireSession, async (c) => {
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
    'UPDATE blog_entries SET slug=?, title=?, entry_date=?, published=?, updated_at=? WHERE id=?',
  )
    .bind(
      slug,
      resolvedTitle,
      resolvedDate,
      body.published ?? existing.published,
      now(),
      id,
    )
    .run();

  await invalidateBlogCache(c.env, existing.slug);
  if (slug !== existing.slug) await invalidateBlogCache(c.env, slug);
  await c.env.PAGES_KV.delete('blog:index');

  return c.json(await c.env.DB.prepare('SELECT * FROM blog_entries WHERE id = ?').bind(id).first<BlogEntry>());
});

blogRoutes.delete('/:id', requireSession, async (c) => {
  const existing = await c.env.DB.prepare('SELECT slug FROM blog_entries WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ slug: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM blog_entries WHERE id = ?').bind(c.req.param('id')).run();
  await invalidateBlogCache(c.env, existing.slug);
  await c.env.PAGES_KV.delete('blog:index');
  return c.json({ ok: true });
});

async function invalidateBlogCache(env: Env, slug: string) {
  const key = `blog:${slug}`;
  await env.PAGES_KV.delete(key);
  await env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
}
