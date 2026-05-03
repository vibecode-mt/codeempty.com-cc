import { Hono } from 'hono';
import type { Env, CommonScript } from '../types';
import { uuid, now } from '../utils';
import { requireSession } from './middleware';

export const scriptRoutes = new Hono<{ Bindings: Env }>();

scriptRoutes.get('/', requireSession, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM common_scripts ORDER BY sort_order ASC, created_at ASC',
  ).all<CommonScript>();
  return c.json(rows.results);
});

scriptRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json<Partial<CommonScript>>();
  if (!body.name || !body.html_snippet) return c.json({ error: 'name and html_snippet are required' }, 400);

  const id = uuid();
  const ts = now();
  await c.env.DB.prepare(
    `INSERT INTO common_scripts (id, name, html_snippet, position, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name, body.html_snippet, body.position ?? 'head', body.enabled ?? 1, body.sort_order ?? 0, ts, ts)
    .run();

  await invalidateAllCache(c.env);
  return c.json(await c.env.DB.prepare('SELECT * FROM common_scripts WHERE id = ?').bind(id).first<CommonScript>(), 201);
});

scriptRoutes.put('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<CommonScript>>();
  const existing = await c.env.DB.prepare('SELECT * FROM common_scripts WHERE id = ?').bind(id).first<CommonScript>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE common_scripts SET name=?, html_snippet=?, position=?, enabled=?, sort_order=?, updated_at=? WHERE id=?',
  )
    .bind(
      body.name ?? existing.name,
      body.html_snippet ?? existing.html_snippet,
      body.position ?? existing.position,
      body.enabled ?? existing.enabled,
      body.sort_order ?? existing.sort_order,
      now(),
      id,
    )
    .run();

  await invalidateAllCache(c.env);
  return c.json(await c.env.DB.prepare('SELECT * FROM common_scripts WHERE id = ?').bind(id).first<CommonScript>());
});

scriptRoutes.delete('/:id', requireSession, async (c) => {
  await c.env.DB.prepare('DELETE FROM common_scripts WHERE id = ?').bind(c.req.param('id')).run();
  await invalidateAllCache(c.env);
  return c.json({ ok: true });
});

async function invalidateAllCache(env: Env) {
  const keys = await env.DB.prepare('SELECT cache_key FROM cache_keys').all<{ cache_key: string }>();
  const deletes = keys.results.map((r) => env.PAGES_KV.delete(r.cache_key));
  await Promise.all([...deletes, env.PAGES_KV.delete('home'), env.PAGES_KV.delete('blog:index')]);
  await env.DB.prepare('DELETE FROM cache_keys').run();
}
