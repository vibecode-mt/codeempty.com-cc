import type { Env, Page, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElementsWithWidgets } from './content';
import { applyContentElementTranslations, applyPageTranslations, getPublishedLanguageOptions, getSiteTitle } from '../i18n';

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
  if (!home) return renderUpgradePage(env, language);
  return renderPageBy('slug', home.slug, env, language);
}

async function renderUpgradePage(env: Env, language: string): Promise<Response> {
  const [scriptsResult, navPages, languageOptions, siteTitle] = await Promise.all([
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env, language),
    getPublishedLanguageOptions(env),
    getSiteTitle(env, language),
  ]);
  const copy = upgradeCopy(language);
  const body = `
    <section style="max-width:780px;margin:3rem auto;padding:2rem;border:1px solid #e5e7eb;border-radius:.9rem;background:#fafafa">
      <h1 class="page-title" style="font-size:2rem;margin-bottom:.6rem">${escHtml(copy.title)}</h1>
      <p style="color:#4b5563;font-size:1.05rem;line-height:1.7;margin-bottom:.9rem">${escHtml(copy.body)}</p>
      <p style="color:#6b7280;font-size:.95rem;line-height:1.7">${escHtml(copy.body2)}</p>
    </section>
  `;
  const html = renderLayout({
    title: `${copy.title} — ${siteTitle}`,
    body,
    scripts: scriptsResult.results,
    navPages,
    language,
    languageOptions,
    metaDescription: copy.body,
    siteTitle,
  });
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html;charset=utf-8' } });
}

function upgradeCopy(language: string): { title: string; body: string; body2: string } {
  const base = language.split('-')[0].toLowerCase();
  const map: Record<string, { title: string; body: string; body2: string }> = {
    en: {
      title: 'Website is being upgraded',
      body: 'We are currently updating this site and will be back soon.',
      body2: 'Thank you for your patience. Please check back in a little while.',
    },
    es: {
      title: 'El sitio web se está actualizando',
      body: 'Estamos actualizando este sitio y volveremos pronto.',
      body2: 'Gracias por tu paciencia. Vuelve a visitarnos en breve.',
    },
    fr: {
      title: 'Le site est en cours de mise à niveau',
      body: 'Nous mettons actuellement ce site à jour et reviendrons bientôt.',
      body2: 'Merci pour votre patience. Revenez dans un moment.',
    },
    de: {
      title: 'Die Website wird aktualisiert',
      body: 'Wir aktualisieren diese Website gerade und sind bald zurück.',
      body2: 'Vielen Dank für Ihre Geduld. Bitte schauen Sie bald wieder vorbei.',
    },
    zh: {
      title: '网站正在升级',
      body: '我们正在更新网站，很快会恢复访问。',
      body2: '感谢您的耐心等待，请稍后再来。',
    },
    ja: {
      title: 'サイトをアップグレード中です',
      body: '現在このサイトを更新しており、まもなく再開します。',
      body2: 'しばらくしてからもう一度アクセスしてください。',
    },
  };
  return map[base] ?? map.en;
}

async function renderPageBy(field: 'slug' | 'id', value: string, env: Env, language: string): Promise<Response> {
  const cacheKey = `page:${field === 'slug' ? value : `id:${value}`}:lang:${language}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const sql =
    field === 'slug'
      ? 'SELECT * FROM pages WHERE slug = ? AND published = 1'
      : 'SELECT * FROM pages WHERE id = ? AND published = 1';

  const [page, scriptsResult, navPages, languageOptions] = await Promise.all([
    env.DB.prepare(sql).bind(value).first<Page>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env, language),
    getPublishedLanguageOptions(env),
  ]);

  if (!page) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;
  const siteTitle = await getSiteTitle(env, language);
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

  const titleSuffix = isHome ? siteTitle : `${localizedPage.seo_title || localizedPage.title} — ${siteTitle}`;
  const html = renderLayout({
    title: titleSuffix,
    body,
    scripts,
    navPages,
    language,
    languageOptions,
    metaDescription: localizedPage.seo_description,
    siteTitle,
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
