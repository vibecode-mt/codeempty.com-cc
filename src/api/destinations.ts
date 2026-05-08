import { Hono } from 'hono';
import type { Env, PublishDestination } from '../types';
import { uuid } from '../utils';
import { requireAdmin } from './middleware';

export const destinationRoutes = new Hono<{ Bindings: Env }>();

// Strip the secret out of any destination row before returning to the client.
// The secret only ever leaves the server when we hit the destination's
// /api/oauth/token endpoint internally (issue-token route below).
function publicShape(d: PublishDestination): Omit<PublishDestination, 'client_secret'> {
  const { client_secret: _ignored, ...rest } = d;
  return rest;
}

destinationRoutes.get('/', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM publish_destinations ORDER BY created_at DESC',
  ).all<PublishDestination>();
  return c.json(rows.results.map(publicShape));
});

destinationRoutes.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<PublishDestination>>();
  if (!body.name?.trim() || !body.api_url?.trim() || !body.client_id?.trim() || !body.client_secret?.trim()) {
    return c.json({ error: 'name, api_url, client_id, client_secret are required' }, 400);
  }
  // Normalize api_url — strip trailing slash so concatenations don't double up.
  const apiUrl = body.api_url.trim().replace(/\/$/, '');
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO publish_destinations (id, name, api_url, client_id, client_secret, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name.trim(), apiUrl, body.client_id.trim(), body.client_secret.trim(), body.scopes?.trim() || 'write')
    .run();
  const created = await c.env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?')
    .bind(id)
    .first<PublishDestination>();
  return c.json(publicShape(created!), 201);
});

destinationRoutes.delete('/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM publish_destinations WHERE id = ?')
    .bind(c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// Verify the destination's OAuth credentials work by performing an actual
// client_credentials grant. Doesn't return the token itself, just success.
destinationRoutes.post('/:id/test', requireAdmin, async (c) => {
  const dest = await c.env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?')
    .bind(c.req.param('id'))
    .first<PublishDestination>();
  if (!dest) return c.json({ error: 'Destination not found' }, 404);

  const result = await fetchDestinationToken(dest);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 400);
  }
  return c.json({ ok: true, scope: result.scope, expires_in: result.expires_in });
});

// Issue a token for the admin browser. The browser then drives the publish
// flow itself — uploading media to and posting /projects/import on the
// destination. The destination's client_secret never leaves the source.
destinationRoutes.post('/:id/issue-token', requireAdmin, async (c) => {
  const dest = await c.env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?')
    .bind(c.req.param('id'))
    .first<PublishDestination>();
  if (!dest) return c.json({ error: 'Destination not found' }, 404);

  const result = await fetchDestinationToken(dest);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({
    api_url: dest.api_url,
    access_token: result.access_token,
    expires_in: result.expires_in,
    scope: result.scope,
  });
});

interface TokenSuccess {
  ok: true;
  access_token: string;
  expires_in: number;
  scope: string;
}
interface TokenFailure {
  ok: false;
  error: string;
}

async function fetchDestinationToken(dest: PublishDestination): Promise<TokenSuccess | TokenFailure> {
  try {
    const res = await fetch(`${dest.api_url}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: dest.client_id,
        client_secret: dest.client_secret,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Destination returned ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json<{ access_token?: string; expires_in?: number; scope?: string }>();
    if (!data.access_token) {
      return { ok: false, error: 'Destination did not return an access_token' };
    }
    return {
      ok: true,
      access_token: data.access_token,
      expires_in: data.expires_in ?? 0,
      scope: data.scope ?? '',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
