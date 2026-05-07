import type { Env, Page, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElements } from './content';

export async function renderPage(slug: string, env: Env): Promise<Response> {
  const cacheKey = `page:${slug}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [page, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare('SELECT * FROM pages WHERE slug = ? AND published = 1').bind(slug).first<Page>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env),
  ]);

  if (!page) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;

  const elementsResult = await env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind('page', page.id)
    .all<ContentElement>();

  const body = `
    <h1 class="page-title">${escHtml(page.title)}</h1>
    <div style="margin-top:1.5rem">${renderContentElements(elementsResult.results)}</div>
  `;

  const html = renderLayout({ title: `${page.title} — CodeEmpty`, body, scripts, navPages });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    "INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime('now'))",
  )
    .bind(cacheKey, page.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
