import type { Env } from './types';

const SITEMAP_KV_KEY = 'system:sitemap.xml';

type SitemapEntry = { loc: string; lastmod?: string };
type PageRow = { slug: string; updated_at: string; is_home?: number };
type ProjectRow = { slug: string; updated_at: string };
type BlogRow = { slug: string; updated_at: string };

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function withOrigin(origin: string, path: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return `${base}${path}`;
}

async function hasIsHomeColumn(env: Env): Promise<boolean> {
  const info = await env.DB.prepare('PRAGMA table_info(pages)').all<{ name: string }>();
  return info.results.some((col) => col.name === 'is_home');
}

async function collectEntries(env: Env, origin: string): Promise<SitemapEntry[]> {
  const homeColumn = await hasIsHomeColumn(env);
  const pageSql = homeColumn
    ? 'SELECT slug, updated_at, is_home FROM pages WHERE published = 1'
    : 'SELECT slug, updated_at FROM pages WHERE published = 1';

  const [pages, projects, blogEntries] = await Promise.all([
    env.DB.prepare(pageSql).all<PageRow>(),
    env.DB.prepare('SELECT slug, updated_at FROM projects WHERE published = 1').all<ProjectRow>(),
    env.DB.prepare('SELECT slug, updated_at FROM blog_entries WHERE published = 1').all<BlogRow>(),
  ]);

  const map = new Map<string, SitemapEntry>();
  const put = (loc: string, updatedAt?: string) => {
    const lastmod = toIsoDate(updatedAt);
    const existing = map.get(loc);
    if (!existing) {
      map.set(loc, { loc, lastmod });
      return;
    }
    if (lastmod && (!existing.lastmod || lastmod > existing.lastmod)) {
      map.set(loc, { loc, lastmod });
    }
  };

  for (const page of pages.results) {
    const isHome = homeColumn ? page.is_home === 1 : page.slug === 'home';
    if (isHome) put(withOrigin(origin, '/'), page.updated_at);
    else put(withOrigin(origin, `/${page.slug}`), page.updated_at);
  }

  for (const project of projects.results) {
    put(withOrigin(origin, `/projects/${project.slug}`), project.updated_at);
  }

  if (blogEntries.results.length > 0) put(withOrigin(origin, '/blog'));
  for (const blogEntry of blogEntries.results) {
    put(withOrigin(origin, `/blog/${blogEntry.slug}`), blogEntry.updated_at);
  }

  return Array.from(map.values()).sort((a, b) => a.loc.localeCompare(b.loc));
}

function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : '';
    return `<url><loc>${xmlEscape(entry.loc)}</loc>${lastmod}</url>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function buildRobotsTxt(origin: string): string {
  const sitemapUrl = withOrigin(origin, '/sitemap.xml');
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

export async function regenerateSitemap(env: Env, origin: string): Promise<{ xml: string; url_count: number }> {
  const entries = await collectEntries(env, origin);
  const xml = buildSitemap(entries);
  await env.PAGES_KV.put(SITEMAP_KV_KEY, xml);
  return { xml, url_count: entries.length };
}

export async function getSitemap(env: Env, origin: string): Promise<{ xml: string; url_count: number }> {
  const cached = await env.PAGES_KV.get(SITEMAP_KV_KEY);
  if (cached) return { xml: cached, url_count: 0 };
  return regenerateSitemap(env, origin);
}
