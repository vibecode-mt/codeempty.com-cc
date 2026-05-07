import type { CommonScript, Env } from '../types';

export async function fetchNavPages(env: Env): Promise<{ title: string; slug: string }[]> {
  const result = await env.DB.prepare(
    'SELECT title, slug FROM pages WHERE published = 1 AND show_in_menu = 1 ORDER BY title ASC',
  ).all<{ title: string; slug: string }>();
  return result.results;
}

export function renderLayout(opts: {
  title: string;
  body: string;
  scripts: CommonScript[];
  navPages?: { title: string; slug: string }[];
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(opts.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${headScripts}
  <style>${css}</style>
</head>
<body>
  <header>
    <nav class="nav">
      <a class="nav-brand" href="/">CodeEmpty</a>
      <div class="nav-links">
        <a href="/">Projects</a>
        <a href="/blog">Blog</a>
        ${(opts.navPages ?? []).map((p) => `<a href="/${escHtml(p.slug)}">${escHtml(p.title)}</a>`).join('')}
      </div>
    </nav>
  </header>
  <main class="main">
    ${opts.body}
  </main>
  <footer class="footer">
    <p>&copy; ${new Date().getFullYear()} CodeEmpty.com</p>
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
.nav-brand{font-weight:700;font-size:1.2rem;color:#1a1a1a}
.nav-links{display:flex;gap:1.5rem;font-size:.95rem}
.nav-links a{color:#555}
.main{max-width:1100px;margin:0 auto;padding:2rem 1.5rem;min-height:70vh}
.footer{text-align:center;padding:2rem;color:#888;font-size:.875rem;border-top:1px solid #eee}
.page-title{font-size:2rem;font-weight:700;margin-bottom:.5rem}
.page-subtitle{color:#555;margin-bottom:2rem}
.projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem;margin-top:1.5rem}
.project-card{border:1px solid #e5e7eb;border-radius:.75rem;overflow:hidden;transition:box-shadow .2s}
.project-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08)}
.project-card img{width:100%;height:200px;object-fit:cover}
.project-card-body{padding:1.25rem}
.project-card-title{font-size:1.1rem;font-weight:600;margin-bottom:.5rem}
.project-card-desc{font-size:.9rem;color:#555;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
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
