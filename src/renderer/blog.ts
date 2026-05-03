import type { Env, BlogEntry, ContentElement, CommonScript } from '../types';
import { renderLayout, escHtml } from './layout';
import { renderContentElements } from './content';

export async function renderBlogIndex(env: Env): Promise<Response> {
  const cacheKey = 'blog:index';
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [entriesResult, scriptsResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM blog_entries WHERE published = 1 ORDER BY entry_date DESC').all<BlogEntry>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
  ]);

  const entries = entriesResult.results;
  const scripts = scriptsResult.results;

  // Group by date
  const groups = new Map<string, BlogEntry[]>();
  for (const entry of entries) {
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

  const body = `
    <h1 class="page-title">Blog</h1>
    <div class="blog-list" style="margin-top:1.5rem">
      ${groupHtml || '<p>No entries yet.</p>'}
    </div>
  `;

  const html = renderLayout({ title: 'Blog — CodeEmpty', body, scripts });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}

export async function renderBlogEntry(slug: string, env: Env): Promise<Response> {
  const cacheKey = `blog:${slug}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [entry, scriptsResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM blog_entries WHERE slug = ? AND published = 1').bind(slug).first<BlogEntry>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
  ]);

  if (!entry) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;

  const elementsResult = await env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? ORDER BY sort_order ASC',
  )
    .bind('blog_entry', entry.id)
    .all<ContentElement>();

  const body = `
    <a class="back-link" href="/blog">&#8592; Back to Blog</a>
    <p style="font-size:.875rem;color:#9ca3af;margin-bottom:.5rem">${formatDate(entry.entry_date.slice(0, 10))}</p>
    <h1 class="page-title">${escHtml(entry.title)}</h1>
    <div class="blog-entry-content">${renderContentElements(elementsResult.results)}</div>
  `;

  const html = renderLayout({ title: `${entry.title} — CodeEmpty`, body, scripts });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    "INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime('now'))",
  )
    .bind(cacheKey, entry.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
