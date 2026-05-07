import type { Env, Project, ProjectStep, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElement } from './content';

// Pull tags with the given prefix (e.g. `step:` / `element:`) and strip the prefix.
//   ["step:major","youtube"] with prefix "step:" → ["major"]
function pickNamespacedTags(tags: string | null, prefix: string): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const raw of tags.split(',')) {
    const t = raw.trim().toLowerCase();
    if (t.startsWith(prefix)) out.push(t.slice(prefix.length));
  }
  return out;
}

export async function renderProject(slug: string, env: Env): Promise<Response> {
  const cacheKey = `project:${slug}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [project, scriptsResult, navPages] = await Promise.all([
    env.DB.prepare('SELECT * FROM projects WHERE slug = ? AND published = 1').bind(slug).first<Project>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env),
  ]);

  if (!project) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;

  const stepsResult = await env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind(project.id)
    .all<ProjectStep>();

  const steps = stepsResult.results;

  // Batch all elements in one query — a 30-step project was firing 31 D1 reads
  // on every cold render before the KV cache warmed.
  let elementsByStep = new Map<string, ContentElement[]>();
  if (steps.length > 0) {
    const placeholders = steps.map(() => '?').join(',');
    const allEls = await env.DB
      .prepare(
        `SELECT * FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${placeholders}) AND hidden = 0 ORDER BY parent_id, sort_order ASC`,
      )
      .bind(...steps.map((s) => s.id))
      .all<ContentElement>();
    for (const el of allEls.results) {
      const arr = elementsByStep.get(el.parent_id) ?? [];
      arr.push(el);
      elementsByStep.set(el.parent_id, arr);
    }
  }

  // Collect filter tag namespaces. step:X tags filter steps; element:Y filter elements.
  const stepFilterTags = new Set<string>();
  const elementFilterTags = new Set<string>();

  // Anchor id per step
  const stepAnchor = (i: number) => `step-${i + 1}`;

  // Many-step heuristic: collapse all but the first when there are >5 steps.
  // Small projects open everything so the page reads top-to-bottom as before.
  const collapseAll = steps.length > 5;

  const stepHtml: string[] = [];
  const tocItems: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const elements = elementsByStep.get(step.id) ?? [];
    const stepTags = pickNamespacedTags(step.tags, 'step:');
    for (const t of stepTags) stepFilterTags.add(t);

    const elementHtml = elements.map((el) => {
      const elTags = pickNamespacedTags(el.tags, 'element:');
      for (const t of elTags) elementFilterTags.add(t);
      const dataAttr = elTags.length > 0 ? ` data-el-tags="${escHtml(elTags.join(','))}"` : '';
      // renderContentElement returns a <div class="content-el ..."> ... </div>;
      // we wrap it in another div carrying the data attribute so the JS filter
      // doesn't need to parse the inner div's classes.
      return `<div class="content-el-wrap"${dataAttr}>${renderContentElement(el)}</div>`;
    }).join('');

    const elementCount = elements.length;
    const imageCount = elements.filter((e) => e.type === 'image').length;
    const summaryMeta = elementCount > 0
      ? `<span class="step-meta">${elementCount} ${elementCount === 1 ? 'item' : 'items'}${imageCount > 0 ? ` · ${imageCount} 🖼` : ''}</span>`
      : '';

    const stepDataAttr = stepTags.length > 0 ? ` data-step-tags="${escHtml(stepTags.join(','))}"` : '';
    const open = !collapseAll || i === 0 ? ' open' : '';
    const anchor = stepAnchor(i);

    stepHtml.push(
      `<details class="step" id="${anchor}"${stepDataAttr}${open}>
        <summary class="step-summary">
          <span class="step-num">${i + 1}.</span>
          <span class="step-title-text">${escHtml(step.title)}</span>
          ${summaryMeta}
        </summary>
        <div class="step-body">${elementHtml}</div>
      </details>`,
    );

    const tocDataAttr = stepTags.length > 0 ? ` data-step-tags="${escHtml(stepTags.join(','))}"` : '';
    tocItems.push(
      `<a class="toc-item" href="#${anchor}"${tocDataAttr}><span class="toc-num">${i + 1}.</span> ${escHtml(step.title)}</a>`,
    );
  }

  // Filter chip rows. Only render when tags actually exist.
  const stepFilterRow = stepFilterTags.size > 0
    ? `<div class="filter-row" data-filter-scope="step">
        <span class="filter-label">Steps:</span>
        ${[...stepFilterTags].sort().map((t) => `<button type="button" class="filter-chip" data-tag="${escHtml(t)}">${escHtml(t)}</button>`).join('')}
        <button type="button" class="filter-clear" data-clear="step">Clear</button>
      </div>`
    : '';

  const elementFilterRow = elementFilterTags.size > 0
    ? `<div class="filter-row" data-filter-scope="element">
        <span class="filter-label">Content:</span>
        ${[...elementFilterTags].sort().map((t) => `<button type="button" class="filter-chip" data-tag="${escHtml(t)}">${escHtml(t)}</button>`).join('')}
        <button type="button" class="filter-clear" data-clear="element">Clear</button>
      </div>`
    : '';

  const tocBlock = steps.length > 5
    ? `<details class="step-toc" open>
        <summary>📑 Contents — ${steps.length} steps</summary>
        <div class="toc-list">${tocItems.join('')}</div>
        <div class="toc-actions">
          <button type="button" id="toc-expand-all">Expand all</button>
          <button type="button" id="toc-collapse-all">Collapse all</button>
        </div>
      </details>`
    : '';

  // Inline filter / TOC behavior. Static HTML is fine for browse-only readers,
  // and feature-detection means non-JS clients still see everything.
  const inlineScript = (stepFilterTags.size > 0 || elementFilterTags.size > 0 || steps.length > 5)
    ? `<script>(function(){
  function $$(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  var stepActive=new Set(),elActive=new Set();
  function update(){
    $$('.step').forEach(function(s){
      var tags=(s.getAttribute('data-step-tags')||'').split(',').filter(Boolean);
      var v=stepActive.size===0||tags.some(function(t){return stepActive.has(t);});
      s.style.display=v?'':'none';
    });
    $$('.content-el-wrap').forEach(function(e){
      var tags=(e.getAttribute('data-el-tags')||'').split(',').filter(Boolean);
      var v=elActive.size===0||tags.some(function(t){return elActive.has(t);});
      e.style.display=v?'':'none';
    });
    $$('.toc-item').forEach(function(t){
      var tags=(t.getAttribute('data-step-tags')||'').split(',').filter(Boolean);
      var v=stepActive.size===0||tags.some(function(x){return stepActive.has(x);});
      t.style.display=v?'':'none';
    });
  }
  $$('.filter-row').forEach(function(row){
    var scope=row.getAttribute('data-filter-scope');
    var set=scope==='step'?stepActive:elActive;
    row.addEventListener('click',function(e){
      var btn=e.target.closest('.filter-chip');
      if(btn){
        var tag=btn.getAttribute('data-tag');
        if(set.has(tag)){set.delete(tag);btn.classList.remove('active');}
        else{set.add(tag);btn.classList.add('active');}
        update();return;
      }
      var clr=e.target.closest('.filter-clear');
      if(clr){
        set.clear();
        $$('.filter-chip',row).forEach(function(b){b.classList.remove('active');});
        update();
      }
    });
  });
  // TOC: clicking a link opens the target details so the section is visible
  $$('.toc-item').forEach(function(a){
    a.addEventListener('click',function(){
      var id=a.getAttribute('href').slice(1);
      var t=document.getElementById(id);
      if(t&&t.tagName==='DETAILS')t.open=true;
    });
  });
  var ea=document.getElementById('toc-expand-all');
  if(ea)ea.addEventListener('click',function(){$$('details.step').forEach(function(d){d.open=true;});});
  var ca=document.getElementById('toc-collapse-all');
  if(ca)ca.addEventListener('click',function(){$$('details.step').forEach(function(d){d.open=false;});});
})();</script>`
    : '';

  const body = `
    <a class="back-link" href="/">&#8592; Back to Projects</a>
    <h1 class="page-title">${escHtml(project.title)}</h1>
    ${project.description ? `<p class="page-subtitle">${project.description}</p>` : ''}
    ${project.image_url ? `<img src="${escHtml(project.image_url)}" alt="${escHtml(project.title)}" style="border-radius:.75rem;margin-bottom:2rem;max-height:400px;width:100%;object-fit:cover">` : ''}
    ${tocBlock}
    ${stepFilterRow}
    ${elementFilterRow}
    <div class="steps">${stepHtml.join('')}</div>
    ${inlineScript}
  `;

  const html = renderLayout({ title: `${project.title} — CodeEmpty`, body, scripts, navPages });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    'INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime(\'now\'))',
  )
    .bind(cacheKey, project.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
