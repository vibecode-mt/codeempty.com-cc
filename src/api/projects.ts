import { Hono } from 'hono';
import type { Env, Project, ProjectStep } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireSession, requireOAuthOrSession } from './middleware';

export const projectRoutes = new Hono<{ Bindings: Env }>();

// Public: list published projects
projectRoutes.get('/', requireOAuthOrSession, async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM projects ORDER BY sort_order ASC, created_at ASC',
  ).all<Project>();
  return c.json(rows.results);
});

projectRoutes.get('/public', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE published = 1 ORDER BY sort_order ASC, created_at ASC',
  ).all<Project>();
  return c.json(rows.results);
});

projectRoutes.post('/', requireSession, async (c) => {
  const body = await c.req.json<Partial<Project>>();
  if (!body.title) return c.json({ error: 'title is required' }, 400);

  const id = uuid();
  const slug = body.slug?.trim() || slugify(body.title);
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO projects (id, slug, title, description, image_url, sort_order, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, slug, body.title, body.description ?? '', body.image_url ?? null, body.sort_order ?? 0, body.published ?? 1, ts, ts)
    .run();

  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
  await c.env.PAGES_KV.delete('home');
  return c.json(project, 201);
});

projectRoutes.get('/:id', requireOAuthOrSession, async (c) => {
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Project>();
  if (!project) return c.json({ error: 'Not found' }, 404);

  const steps = await c.env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC',
  )
    .bind(project.id)
    .all<ProjectStep>();

  return c.json({ ...project, steps: steps.results });
});

projectRoutes.put('/:id', requireSession, async (c) => {
  const body = await c.req.json<Partial<Project>>();
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const resolvedTitle = body.title?.trim() || existing.title;
  const slug = body.slug?.trim() || existing.slug?.trim() || slugify(resolvedTitle);
  const ts = now();
  await c.env.DB.prepare(
    `UPDATE projects SET slug=?, title=?, description=?, image_url=?, sort_order=?, published=?, updated_at=? WHERE id=?`,
  )
    .bind(
      slug,
      resolvedTitle,
      body.description ?? existing.description,
      body.image_url ?? existing.image_url,
      body.sort_order ?? existing.sort_order,
      body.published ?? existing.published,
      ts,
      id,
    )
    .run();

  await invalidateProjectCache(c.env, existing.slug);
  if (slug !== existing.slug) await invalidateProjectCache(c.env, slug);

  return c.json(await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>());
});

projectRoutes.delete('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT slug FROM projects WHERE id = ?').bind(id).first<{ slug: string }>();
  if (!project) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  await invalidateProjectCache(c.env, project.slug);
  return c.json({ ok: true });
});

// Steps
projectRoutes.get('/:projectId/steps', requireOAuthOrSession, async (c) => {
  const steps = await c.env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC',
  )
    .bind(c.req.param('projectId'))
    .all<ProjectStep>();
  return c.json(steps.results);
});

projectRoutes.post('/:projectId/steps', requireSession, async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json<Partial<ProjectStep>>();
  if (!body.title) return c.json({ error: 'title is required' }, 400);

  const id = uuid();
  const ts = now();
  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM project_steps WHERE project_id = ?',
  )
    .bind(projectId)
    .first<{ m: number }>();

  await c.env.DB.prepare(
    'INSERT INTO project_steps (id, project_id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, projectId, body.title, (maxOrder?.m ?? -1) + 1, ts, ts)
    .run();

  const step = await c.env.DB.prepare('SELECT * FROM project_steps WHERE id = ?').bind(id).first<ProjectStep>();
  return c.json(step, 201);
});

projectRoutes.put('/steps/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<ProjectStep>>();
  const existing = await c.env.DB.prepare('SELECT * FROM project_steps WHERE id = ?').bind(id).first<ProjectStep>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('UPDATE project_steps SET title=?, sort_order=?, updated_at=? WHERE id=?')
    .bind(body.title ?? existing.title, body.sort_order ?? existing.sort_order, now(), id)
    .run();

  return c.json(await c.env.DB.prepare('SELECT * FROM project_steps WHERE id = ?').bind(id).first<ProjectStep>());
});

projectRoutes.delete('/steps/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM project_steps WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

projectRoutes.post('/steps/reorder', requireSession, async (c) => {
  const { orders } = await c.req.json<{ orders: { id: string; sort_order: number }[] }>();
  const stmts = orders.map((o) =>
    c.env.DB.prepare('UPDATE project_steps SET sort_order=? WHERE id=?').bind(o.sort_order, o.id),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

async function invalidateProjectCache(env: Env, slug: string) {
  const key = `project:${slug}`;
  await Promise.all([
    env.PAGES_KV.delete(key),
    env.PAGES_KV.delete('home'),
    env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run(),
  ]);
}
