import type { Env } from '../src/types';
import { renderProject } from '../src/renderer/project';
import { renderPage, renderHomePage } from '../src/renderer/page';
import { renderBlogEntry } from '../src/renderer/blog';

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/') return renderHomePage(ctx.env);

  if (path.startsWith('/projects/')) {
    const slug = path.slice('/projects/'.length);
    if (slug) return renderProject(slug, ctx.env);
  }

  if (path.startsWith('/blog/')) {
    const slug = path.slice('/blog/'.length);
    if (slug) return renderBlogEntry(slug, ctx.env);
  }

  // Serve admin SPA — try real static asset first, fall back to index.html for SPA routes
  if (path === '/admin' || path.startsWith('/admin/')) {
    const assetResp = await ctx.env.ASSETS.fetch(ctx.request);
    if (assetResp.status !== 404) return assetResp;
    return ctx.env.ASSETS.fetch(new Request(new URL('/admin/index.html', url)));
  }

  // All other top-level paths are author-managed Pages (e.g. /about, /blog, /contact)
  const slug = path.slice(1);
  if (slug) return renderPage(slug, ctx.env);

  return new Response('Not Found', { status: 404 });
};

