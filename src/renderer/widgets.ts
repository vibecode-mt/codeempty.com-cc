import type { Env, Project, BlogEntry, ContentElement, WidgetContent, WidgetKind } from '../types';
import { escHtml } from './layout';
import { getContactConfig } from '../contact-form';

// Widgets are content elements whose `content` field is JSON like
// { "kind": "project_list" }. Rendering needs DB access, so this module is
// async — call `renderWidgets` to pre-render every widget element on a page,
// then have the synchronous content renderer interpolate the result.

function parseWidget(content: string): WidgetContent | null {
  try {
    const parsed = JSON.parse(content) as Partial<WidgetContent>;
    if (parsed && (parsed.kind === 'project_list' || parsed.kind === 'blog_list' || parsed.kind === 'contact')) {
      return { kind: parsed.kind };
    }
  } catch {
    // fall through
  }
  return null;
}

async function renderProjectList(env: Env): Promise<string> {
  const projects = await env.DB.prepare(
    'SELECT * FROM projects WHERE published = 1 ORDER BY sort_order ASC, created_at ASC',
  ).all<Project>();

  const cards = projects.results
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

  return `<div class="content-el content-el-widget widget-project-list">
    <div class="projects-grid">${cards || '<p>No projects yet.</p>'}</div>
  </div>`;
}

async function renderBlogList(env: Env): Promise<string> {
  const entries = await env.DB.prepare(
    'SELECT * FROM blog_entries WHERE published = 1 ORDER BY entry_date DESC',
  ).all<BlogEntry>();

  const groups = new Map<string, BlogEntry[]>();
  for (const entry of entries.results) {
    const date = entry.entry_date.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(entry);
  }

  const groupHtml = [...groups.entries()]
    .map(
      ([date, items]) => `<div class="blog-date-group">
        <div class="blog-date-label">${formatDate(date)}</div>
        ${items.map((e) => `<a class="blog-entry-link" href="/blog/${escHtml(e.slug)}">${escHtml(e.title)}</a>`).join('')}
      </div>`,
    )
    .join('');

  return `<div class="content-el content-el-widget widget-blog-list">
    <div class="blog-list">${groupHtml || '<p>No entries yet.</p>'}</div>
  </div>`;
}

