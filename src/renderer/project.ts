import type { Env, Project, ProjectStep, ContentElement, CommonScript } from '../types';
import { renderLayout, escHtml } from './layout';
import { renderContentElements } from './content';

export async function renderProject(slug: string, env: Env): Promise<Response> {
  const cacheKey = `project:${slug}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [project, scriptsResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM projects WHERE slug = ? AND published = 1').bind(slug).first<Project>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
  ]);

  if (!project) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;

  const stepsResult = await env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC',
  )
    .bind(project.id)
    .all<ProjectStep>();

  const steps = stepsResult.results;

  const stepHtml = await Promise.all(
    steps.map(async (step) => {
      const elementsResult = await env.DB.prepare(
        'SELECT * FROM content_elements WHERE parent_type = ? AND parent_id = ? ORDER BY sort_order ASC',
      )
        .bind('project_step', step.id)
        .all<ContentElement>();

      return `<div class="step">
        <div class="step-title">${escHtml(step.title)}</div>
        ${renderContentElements(elementsResult.results)}
      </div>`;
    }),
  );

  const body = `
    <a class="back-link" href="/">&#8592; Back to Projects</a>
    <h1 class="page-title">${escHtml(project.title)}</h1>
    ${project.description ? `<p class="page-subtitle">${escHtml(project.description)}</p>` : ''}
    ${project.image_url ? `<img src="${escHtml(project.image_url)}" alt="${escHtml(project.title)}" style="border-radius:.75rem;margin-bottom:2rem;max-height:400px;width:100%;object-fit:cover">` : ''}
    ${stepHtml.join('')}
  `;

  const html = renderLayout({ title: `${project.title} — CodeEmpty`, body, scripts });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    'INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime(\'now\'))',
  )
    .bind(cacheKey, project.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
