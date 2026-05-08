import { Hono } from 'hono';
import type { Env, ContentElement, ParentType } from '../types';
import { uuid, now } from '../utils';
import { requireAdmin, requireOAuthOrSession } from './middleware';

export const contentRoutes = new Hono<{ Bindings: Env }>();

contentRoutes.get('/:parentType/:parentId', requireOAuthOrSession, async (c) => {
  const { parentType, parentId } = c.req.param();
  const rows = await c.env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? ORDER BY sort_order ASC',
  )
    .bind(parentType, parentId)
    .all<ContentElement>();
  return c.json(rows.results);
});

contentRoutes.post('/:parentType/:parentId', requireAdmin, async (c) => {
  const { parentType, parentId } = c.req.param();
  const body = await c.req.json<Partial<ContentElement>>();
  if (!body.type) return c.json({ error: 'type is required' }, 400);

  const id = uuid();
  const ts = now();
  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM content_elements WHERE parent_type = ? AND parent_id = ?',
  )
    .bind(parentType, parentId)
    .first<{ m: number }>();

  await c.env.DB.prepare(
    `INSERT INTO content_elements (id, parent_type, parent_id, type, content, sort_order, video_timestamp_ms, tags, render_style, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      parentType as ParentType,
      parentId,
      body.type,
      body.content ?? '',
      (maxOrder?.m ?? -1) + 1,
      body.video_timestamp_ms ?? null,
      normalizeTags(body.tags),
      normalizeRenderStyle(body.render_style),
      ts,
      ts,
    )
    .run();

  // If a timestamp is provided, re-sort elements within this parent so sort_order reflects timestamp order
  if (body.video_timestamp_ms != null) {
    await resortElementsByTimestamp(c.env, parentType as ParentType, parentId);
  }

  const el = await c.env.DB.prepare('SELECT * FROM content_elements WHERE id = ?').bind(id).first<ContentElement>();
  await invalidateParentCache(c.env, parentType as ParentType, parentId);
  return c.json(el, 201);
});

contentRoutes.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<ContentElement>>();
  const existing = await c.env.DB.prepare('SELECT * FROM content_elements WHERE id = ?')
    .bind(id)
    .first<ContentElement>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE content_elements SET type=?, content=?, sort_order=?, video_timestamp_ms=?, tags=?, render_style=?, hidden=?, updated_at=? WHERE id=?',
  )
    .bind(
      body.type ?? existing.type,
      body.content ?? existing.content,
      body.sort_order ?? existing.sort_order,
      'video_timestamp_ms' in body ? (body.video_timestamp_ms ?? null) : existing.video_timestamp_ms,
      'tags' in body ? normalizeTags(body.tags) : existing.tags,
      'render_style' in body ? normalizeRenderStyle(body.render_style) : existing.render_style,
      'hidden' in body ? (body.hidden ? 1 : 0) : existing.hidden,
      now(),
      id,
    )
    .run();

  // Re-sort if timestamp changed
  if ('video_timestamp_ms' in body) {
    await resortElementsByTimestamp(c.env, existing.parent_type, existing.parent_id);
  }

  await invalidateParentCache(c.env, existing.parent_type, existing.parent_id);
  return c.json(await c.env.DB.prepare('SELECT * FROM content_elements WHERE id = ?').bind(id).first<ContentElement>());
});

contentRoutes.delete('/:id', requireAdmin, async (c) => {
  const existing = await c.env.DB.prepare('SELECT * FROM content_elements WHERE id = ?')
    .bind(c.req.param('id'))
    .first<ContentElement>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare('DELETE FROM content_elements WHERE id = ?').bind(c.req.param('id')).run();
  await invalidateParentCache(c.env, existing.parent_type, existing.parent_id);
  return c.json({ ok: true });
});

contentRoutes.post('/reorder', requireAdmin, async (c) => {
  const { orders } = await c.req.json<{ orders: { id: string; sort_order: number }[] }>();
  const stmts = orders.map((o) =>
    c.env.DB.prepare('UPDATE content_elements SET sort_order=?, updated_at=? WHERE id=?').bind(o.sort_order, now(), o.id),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

async function resortElementsByTimestamp(env: Env, parentType: ParentType, parentId: string) {
  const els = await env.DB.prepare(
    'SELECT id, video_timestamp_ms, sort_order FROM content_elements WHERE parent_type = ? AND parent_id = ? ORDER BY sort_order ASC',
  ).bind(parentType, parentId).all<{ id: string; video_timestamp_ms: number | null; sort_order: number }>();

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

const VALID_RENDER_STYLES = new Set(['ai_response', 'thoughts', 'markdown']);
function normalizeRenderStyle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim().toLowerCase();
  if (!v || v === 'default') return null;
  return VALID_RENDER_STYLES.has(v) ? v : null;
}

async function invalidateParentCache(env: Env, parentType: ParentType, parentId: string) {
  let key: string | null = null;

  if (parentType === 'project_step') {
    const step = await env.DB.prepare('SELECT project_id FROM project_steps WHERE id = ?')
      .bind(parentId)
      .first<{ project_id: string }>();
    if (step) {
      const project = await env.DB.prepare('SELECT slug FROM projects WHERE id = ?')
        .bind(step.project_id)
        .first<{ slug: string }>();
      if (project) key = `project:${project.slug}`;
    }
  } else if (parentType === 'page') {
    const page = await env.DB.prepare('SELECT slug FROM pages WHERE id = ?')
      .bind(parentId)
      .first<{ slug: string }>();
    if (page) key = `page:${page.slug}`;
  } else if (parentType === 'blog_entry') {
    const entry = await env.DB.prepare('SELECT slug FROM blog_entries WHERE id = ?')
      .bind(parentId)
      .first<{ slug: string }>();
    if (entry) key = `blog:${entry.slug}`;
  }

  if (key) {
    await env.PAGES_KV.delete(key);
    await env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
    if (parentType === 'blog_entry') await env.PAGES_KV.delete('blog:index');
    if (parentType === 'project_step') await env.PAGES_KV.delete('home');
  }
}