async function renderContact(env: Env): Promise<string> {
  const cfg = await getContactConfig(env);
  const fieldsHtml = cfg.fields.map((f) => {
    const required = f.required ? ' required' : '';
    const help = f.help_text ? `<div class="contact-help">${escHtml(f.help_text)}</div>` : '';
    if (f.type === 'textarea') {
      return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><textarea name="${escHtml(f.key)}" placeholder="${escHtml(f.placeholder ?? '')}"${required}></textarea>${help}</label>`;
    }
    if (f.type === 'select') {
      const options = (f.options ?? [])
        .map((o) => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`)
        .join('');
      return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><select name="${escHtml(f.key)}"${required}><option value="">Select…</option>${options}</select>${help}</label>`;
    }
    if (f.type === 'checkbox') {
      return `<label class="contact-field contact-field-checkbox"><input type="checkbox" name="${escHtml(f.key)}"${required}><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span></label>${help}`;
    }
    const inputType = f.type === 'email' || f.type === 'tel' ? f.type : 'text';
    return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><input type="${inputType}" name="${escHtml(f.key)}" placeholder="${escHtml(f.placeholder ?? '')}"${required}>${help}</label>`;
  }).join('');

  const captchaScript = cfg.captcha.enabled
    ? cfg.captcha.provider === 'turnstile'
      ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : '<script src="https://www.google.com/recaptcha/api.js?render=explicit" async defer></script>'
    : '';

  const captchaHtml = cfg.captcha.enabled
    ? cfg.captcha.provider === 'turnstile'
      ? `<div class="cf-turnstile" data-sitekey="${escHtml(cfg.captcha.site_key)}"></div>`
      : cfg.captcha.provider === 'recaptcha_v2'
        ? `<div class="g-recaptcha" data-sitekey="${escHtml(cfg.captcha.site_key)}"></div>`
        : '<div class="contact-captcha-note">This form uses invisible reCAPTCHA.</div>'
    : '';

  const recaptchaV3Script = cfg.captcha.enabled && cfg.captcha.provider === 'recaptcha_v3'
    ? `await new Promise((resolve) => {
      if (typeof grecaptcha !== 'undefined') return grecaptcha.ready(resolve);
      let tries = 0;
      const timer = setInterval(() => {
        if (typeof grecaptcha !== 'undefined') { clearInterval(timer); grecaptcha.ready(resolve); return; }
        tries++;
        if (tries > 50) { clearInterval(timer); resolve(undefined); }
      }, 100);
    });
    captchaToken = await grecaptcha.execute('${escJs(cfg.captcha.site_key)}', { action: '${escJs(cfg.captcha.recaptcha_action ?? 'contact_submit')}' });`
    : '';

  return `<div class="content-el content-el-widget widget-contact">
    <form class="contact-form" novalidate>
      ${fieldsHtml}
      ${captchaHtml}
      <button type="submit">${escHtml(cfg.submit_button_label)}</button>
      <p class="contact-status" aria-live="polite"></p>
    </form>
  </div>
  ${captchaScript}
  <script>
  (function () {
    const root = document.currentScript && document.currentScript.previousElementSibling;
    if (!root) return;
    const form = root.querySelector('.contact-form');
    const statusEl = root.querySelector('.contact-status');
    if (!form || !statusEl) return;

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      statusEl.textContent = 'Sending...';
      statusEl.className = 'contact-status';
      const data = new FormData(form);
      const fields = Object.fromEntries(data.entries());
      form.querySelectorAll('input[type="checkbox"][name]').forEach((el) => {
        fields[el.name] = el.checked;
      });

      let captchaToken = undefined;
      ${recaptchaV3Script}
      try {
        if (!captchaToken) {
          const turnstileEl = form.querySelector('.cf-turnstile');
          if (turnstileEl && window.turnstile) captchaToken = window.turnstile.getResponse(turnstileEl);
        }
        if (!captchaToken) {
          const recaptchaEl = form.querySelector('.g-recaptcha');
          if (recaptchaEl && typeof grecaptcha !== 'undefined') captchaToken = grecaptcha.getResponse();
        }
      } catch (_) {}

      try {
        const resp = await fetch('/api/contact/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: fields,
            source_page_slug: location.pathname.replace(/^\\//, '') || 'home',
            captcha_token: captchaToken
          })
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Submission failed');
        statusEl.textContent = ${JSON.stringify(cfg.success_message)};
        statusEl.classList.add('ok');
        form.reset();
      } catch (err) {
        statusEl.textContent = (err && err.message) ? err.message : 'Submission failed';
        statusEl.classList.add('error');
      }
    });
  })();
  </script>`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Pre-render every widget content element in `elements` and return a Map keyed
// by element id → rendered HTML. Unknown widget kinds yield an HTML comment
// rather than throwing, so a typo in the JSON doesn't take down a page.
export async function renderWidgets(elements: ContentElement[], env: Env): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const widgets = elements.filter((el) => el.type === 'widget');
  if (widgets.length === 0) return out;

  // Dedupe by kind so two project_list widgets on a page only hit D1 once.
  const cache = new Map<WidgetKind, string>();

  for (const el of widgets) {
    const cfg = parseWidget(el.content);
    if (!cfg) {
      out.set(el.id, `<!-- unknown widget: ${escHtml(el.content).slice(0, 100)} -->`);
      continue;
    }
    let html = cache.get(cfg.kind);
    if (html === undefined) {
      if (cfg.kind === 'project_list') html = await renderProjectList(env);
      else if (cfg.kind === 'blog_list') html = await renderBlogList(env);
      else html = await renderContact(env);
      cache.set(cfg.kind, html);
    }
    out.set(el.id, html);
  }

  return out;
}

function escJs(v: string): string {
  return v.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

// Helpers used by API cache invalidation. Returns the slugs of pages that
// embed a widget of the given kind so callers can drop their KV entries.
export async function pagesWithWidget(env: Env, kind: WidgetKind): Promise<string[]> {
  // Coarse JSON match — fine because we control the shape.
  const needle = `%"kind":"${kind}"%`;
  const result = await env.DB.prepare(
    `SELECT DISTINCT p.slug FROM pages p
     JOIN content_elements ce ON ce.parent_type = 'page' AND ce.parent_id = p.id
     WHERE ce.type = 'widget' AND ce.content LIKE ?`,
  )
    .bind(needle)
    .all<{ slug: string }>();
  return result.results.map((r) => r.slug);
}
