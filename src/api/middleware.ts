import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env } from '../types';

export const requireSession = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = getCookie(c, 'session');
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);

  const session = await c.env.DB.prepare(
    "SELECT s.user_id, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')",
  )
    .bind(token)
    .first<{ user_id: string; is_admin: number }>();

  if (!session) return c.json({ error: 'Session expired' }, 401);
  c.set('userId' as never, session.user_id);
  await next();
});

export const requireOAuthOrSession = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  // Try bearer token first
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const oauthToken = await c.env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE token = ? AND expires_at > datetime('now')",
    )
      .bind(token)
      .first();
    if (oauthToken) {
      await next();
      return;
    }
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Fall back to session cookie
  const sessionToken = getCookie(c, 'session');
  if (!sessionToken) return c.json({ error: 'Unauthenticated' }, 401);

  const session = await c.env.DB.prepare(
    "SELECT s.user_id FROM sessions s WHERE s.token = ? AND s.expires_at > datetime('now')",
  )
    .bind(sessionToken)
    .first();
  if (!session) return c.json({ error: 'Session expired' }, 401);

  await next();
});
