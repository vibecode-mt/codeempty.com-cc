import type { CommonScript, Env, Page } from '../types';
import { applyPageTranslations } from '../i18n';

export async function fetchNavPages(env: Env, language = 'en'): Promise<{ title: string; slug: string }[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM pages WHERE published = 1 AND show_in_menu = 1 ORDER BY title ASC',
  ).all<Page>();
  const translated = await applyPageTranslations(env, result.results, language);
  return translated.map((p) => ({ title: p.title, slug: p.slug }));
}

export function renderLayout(opts: {
  title: string;
  body: string;
  scripts: CommonScript[];
  navPages?: { title: string; slug: string }[];
  language?: string;
  metaDescription?: string | null;
  siteTitle?: string;
}): string {
  const headScripts = opts.scripts
    .filter((s) => s.enabled && s.position === 'head')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => s.html_snippet)
    .join('\n');

  const bodyScripts = opts.scripts
    .filter((s) => s.enabled && s.position === 'body_end')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => s.html_snippet)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${escHtml(opts.language ?? 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(opts.title)}</title>
  ${opts.metaDescription ? `<meta name="description" content="${escHtml(opts.metaDescription)}">` : ''}
  <meta property="og:title" content="${escHtml(opts.title)}">
  ${opts.metaDescription ? `<meta property="og:description" content="${escHtml(opts.metaDescription)}">` : ''}
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${headScripts}
  <style>${css}</style>
</head>
<body>
  <header>
    <nav class="nav">
      <a class="nav-brand" href="/">${escHtml(opts.siteTitle ?? 'CodeEmpty')}</a>
      <div class="nav-links">
        ${(opts.navPages ?? []).map((p) => `<a href="/${escHtml(p.slug)}">${escHtml(p.title)}</a>`).join('')}
      </div>
    </nav>
  </header>
  <main class="main">
    ${opts.body}
  </main>
  <footer class="footer">
    <p>&copy; ${new Date().getFullYear()} ${escHtml(opts.siteTitle ?? 'CodeEmpty')}.com</p>
  </footer>
  ${bodyScripts}
</body>
</html>`;
}

export function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const css = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;color:#1a1a1a;background:#fff;line-height:1.6}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto;display:block}
.nav{max-width:1100px;margin:0 auto;padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.nav-brand{font-weight:700;font-size:1.25rem;color:#1a1a1a;letter-spacing:-.01em}
.nav-links{display:flex;gap:1.5rem;font-size:.95rem}
.nav-links a{color:#555}
.main{max-width:1100px;margin:0 auto;padding:2rem 1.5rem;min-height:70vh}
.footer{text-align:center;padding:2rem;color:#888;font-size:.875rem;border-top:1px solid #eee}
.page-title{font-size:1.55rem;font-weight:700;margin-bottom:.4rem;letter-spacing:-.01em}
.page-subtitle{color:#555;margin-bottom:2rem;font-size:.95rem;line-height:1.55}

/* Typography for free-form HTML content (description elements, page bodies,
 * blog entries). The site-wide '*{margin:0;padding:0}' reset zeroes browser
 * defaults so authored h2/ul/blockquote tags would render with no visual
 * hierarchy. Restore them inside content containers only. */
.content-el-desc,.blog-entry-content{font-size:1rem;line-height:1.7}
.content-el-desc h1,.content-el-desc h2,.content-el-desc h3,.content-el-desc h4,
.blog-entry-content h1,.blog-entry-content h2,.blog-entry-content h3,.blog-entry-content h4{font-weight:600;line-height:1.3;margin:1.1em 0 .5em}
.content-el-desc h1,.blog-entry-content h1{font-size:1.5rem}
.content-el-desc h2,.blog-entry-content h2{font-size:1.3rem}
.content-el-desc h3,.blog-entry-content h3{font-size:1.12rem}
.content-el-desc h4,.blog-entry-content h4{font-size:1.02rem}
.content-el-desc p,.blog-entry-content p{margin:.5em 0}
.content-el-desc ul,.content-el-desc ol,
.blog-entry-content ul,.blog-entry-content ol{padding-left:1.5rem;margin:.6em 0}
.content-el-desc ul,.blog-entry-content ul{list-style:disc}
.content-el-desc ol,.blog-entry-content ol{list-style:decimal}
.content-el-desc li,.blog-entry-content li{margin:.2em 0}
.content-el-desc blockquote,.blog-entry-content blockquote{border-left:3px solid #d1d5db;padding-left:1rem;color:#4b5563;margin:.7em 0;font-style:italic}
.content-el-desc a,.blog-entry-content a{color:#2563eb;text-decoration:underline}
.content-el-desc code,.blog-entry-content code{background:#f3f4f6;padding:.1em .35em;border-radius:.25rem;font-family:ui-monospace,monospace;font-size:.95em}
.content-el-desc pre,.blog-entry-content pre{background:#1f2937;color:#f3f4f6;padding:.85rem 1rem;border-radius:.5rem;overflow-x:auto;font-size:.85rem;line-height:1.55;margin:.7em 0}
.content-el-desc pre code,.blog-entry-content pre code{background:transparent;color:inherit;padding:0}
.content-el-desc hr,.blog-entry-content hr{border:0;border-top:1px solid #e5e7eb;margin:1.2em 0}
.content-el-desc img,.blog-entry-content img{margin:.5em 0;border-radius:.5rem}
.projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;margin-top:1.5rem}
.project-card{display:block;color:inherit;text-decoration:none;background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;overflow:hidden;transition:transform .18s ease,box-shadow .22s ease,border-color .18s ease}
.project-card:hover{text-decoration:none;transform:translateY(-3px);box-shadow:0 14px 38px rgba(15,23,42,.10);border-color:#d4d4d8}
.project-card img{width:100%;height:200px;object-fit:cover;transition:transform .35s ease}
.project-card:hover img{transform:scale(1.03)}
.project-card-body{padding:1.25rem}
.project-card-title{font-size:1.1rem;font-weight:600;margin-bottom:.5rem;transition:color .18s ease}
.project-card:hover .project-card-title{color:#2563eb}
.project-card-desc{font-size:.9rem;color:#555;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.step{margin-bottom:1rem;border:1px solid #e5e7eb;border-radius:.5rem;background:#fff}
.step[open]{margin-bottom:2rem}
.step-summary{padding:.75rem 1rem;cursor:pointer;display:flex;align-items:center;gap:.6rem;font-weight:600;list-style:none;border-radius:.5rem;user-select:none}
.step-summary::-webkit-details-marker{display:none}
.step-summary::before{content:"▸";font-size:.8em;color:#9ca3af;transition:transform .15s;flex-shrink:0}
.step[open] .step-summary::before{transform:rotate(90deg)}
.step[open] .step-summary{border-bottom:1px solid #f3f4f6;border-radius:.5rem .5rem 0 0}
.step-summary:hover{background:#f9fafb}
.step-num{color:#9ca3af;font-weight:500;font-size:.95em}
.step-title-text{flex:1;font-size:1.05rem}
.step-meta{font-size:.8rem;color:#9ca3af;font-weight:400}
.step-body{padding:1rem 1.25rem 1.25rem}
.step-title{font-size:1.25rem;font-weight:600;margin-bottom:1rem;padding-bottom:.5rem;border-bottom:2px solid #e5e7eb}
.step-toc{margin-bottom:2rem;background:#f9fafb;border:1px solid #e5e7eb;border-radius:.5rem;padding:.5rem 1rem}
.step-toc>summary{cursor:pointer;font-weight:600;font-size:.95rem;padding:.25rem 0}
.toc-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.25rem .75rem;margin:.5rem 0}
.toc-item{display:flex;gap:.4rem;padding:.25rem 0;font-size:.875rem;color:#374151;text-decoration:none}
.toc-item:hover{color:#1d4ed8}
.toc-num{color:#9ca3af;flex-shrink:0;width:1.75rem;text-align:right}
.toc-actions{display:flex;gap:.5rem;margin-top:.5rem;font-size:.8rem}
.toc-actions button{padding:.25rem .6rem;background:#fff;border:1px solid #d1d5db;border-radius:.25rem;cursor:pointer;color:#4b5563}
.toc-actions button:hover{background:#f3f4f6}
.filter-row{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin-bottom:.75rem;padding:.5rem .75rem;background:#fafafa;border:1px solid #e5e7eb;border-radius:.5rem}
.filter-label{font-size:.8rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-right:.25rem}
.filter-chip{padding:.25rem .7rem;background:#fff;border:1px solid #d1d5db;border-radius:9999px;font-size:.8rem;cursor:pointer;color:#4b5563;font-family:inherit}
.filter-chip:hover{background:#f3f4f6}
.filter-chip.active{background:#2563eb;border-color:#2563eb;color:#fff}
.filter-chip.active:hover{background:#1d4ed8}
.filter-clear{margin-left:auto;padding:.25rem .6rem;background:transparent;border:none;font-size:.8rem;color:#6b7280;cursor:pointer;font-family:inherit}
.filter-clear:hover{color:#1f2937;text-decoration:underline}
.content-el-wrap{display:contents}
.project-hero{margin:-2rem -1.5rem 2rem;position:relative}
.project-hero-image{height:clamp(240px,36vw,420px);overflow:hidden;border-radius:0 0 .75rem .75rem;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.project-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.project-hero-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:1.5rem 2rem;background:linear-gradient(to bottom,rgba(0,0,0,0) 30%,rgba(0,0,0,.65) 100%);color:#fff}
.project-hero-back{align-self:flex-start;color:rgba(255,255,255,.85);text-decoration:none;font-size:.85rem;background:rgba(0,0,0,.35);padding:.3rem .75rem;border-radius:9999px;backdrop-filter:blur(6px);transition:background .15s}
.project-hero-back:hover{background:rgba(0,0,0,.55);color:#fff}
.project-hero-title{font-size:clamp(1.6rem,4vw,2.5rem);font-weight:700;line-height:1.15;margin:auto 0 .5rem;text-shadow:0 2px 12px rgba(0,0,0,.45);letter-spacing:-.01em}
.project-hero-subtitle{font-size:clamp(.95rem,1.4vw,1.1rem);line-height:1.5;color:rgba(255,255,255,.92);max-width:60ch;text-shadow:0 1px 8px rgba(0,0,0,.4);margin:0}
.project-hero-text{padding:1.5rem 0 .5rem}
.project-hero-text .project-hero-back{display:inline-block;color:#6b7280;background:transparent;padding:0;font-size:.9rem;margin-bottom:1rem}
.project-hero-text .project-hero-back:hover{color:#1f2937;text-decoration:underline}
.project-hero-title-plain{font-size:clamp(1.6rem,4vw,2.25rem);font-weight:700;margin:0 0 .75rem;letter-spacing:-.01em}
@media(max-width:640px){.project-hero{margin-left:-1.5rem;margin-right:-1.5rem}.project-hero-overlay{padding:1rem 1.25rem}}
.project-dates{font-size:.8rem;color:#6b7280;margin-bottom:1rem;letter-spacing:.01em}
.project-description{margin-bottom:1.5rem;font-size:1rem;color:#374151;line-height:1.65}
.project-description-text{overflow:hidden}
.project-description[data-collapsed="true"] .project-description-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.project-description[data-collapsed="true"] .project-description-text{mask-image:linear-gradient(to bottom,#000 60%,rgba(0,0,0,.6) 100%);-webkit-mask-image:linear-gradient(to bottom,#000 60%,rgba(0,0,0,.6) 100%)}
.project-description-more{margin-top:.4rem;background:transparent;border:none;color:#2563eb;padding:0;font-size:.9rem;cursor:pointer;font-family:inherit;font-weight:500}
.project-description-more:hover{color:#1d4ed8;text-decoration:underline}
.page-tools{display:flex;gap:.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap}
.yt-watch-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.45rem .9rem;background:#ff0033;color:#fff;border-radius:.4rem;font-size:.85rem;text-decoration:none;font-weight:500}
.yt-watch-btn:hover{background:#cc0028}
.yt-link{display:inline-flex;align-items:center;gap:.25rem;padding:.15rem .55rem;background:#fef2f2;color:#b91c1c;border-radius:9999px;font-size:.75rem;font-family:monospace;text-decoration:none;border:1px solid #fecaca;flex-shrink:0;transition:background .15s}
.yt-link:hover{background:#fee2e2;color:#991b1b}
.step-summary .yt-link{margin-left:auto}
.content-el-with-ts{display:flex;align-items:flex-start;gap:.75rem}
.content-el-with-ts>:first-child{flex:1;min-width:0}
.content-el-ts{flex-shrink:0;padding-top:.25rem}
.step-search{flex:1;min-width:160px;max-width:400px;padding:.45rem .75rem;border:1px solid #d1d5db;border-radius:.4rem;font-size:.9rem;font-family:inherit}
.slideshow-trigger{padding:.45rem .9rem;background:#1f2937;color:#fff;border:none;border-radius:.4rem;font-size:.85rem;cursor:pointer;font-family:inherit}
.slideshow-trigger:hover{background:#111827}
.content-el-img img{cursor:zoom-in}
.ss-modal{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;flex-direction:column;color:#fff}
.ss-modal[hidden]{display:none}
.ss-bar{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;background:rgba(0,0,0,.5);font-size:.85rem;flex-wrap:wrap}
.ss-counter{font-family:monospace}
.ss-step{flex:1;color:#d1d5db;font-size:.85rem;truncate:true;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-bar button,.ss-bar select{background:transparent;border:1px solid #4b5563;color:#fff;padding:.3rem .7rem;border-radius:.3rem;cursor:pointer;font-family:inherit;font-size:.85rem}
.ss-bar button:hover,.ss-bar select:hover{background:#1f2937}
.ss-interval-label{display:inline-flex;align-items:center;gap:.4rem;color:#9ca3af;font-size:.8rem}
.ss-stage{flex:1;display:flex;align-items:center;justify-content:center;position:relative;padding:1rem;min-height:0}
.ss-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:.5rem;box-shadow:0 8px 30px rgba(0,0,0,.5);cursor:pointer}
.ss-img-playing{cursor:pointer;outline:2px solid rgba(96,165,250,.4);outline-offset:4px}
.ss-progress{appearance:none;width:calc(100% - 2rem);margin:0 1rem;height:6px;background:rgba(255,255,255,.18);border-radius:3px;outline:none;cursor:pointer}
.ss-progress::-webkit-slider-thumb{appearance:none;width:14px;height:14px;background:#60a5fa;border-radius:50%;cursor:pointer;border:none}
.ss-progress::-moz-range-thumb{width:14px;height:14px;background:#60a5fa;border-radius:50%;cursor:pointer;border:none}
.ss-progress::-webkit-slider-runnable-track{height:6px;background:rgba(255,255,255,.18);border-radius:3px}
.ss-progress::-moz-range-track{height:6px;background:rgba(255,255,255,.18);border-radius:3px}
.ss-prev,.ss-next{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.6);border:none;color:#fff;width:48px;height:48px;font-size:2rem;cursor:pointer;border-radius:50%;display:flex;align-items:center;justify-content:center;line-height:1}
.ss-prev:hover,.ss-next:hover{background:rgba(0,0,0,.85)}
.ss-prev{left:1rem}.ss-next{right:1rem}
.ss-caption{padding:.75rem 2rem 1.25rem;text-align:center;color:#d1d5db;font-size:.9rem;line-height:1.5;max-width:80ch;align-self:center}
@media(max-width:640px){.ss-prev,.ss-next{width:40px;height:40px;font-size:1.5rem}.ss-bar{font-size:.8rem;gap:.5rem}}
.content-el{margin-bottom:1rem}
.content-el-title{font-size:1.4rem;font-weight:600}
.content-el-desc{line-height:1.8}
.content-el-code{background:#f3f4f6;padding:1rem;border-radius:.5rem;font-family:monospace;font-size:.875rem;white-space:pre-wrap;overflow-x:auto}
.content-el-url a{display:inline-flex;align-items:center;gap:.4rem}
.content-el-img img{border-radius:.5rem}
.content-el-img-caption{font-size:.875rem;color:#555;margin-top:.5rem;line-height:1.6}
.render-markdown p{margin:.75em 0}
.render-markdown code{background:#f3f4f6;padding:.1em .35em;border-radius:.25rem;font-size:.95em}
.render-markdown pre{background:#1f2937;color:#f3f4f6;padding:1rem;border-radius:.5rem;overflow-x:auto;font-size:.875rem;line-height:1.55}
.render-markdown pre code{background:transparent;color:inherit;padding:0}
.render-markdown ul,.render-markdown ol{padding-left:1.5rem;margin:.5em 0}
.render-markdown blockquote{border-left:3px solid #d1d5db;padding-left:1rem;color:#4b5563;margin:.75em 0}
.render-ai-response{border-left:3px solid #6366f1;background:#eef2ff;padding:.75rem 1rem;border-radius:.25rem .5rem .5rem .25rem;line-height:1.7}
.render-ai-response::before{content:"AI response";display:block;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#4338ca;margin-bottom:.4rem}
.render-ai-response p,.render-ai-response ul,.render-ai-response ol{margin:.5em 0}
.render-ai-response code{background:rgba(255,255,255,.7);padding:.1em .35em;border-radius:.25rem;font-size:.95em}
.render-ai-response pre{background:#1e1b4b;color:#e0e7ff;padding:1rem;border-radius:.5rem;overflow-x:auto}
.render-ai-response pre code{background:transparent;color:inherit;padding:0}
.render-thoughts{font-style:italic;color:#6b7280;border-left:2px dashed #9ca3af;padding-left:1rem;line-height:1.7}
.render-thoughts::before{content:"💭 ";font-style:normal}
.content-el-comment{background:#fafafa;border:1px solid #e5e7eb;border-radius:.5rem;padding:.75rem 1rem}
.content-el-comment-header{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;font-size:.875rem}
.content-el-comment-user{font-weight:600;color:#374151}
.content-el-comment-link{color:#6b7280;font-size:.8rem;text-decoration:none}
.content-el-comment-link:hover{color:#374151}
.content-el-comment-body{line-height:1.7;color:#374151}
.youtube-wrapper{position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:.5rem}
.youtube-wrapper iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
.blog-list{display:flex;flex-direction:column;gap:0}
.blog-date-group{margin-bottom:2rem}
.blog-date-label{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:.75rem}
.blog-entry-link{display:block;padding:.75rem 0;border-bottom:1px solid #f3f4f6;font-weight:500}
.blog-entry-content{margin-top:1.5rem}
.back-link{display:inline-flex;align-items:center;gap:.4rem;color:#6b7280;font-size:.9rem;margin-bottom:1.5rem}
`;
