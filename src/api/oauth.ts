import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, OAuthApp, OAuthToken } from '../types';
import { uuid, hashPassword, verifyPassword, now, addHours } from '../utils';
import { requireAdmin } from './middleware';

export const oauthRoutes = new Hono<{ Bindings: Env }>();

oauthRoutes.get('/apps', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, client_id, scopes, created_by, created_at FROM oauth_apps ORDER BY created_at DESC',
  ).all<Omit<OAuthApp, 'client_secret_hash' | 'client_secret_salt'>>();
  return c.json(rows.results);
});

oauthRoutes.post('/apps', requireAdmin, async (c) => {
  const token = getCookie(c, 'session')!;
  const session = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ user_id: string }>();

  const body = await c.req.json<{ name: string; scopes?: string }>();
  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const clientId = uuid();
  const clientSecret = uuid();
  const { hash, salt } = await hashPassword(clientSecret);
  const id = uuid();

  await c.env.DB.prepare(
    `INSERT INTO oauth_apps (id, name, client_id, client_secret_hash, client_secret_salt, scopes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, body.name, clientId, hash, salt, body.scopes ?? 'read', session!.user_id)
    .run();

  const app = await c.env.DB.prepare(
    'SELECT id, name, client_id, scopes, created_by, created_at FROM oauth_apps WHERE id = ?',
  ).bind(id).first();
  // Return full row + plain-text secret (shown once only)
  return c.json({ ...app, client_secret: clientSecret }, 201);
});

oauthRoutes.delete('/apps/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare('DELETE FROM oauth_apps WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// OAuth 2.0 client credentials token endpoint
oauthRoutes.post('/token', async (c) => {
  const body = await c.req.json<{ grant_type: string; client_id: string; client_secret: string }>();
  if (body.grant_type !== 'client_credentials') return c.json({ error: 'unsupported_grant_type' }, 400);
  if (!body.client_id || !body.client_secret) return c.json({ error: 'invalid_request' }, 400);

  const app = await c.env.DB.prepare('SELECT * FROM oauth_apps WHERE client_id = ?')
    .bind(body.client_id)
    .first<OAuthApp>();
  if (!app) return c.json({ error: 'invalid_client' }, 401);

  const valid = await verifyPassword(body.client_secret, app.client_secret_hash, app.client_secret_salt);
  if (!valid) return c.json({ error: 'invalid_client' }, 401);

  // Revoke existing tokens for this app
  await c.env.DB.prepare('DELETE FROM oauth_tokens WHERE app_id = ?').bind(app.id).run();

  const token = uuid();
  const tokenId = uuid();
  const expiresAt = addHours(24);

  await c.env.DB.prepare(
    'INSERT INTO oauth_tokens (id, app_id, token, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(tokenId, app.id, token, expiresAt)
    .run();

  return c.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: 86400,
    scope: app.scopes,
  });
});

// List active tokens (admin view)
oauthRoutes.get('/tokens', requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.app_id, t.expires_at, t.created_at, a.name as app_name
     FROM oauth_tokens t JOIN oauth_apps a ON a.id = t.app_id
     WHERE t.expires_at > datetime('now')
     ORDER BY t.created_at DESC`,
  ).all<OAuthToken & { app_name: string }>();
  return c.json(rows.results);
});
