import type { Env, Project, BlogEntry, ContentElement, WidgetContent, WidgetKind } from '../types';
import { escHtml } from './layout';

// Widgets are content elements whose `content` field is JSON like
// { "kind": "project_list" }. Rendering needs DB access, so this module is
// async — call `renderWidgets` to pre-render every widget element on a page,
// then have the synchronous content renderer interpolate the result.

function parseWidget(content: string): WidgetContent | null {
  try {
    const parsed = JSON.parse(content) as Partial<WidgetContent>;
    if (parsed && (parsed.kind === 'project_list' || parsed.kind === 'blog_list')) {
      return { kind: parsed.kind };
    }
  } catch {
    // fall through
  }
  return null;
}

async function renderProjectList(env: Env): Promise<string> {
  const projects = await env.DB.prepare(
    'SELECT * FROM projects WHERE published = 1 ORDER BY sort_order ASC, created_at ASC',
  ).all<Project>();

  const cards = projects.results
    .map(
      (p) => `<a class="project-card" href="/projects/${escHtml(p.slug)}">
        ${p.image_url ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.title)}" loading="lazy">` : ''}
        <div class="project-card-body">
          <div class="project-card-title">${escHtml(p.title)}</div>
          <div class="project-card-desc">${p.description}</div>
        </div>
      </a>`,
    )
    .join('');

  return `<div class="content-el content-el-widget widget-project-list">
    <div class="projects-grid">${cards || '<p>No projects yet.</p>'}</div>
  </div>`;
}

async function renderBlogList(env: Env): Promise<string> {
  const entries = await env.DB.prepare(
    'SELECT * FROM blog_entries WHERE published = 1 ORDER BY entry_date DESC',
  ).all<BlogEntry>();

  const groups = new Map<string, BlogEntry[]>();
  for (const entry of entries.results) {
    const date = entry.entry_date.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(entry);
  }

  const groupHtml = [...groups.entries()]
    .map(
      ([date, items]) => `<div class="blog-date-group">
        <div class="blog-date-label">${formatDate(date)}</div>
        ${items.map((e) => `<a class="blog-entry-link" href="/blog/${escHtml(e.slug)}">${escHtml(e.title)}</a>`).join('')}
      </div>`,
    )
    .join('');

  return `<div class="content-el content-el-widget widget-blog-list">
    <div class="blog-list">${groupHtml || '<p>No entries yet.</p>'}</div>
  </div>`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Pre-render every widget content element in `elements` and return a Map keyed
// by element id → rendered HTML. Unknown widget kinds yield an HTML comment
// rather than throwing, so a typo in the JSON doesn't take down a page.
export async function renderWidgets(elements: ContentElement[], env: Env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const widgets = elements.filter((el) => el.type === 'widget');
  if (widgets.length === 0) return out;

  // Dedupe by kind so two project_list widgets on a page only hit D1 once.
  const cache = new Map<WidgetKind, string>();

  for (const el of widgets) {
    const cfg = parseWidget(el.content);
    if (!cfg) {
      out.set(el.id, `<!-- unknown widget: ${escHtml(el.content).slice(0, 100)} -->`);
      continue;
    }
    let html = cache.get(cfg.kind);
    if (html === undefined) {
      html = cfg.kind === 'project_list' ? await renderProjectList(env) : await renderBlogList(env);
      cache.set(cfg.kind, html);
    }
    out.set(el.id, html);
  }

  return out;
}

// Helpers used by API cache invalidation. Returns the slugs of pages that
// embed a widget of the given kind so callers can drop their KV entries.
export async function pagesWithWidget(env: Env, kind: WidgetKind): Promise<string[]> {
  // Coarse JSON match — fine because we control the shape.
  const needle = `%"kind":"${kind}"%`;
  const result = await env.DB.prepare(
    `SELECT DISTINCT p.slug FROM pages p
     JOIN content_elements ce ON ce.parent_type = 'page' AND ce.parent_id = p.id
     WHERE ce.type = 'widget' AND ce.content LIKE ?`,
  )
    .bind(needle)
    .all<{ slug: string }>();
  return result.results.map((r) => r.slug);
}
