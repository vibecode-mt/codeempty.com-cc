import { Hono } from 'hono';
import type { Env, Project, ProjectStep, ContentElement, ProjectVersion } from '../types';
import { uuid, slugify, now } from '../utils';
import { requireSession, requireOAuthOrSession, requireSessionOrOAuthWithScope } from './middleware';

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
    `INSERT INTO projects (id, slug, title, description, image_url, video_key, video_url, youtube_url, sort_order, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, slug, body.title, body.description ?? '', body.image_url ?? null, body.video_key ?? null, body.video_url ?? null, body.youtube_url?.trim() || null, body.sort_order ?? 0, body.published ?? 1, ts, ts)
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
    `UPDATE projects SET slug=?, title=?, description=?, image_url=?, video_key=?, video_url=?, youtube_url=?, sort_order=?, published=?, updated_at=? WHERE id=?`,
  )
    .bind(
      slug,
      resolvedTitle,
      body.description ?? existing.description,
      body.image_url ?? existing.image_url,
      'video_key' in body ? (body.video_key ?? null) : existing.video_key,
      'video_url' in body ? (body.video_url ?? null) : existing.video_url,
      'youtube_url' in body ? (body.youtube_url?.trim() || null) : existing.youtube_url,
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

// Bulk add or remove tags. Same scope+filter shape as bulk-delete; an additional
// "action" picks add vs remove and "apply_tags" is the tag list to mutate with.
// Used by the admin "Bulk tag" modal so an editor can stamp e.g. "step:major"
// onto every step matching some existing-tag filter without clicking each row.
projectRoutes.post('/:id/bulk-tag', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const body = await c.req.json<{
    scope: 'steps' | 'elements';
    tags?: string[];
    include_untagged?: boolean;
    action: 'add' | 'remove';
    apply_tags: string;
  }>();

  if (body.scope !== 'steps' && body.scope !== 'elements') {
    return c.json({ error: 'scope must be "steps" or "elements"' }, 400);
  }
  if (body.action !== 'add' && body.action !== 'remove') {
    return c.json({ error: 'action must be "add" or "remove"' }, 400);
  }

  const applyList = (body.apply_tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (applyList.length === 0) {
    return c.json({ error: 'apply_tags must include at least one tag' }, 400);
  }

  const filterTags = (body.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const includeUntagged = body.include_untagged === true;

  const matchesTagFilter = (rowTags: string | null) => {
    const itemTags = parseTags(rowTags);
    if (itemTags.length === 0) return includeUntagged || filterTags.length === 0;
    if (filterTags.length === 0) return true;
    return itemTags.some((t) => filterTags.includes(t.toLowerCase()));
  };

  const mutate = (existing: string | null): string | null => {
    const set = new Set(parseTags(existing).map((t) => t.toLowerCase()));
    if (body.action === 'add') {
      for (const t of applyList) set.add(t);
    } else {
      for (const t of applyList) set.delete(t);
    }
    return set.size === 0 ? null : Array.from(set).join(',');
  };

  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  let updated = 0;

  if (body.scope === 'steps') {
    const rows = await c.env.DB.prepare(
      'SELECT id, tags FROM project_steps WHERE project_id = ?',
    )
      .bind(projectId)
      .all<{ id: string; tags: string | null }>();

    for (const r of rows.results) {
      if (!matchesTagFilter(r.tags)) continue;
      const next = mutate(r.tags);
      if (next === r.tags) continue;
      stmts.push(
        c.env.DB.prepare('UPDATE project_steps SET tags=?, updated_at=? WHERE id=?').bind(next, ts, r.id),
      );
      updated++;
    }
  } else {
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

      for (const r of els.results) {
        if (!matchesTagFilter(r.tags)) continue;
        const next = mutate(r.tags);
        if (next === r.tags) continue;
        stmts.push(
          c.env.DB.prepare('UPDATE content_elements SET tags=?, updated_at=? WHERE id=?').bind(next, ts, r.id),
        );
        updated++;
      }
    }
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
    await invalidateProjectCache(c.env, project.slug);
  }

  return c.json({ ok: true, updated });
});

// ────────────────────────────────────────────────────────────────────────────
// Versioning: snapshot the project (project + steps + elements) into JSON,
// stored in project_versions. Restore reads the snapshot and applies it as one
// atomic D1 batch (delete old children + update project row + insert new).
// Media is referenced by R2 key, never duplicated — restoring after the
// referenced media has been deleted leaves dangling URLs but doesn't fail.

interface SnapshotShape {
  format_version: number;
  project: Project;
  steps: ProjectStep[];
  elements: ContentElement[];
}

async function buildSnapshot(env: Env, projectId: string): Promise<SnapshotShape> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Project>();
  if (!project) throw new Error('Project not found');

  const stepsResult = await env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC',
  )
    .bind(projectId)
    .all<ProjectStep>();
  const steps = stepsResult.results;

  let elements: ContentElement[] = [];
  if (steps.length > 0) {
    const placeholders = steps.map(() => '?').join(',');
    const elsResult = await env.DB.prepare(
      `SELECT * FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${placeholders}) ORDER BY parent_id, sort_order ASC`,
    )
      .bind(...steps.map((s) => s.id))
      .all<ContentElement>();
    elements = elsResult.results;
  }

  return { format_version: 1, project, steps, elements };
}

// Persists a snapshot row. Caller decides the source label.
async function snapshotProjectToVersions(
  env: Env,
  projectId: string,
  source: 'manual' | 'publish' | 'import-replace',
  label: string | null,
  createdBy: string | null,
): Promise<{ id: string; version_num: number }> {
  const snapshot = await buildSnapshot(env, projectId);
  const lastRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(version_num), 0) as v FROM project_versions WHERE project_id = ?',
  )
    .bind(projectId)
    .first<{ v: number }>();
  const versionNum = (lastRow?.v ?? 0) + 1;
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO project_versions (id, project_id, version_num, label, snapshot_json, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, projectId, versionNum, label, JSON.stringify(snapshot), source, createdBy)
    .run();
  return { id, version_num: versionNum };
}

// Apply a snapshot atomically. The project row keeps its id and slug; everything
// else inside the project (steps, elements) is wiped and recreated from the
// snapshot. Wrapped in a single c.env.DB.batch() so a failure leaves no
// half-state.
async function applySnapshot(
  env: Env,
  projectId: string,
  snapshot: SnapshotShape,
): Promise<void> {
  // Existing step ids are needed so we can drop their elements first.
  const existing = await env.DB.prepare(
    'SELECT id FROM project_steps WHERE project_id = ?',
  )
    .bind(projectId)
    .all<{ id: string }>();
  const existingIds = existing.results.map((r) => r.id);

  const ts = now();
  const stmts: D1PreparedStatement[] = [];

  if (existingIds.length > 0) {
    const ph = existingIds.map(() => '?').join(',');
    stmts.push(
      env.DB
        .prepare(`DELETE FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${ph})`)
        .bind(...existingIds),
    );
  }
  stmts.push(env.DB.prepare('DELETE FROM project_steps WHERE project_id = ?').bind(projectId));

  // Update the project row in place — id and slug are preserved.
  const p = snapshot.project;
  stmts.push(
    env.DB
      .prepare(
        `UPDATE projects SET title=?, description=?, image_url=?, video_key=?, video_url=?, youtube_url=?, sort_order=?, published=?, updated_at=? WHERE id=?`,
      )
      .bind(
        p.title,
        p.description,
        p.image_url,
        p.video_key,
        p.video_url,
        p.youtube_url ?? null,
        p.sort_order,
        p.published,
        ts,
        projectId,
      ),
  );

  // Insert steps with their original ids so element parent links stay valid.
  for (const s of snapshot.steps) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, tags, hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          s.id,
          projectId,
          s.title,
          s.sort_order,
          s.video_timestamp_ms,
          s.tags,
          s.hidden ?? 0,
          s.created_at,
          ts,
        ),
    );
  }

  for (const e of snapshot.elements) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, video_timestamp_ms, tags, render_style, hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          e.id,
          e.parent_type,
          e.parent_id,
          e.type,
          e.content,
          e.sort_order,
          e.video_timestamp_ms,
          e.tags,
          e.render_style,
          e.hidden ?? 0,
          e.created_at,
          ts,
        ),
    );
  }

  await env.DB.batch(stmts);
  await invalidateProjectCache(env, p.slug);
}

projectRoutes.post('/:id/versions', requireSession, async (c) => {
  const projectId = c.req.param('id');
  let body: { label?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body */ }
  const userId = (c.get('userId' as never) as string | null) ?? null;
  try {
    const result = await snapshotProjectToVersions(c.env, projectId, 'manual', body.label?.trim() || null, userId);
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

projectRoutes.get('/:id/versions', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const rows = await c.env.DB.prepare(
    `SELECT id, project_id, version_num, label, source, created_by, created_at,
            length(snapshot_json) AS size_bytes
       FROM project_versions
      WHERE project_id = ?
      ORDER BY version_num DESC`,
  )
    .bind(projectId)
    .all<ProjectVersion & { size_bytes: number }>();
  return c.json(rows.results);
});

projectRoutes.post('/:id/versions/:vid/restore', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const versionId = c.req.param('vid');
  const userId = (c.get('userId' as never) as string | null) ?? null;

  const target = await c.env.DB.prepare(
    'SELECT * FROM project_versions WHERE id = ? AND project_id = ?',
  )
    .bind(versionId, projectId)
    .first<ProjectVersion>();
  if (!target) return c.json({ error: 'Version not found' }, 404);

  let snapshot: SnapshotShape;
  try {
    snapshot = JSON.parse(target.snapshot_json) as SnapshotShape;
  } catch {
    return c.json({ error: 'Snapshot is corrupt' }, 500);
  }

  // Snapshot the current state first so the user can roll the restore back.
  const before = await snapshotProjectToVersions(
    c.env,
    projectId,
    'manual',
    `Before restore of v${target.version_num}`,
    userId,
  );

  try {
    await applySnapshot(c.env, projectId, snapshot);
  } catch (e) {
    return c.json({ error: `Restore failed: ${String(e)}`, pre_restore_version_id: before.id }, 500);
  }

  return c.json({
    ok: true,
    restored_version_id: versionId,
    restored_version_num: target.version_num,
    pre_restore_version_id: before.id,
  });
});

projectRoutes.delete('/:id/versions/:vid', requireSession, async (c) => {
  const projectId = c.req.param('id');
  const versionId = c.req.param('vid');
  await c.env.DB.prepare('DELETE FROM project_versions WHERE id = ? AND project_id = ?')
    .bind(versionId, projectId)
    .run();
  return c.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Export: returns the snapshot plus a list of R2 keys the browser must fetch
// to assemble a `.codeempty` bundle. Avoids server-side zipping (would blow
// past the free-tier per-request CPU budget on a 100MB project).

// Pull every R2 key referenced by a project's rows. Owned-by-R2 fields only —
// external URLs (youtube/url/user_comment.profile_url) are ignored.
function collectMediaKeys(project: Project, elements: ContentElement[]): string[] {
  const keys = new Set<string>();
  const fromUrl = (u: string | null | undefined) => {
    if (!u) return;
    const m = u.match(/^\/api\/media\/(.+)$/);
    if (m) keys.add(m[1]);
  };
  fromUrl(project.image_url);
  fromUrl(project.video_url);
  if (project.video_key) keys.add(project.video_key);
  for (const el of elements) {
    if (el.type === 'image') {
      try {
        const parsed = JSON.parse(el.content) as { url?: string };
        fromUrl(parsed.url);
      } catch { /* malformed — ignore */ }
    }
  }
  return Array.from(keys);
}

// Find a slug that doesn't already exist by appending -2, -3, …
async function uniqueSlug(env: Env, baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let n = 2;
  // Cap iterations to avoid pathological loops; ~50 is enough in practice.
  while (n < 100) {
    const existing = await env.DB.prepare('SELECT 1 FROM projects WHERE slug = ?')
      .bind(candidate)
      .first();
    if (!existing) return candidate;
    candidate = `${baseSlug}-${n}`;
    n++;
  }
  return `${baseSlug}-${uuid().slice(0, 8)}`;
}

// Import a snapshot into the database. Generates new uuids for project, steps,
// elements (cross-instance import never trusts the source's ids). For replace
// mode, preserves the target's id and slug; auto-snapshots target first.
//
// Returns the resulting project_id (= targetProjectId for replace, new for
// create) and the slug. The whole effect is one atomic D1 batch.
async function importSnapshot(
  env: Env,
  payload: SnapshotShape,
  opts: {
    mode: 'create' | 'replace';
    targetProjectId?: string;
    label?: string | null;
    createdBy: string | null;
  },
): Promise<{ project_id: string; slug: string; version_id?: string }> {
  const ts = now();

  // Decide the destination project id + slug
  let destProjectId: string;
  let destSlug: string;
  let preSnapshotId: string | undefined;

  if (opts.mode === 'replace') {
    if (!opts.targetProjectId) throw new Error('target_project_id is required for replace mode');
    const target = await env.DB.prepare('SELECT id, slug FROM projects WHERE id = ?')
      .bind(opts.targetProjectId)
      .first<{ id: string; slug: string }>();
    if (!target) throw new Error(`Target project ${opts.targetProjectId} not found`);
    destProjectId = target.id;
    destSlug = target.slug; // keep the existing slug — inbound links and KV cache key stay valid
    // Auto-snapshot target before replacing.
    const pre = await snapshotProjectToVersions(
      env,
      destProjectId,
      'import-replace',
      opts.label ?? 'Before import-replace',
      opts.createdBy,
    );
    preSnapshotId = pre.id;
  } else {
    destProjectId = uuid();
    const baseSlug = payload.project.slug?.trim() || slugify(payload.project.title);
    destSlug = await uniqueSlug(env, baseSlug);
  }

  // Remap step ids and reparent elements.
  const stepIdMap = new Map<string, string>();
  const newSteps = payload.steps.map((s) => {
    const newId = uuid();
    stepIdMap.set(s.id, newId);
    return { ...s, id: newId, project_id: destProjectId };
  });
  const newElements = payload.elements.map((e) => {
    const newParentId = e.parent_type === 'project_step'
      ? (stepIdMap.get(e.parent_id) ?? e.parent_id)
      : e.parent_id;
    return { ...e, id: uuid(), parent_id: newParentId };
  });

  // Build the atomic batch.
  const stmts: D1PreparedStatement[] = [];

  if (opts.mode === 'replace') {
    // Wipe existing children of the target project before re-inserting.
    const existing = await env.DB.prepare('SELECT id FROM project_steps WHERE project_id = ?')
      .bind(destProjectId)
      .all<{ id: string }>();
    const existingIds = existing.results.map((r) => r.id);
    if (existingIds.length > 0) {
      const ph = existingIds.map(() => '?').join(',');
      stmts.push(
        env.DB
          .prepare(`DELETE FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${ph})`)
          .bind(...existingIds),
      );
    }
    stmts.push(env.DB.prepare('DELETE FROM project_steps WHERE project_id = ?').bind(destProjectId));
    // UPDATE the existing project row with imported metadata; id+slug preserved.
    const p = payload.project;
    stmts.push(
      env.DB
        .prepare(
          `UPDATE projects SET title=?, description=?, image_url=?, video_key=?, video_url=?, youtube_url=?, sort_order=?, published=?, updated_at=? WHERE id=?`,
        )
        .bind(
          p.title,
          p.description,
          p.image_url,
          p.video_key,
          p.video_url,
          p.youtube_url ?? null,
          p.sort_order,
          p.published,
          ts,
          destProjectId,
        ),
    );
  } else {
    const p = payload.project;
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO projects (id, slug, title, description, image_url, video_key, video_url, youtube_url, sort_order, published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          destProjectId,
          destSlug,
          p.title,
          p.description ?? '',
          p.image_url ?? null,
          p.video_key ?? null,
          p.video_url ?? null,
          p.youtube_url ?? null,
          p.sort_order ?? 0,
          p.published ?? 1,
          ts,
          ts,
        ),
    );
  }

  for (const s of newSteps) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO project_steps (id, project_id, title, sort_order, video_timestamp_ms, tags, hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(s.id, s.project_id, s.title, s.sort_order, s.video_timestamp_ms, s.tags, s.hidden ?? 0, ts, ts),
    );
  }
  for (const e of newElements) {
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, video_timestamp_ms, tags, render_style, hidden, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          e.id,
          e.parent_type,
          e.parent_id,
          e.type,
          e.content,
          e.sort_order,
          e.video_timestamp_ms,
          e.tags,
          e.render_style,
          e.hidden ?? 0,
          ts,
          ts,
        ),
    );
  }

  await env.DB.batch(stmts);
  await invalidateProjectCache(env, destSlug);
  if (opts.mode === 'create') {
    // Home page lists all projects; invalidate too.
    await env.PAGES_KV.delete('home');
  }

  return { project_id: destProjectId, slug: destSlug, version_id: preSnapshotId };
}

projectRoutes.post(
  '/import',
  requireSessionOrOAuthWithScope('write'),
  async (c) => {
    const body = await c.req.json<{
      manifest: { format_version: number };
      project: Project;
      steps: ProjectStep[];
      elements: ContentElement[];
      mode: 'create' | 'replace';
      target_project_id?: string;
      label?: string;
      idempotency_key?: string;
    }>();

    if (!body.project || !Array.isArray(body.steps) || !Array.isArray(body.elements)) {
      return c.json({ error: 'Missing required fields: project, steps, elements' }, 400);
    }
    if (body.mode !== 'create' && body.mode !== 'replace') {
      return c.json({ error: 'mode must be "create" or "replace"' }, 400);
    }
    if (body.manifest?.format_version !== 1) {
      return c.json({ error: `Unsupported bundle format: ${body.manifest?.format_version}` }, 400);
    }

    const userId = (c.get('userId' as never) as string | null) ?? null;

    // Idempotency replay: if we've already processed this key successfully,
    // return the cached response.
    if (body.idempotency_key) {
      const cached = await c.env.DB
        .prepare('SELECT response_json FROM idempotency_log WHERE key = ?')
        .bind(body.idempotency_key)
        .first<{ response_json: string }>();
      if (cached) {
        return c.json(JSON.parse(cached.response_json));
      }
    }

    try {
      const result = await importSnapshot(c.env, {
        format_version: 1,
        project: body.project,
        steps: body.steps,
        elements: body.elements,
      }, {
        mode: body.mode,
        targetProjectId: body.target_project_id,
        label: body.label ?? null,
        createdBy: userId,
      });

      if (body.idempotency_key) {
        await c.env.DB
          .prepare(
            'INSERT OR IGNORE INTO idempotency_log (key, user_id, endpoint, response_json) VALUES (?, ?, ?, ?)',
          )
          .bind(body.idempotency_key, userId ?? '<oauth>', '/api/projects/import', JSON.stringify(result))
          .run();
      }

      return c.json(result, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  },
);

projectRoutes.get('/:id/export-data', requireSession, async (c) => {
  const projectId = c.req.param('id');
  let snapshot: SnapshotShape;
  try {
    snapshot = await buildSnapshot(c.env, projectId);
  } catch (e) {
    return c.json({ error: String(e) }, 404);
  }
  const mediaKeys = collectMediaKeys(snapshot.project, snapshot.elements);
  const media = mediaKeys.map((key) => ({ key, url: `/api/media/${key}` }));
  return c.json({
    manifest: {
      format_version: 1,
      exported_at: now(),
      source_slug: snapshot.project.slug,
      stats: {
        step_count: snapshot.steps.length,
        element_count: snapshot.elements.length,
        media_count: media.length,
      },
    },
    project: snapshot.project,
    steps: snapshot.steps,
    elements: snapshot.elements,
    media,
  });
});
