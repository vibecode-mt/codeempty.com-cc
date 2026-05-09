import type { Env, BlogEntry, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElements } from './content';
import { applyBlogEntryTranslations, applyContentElementTranslations, getSiteTitle } from '../i18n';

export async function renderBlogEntry(slug: string, env: Env, language = 'en'): Promise<Response> {
  const cacheKey = `blog:${slug}:lang:${language}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [entry, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare('SELECT * FROM blog_entries WHERE slug = ? AND published = 1').bind(slug).first<BlogEntry>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env, language),
  ]);

  if (!entry) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;
  const siteTitle = await getSiteTitle(env, language);
  const translatedEntries = await applyBlogEntryTranslations(env, [entry], language);
  const localizedEntry = translatedEntries[0] ?? entry;

  const elementsResult = await env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind('blog_entry', entry.id)
    .all<ContentElement>();

  const translatedElements = await applyContentElementTranslations(env, elementsResult.results, language);
  const body = `
    <a class="back-link" href="/blog">&#8592; Back to Blog</a>
    <p style="font-size:.875rem;color:#9ca3af;margin-bottom:.5rem">${formatDate(localizedEntry.entry_date.slice(0, 10))}</p>
    <h1 class="page-title">${escHtml(localizedEntry.title)}</h1>
    <div class="blog-entry-content">${renderContentElements(translatedElements)}</div>
  `;

  const html = renderLayout({
    title: `${localizedEntry.seo_title || localizedEntry.title} — ${siteTitle}`,
    body,
    scripts,
    navPages,
    language,
    metaDescription: localizedEntry.seo_description,
    siteTitle,
  });
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
