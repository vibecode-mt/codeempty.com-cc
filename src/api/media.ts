import { Hono } from 'hono';
import type { Env } from '../types';
import { uuid } from '../utils';
import { requireSession } from './middleware';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

mediaRoutes.post('/upload', requireSession, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const key = `${uuid()}.${ext}`;

  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ key, url: `/api/media/${key}` }, 201);
});

mediaRoutes.get('/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

mediaRoutes.delete('/:key{.+}', requireSession, async (c) => {
  await c.env.MEDIA.delete(c.req.param('key'));
  return c.json({ ok: true });
});
