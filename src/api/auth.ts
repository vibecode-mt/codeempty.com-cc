import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, User } from '../types';
import { uuid, hashPassword, verifyPassword, now, addHours } from '../utils';

export const authRoutes = new Hono<{ Bindings: Env }>();

// First-time setup — creates the admin user, returns plain-text password once
authRoutes.post('/setup', async (c) => {
  const existing = await c.env.DB.prepare('SELECT id FROM users LIMIT 1').first();
  if (existing) {
    return c.json({ error: 'Already set up' }, 400);
  }
  const password = uuid();
  const { hash, salt } = await hashPassword(password);
  const id = uuid();
  await c.env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, salt, is_admin) VALUES (?, ?, ?, ?, 1)',
  )
    .bind(id, 'admin', hash, salt)
    .run();
  return c.json({ username: 'admin', password, message: 'Save this password — it will not be shown again.' });
});

authRoutes.post('/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) return c.json({ error: 'Missing credentials' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash, user.salt);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  const token = uuid();
  const sessionId = uuid();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(sessionId, user.id, token, addHours(24 * 7))
    .run();

  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ ok: true, username: user.username });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, 'session');
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const token = getCookie(c, 'session');
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);

  const session = await c.env.DB.prepare(
    "SELECT s.*, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')",
  )
    .bind(token)
    .first<{ username: string; is_admin: number; user_id: string }>();

  if (!session) return c.json({ error: 'Session expired' }, 401);
  return c.json({ username: session.username, is_admin: session.is_admin });
});

authRoutes.post('/change-password', async (c) => {
  const token = getCookie(c, 'session');
  if (!token) return c.json({ error: 'Unauthenticated' }, 401);

  const session = await c.env.DB.prepare(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')",
  )
    .bind(token)
    .first<{ user_id: string }>();
  if (!session) return c.json({ error: 'Session expired' }, 401);

  const { current_password, new_password } = await c.req.json<{ current_password: string; new_password: string }>();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.user_id).first<User>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const valid = await verifyPassword(current_password, user.password_hash, user.salt);
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 403);

  const { hash, salt } = await hashPassword(new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(hash, salt, user.id)
    .run();

  return c.json({ ok: true });
});
