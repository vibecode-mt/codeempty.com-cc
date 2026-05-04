import type { Env, Project, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';

export async function renderHome(env: Env): Promise<Response> {
  const cacheKey = 'home';
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [projectsResult, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare('SELECT * FROM projects WHERE published = 1 ORDER BY sort_order ASC, created_at ASC').all<Project>(),
    env.DB.prepare("SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC").all<CommonScript>(),
    fetchNavPages(env),
  ]);

  const projects = projectsResult.results;
  const scripts = scriptsResult.results;

  const cards = projects
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

  const body = `
    <h1 class="page-title">Projects</h1>
    <p class="page-subtitle">A collection of things I've built and explored.</p>
    <div class="projects-grid">${cards || '<p>No projects yet.</p>'}</div>
  `;

  const html = renderLayout({ title: 'CodeEmpty — Projects', body, scripts, navPages });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
