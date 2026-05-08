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

// Looks up the OAuth app behind a bearer token and verifies it has the given
// scope. Scopes are stored space-separated on oauth_apps.scopes.
async function checkOAuthScope(
  env: Env,
  authHeader: string | undefined,
  scope: string,
): Promise<{ ok: true; userId: string | null } | { ok: false; reason: string; status: 401 | 403 }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, reason: 'Missing bearer token', status: 401 };
  }
  const token = authHeader.slice(7);
  const row = await env.DB.prepare(
    `SELECT t.app_id, a.scopes
       FROM oauth_tokens t
       JOIN oauth_apps a ON a.id = t.app_id
      WHERE t.token = ? AND t.expires_at > datetime('now')`,
  )
    .bind(token)
    .first<{ app_id: string; scopes: string }>();
  if (!row) return { ok: false, reason: 'Invalid or expired token', status: 401 };
  const granted = (row.scopes ?? '').split(/[\s,]+/).filter(Boolean);
  if (!granted.includes(scope)) {
    return { ok: false, reason: `Missing required scope: ${scope}`, status: 403 };
  }
  return { ok: true, userId: null };
}

// Bearer-only, with required scope check. Used for cross-instance API endpoints
// hit by a remote source that has only an OAuth client_credentials token.
export function requireOAuthWithScope(scope: string) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const result = await checkOAuthScope(c.env, c.req.header('Authorization'), scope);
    if (!result.ok) return c.json({ error: result.reason }, result.status);
    await next();
  });
}

// Either a session cookie (admin browser) or a bearer with the given scope.
// Used for endpoints that must serve both the local admin UI AND a remote
// publish flow — e.g. /api/projects/import.
export function requireSessionOrOAuthWithScope(scope: string) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const auth = c.req.header('Authorization');
    if (auth?.startsWith('Bearer ')) {
      const result = await checkOAuthScope(c.env, auth, scope);
      if (!result.ok) return c.json({ error: result.reason }, result.status);
      await next();
      return;
    }
    const sessionToken = getCookie(c, 'session');
    if (!sessionToken) return c.json({ error: 'Unauthenticated' }, 401);
    const session = await c.env.DB.prepare(
      "SELECT s.user_id FROM sessions s WHERE s.token = ? AND s.expires_at > datetime('now')",
    )
      .bind(sessionToken)
      .first<{ user_id: string }>();
    if (!session) return c.json({ error: 'Session expired' }, 401);
    c.set('userId' as never, session.user_id);
    await next();
  });
}
