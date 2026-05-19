import { Hono } from 'hono';
import type { Env, ExceptionLog } from '../types';
import { uuid, now } from '../utils';
import { requireAdmin } from './middleware';

export const logRoutes = new Hono<{ Bindings: Env }>();

interface ExceptionInput {
  method: string;
  path: string;
  status: number;
  errorName: string;
  message: string;
  stack: string | null;
  userAgent: string | null;
}

export async function recordException(env: Env, input: ExceptionInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO exception_logs (id, created_at, method, path, status, error_name, message, stack, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      now(),
      input.method,
      input.path,
      input.status,
      input.errorName,
      input.message,
      input.stack,
      input.userAgent,
    )
    .run();
}

logRoutes.get('/', requireAdmin, async (c) => {
  const limitParam = Number.parseInt(c.req.query('limit') ?? '100', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

  const rows = await c.env.DB.prepare(
    'SELECT id, created_at, method, path, status, error_name, message, stack, user_agent FROM exception_logs ORDER BY created_at DESC, id DESC LIMIT ?',
  )
    .bind(limit)
    .all<ExceptionLog>();

  return c.json(rows.results);
});
