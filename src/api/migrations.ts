import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from './middleware';
import { MIGRATIONS } from '../migrations-manifest';

export const migrationRoutes = new Hono<{ Bindings: Env }>();

interface D1MigrationRow {
  id: number;
  name: string;
  applied_at: string;
}

async function ensureMigrationsTable(env: Env): Promise<void> {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

migrationRoutes.get('/', requireAdmin, async (c) => {
  await ensureMigrationsTable(c.env);

  const applied = await c.env.DB
    .prepare('SELECT id, name, applied_at FROM d1_migrations ORDER BY id ASC')
    .all<D1MigrationRow>();

  const appliedSet = new Map(applied.results.map((r) => [r.name, r.applied_at]));

  const migrations = MIGRATIONS.map((m) => ({
    name: m.name,
    applied: appliedSet.has(m.name),
    applied_at: appliedSet.get(m.name) ?? null,
  }));

  return c.json({ migrations });
});

migrationRoutes.post('/apply', requireAdmin, async (c) => {
  await ensureMigrationsTable(c.env);

  const applied = await c.env.DB
    .prepare('SELECT name FROM d1_migrations')
    .all<{ name: string }>();

  const appliedSet = new Set(applied.results.map((r) => r.name));
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.name));

  if (pending.length === 0) {
    return c.json({ ok: true, applied: [], message: 'No pending migrations.' });
  }

  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const migration of pending) {
    try {
      await c.env.DB.exec(migration.sql);
      await c.env.DB
        .prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, datetime('now'))")
        .bind(migration.name)
        .run();
      results.push({ name: migration.name, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: migration.name, ok: false, error: message });
      // Stop on first failure to avoid cascading issues
      break;
    }
  }

  const allOk = results.every((r) => r.ok);
  return c.json({ ok: allOk, applied: results }, allOk ? 200 : 500);
});
