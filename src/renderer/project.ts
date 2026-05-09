import type { Env, Project, ProjectStep, ContentElement, CommonScript } from '../types';
import { renderLayout, fetchNavPages, escHtml } from './layout';
import { renderContentElement } from './content';
import {
  applyContentElementTranslations,
  applyProjectStepTranslations,
  applyProjectTranslations,
  getPublishedLanguageOptions,
  getSiteTitle,
} from '../i18n';

function pickNamespacedTags(tags: string | null, prefix: string): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const raw of tags.split(',')) {
    const t = raw.trim().toLowerCase();
    if (t.startsWith(prefix)) out.push(t.slice(prefix.length));
  }
  return out;
}

function extractYoutubeId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function youtubeLinkAt(id: string, ms: number): string {
  return `https://youtu.be/${id}?t=${Math.floor(ms / 1000)}s`;
}

function formatTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

// "May 8, 2026" — small, human-readable. Input is "YYYY-MM-DD HH:MM:SS" (UTC).
function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface SlideshowImage {
  url: string;
  caption: string;
  stepIdx: number;
  stepTitle: string;
  // Element-level tags (`element:...`) and the parent step's tags
  // (`step:...`) — both used by the client filter to keep the slideshow
  // in sync with whatever's currently visible on the page.
  tags: string[];
  stepTags: string[];
}

// Pull a plain-text "search index" from an element's content. Used to build
// each step's data-step-search attribute so quick search hits element text,
// not just step titles.
function extractElementText(el: ContentElement): string {
  const stripHtml = (s: string) =>
    s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  switch (el.type) {
    case 'description':
    case 'title':
    case 'prompt_code':
    case 'youtube':
      return stripHtml(el.content);
    case 'url':
      try {
        const p = JSON.parse(el.content) as { href?: string; label?: string };
        return `${p.label ?? ''} ${p.href ?? ''}`;
      } catch { return el.content; }
    case 'image':
      try {
        const p = JSON.parse(el.content) as { caption?: string };
        return stripHtml(p.caption ?? '');
      } catch { return ''; }
    case 'user_comment':
      try {
        const p = JSON.parse(el.content) as { username?: string; text?: string };
        return `${p.username ?? ''} ${stripHtml(p.text ?? '')}`;
      } catch { return ''; }
    default:
      return el.content;
  }
}

