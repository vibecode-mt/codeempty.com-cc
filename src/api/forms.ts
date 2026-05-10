import { Hono } from 'hono';
import type { FormDefinition, FormSubmission, Env } from '../types';
import { now, slugify, uuid } from '../utils';
import { requireAdmin, requireOAuthOrSession } from './middleware';
import { ensureFormsTables, parseFormConfig, validateFormConfig } from '../forms';
import { pagesWithWidget } from '../renderer/widgets';

export const formRoutes = new Hono<{ Bindings: Env }>();

formRoutes.post('/:id/test-webhook', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const form = await c.env.DB.prepare('SELECT * FROM forms WHERE id = ?')
    .bind(c.req.param('id'))
    .first<FormDefinition>();
  if (!form) return c.json({ error: 'Form not found' }, 404);
  const cfg = parseFormConfig(form);
  
  const testPayload = {
    fields: { name: 'Test User', email: 'test@example.com', message: 'This is a test submission' },
    source_page_slug: 'test',
    user_agent: 'Mozilla/5.0 (test)',
    created_at: new Date().toISOString(),
  };
  
  const result = await deliverSubmission(cfg, testPayload);
  return c.json({
    webhook_url: cfg.delivery.webhook_url,
    webhook_configured: !!cfg.delivery.webhook_url?.trim(),
    test_result: result,
    payload: testPayload,
  });
});

formRoutes.get('/', requireOAuthOrSession, async (c) => {
  await ensureFormsTables(c.env);
  const rows = await c.env.DB.prepare('SELECT * FROM forms ORDER BY name ASC').all<FormDefinition>();
  return c.json(rows.results.map(parseFormConfig));
});

