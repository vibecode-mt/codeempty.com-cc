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
    `INSERT INTO projects (id, slug, title, description, image_url, video_key, video_url, sort_order, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, slug, body.title, body.description ?? '', body.image_url ?? null, body.video_key ?? null, body.video_url ?? null, body.sort_order ?? 0, body.published ?? 1, ts, ts)
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
    `UPDATE projects SET slug=?, title=?, description=?, image_url=?, video_key=?, video_url=?, sort_order=?, published=?, updated_at=? WHERE id=?`,
  )
    .bind(
      slug,
      resolvedTitle,
      body.description ?? existing.description,
      body.image_url ?? existing.image_url,
      'video_key' in body ? (body.video_key ?? null) : existing.video_key,
      'video_url' in body ? (body.video_url ?? null) : existing.video_url,
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
    'INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, projectId, body.title, (maxOrder?.m ?? -1) + 1, body.video_timestamp_ms ?? null, ts, ts)
    .run();

  // If a timestamp is provided, re-sort all steps by timestamp so sort_order reflects order
  if (body.video_timestamp_ms != null) {
    await resortStepsByTimestamp(c.env, projectId);
  }

  const step = await c.env.DB.prepare('SELECT * FROM project_steps WHERE id = ?').bind(id).first<ProjectStep>();
  return c.json(step, 201);
});

projectRoutes.put('/steps/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<ProjectStep>>();
  const existing = await c.env.DB.prepare('SELECT * FROM project_steps WHERE id = ?').bind(id).first<ProjectStep>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('UPDATE project_steps SET title=?, sort_order=?, video_timestamp_ms=?, updated_at=? WHERE id=?')
    .bind(
      body.title ?? existing.title,
      body.sort_order ?? existing.sort_order,
      'video_timestamp_ms' in body ? (body.video_timestamp_ms ?? null) : existing.video_timestamp_ms,
      now(),
      id,
    )
    .run();

  // Re-sort if timestamp changed
  if ('video_timestamp_ms' in body) {
    await resortStepsByTimestamp(c.env, existing.project_id);
  }

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

// Bulk time-shift: shift all steps/elements with video_timestamp_ms >= split_ms by offset_ms
projectRoutes.post('/:id/timeshift', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const { split_ms, offset_ms } = await c.req.json<{ split_ms: number; offset_ms: number }>();
  if (split_ms == null || offset_ms == null) {
    return c.json({ error: 'split_ms and offset_ms are required' }, 400);
  }

  const ts = now();

  // Fetch all steps for this project
  const allSteps = await c.env.DB.prepare(
    'SELECT id, video_timestamp_ms FROM project_steps WHERE project_id = ?',
  ).bind(projectId).all<{ id: string; video_timestamp_ms: number | null }>();

  const stepStmts = allSteps.results
    .filter((s) => s.video_timestamp_ms != null && s.video_timestamp_ms >= split_ms)
    .map((s) => {
      const newTs = Math.max(0, s.video_timestamp_ms! + offset_ms);
      return c.env.DB.prepare(
        'UPDATE project_steps SET video_timestamp_ms=?, updated_at=? WHERE id=?',
      ).bind(newTs, ts, s.id);
    });

  // Fetch all content elements for steps of this project
  const stepIds = allSteps.results.map((s) => s.id);
  const elementStmts: D1PreparedStatement[] = [];
  for (const stepId of stepIds) {
    const els = await c.env.DB.prepare(
      'SELECT id, video_timestamp_ms FROM content_elements WHERE parent_type = ? AND parent_id = ?',
    ).bind('project_step', stepId).all<{ id: string; video_timestamp_ms: number | null }>();

    for (const el of els.results) {
      if (el.video_timestamp_ms != null && el.video_timestamp_ms >= split_ms) {
        const newTs = Math.max(0, el.video_timestamp_ms + offset_ms);
        elementStmts.push(
          c.env.DB.prepare(
            'UPDATE content_elements SET video_timestamp_ms=?, updated_at=? WHERE id=?',
          ).bind(newTs, ts, el.id),
        );
      }
    }
  }

  if (stepStmts.length > 0 || elementStmts.length > 0) {
    await c.env.DB.batch([...stepStmts, ...elementStmts]);
  }

  // Re-sort steps and then elements within each step
  await resortStepsByTimestamp(c.env, projectId);
  for (const stepId of stepIds) {
    await resortElementsByTimestamp(c.env, stepId);
  }

  return c.json({ ok: true, shifted: stepStmts.length, elements_shifted: elementStmts.length });
});

async function resortStepsByTimestamp(env: Env, projectId: string) {
  const steps = await env.DB.prepare(
    'SELECT id, video_timestamp_ms, sort_order FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC',
  ).bind(projectId).all<{ id: string; video_timestamp_ms: number | null; sort_order: number }>();

  const sorted = [...steps.results].sort((a, b) => {
    if (a.video_timestamp_ms != null && b.video_timestamp_ms != null) {
      return a.video_timestamp_ms - b.video_timestamp_ms;
    }
    if (a.video_timestamp_ms != null) return -1;
    if (b.video_timestamp_ms != null) return 1;
    return a.sort_order - b.sort_order;
  });

  if (sorted.length === 0) return;
  const stmts = sorted.map((s, i) =>
    env.DB.prepare('UPDATE project_steps SET sort_order=? WHERE id=?').bind(i, s.id),
  );
  await env.DB.batch(stmts);
}

async function resortElementsByTimestamp(env: Env, stepId: string) {
  const els = await env.DB.prepare(
    'SELECT id, video_timestamp_ms, sort_order FROM content_elements WHERE parent_type = ? AND parent_id = ? ORDER BY sort_order ASC',
  ).bind('project_step', stepId).all<{ id: string; video_timestamp_ms: number | null; sort_order: number }>();

  const sorted = [...els.results].sort((a, b) => {
    if (a.video_timestamp_ms != null && b.video_timestamp_ms != null) {
      return a.video_timestamp_ms - b.video_timestamp_ms;
    }
    if (a.video_timestamp_ms != null) return -1;
    if (b.video_timestamp_ms != null) return 1;
    return a.sort_order - b.sort_order;
  });

  if (sorted.length === 0) return;
  const stmts = sorted.map((s, i) =>
    env.DB.prepare('UPDATE content_elements SET sort_order=? WHERE id=?').bind(i, s.id),
  );
  await env.DB.batch(stmts);
}

async function invalidateProjectCache(env: Env, slug: string) {
  const key = `project:${slug}`;
  await Promise.all([
    env.PAGES_KV.delete(key),
    env.PAGES_KV.delete('home'),
    env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run(),
  ]);
}

// Caption import endpoint
interface ImportCaption {
  text: string;
  timestampMs: number;
  type: 'step' | 'element';
}

projectRoutes.post('/:id/import-captions', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{ captions: ImportCaption[] }>();
  if (!Array.isArray(body.captions)) {
    return c.json({ error: 'captions must be an array' }, 400);
  }

  if (body.captions.length === 0) {
    return c.json({ error: 'No captions provided' }, 400);
  }

  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  const createdSteps: { id: string; sort_order: number }[] = [];
  let currentStepId: string | null = null;
  let stepSort = -1;
  let elementSort = 0;

  // Group captions: steps are standalone, elements follow their preceding step
  for (const caption of body.captions) {
    if (caption.type === 'step') {
      const stepId = uuid();
      stepSort++;
      currentStepId = stepId;
      elementSort = 0;

      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(stepId, projectId, caption.text, stepSort, caption.timestampMs, ts, ts),
      );

      createdSteps.push({ id: stepId, sort_order: stepSort });
    } else if (caption.type === 'element') {
      if (!currentStepId) {
        return c.json({ error: 'First caption must be a step, not an element' }, 400);
      }

      const elementId = uuid();
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, video_timestamp_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          elementId,
          'project_step',
          currentStepId,
          'description',
          caption.text,
          elementSort,
          caption.timestampMs,
          ts,
          ts,
        ),
      );

      elementSort++;
    }
  }

  // Execute all inserts
  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  // Re-sort all steps by timestamp
  await resortStepsByTimestamp(c.env, projectId);

  // Re-sort elements within each created step
  for (const step of createdSteps) {
    await resortElementsByTimestamp(c.env, step.id);
  }

  // Invalidate cache
  await invalidateProjectCache(c.env, project.slug);

  return c.json(
    {
      ok: true,
      steps_created: createdSteps.length,
      total_captions: body.captions.length,
    },
    201,
  );
});
