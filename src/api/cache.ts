import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from './middleware';
import { regenerateSitemap } from '../sitemap';

export const cacheRoutes = new Hono<{ Bindings: Env }>();

cacheRoutes.post('/invalidate-all', requireAdmin, async (c) => {
  const keys = await c.env.DB.prepare('SELECT cache_key FROM cache_keys').all<{ cache_key: string }>();
  const deletes = keys.results.map((r) => c.env.PAGES_KV.delete(r.cache_key));
  await Promise.all([...deletes, c.env.PAGES_KV.delete('home'), c.env.PAGES_KV.delete('blog:index')]);
  await c.env.DB.prepare('DELETE FROM cache_keys').run();
  return c.json({ ok: true, invalidated: keys.results.length + 2 });
});

cacheRoutes.post('/invalidate/:key{.+}', requireAdmin, async (c) => {
  const key = c.req.param('key');
  await c.env.PAGES_KV.delete(key);
  await c.env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
  return c.json({ ok: true });
});

cacheRoutes.post('/sitemap/generate', requireAdmin, async (c) => {
  const origin = new URL(c.req.url).origin;
  const result = await regenerateSitemap(c.env, origin);
  return c.json({ ok: true, ...result });
});
