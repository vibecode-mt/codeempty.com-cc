import type { Env, BlogEntry, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElements } from './content';

export async function renderBlogEntry(slug: string, env: Env): Promise<Response> {
  const cacheKey = `blog:${slug}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [entry, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare('SELECT * FROM blog_entries WHERE slug = ? AND published = 1').bind(slug).first<BlogEntry>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env),
  ]);

  if (!entry) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;

  const elementsResult = await env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind('blog_entry', entry.id)
    .all<ContentElement>();

  const body = `
    <a class="back-link" href="/blog">&#8592; Back to Blog</a>
    <p style="font-size:.875rem;color:#9ca3af;margin-bottom:.5rem">${formatDate(entry.entry_date.slice(0, 10))}</p>
    <h1 class="page-title">${escHtml(entry.title)}</h1>
    <div class="blog-entry-content">${renderContentElements(elementsResult.results)}</div>
  `;

  const html = renderLayout({ title: `${entry.title} — CodeEmpty`, body, scripts, navPages });
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