formRoutes.get('/submissions', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT fs.*, f.slug AS form_slug, f.name AS form_name
     FROM form_submissions fs
     JOIN forms f ON f.id = fs.form_id
     ORDER BY fs.created_at DESC
     LIMIT 1000`,
  ).all<FormSubmission & { form_slug: string; form_name: string }>();
  return c.json(rows.results);
});

formRoutes.post('/', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const body = await c.req.json<Partial<ReturnType<typeof parseFormConfig>>>();
  const id = uuid();
  const ts = now();
  const cfg = validateFormConfig({
    id,
    slug: body.slug || slugify(body.name || ''),
    name: body.name || '',
    published: body.published ?? 1,
    fields: body.fields ?? [],
    captcha: body.captcha ?? { enabled: 0, provider: 'none', site_key: '', secret_key: '' },
    delivery: body.delivery ?? { provider: 'webhook', to_email: '', from_email: '' },
    submit_action_type: body.submit_action_type ?? 'message',
    submit_action_value: body.submit_action_value ?? '',
    success_message: body.success_message ?? 'Thanks! Your submission has been saved.',
    created_at: ts,
    updated_at: ts,
  });
  if (!cfg.slug || !cfg.name) return c.json({ error: 'name and slug are required' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO forms (id, slug, name, published, fields_json, captcha_json, delivery_json, submit_action_type, submit_action_value, success_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      cfg.id,
      cfg.slug,
      cfg.name,
      cfg.published,
      JSON.stringify(cfg.fields),
      JSON.stringify(cfg.captcha),
      JSON.stringify(cfg.delivery),
      cfg.submit_action_type,
      cfg.submit_action_value || null,
      cfg.success_message,
      cfg.created_at,
      cfg.updated_at,
    )
    .run();
  await invalidateFormWidgetCaches(c.env);
  return c.json(cfg, 201);
});

formRoutes.get('/:id', requireOAuthOrSession, async (c) => {
  await ensureFormsTables(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM forms WHERE id = ? OR slug = ?')
    .bind(c.req.param('id'), c.req.param('id'))
    .first<FormDefinition>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(parseFormConfig(row));
});

formRoutes.put('/:id', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(id).first<FormDefinition>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const ex = parseFormConfig(existing);
  const body = await c.req.json<Partial<typeof ex>>();
  const cfg = validateFormConfig({
    ...ex,
    ...body,
    id,
    slug: body.slug ?? ex.slug,
    name: body.name ?? ex.name,
    updated_at: now(),
  });
  if (!cfg.slug || !cfg.name) return c.json({ error: 'name and slug are required' }, 400);

  await c.env.DB.prepare(
    `UPDATE forms SET slug=?, name=?, published=?, fields_json=?, captcha_json=?, delivery_json=?, submit_action_type=?, submit_action_value=?, success_message=?, updated_at=?
     WHERE id=?`,
  )
    .bind(
      cfg.slug,
      cfg.name,
      cfg.published,
      JSON.stringify(cfg.fields),
      JSON.stringify(cfg.captcha),
      JSON.stringify(cfg.delivery),
      cfg.submit_action_type,
      cfg.submit_action_value || null,
      cfg.success_message,
      cfg.updated_at,
      id,
    )
    .run();
  await invalidateFormWidgetCaches(c.env);
  return c.json(cfg);
});

formRoutes.delete('/:id', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM form_submissions WHERE form_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(id).run();
  await invalidateFormWidgetCaches(c.env);
  return c.json({ ok: true });
});

formRoutes.get('/:id/submissions', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const id = c.req.param('id');
  const rows = await c.env.DB.prepare(
    'SELECT * FROM form_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT 500',
  ).bind(id).all<FormSubmission>();
  return c.json(rows.results);
});

formRoutes.post('/:id/submissions', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const id = c.req.param('id');
  const body = await c.req.json<{ payload_json?: string; status?: string; source_page_slug?: string }>();
  const subId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO form_submissions (id, form_id, source_page_slug, payload_json, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(subId, id, body.source_page_slug ?? null, body.payload_json ?? '{}', body.status ?? 'stored', null)
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM form_submissions WHERE id = ?').bind(subId).first<FormSubmission>(), 201);
});

formRoutes.put('/:id/submissions/:submissionId', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  const body = await c.req.json<Partial<FormSubmission>>();
  const existing = await c.env.DB.prepare('SELECT * FROM form_submissions WHERE id = ? AND form_id = ?')
    .bind(c.req.param('submissionId'), c.req.param('id'))
    .first<FormSubmission>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare(
    'UPDATE form_submissions SET source_page_slug=?, payload_json=?, status=?, error_message=?, updated_at=? WHERE id = ?',
  )
    .bind(
      body.source_page_slug ?? existing.source_page_slug,
      body.payload_json ?? existing.payload_json,
      body.status ?? existing.status,
      body.error_message ?? existing.error_message,
      now(),
      existing.id,
    )
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM form_submissions WHERE id = ?').bind(existing.id).first<FormSubmission>());
});

formRoutes.delete('/:id/submissions/:submissionId', requireAdmin, async (c) => {
  await ensureFormsTables(c.env);
  await c.env.DB.prepare('DELETE FROM form_submissions WHERE id = ? AND form_id = ?')
    .bind(c.req.param('submissionId'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

formRoutes.post('/:slug/submit', async (c) => {
  await ensureFormsTables(c.env);
  const form = await c.env.DB.prepare('SELECT * FROM forms WHERE slug = ? AND published = 1')
    .bind(c.req.param('slug'))
    .first<FormDefinition>();
  if (!form) return c.json({ error: 'Form not found' }, 404);
  const cfg = parseFormConfig(form);
  const body = await c.req.json<{ fields?: Record<string, unknown>; source_page_slug?: string; captcha_token?: string }>();
  const fieldsInput = body.fields ?? {};
  const values: Record<string, unknown> = {};
  for (const field of cfg.fields) {
    const raw = fieldsInput[field.key];
    values[field.key] = field.type === 'checkbox'
      ? (raw === true || raw === 'true' || raw === 'on' || raw === 1)
      : (typeof raw === 'string' ? raw.trim() : '');
    if (field.required) {
      if (field.type === 'checkbox' && !values[field.key]) return c.json({ error: `${field.label} is required` }, 400);
      if (field.type !== 'checkbox' && !values[field.key]) return c.json({ error: `${field.label} is required` }, 400);
    }
    if (field.type === 'email' && values[field.key]) {
      const email = String(values[field.key]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: `${field.label} must be a valid email` }, 400);
    }
  }

  const captchaOk = await verifyCaptcha(cfg, body.captcha_token);
  if (!captchaOk.ok) return c.json({ error: captchaOk.error }, 400);

  const payload = {
    fields: values,
    source_page_slug: body.source_page_slug ?? null,
    user_agent: c.req.header('user-agent') ?? null,
    created_at: new Date().toISOString(),
  };
  const subId = uuid();
  await c.env.DB.prepare(
    `INSERT INTO form_submissions (id, form_id, source_page_slug, payload_json, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(subId, cfg.id, body.source_page_slug ?? null, JSON.stringify(payload), 'received', null)
    .run();

  if (hasDeliveryTarget(cfg.delivery)) {
    const delivered = await deliverSubmission(cfg, payload);
    if (!delivered.ok) {
      await c.env.DB.prepare('UPDATE form_submissions SET status=?, error_message=?, updated_at=? WHERE id=?')
        .bind('failed', delivered.error, now(), subId)
        .run();
      return c.json({ error: delivered.error }, 502);
    }
    await c.env.DB.prepare('UPDATE form_submissions SET status=?, updated_at=? WHERE id=?')
      .bind('sent', now(), subId)
      .run();
  } else {
    await c.env.DB.prepare('UPDATE form_submissions SET status=?, updated_at=? WHERE id=?')
      .bind('stored', now(), subId)
      .run();
  }

  const response: Record<string, unknown> = { ok: true, message: cfg.success_message };
  if (cfg.submit_action_type === 'redirect' && cfg.submit_action_value) response.redirect_to = cfg.submit_action_value;
  if (cfg.submit_action_type === 'show_summary') {
    const summary = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM form_submissions WHERE form_id = ?',
    ).bind(cfg.id).first<{ total: number }>();
    response.summary = { total: summary?.total ?? 0 };
  }
  return c.json(response);
});

