import type { Env } from '../src/types';
import { renderProject } from '../src/renderer/project';
import { renderPage, renderHomePage } from '../src/renderer/page';
import { renderBlogEntry } from '../src/renderer/blog';
import { resolveLanguageFromRequest } from '../src/i18n';
import { buildRobotsTxt, getSitemap } from '../src/sitemap';

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/sitemap.xml') {
    const { xml } = await getSitemap(ctx.env, url.origin);
    return new Response(xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  }

  if (path === '/robots.txt') {
    return new Response(buildRobotsTxt(url.origin), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  }

  // Let Pages static assets (favicon, JS, CSS, images, etc.) be served directly.
  if (path.includes('.')) {
    const assetResp = await ctx.env.ASSETS.fetch(ctx.request);
    if (assetResp.status !== 404) return assetResp;
  }

  const language = await resolveLanguageFromRequest(ctx.request, ctx.env);

  if (path === '/') return renderHomePage(ctx.env, language);

  if (path.startsWith('/projects/')) {
    const slug = path.slice('/projects/'.length);
    if (slug) return renderProject(slug, ctx.env, language);
  }

  if (path.startsWith('/blog/')) {
    const slug = path.slice('/blog/'.length);
    if (slug) return renderBlogEntry(slug, ctx.env, language);
  }

  // Serve admin SPA — try real static asset first, fall back to index.html for SPA routes
  if (path === '/admin' || path.startsWith('/admin/')) {
    const assetResp = await ctx.env.ASSETS.fetch(ctx.request);
    if (assetResp.status !== 404) return assetResp;
    return ctx.env.ASSETS.fetch(new Request(new URL('/admin/index.html', url)));
  }

  // All other top-level paths are author-managed Pages (e.g. /about, /blog, /contact)
  const slug = path.slice(1);
  if (slug) return renderPage(slug, ctx.env, language);

  return new Response('Not Found', { status: 404 });
};
