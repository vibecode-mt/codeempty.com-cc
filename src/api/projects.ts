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
    'INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, projectId, body.title, (maxOrder?.m ?? -1) + 1, body.video_timestamp_ms ?? null, normalizeTags(body.tags), ts, ts)
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

  await c.env.DB.prepare('UPDATE project_steps SET title=?, sort_order=?, video_timestamp_ms=?, tags=?, hidden=?, updated_at=? WHERE id=?')
    .bind(
      body.title ?? existing.title,
      body.sort_order ?? existing.sort_order,
      'video_timestamp_ms' in body ? (body.video_timestamp_ms ?? null) : existing.video_timestamp_ms,
      'tags' in body ? normalizeTags(body.tags) : existing.tags,
      'hidden' in body ? (body.hidden ? 1 : 0) : existing.hidden,
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
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM content_elements WHERE parent_type = 'project_step' AND parent_id = ?",
    ).bind(id),
    c.env.DB.prepare('DELETE FROM project_steps WHERE id = ?').bind(id),
  ]);
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
  tags?: string;
}

projectRoutes.post('/:id/import-captions', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{ captions: ImportCaption[]; default_tags?: string }>();
  if (!Array.isArray(body.captions)) {
    return c.json({ error: 'captions must be an array' }, 400);
  }

  if (body.captions.length === 0) {
    return c.json({ error: 'No captions provided' }, 400);
  }

  const defaultTags = normalizeTags(body.default_tags);

  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  const createdSteps: { id: string; sort_order: number }[] = [];
  let currentStepId: string | null = null;
  let stepSort = -1;
  let elementSort = 0;

  // Group captions: steps are standalone, elements follow their preceding step
  for (const caption of body.captions) {
    // Per-caption tags take precedence; default_tags is a fallback for older clients.
    const captionTags = caption.tags != null ? normalizeTags(caption.tags) : defaultTags;

    if (caption.type === 'step') {
      const stepId = uuid();
      stepSort++;
      currentStepId = stepId;
      elementSort = 0;

      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(stepId, projectId, caption.text, stepSort, caption.timestampMs, captionTags, ts, ts),
      );

      createdSteps.push({ id: stepId, sort_order: stepSort });
    } else if (caption.type === 'element') {
      if (!currentStepId) {
        return c.json({ error: 'First caption must be a step, not an element' }, 400);
      }

      const elementId = uuid();
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, video_timestamp_ms, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          elementId,
          'project_step',
          currentStepId,
          'description',
          caption.text,
          elementSort,
          caption.timestampMs,
          captionTags,
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

// Normalize a tag string: trim, dedupe, drop empties. Stored as comma-separated
// for cheap LIKE-style filtering. Returns null when there are no tags.
function normalizeTags(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const set = new Set<string>();
  for (const part of input.split(',')) {
    const t = part.trim().toLowerCase();
    if (t) set.add(t);
  }
  if (set.size === 0) return null;
  return Array.from(set).join(',');
}

function parseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

// Format ms as SRT timestamp: HH:MM:SS,mmm
function formatSrtTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return (
    String(h).padStart(2, '0') +
    ':' + String(m).padStart(2, '0') +
    ':' + String(s).padStart(2, '0') +
    ',' + String(millis).padStart(3, '0')
  );
}

interface ExportItem {
  text: string;
  start: number;
  tags: string[];
}

// Export project content as an SRT file. Filter by tags; "include_untagged" controls
// whether items with no tags pass through. Items lacking video_timestamp_ms are skipped
// since SRT requires timing.
projectRoutes.get('/:id/export-srt', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const tagsParam = c.req.query('tags') ?? '';
  const includeUntagged = c.req.query('include_untagged') === '1';
  const includeSteps = c.req.query('include_steps') !== '0'; // default on
  const filterTags = parseTags(tagsParam.toLowerCase());

  const steps = await c.env.DB.prepare(
    'SELECT id, title, video_timestamp_ms, tags FROM project_steps WHERE project_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind(projectId)
    .all<{ id: string; title: string; video_timestamp_ms: number | null; tags: string | null }>();

  const items: ExportItem[] = [];

  if (includeSteps) {
    for (const s of steps.results) {
      if (s.video_timestamp_ms == null) continue;
      items.push({ text: s.title, start: s.video_timestamp_ms, tags: parseTags(s.tags) });
    }
  }

  for (const s of steps.results) {
    const els = await c.env.DB.prepare(
      'SELECT type, content, video_timestamp_ms, tags FROM content_elements WHERE parent_type = ? AND parent_id = ? AND hidden = 0 ORDER BY sort_order ASC',
    )
      .bind('project_step', s.id)
      .all<{ type: string; content: string; video_timestamp_ms: number | null; tags: string | null }>();
    for (const el of els.results) {
      if (el.video_timestamp_ms == null) continue;
      // Only descriptive text types translate cleanly to SRT
      if (el.type !== 'description' && el.type !== 'title') continue;
      items.push({
        text: stripHtml(el.content),
        start: el.video_timestamp_ms,
        tags: parseTags(el.tags),
      });
    }
  }

  // Tag filter
  const filtered = items.filter((item) => {
    if (item.tags.length === 0) return includeUntagged || filterTags.length === 0;
    if (filterTags.length === 0) return true;
    return item.tags.some((t) => filterTags.includes(t));
  });

  filtered.sort((a, b) => a.start - b.start);

  // Build SRT
  const MAX_DUR = 6000;
  const MIN_DUR = 1500;
  const TAIL_DUR = 4000;
  const lines: string[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const cur = filtered[i];
    const next = filtered[i + 1];
    let end: number;
    if (next) {
      end = Math.min(next.start - 100, cur.start + MAX_DUR);
      if (end < cur.start + MIN_DUR) end = cur.start + MIN_DUR;
    } else {
      end = cur.start + TAIL_DUR;
    }
    if (end <= cur.start) end = cur.start + MIN_DUR;
    lines.push(String(i + 1));
    lines.push(`${formatSrtTimestamp(cur.start)} --> ${formatSrtTimestamp(end)}`);
    lines.push(cur.text.replace(/\r\n|\r/g, '\n').trim());
    lines.push('');
  }

  const srt = lines.join('\n');
  const filename = `${project.slug || 'project'}.srt`;
  return new Response(srt, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-subrip; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Item-Count': String(filtered.length),
    },
  });
});

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Bulk delete steps and/or elements in a project, optionally filtered by tags.
// scope: 'steps' wipes the matching steps and their elements; 'elements' only matches
// content_elements directly. tags=[] means "all" (no tag filter).
projectRoutes.post('/:id/bulk-delete', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{
    scope: 'steps' | 'elements';
    tags?: string[];
    include_untagged?: boolean;
  }>();

  if (body.scope !== 'steps' && body.scope !== 'elements') {
    return c.json({ error: 'scope must be "steps" or "elements"' }, 400);
  }

  const filterTags = (body.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const includeUntagged = body.include_untagged === true;

  const matchesTagFilter = (rowTags: string | null) => {
    const itemTags = parseTags(rowTags);
    if (itemTags.length === 0) return includeUntagged || filterTags.length === 0;
    if (filterTags.length === 0) return true;
    return itemTags.some((t) => filterTags.includes(t.toLowerCase()));
  };

  const stmts: D1PreparedStatement[] = [];
  let stepsDeleted = 0;
  let elementsDeleted = 0;

  if (body.scope === 'steps') {
    const steps = await c.env.DB.prepare(
      'SELECT id, tags FROM project_steps WHERE project_id = ?',
    )
      .bind(projectId)
      .all<{ id: string; tags: string | null }>();

    const targetIds = steps.results.filter((s) => matchesTagFilter(s.tags)).map((s) => s.id);
    if (targetIds.length > 0) {
      // Delete the elements under each step first (no FK cascade in schema)
      // Use one query with placeholders since target list can be large.
      const placeholders = targetIds.map(() => '?').join(',');
      stmts.push(
        c.env.DB.prepare(
          `DELETE FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${placeholders})`,
        ).bind(...targetIds),
      );
      stmts.push(
        c.env.DB.prepare(
          `DELETE FROM project_steps WHERE id IN (${placeholders})`,
        ).bind(...targetIds),
      );
      stepsDeleted = targetIds.length;
    }
  } else {
    // elements scope: delete matching elements anywhere under this project's steps
    const stepRows = await c.env.DB.prepare(
      'SELECT id FROM project_steps WHERE project_id = ?',
    )
      .bind(projectId)
      .all<{ id: string }>();
    const stepIds = stepRows.results.map((r) => r.id);
    if (stepIds.length > 0) {
      const placeholders = stepIds.map(() => '?').join(',');
      const els = await c.env.DB
        .prepare(
          `SELECT id, tags FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${placeholders})`,
        )
        .bind(...stepIds)
        .all<{ id: string; tags: string | null }>();
      const targetIds = els.results.filter((e) => matchesTagFilter(e.tags)).map((e) => e.id);
      if (targetIds.length > 0) {
        const elPlaceholders = targetIds.map(() => '?').join(',');
        stmts.push(
          c.env.DB
            .prepare(`DELETE FROM content_elements WHERE id IN (${elPlaceholders})`)
            .bind(...targetIds),
        );
        elementsDeleted = targetIds.length;
      }
    }
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
    await invalidateProjectCache(c.env, project.slug);
  }

  return c.json({ ok: true, steps_deleted: stepsDeleted, elements_deleted: elementsDeleted });
});
