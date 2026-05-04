import { Hono } from 'hono';
import type { Env, Page } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireSession, requireOAuthOrSession } from './middleware';

export const pageRoutes = new Hono<{ Bindings: Env }>();

pageRoutes.get('/', requireOAuthOrSession, async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM pages ORDER BY slug ASC').all<Page>();
  return c.json(rows.results);
});

pageRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json<Partial<Page>>();
  if (!body.title || !body.slug) return c.json({ error: 'title and slug are required' }, 400);

  const id = uuid();
  const ts = now();
  const slug = slugify(body.slug);

  await c.env.DB.prepare(
    'INSERT INTO pages (id, slug, title, published, show_in_menu, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, slug, body.title, body.published ?? 1, body.show_in_menu ?? 0, ts, ts)
    .run();

  return c.json(await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Page>(), 201);
});

pageRoutes.get('/:id', requireOAuthOrSession, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ? OR slug = ?')
    .bind(c.req.param('id'), c.req.param('id'))
    .first<Page>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

pageRoutes.put('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Page>>();
  const existing = await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Page>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const slug = body.slug ? slugify(body.slug) : existing.slug;
  const showInMenu = body.show_in_menu ?? existing.show_in_menu;
  await c.env.DB.prepare('UPDATE pages SET slug=?, title=?, published=?, show_in_menu=?, updated_at=? WHERE id=?')
    .bind(slug, body.title ?? existing.title, body.published ?? existing.published, showInMenu, now(), id)
    .run();

  await invalidatePageCache(c.env, existing.slug);
  if (slug !== existing.slug) await invalidatePageCache(c.env, slug);
  if (showInMenu !== existing.show_in_menu) await invalidateNavCaches(c.env);

  return c.json(await c.env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<Page>());
});

pageRoutes.delete('/:id', requireSession, async (c) => {
  const existing = await c.env.DB.prepare('SELECT slug FROM pages WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ slug: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(c.req.param('id')).run();
  await invalidatePageCache(c.env, existing.slug);
  return c.json({ ok: true });
});

async function invalidatePageCache(env: Env, slug: string) {
  const key = `page:${slug}`;
  await env.PAGES_KV.delete(key);
  await env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
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
