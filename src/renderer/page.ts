import type { Env, Page, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElementsWithWidgets } from './content';
import { applyContentElementTranslations, applyPageTranslations } from '../i18n';

export async function renderPage(slug: string, env: Env, language = 'en'): Promise<Response> {
  return renderPageBy('slug', slug, env, language);
}

export async function renderHomePage(env: Env, language = 'en'): Promise<Response> {
  const hasHomeColumn = await hasIsHomeColumn(env);
  const home = hasHomeColumn
    ? await env.DB.prepare(
      'SELECT slug FROM pages WHERE is_home = 1 AND published = 1 LIMIT 1',
    ).first<{ slug: string }>()
    : await env.DB.prepare(
      'SELECT slug FROM pages WHERE slug = ? AND published = 1 LIMIT 1',
    ).bind('home').first<{ slug: string }>();
  if (!home) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });
  return renderPageBy('slug', home.slug, env, language);
}

async function renderPageBy(field: 'slug' | 'id', value: string, env: Env, language: string): Promise<Response> {
  const cacheKey = `page:${field === 'slug' ? value : `id:${value}`}:lang:${language}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const sql =
    field === 'slug'
      ? 'SELECT * FROM pages WHERE slug = ? AND published = 1'
      : 'SELECT * FROM pages WHERE id = ? AND published = 1';

  const [page, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare(sql).bind(value).first<Page>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env, language),
  ]);

  if (!page) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;
  const translatedPages = await applyPageTranslations(env, [page], language);
  const localizedPage = translatedPages[0] ?? page;

  const elementsResult = await env.DB.prepare(
    'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind('page', page.id)
    .all<ContentElement>();

  const translatedElements = await applyContentElementTranslations(env, elementsResult.results, language);
  const elementsHtml = await renderContentElementsWithWidgets(translatedElements, env, language);

  // Home page suppresses the redundant H1 (the project_list widget speaks for itself);
  // other pages keep the title heading. This matches the previous look of '/'.
  const isHome = localizedPage.is_home === 1 || localizedPage.slug === 'home';
  const showHeading = !isHome;
  const body = `
    ${showHeading ? `<h1 class="page-title">${escHtml(localizedPage.title)}</h1>` : ''}
    <div${showHeading ? ' style="margin-top:1.5rem"' : ''}>${elementsHtml}</div>
  `;

  const titleSuffix = isHome ? 'CodeEmpty' : `${localizedPage.seo_title || localizedPage.title} — CodeEmpty`;
  const html = renderLayout({
    title: titleSuffix,
    body,
    scripts,
    navPages,
    language,
    metaDescription: localizedPage.seo_description,
  });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    "INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime('now'))",
  )
    .bind(cacheKey, page.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}

async function hasIsHomeColumn(env: Env): Promise<boolean> {
  const info = await env.DB.prepare('PRAGMA table_info(pages)').all<{ name: string }>();
  return info.results.some((col) => col.name === 'is_home');
}