export async function renderProject(slug: string, env: Env, language = 'en'): Promise<Response> {
  const cacheKey = `project:${slug}:lang:${language}`;
  const cached = await env.PAGES_KV.get(cacheKey);
  if (cached) return new Response(cached, { headers: { 'content-type': 'text/html;charset=utf-8' } });

  const [project, scriptsResult, navPages, languageOptions] = await Promise.all([
    env.DB.prepare('SELECT * FROM projects WHERE slug = ? AND published = 1').bind(slug).first<Project>(),
    env.DB.prepare('SELECT * FROM common_scripts WHERE enabled = 1 ORDER BY sort_order ASC').all<CommonScript>(),
    fetchNavPages(env, language),
    getPublishedLanguageOptions(env),
  ]);

  if (!project) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/html' } });

  const scripts = scriptsResult.results;
  const siteTitle = await getSiteTitle(env, language);
  const translatedProjects = await applyProjectTranslations(env, [project], language);
  const localizedProject = translatedProjects[0] ?? project;
  const youtubeId = extractYoutubeId(localizedProject.youtube_url);

  const stepsResult = await env.DB.prepare(
    'SELECT * FROM project_steps WHERE project_id = ? AND hidden = 0 ORDER BY sort_order ASC',
  )
    .bind(project.id)
    .all<ProjectStep>();

  const translatedSteps = await applyProjectStepTranslations(env, stepsResult.results, language);
  const steps = translatedSteps;

  // Batch all elements in one query.
  const elementsByStep = new Map<string, ContentElement[]>();
  if (steps.length > 0) {
    const placeholders = steps.map(() => '?').join(',');
    const allEls = await env.DB
      .prepare(
        `SELECT * FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${placeholders}) AND hidden = 0 ORDER BY parent_id, sort_order ASC`,
      )
      .bind(...steps.map((s) => s.id))
      .all<ContentElement>();
    const translatedEls = await applyContentElementTranslations(env, allEls.results, language);
    for (const el of translatedEls) {
      const arr = elementsByStep.get(el.parent_id) ?? [];
      arr.push(el);
      elementsByStep.set(el.parent_id, arr);
    }
  }

  const stepFilterTags = new Set<string>();
  const elementFilterTags = new Set<string>();
  const stepAnchor = (i: number) => `step-${i + 1}`;
  const collapseAll = steps.length > 5;
  const slideshowImages: SlideshowImage[] = [];

  const stepHtml: string[] = [];
  const tocItems: string[] = [];

  // Render a small ▶ link if the project has a youtube URL and the row has a timestamp
  const ytBadge = (ms: number | null): string => {
    if (ms == null || !youtubeId) return '';
    return `<a class="yt-link" href="${youtubeLinkAt(youtubeId, ms)}" target="_blank" rel="noopener noreferrer" title="Open at ${formatTs(ms)} on YouTube">▶ ${formatTs(ms)}</a>`;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const elements = elementsByStep.get(step.id) ?? [];
    const stepTags = pickNamespacedTags(step.tags, 'step:');
    for (const t of stepTags) stepFilterTags.add(t);

    // Build a search index for this step: title + every element's plain text.
    // Quick search matches against this so users can find content, not only
    // step titles.
    const searchParts: string[] = [step.title];

    const elementHtml = elements.map((el) => {
      const elTags = pickNamespacedTags(el.tags, 'element:');
      for (const t of elTags) elementFilterTags.add(t);

      searchParts.push(extractElementText(el));

      if (el.type === 'image') {
        try {
          const parsed = JSON.parse(el.content) as { url?: string; caption?: string };
          if (parsed.url) {
            slideshowImages.push({
              url: parsed.url,
              caption: parsed.caption ?? '',
              stepIdx: i,
              stepTitle: step.title,
              tags: elTags,
              stepTags,
            });
          }
        } catch { /* skip malformed image */ }
      }

      const dataAttr = elTags.length > 0 ? ` data-el-tags="${escHtml(elTags.join(','))}"` : '';
      const tsBadge = ytBadge(el.video_timestamp_ms);
      const inner = renderContentElement(el);
      // Position the ts badge inline with element content; CSS pulls it to the right
      const wrapped = tsBadge
        ? `<div class="content-el-with-ts">${inner}<div class="content-el-ts">${tsBadge}</div></div>`
        : inner;
      return `<div class="content-el-wrap"${dataAttr}>${wrapped}</div>`;
    }).join('');

    const stepSearchIndex = searchParts.join(' ').toLowerCase();

    const elementCount = elements.length;
    const imageCount = elements.filter((e) => e.type === 'image').length;
    const summaryMeta = elementCount > 0
      ? `<span class="step-meta">${elementCount} ${elementCount === 1 ? 'item' : 'items'}${imageCount > 0 ? ` · ${imageCount} 🖼` : ''}</span>`
      : '';

    const stepDataAttr = stepTags.length > 0 ? ` data-step-tags="${escHtml(stepTags.join(','))}"` : '';
    const open = !collapseAll || i === 0 ? ' open' : '';
    const anchor = stepAnchor(i);
    const stepTsBadge = ytBadge(step.video_timestamp_ms);

    stepHtml.push(
      `<details class="step" id="${anchor}"${stepDataAttr}${open} data-step-search="${escHtml(stepSearchIndex)}">
        <summary class="step-summary">
          <span class="step-num">${i + 1}.</span>
          <span class="step-title-text">${escHtml(step.title)}</span>
          ${stepTsBadge}
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

  const showSearch = steps.length > 5;
  const searchBox = showSearch
    ? `<input class="step-search" type="search" placeholder="🔍 Search steps & content…" aria-label="Search steps and element content">`
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

  const slideshowButton = slideshowImages.length > 0
    ? `<button type="button" class="slideshow-trigger">🎞 Slideshow (${slideshowImages.length})</button>`
    : '';

  const youtubeButton = youtubeId
    ? `<a class="yt-watch-btn" href="https://youtu.be/${youtubeId}" target="_blank" rel="noopener noreferrer" title="Watch on YouTube">▶ Watch on YouTube</a>`
    : '';

  const slideshowJsonScript = slideshowImages.length > 0
    ? `<script type="application/json" id="slideshow-data">${JSON.stringify(slideshowImages).replace(/</g, '\\u003c')}</script>`
    : '';

  const slideshowModal = slideshowImages.length > 0
    ? `<div class="ss-modal" hidden role="dialog" aria-label="Image slideshow">
        <div class="ss-bar">
          <span class="ss-counter">1 / ${slideshowImages.length}</span>
          <span class="ss-step"></span>
          <button class="ss-play" type="button" aria-label="Toggle auto-play">▶ Play</button>
          <label class="ss-interval-label">
            every
            <select class="ss-interval">
              <option value="3000">3s</option>
              <option value="5000" selected>5s</option>
              <option value="8000">8s</option>
              <option value="15000">15s</option>
            </select>
          </label>
          <button class="ss-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="ss-stage">
          <button class="ss-prev" type="button" aria-label="Previous">‹</button>
          <img class="ss-img" alt="" title="Click to pause / resume">
          <button class="ss-next" type="button" aria-label="Next">›</button>
        </div>
        <input class="ss-progress" type="range" min="0" max="${slideshowImages.length - 1}" step="1" value="0" aria-label="Slide progress">
        <div class="ss-caption"></div>
      </div>`
    : '';

  const needsScript =
    stepFilterTags.size > 0 ||
    elementFilterTags.size > 0 ||
    showSearch ||
    slideshowImages.length > 0 ||
    steps.length > 5 ||
    !!localizedProject.description;

  const inlineScript = needsScript
    ? `<script>(function(){
  function $(sel,root){return (root||document).querySelector(sel);}
  function $$(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  var stepActive=new Set(),elActive=new Set();
  var search='';
  function stepMatches(s){
    if(stepActive.size>0){
      var tags=(s.getAttribute('data-step-tags')||'').split(',').filter(Boolean);
      if(!tags.some(function(t){return stepActive.has(t);}))return false;
    }
    if(search){
      var idx=s.getAttribute('data-step-search')||'';
      if(idx.indexOf(search)<0)return false;
    }
    return true;
  }
  function update(){
    var stepEls=$$('.step');
    stepEls.forEach(function(s){s.style.display=stepMatches(s)?'':'none';});
    $$('.content-el-wrap').forEach(function(e){
      var tags=(e.getAttribute('data-el-tags')||'').split(',').filter(Boolean);
      var v=elActive.size===0||tags.some(function(t){return elActive.has(t);});
      e.style.display=v?'':'none';
    });
    $$('.toc-item').forEach(function(t){
      var tagOk=true;
      if(stepActive.size>0){
        var tags=(t.getAttribute('data-step-tags')||'').split(',').filter(Boolean);
        tagOk=tags.some(function(x){return stepActive.has(x);});
      }
      t.style.display=tagOk?'':'none';
    });
    refreshSlideshowVisibility(stepEls);
  }
  // Recomputes the filtered slideshow set + the trigger button text/state
  // every time filters or search change.
  var allImages=[],filteredImages=[];
  var triggerBtn=$('.slideshow-trigger');
  var triggerTotal=0;
  function refreshSlideshowVisibility(stepEls){
    if(!triggerBtn||!allImages.length)return;
    // Build a per-step "matches" map (step idx → boolean) once per call.
    var stepOk=new Array(stepEls.length);
    for(var i=0;i<stepEls.length;i++)stepOk[i]=stepMatches(stepEls[i]);
    filteredImages=allImages.filter(function(im){
      if(stepOk[im.stepIdx]===false)return false;
      if(elActive.size>0&&!im.tags.some(function(t){return elActive.has(t);}))return false;
      return true;
    });
    if(filteredImages.length===triggerTotal){
      triggerBtn.textContent='🎞 Slideshow ('+triggerTotal+')';
    }else{
      triggerBtn.textContent='🎞 Slideshow ('+filteredImages.length+' of '+triggerTotal+')';
    }
    triggerBtn.disabled=filteredImages.length===0;
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
  var sb=$('.step-search');
  if(sb){
    sb.addEventListener('input',function(){
      search=sb.value.trim().toLowerCase();
      update();
    });
  }
  $$('.toc-item').forEach(function(a){
    a.addEventListener('click',function(){
      var id=a.getAttribute('href').slice(1);
      var t=document.getElementById(id);
      if(t&&t.tagName==='DETAILS')t.open=true;
    });
  });
  // Don't let the YouTube link inside a <summary> toggle the <details>
  $$('.step-summary .yt-link').forEach(function(a){
    a.addEventListener('click',function(e){e.stopPropagation();});
  });
  // Description "more" toggle: hide the button if text fits within the clamp,
  // otherwise expand on click.
  var desc=$('.project-description');
  if(desc){
    var txt=$('.project-description-text',desc);
    var more=$('.project-description-more',desc);
    if(txt&&more){
      // Measurement happens after layout; if the inner content fits the clamped
      // height, no "more" link is needed at all.
      if(txt.scrollHeight<=txt.clientHeight+2){more.remove();}
      else{
        more.addEventListener('click',function(){
          var collapsed=desc.getAttribute('data-collapsed')!=='false';
          desc.setAttribute('data-collapsed',collapsed?'false':'true');
          more.setAttribute('aria-expanded',collapsed?'true':'false');
          more.textContent=collapsed?'less ↑':'more ↓';
        });
      }
    }
  }
  var ea=$('#toc-expand-all');
  if(ea)ea.addEventListener('click',function(){$$('details.step').forEach(function(d){d.open=true;});});
  var ca=$('#toc-collapse-all');
  if(ca)ca.addEventListener('click',function(){$$('details.step').forEach(function(d){d.open=false;});});

  // Slideshow
  var ssData=document.getElementById('slideshow-data');
  if(ssData){
    allImages=JSON.parse(ssData.textContent);
    filteredImages=allImages.slice();
    triggerTotal=allImages.length;
    var modal=$('.ss-modal');
    var img=$('.ss-img',modal);
    var counter=$('.ss-counter',modal);
    var stepLabel=$('.ss-step',modal);
    var caption=$('.ss-caption',modal);
    var playBtn=$('.ss-play',modal);
    var intervalSelect=$('.ss-interval',modal);
    var progress=$('.ss-progress',modal);
    // Active slide deck — snapshot of filteredImages taken at open() time.
    // Filters changing while the modal is open don't yank the user mid-show.
    var deck=[],idx=0,playing=false,timer=null;
    function show(){
      if(deck.length===0)return;
      idx=(idx+deck.length)%deck.length;
      var im=deck[idx];
      img.src=im.url;
      counter.textContent=(idx+1)+' / '+deck.length;
      stepLabel.textContent='— '+im.stepTitle;
      caption.textContent=im.caption||'';
      progress.max=String(Math.max(0,deck.length-1));
      progress.value=String(idx);
    }
    function next(){idx++;show();}
    function prev(){idx--;show();}
    function startTimer(){
      if(timer)clearInterval(timer);
      timer=setInterval(next,parseInt(intervalSelect.value,10));
    }
    function stopTimer(){if(timer){clearInterval(timer);timer=null;}}
    function setPlaying(p){
      playing=p;
      playBtn.textContent=playing?'⏸ Pause':'▶ Play';
      img.classList.toggle('ss-img-playing',playing);
      if(playing)startTimer();else stopTimer();
    }
    function togglePlay(){setPlaying(!playing);}
    function open(at){
      deck=filteredImages.slice();
      if(deck.length===0)return;
      idx=at||0;
      show();
      modal.hidden=false;
      document.body.style.overflow='hidden';
    }
    function close(){modal.hidden=true;setPlaying(false);document.body.style.overflow='';}
    $$('.slideshow-trigger').forEach(function(b){
      b.addEventListener('click',function(){if(!b.disabled)open(0);});
    });
    $('.ss-prev',modal).addEventListener('click',prev);
    $('.ss-next',modal).addEventListener('click',next);
    $('.ss-close',modal).addEventListener('click',close);
    playBtn.addEventListener('click',togglePlay);
    img.addEventListener('click',togglePlay);
    intervalSelect.addEventListener('change',function(){if(playing)startTimer();});
    progress.addEventListener('input',function(){
      idx=parseInt(progress.value,10);
      show();
      if(playing)startTimer(); // restart the interval so the user-chosen slide gets full duration
    });
    document.addEventListener('keydown',function(e){
      if(modal.hidden)return;
      if(e.key==='Escape')close();
      else if(e.key==='ArrowLeft')prev();
      else if(e.key==='ArrowRight')next();
      else if(e.key===' '){e.preventDefault();togglePlay();}
    });
    $$('.content-el-img img').forEach(function(im){
      im.style.cursor='zoom-in';
      im.addEventListener('click',function(){
        // Open at the matching image within the currently filtered deck.
        var src=im.getAttribute('src');
        deck=filteredImages.slice();
        if(deck.length===0)return;
        for(var k=0;k<deck.length;k++){if(deck[k].url===src){open(k);return;}}
        open(0);
      });
    });
    // Initial sync (filters at page load might already have constrained things)
    refreshSlideshowVisibility($$('.step'));
  }
})();</script>`
    : '';

  // Hero block: cover image with title overlay (description moved below the
  // image to stay readable for long copy). Falls back to a text-only header
  // when no cover image is set.
  const hero = localizedProject.image_url
    ? `<header class="project-hero project-hero-image">
        <img class="project-hero-img" src="${escHtml(localizedProject.image_url)}" alt="" decoding="async">
        <div class="project-hero-overlay">
          <a class="project-hero-back" href="/">← Projects</a>
          <h1 class="project-hero-title">${escHtml(localizedProject.title)}</h1>
        </div>
      </header>`
    : `<header class="project-hero project-hero-text">
        <a class="project-hero-back" href="/">← Projects</a>
        <h1 class="project-hero-title-plain">${escHtml(localizedProject.title)}</h1>
      </header>`;

  // Posted/updated timestamps. Suppress "Updated" when it equals "Posted".
  const postedDate = formatDate(localizedProject.created_at);
  const updatedDate = formatDate(localizedProject.updated_at);
  const datesLine = postedDate
    ? `<div class="project-dates">Posted ${postedDate}${updatedDate && updatedDate !== postedDate ? ` · Updated ${updatedDate}` : ''}</div>`
    : '';

  // Collapsible description: clamps to a few lines initially, "more" link
  // expands. Inline JS removes the link when the text is short enough to fit.
  const descriptionBlock = localizedProject.description
    ? `<div class="project-description" data-collapsed="true">
        <div class="project-description-text">${localizedProject.description}</div>
        <button type="button" class="project-description-more" aria-expanded="false">more ↓</button>
      </div>`
    : '';

  const toolsBar = (searchBox || slideshowButton || youtubeButton)
    ? `<div class="page-tools">${searchBox}${slideshowButton}${youtubeButton}</div>`
    : '';

  const body = `
    ${hero}
    ${datesLine}
    ${descriptionBlock}
    ${toolsBar}
    ${tocBlock}
    ${stepFilterRow}
    ${elementFilterRow}
    <div class="steps">${stepHtml.join('')}</div>
    ${slideshowJsonScript}
    ${slideshowModal}
    ${inlineScript}
  `;

  const html = renderLayout({
    title: `${localizedProject.seo_title || localizedProject.title} — ${siteTitle}`,
    body,
    scripts,
    navPages,
    language,
    languageOptions,
    metaDescription: localizedProject.seo_description,
    siteTitle,
  });
  await env.PAGES_KV.put(cacheKey, html, { expirationTtl: 86400 });
  await env.DB.prepare(
    'INSERT OR REPLACE INTO cache_keys (cache_key, content_hash, cached_at) VALUES (?, ?, datetime(\'now\'))',
  )
    .bind(cacheKey, project.updated_at)
    .run();

  return new Response(html, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