async function verifyCaptcha(cfg: ReturnType<typeof parseFormConfig>, token?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cfg.captcha.enabled || cfg.captcha.provider === 'none') return { ok: true };
  if (!token) return { ok: false, error: 'Captcha token is required' };

  if (cfg.captcha.provider === 'turnstile') {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: cfg.captcha.secret_key, response: token }),
    });
    const data = await resp.json<{ success?: boolean }>();
    return data.success ? { ok: true } : { ok: false, error: 'Captcha verification failed' };
  }

  const recaptchaResp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: cfg.captcha.secret_key, response: token }),
  });
  const recaptcha = await recaptchaResp.json<{ success?: boolean; score?: number; action?: string }>();
  if (!recaptcha.success) return { ok: false, error: 'Captcha verification failed' };
  if (cfg.captcha.provider === 'recaptcha_v3') {
    const min = cfg.captcha.recaptcha_min_score ?? 0.5;
    if ((recaptcha.score ?? 0) < min) return { ok: false, error: 'Captcha score too low' };
    if (cfg.captcha.recaptcha_action && recaptcha.action && recaptcha.action !== cfg.captcha.recaptcha_action) {
      return { ok: false, error: 'Captcha action mismatch' };
    }
  }
  return { ok: true };
}

async function deliverSubmission(
  cfg: ReturnType<typeof parseFormConfig>,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (cfg.delivery.provider === 'smtp') {
    return { ok: false, error: 'SMTP delivery is not supported directly in Cloudflare Workers. Use webhook delivery.' };
  }
  const webhookUrl = cfg.delivery.webhook_url?.trim();
  if (!webhookUrl) return { ok: false, error: 'Webhook URL is not configured' };
  
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.delivery.webhook_auth_header) headers.authorization = cfg.delivery.webhook_auth_header;
  
  const body = JSON.stringify({
    event: 'form_submission',
    form_slug: cfg.slug,
    form_name: cfg.name,
    to_email: cfg.delivery.to_email,
    from_email: cfg.delivery.from_email,
    payload,
  });
  
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
    });
    if (!resp.ok) {
      const responseText = await resp.text().catch(() => '');
      console.error(`[Form Delivery] Webhook failed: ${webhookUrl} returned ${resp.status}`, responseText.slice(0, 500));
      return { ok: false, error: `Delivery endpoint returned ${resp.status}` };
    }
    return { ok: true };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`[Form Delivery] Webhook error for ${webhookUrl}:`, errorMsg);
    return { ok: false, error: `Delivery failed: ${errorMsg}` };
  }
}

function hasDeliveryTarget(delivery: ReturnType<typeof parseFormConfig>['delivery']): boolean {
  return delivery.provider === 'smtp' ? Boolean(delivery.smtp_host?.trim()) : Boolean(delivery.webhook_url?.trim());
}

async function invalidateFormWidgetCaches(env: Env) {
  const [formPages, dataPages] = await Promise.all([
    pagesWithWidget(env, 'form'),
    pagesWithWidget(env, 'form_data'),
  ]);
  for (const slug of new Set([...formPages, ...dataPages])) {
    const key = `page:${slug}`;
    await env.PAGES_KV.delete(key);
    await env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
  }
}
