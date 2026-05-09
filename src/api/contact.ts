import { Hono } from 'hono';
import type { ContactSubmission, Env } from '../types';
import { uuid } from '../utils';
import { requireAdmin } from './middleware';
import { ensureContactTables, getContactConfig, upsertContactConfig, type ContactFormConfig } from '../contact-form';
import { pagesWithWidget } from '../renderer/widgets';

export const contactRoutes = new Hono<{ Bindings: Env }>();

contactRoutes.get('/config', requireAdmin, async (c) => {
  return c.json(await getContactConfig(c.env));
});

contactRoutes.put('/config', requireAdmin, async (c) => {
  try {
    const body = await c.req.json<ContactFormConfig>();
    const saved = await upsertContactConfig(c.env, body);
    await invalidateContactWidgetCaches(c.env);
    return c.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid contact config';
    return c.json({ error: message }, 400);
  }
});

contactRoutes.get('/submissions', requireAdmin, async (c) => {
  await ensureContactTables(c.env);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 200',
  ).all<ContactSubmission>();
  return c.json(rows.results);
});

contactRoutes.post('/submit', async (c) => {
  const body = await c.req.json<{
    fields?: Record<string, unknown>;
    source_page_slug?: string;
    captcha_token?: string;
  }>();
  const fieldsInput = body.fields ?? {};
  const cfg = await getContactConfig(c.env);

  const values: Record<string, unknown> = {};
  for (const field of cfg.fields) {
    const raw = fieldsInput[field.key];
    if (field.type === 'checkbox') {
      values[field.key] = raw === true || raw === 'true' || raw === 'on' || raw === 1;
    } else {
      values[field.key] = typeof raw === 'string' ? raw.trim() : '';
    }

    if (field.required) {
      if (field.type === 'checkbox') {
        if (!values[field.key]) return c.json({ error: `${field.label} is required` }, 400);
      } else if (!values[field.key]) {
        return c.json({ error: `${field.label} is required` }, 400);
      }
    }
    if (field.type === 'email' && values[field.key]) {
      const email = String(values[field.key]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return c.json({ error: `${field.label} must be a valid email` }, 400);
      }
    }
  }

  const captchaOk = await verifyCaptcha(c.env, cfg, body.captcha_token);
  if (!captchaOk.ok) return c.json({ error: captchaOk.error }, 400);

  const submissionId = uuid();
  const payload = {
    fields: values,
    source_page_slug: body.source_page_slug ?? null,
    user_agent: c.req.header('user-agent') ?? null,
    created_at: new Date().toISOString(),
  };

  await c.env.DB.prepare(
    'INSERT INTO contact_submissions (id, source_page_slug, payload_json, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
  )
    .bind(submissionId, body.source_page_slug ?? null, JSON.stringify(payload), 'received', null)
    .run();

  if (!hasDeliveryTarget(cfg)) {
    await c.env.DB.prepare('UPDATE contact_submissions SET status = ? WHERE id = ?')
      .bind('stored', submissionId)
      .run();
    return c.json({ ok: true, message: cfg.success_message });
  }

  const delivered = await deliverSubmission(cfg, payload);
  if (!delivered.ok) {
    await c.env.DB.prepare('UPDATE contact_submissions SET status = ?, error_message = ? WHERE id = ?')
      .bind('failed', delivered.error, submissionId)
      .run();
    return c.json({ error: delivered.error }, 502);
  }

  await c.env.DB.prepare('UPDATE contact_submissions SET status = ? WHERE id = ?')
    .bind('sent', submissionId)
    .run();
  return c.json({ ok: true, message: cfg.success_message });
});

async function verifyCaptcha(
  _env: Env,
  cfg: ContactFormConfig,
  token: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!cfg.captcha.enabled || cfg.captcha.provider === 'none') return { ok: true };
  if (!token) return { ok: false, error: 'Captcha token is required' };

  if (cfg.captcha.provider === 'turnstile') {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: cfg.captcha.secret_key, response: token }),
    });
    const data = await resp.json<{ success?: boolean }>();
    if (!data.success) return { ok: false, error: 'Captcha verification failed' };
    return { ok: true };
  }

  const recaptchaResp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: cfg.captcha.secret_key, response: token }),
  });
  const recaptcha = await recaptchaResp.json<{ success?: boolean; score?: number; action?: string }>();
  if (!recaptcha.success) return { ok: false, error: 'Captcha verification failed' };
  if (cfg.captcha.provider === 'recaptcha_v3') {
    const minScore = cfg.captcha.recaptcha_min_score ?? 0.5;
    if ((recaptcha.score ?? 0) < minScore) return { ok: false, error: 'Captcha score too low' };
    if (cfg.captcha.recaptcha_action && recaptcha.action && recaptcha.action !== cfg.captcha.recaptcha_action) {
      return { ok: false, error: 'Captcha action mismatch' };
    }
  }
  return { ok: true };
}

async function deliverSubmission(
  cfg: ContactFormConfig,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (cfg.delivery.provider === 'smtp') {
    return {
      ok: false,
      error: 'SMTP delivery is not supported directly in Cloudflare Workers. Use the webhook provider for now.',
    };
  }
  const webhookUrl = cfg.delivery.webhook_url?.trim();
  if (!webhookUrl) return { ok: false, error: 'Webhook URL is not configured' };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.delivery.webhook_auth_header) {
    headers.authorization = cfg.delivery.webhook_auth_header;
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: 'contact_submission',
      to_email: cfg.delivery.to_email,
      from_email: cfg.delivery.from_email,
      payload,
    }),
  });
  if (!resp.ok) return { ok: false, error: `Delivery endpoint returned ${resp.status}` };
  return { ok: true };
}

function hasDeliveryTarget(cfg: ContactFormConfig): boolean {
  if (cfg.delivery.provider === 'webhook') {
    return Boolean(cfg.delivery.webhook_url?.trim());
  }
  if (cfg.delivery.provider === 'smtp') {
    return Boolean(cfg.delivery.smtp_host?.trim());
  }
  return false;
}

async function invalidateContactWidgetCaches(env: Env) {
  const slugs = await pagesWithWidget(env, 'contact');
  for (const slug of slugs) {
    const key = `page:${slug}`;
    await env.PAGES_KV.delete(key);
    await env.DB.prepare('DELETE FROM cache_keys WHERE cache_key = ?').bind(key).run();
  }
}
