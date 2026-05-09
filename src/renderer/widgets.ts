import type { Env, Project, BlogEntry, ContentElement, WidgetContent, WidgetKind, FormDefinition, FormSubmission } from '../types';
import { escHtml } from './layout';
import { getContactConfig } from '../contact-form';
import { ensureFormsTables, parseFormConfig } from '../forms';

// Widgets are content elements whose `content` field is JSON like
// { "kind": "project_list" }. Rendering needs DB access, so this module is
// async — call `renderWidgets` to pre-render every widget element on a page,
// then have the synchronous content renderer interpolate the result.

function parseWidget(content: string): WidgetContent | null {
  try {
    const parsed = JSON.parse(content) as Partial<WidgetContent>;
    if (parsed && (parsed.kind === 'project_list' || parsed.kind === 'blog_list' || parsed.kind === 'contact' || parsed.kind === 'form' || parsed.kind === 'form_data')) {
      return { kind: parsed.kind };
    }
  } catch {
    // fall through
  }
  return null;
}

function parseWidgetConfig(content: string): Record<string, string> {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
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

async function renderFormWidget(env: Env, content: string): Promise<string> {
  await ensureFormsTables(env);
  const cfg = parseWidgetConfig(content);
  const formSlug = (cfg.form_slug || cfg.form || '').trim();
  if (!formSlug) {
    return '<div class="content-el content-el-widget widget-form"><p>Form widget requires <code>form_slug</code>.</p></div>';
  }
  const row = await env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND published = 1').bind(formSlug).first<FormDefinition>();
  if (!row) return `<div class="content-el content-el-widget widget-form"><p>Form "${escHtml(formSlug)}" not found.</p></div>`;
  const form = parseFormConfig(row);
  const fieldsHtml = form.fields.map((f) => {
    const required = f.required ? ' required' : '';
    const help = f.help_text ? `<div class="contact-help">${escHtml(f.help_text)}</div>` : '';
    if (f.type === 'textarea') return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><textarea name="${escHtml(f.key)}" placeholder="${escHtml(f.placeholder ?? '')}"${required}></textarea>${help}</label>`;
    if (f.type === 'select') {
      const options = (f.options ?? []).map((o) => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
      return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><select name="${escHtml(f.key)}"${required}><option value="">Select…</option>${options}</select>${help}</label>`;
    }
    if (f.type === 'checkbox') return `<label class="contact-field contact-field-checkbox"><input type="checkbox" name="${escHtml(f.key)}"${required}><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span></label>${help}`;
    const inputType = f.type === 'email' || f.type === 'tel' ? f.type : 'text';
    return `<label class="contact-field"><span>${escHtml(f.label)}${f.required ? ' *' : ''}</span><input type="${inputType}" name="${escHtml(f.key)}" placeholder="${escHtml(f.placeholder ?? '')}"${required}>${help}</label>`;
  }).join('');
  const captchaScript = form.captcha.enabled
    ? form.captcha.provider === 'turnstile'
      ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : '<script src="https://www.google.com/recaptcha/api.js?render=explicit" async defer></script>'
    : '';
  const captchaHtml = form.captcha.enabled
    ? form.captcha.provider === 'turnstile'
      ? `<div class="cf-turnstile" data-sitekey="${escHtml(form.captcha.site_key)}"></div>`
      : form.captcha.provider === 'recaptcha_v2'
        ? `<div class="g-recaptcha" data-sitekey="${escHtml(form.captcha.site_key)}"></div>`
        : '<div class="contact-captcha-note">This form uses invisible reCAPTCHA.</div>'
    : '';
  const recaptchaV3Script = form.captcha.enabled && form.captcha.provider === 'recaptcha_v3'
    ? `await new Promise((resolve) => {
      if (typeof grecaptcha !== 'undefined') return grecaptcha.ready(resolve);
      let tries = 0;
      const timer = setInterval(() => {
        if (typeof grecaptcha !== 'undefined') { clearInterval(timer); grecaptcha.ready(resolve); return; }
        tries++;
        if (tries > 50) { clearInterval(timer); resolve(undefined); }
      }, 100);
    });
    captchaToken = await grecaptcha.execute('${escJs(form.captcha.site_key)}', { action: '${escJs(form.captcha.recaptcha_action ?? 'form_submit')}' });`
    : '';

  return `<div class="content-el content-el-widget widget-form" data-form-slug="${escHtml(form.slug)}">
    <form class="contact-form" novalidate>
      ${fieldsHtml}
      ${captchaHtml}
      <button type="submit">${escHtml(cfg.submit_label || 'Submit')}</button>
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
      statusEl.textContent = 'Submitting...';
      statusEl.className = 'contact-status';
      const data = new FormData(form);
      const fields = Object.fromEntries(data.entries());
      form.querySelectorAll('input[type="checkbox"][name]').forEach((el) => { fields[el.name] = el.checked; });
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
        const resp = await fetch('/api/forms/${escJs(form.slug)}/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields,
            source_page_slug: location.pathname.replace(/^\\//, '') || 'home',
            captcha_token: captchaToken
          }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Submission failed');
        if (json.redirect_to) {
          location.href = json.redirect_to;
          return;
        }
        if (json.summary && typeof json.summary.total !== 'undefined') {
          statusEl.textContent = (json.message || 'Submitted') + ' Total responses: ' + json.summary.total;
        } else {
          statusEl.textContent = json.message || 'Submitted';
        }
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

async function renderFormDataWidget(env: Env, content: string): Promise<string> {
  await ensureFormsTables(env);
  const cfg = parseWidgetConfig(content);
  const formSlug = (cfg.form_slug || '').trim();
  if (!formSlug) return '<div class="content-el content-el-widget widget-form-data"><p>Form Data widget requires <code>form_slug</code>.</p></div>';
  const form = await env.DB.prepare('SELECT * FROM forms WHERE slug = ?').bind(formSlug).first<FormDefinition>();
  if (!form) return `<div class="content-el content-el-widget widget-form-data"><p>Form "${escHtml(formSlug)}" not found.</p></div>`;
  const display = cfg.display === 'graph' || cfg.display === 'summary' ? cfg.display : 'table';
  const dateRange = cfg.date_range === 'day' || cfg.date_range === 'week' || cfg.date_range === 'month' ? cfg.date_range : 'all';
  const fieldKey = (cfg.field_key || '').trim();
  const fieldValue = (cfg.field_value || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(cfg.limit || 50)));

  let sinceClause = '';
  if (dateRange === 'day') sinceClause = " AND created_at >= datetime('now','-1 day')";
  if (dateRange === 'week') sinceClause = " AND created_at >= datetime('now','-7 day')";
  if (dateRange === 'month') sinceClause = " AND created_at >= datetime('now','-30 day')";
  const rows = await env.DB.prepare(
    `SELECT * FROM form_submissions WHERE form_id = ? ${sinceClause} ORDER BY created_at DESC LIMIT ?`,
  ).bind(form.id, limit).all<FormSubmission>();

  const parsed = rows.results.map((r) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.payload_json) as Record<string, unknown>; } catch {}
    const fields = (payload.fields && typeof payload.fields === 'object') ? payload.fields as Record<string, unknown> : {};
    return { row: r, fields };
  }).filter((it) => {
    if (!fieldKey) return true;
    const v = it.fields[fieldKey];
    if (v == null) return false;
    if (!fieldValue) return true;
    return String(v).toLowerCase() === fieldValue;
  });

  if (display === 'summary') {
    const total = parsed.length;
    const latest = parsed[0]?.row.created_at ?? 'n/a';
    return `<div class="content-el content-el-widget widget-form-data">
      <div class="contact-form-data-summary">
        <div><strong>Form:</strong> ${escHtml(form.name)}</div>
        <div><strong>Total submissions (filtered):</strong> ${total}</div>
        <div><strong>Latest submission:</strong> ${escHtml(latest)}</div>
      </div>
    </div>`;
  }

  if (display === 'graph') {
    const counts = new Map<string, number>();
    for (const it of parsed) {
      const day = it.row.created_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(1, ...entries.map(([, c]) => c));
    const bars = entries.map(([day, count]) =>
      `<div style="display:flex;align-items:center;gap:.5rem;margin:.2rem 0">
        <span style="width:8rem;font-size:.8rem;color:#6b7280">${escHtml(day)}</span>
        <div style="height:12px;background:#2563eb;border-radius:4px;width:${Math.max(4, Math.round((count / max) * 260))}px"></div>
        <span style="font-size:.8rem">${count}</span>
      </div>`).join('');
    return `<div class="content-el content-el-widget widget-form-data">
      <div><strong>${escHtml(form.name)} submissions</strong></div>
      ${bars || '<p>No data.</p>'}
    </div>`;
  }

  const allKeys = new Set<string>();
  for (const it of parsed) Object.keys(it.fields).forEach((k) => allKeys.add(k));
  const keys = [...allKeys].sort();
  const head = ['created_at', ...keys];
  const rowsHtml = parsed.map((it) => `<tr>${
    head.map((col) => {
      const val = col === 'created_at' ? it.row.created_at : String(it.fields[col] ?? '');
      return `<td style="padding:.4rem .5rem;border-bottom:1px solid #f3f4f6;vertical-align:top">${escHtml(val)}</td>`;
    }).join('')
  }</tr>`).join('');
  return `<div class="content-el content-el-widget widget-form-data">
    <div style="overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead><tr>${head.map((c) => `<th style="text-align:left;padding:.45rem .5rem;border-bottom:1px solid #e5e7eb;background:#f9fafb">${escHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${head.length}" style="padding:.7rem">No submissions.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
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

  // Dedupe widget rendering by key. For config-driven widgets (form/form_data),
  // include content so different configs don't collide.
  const cache = new Map<string, string>();

  for (const el of widgets) {
    const cfg = parseWidget(el.content);
    if (!cfg) {
      out.set(el.id, `<!-- unknown widget: ${escHtml(el.content).slice(0, 100)} -->`);
      continue;
    }
    const cacheKey = (cfg.kind === 'form' || cfg.kind === 'form_data') ? `${cfg.kind}:${el.content}` : cfg.kind;
    let html = cache.get(cacheKey);
    if (html === undefined) {
      if (cfg.kind === 'project_list') html = await renderProjectList(env);
      else if (cfg.kind === 'blog_list') html = await renderBlogList(env);
      else if (cfg.kind === 'contact') html = await renderContact(env);
      else if (cfg.kind === 'form') html = await renderFormWidget(env, el.content);
      else html = await renderFormDataWidget(env, el.content);
      cache.set(cacheKey, html);
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
