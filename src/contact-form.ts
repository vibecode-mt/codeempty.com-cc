import type {
  ContactCaptchaConfig,
  ContactDeliveryConfig,
  ContactField,
  ContactFormSettings,
  Env,
} from './types';
import { now } from './utils';

export interface ContactFormConfig {
  fields: ContactField[];
  captcha: ContactCaptchaConfig;
  delivery: ContactDeliveryConfig;
  submit_button_label: string;
  success_message: string;
}

const DEFAULT_FIELDS: ContactField[] = [
  { key: 'name', label: 'Name', type: 'text', required: 1, placeholder: 'Your name' },
  { key: 'email', label: 'Email', type: 'email', required: 1, placeholder: 'you@example.com' },
  { key: 'message', label: 'Message', type: 'textarea', required: 1, placeholder: 'How can I help?' },
];

const DEFAULT_CAPTCHA: ContactCaptchaConfig = {
  enabled: 0,
  provider: 'none',
  site_key: '',
  secret_key: '',
  recaptcha_action: 'contact_submit',
  recaptcha_min_score: 0.5,
};

const DEFAULT_DELIVERY: ContactDeliveryConfig = {
  provider: 'webhook',
  to_email: '',
  from_email: '',
  webhook_url: '',
  webhook_auth_header: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password: '',
  smtp_secure: 0,
};

export function defaultContactConfig(): ContactFormConfig {
  return {
    fields: DEFAULT_FIELDS,
    captcha: DEFAULT_CAPTCHA,
    delivery: DEFAULT_DELIVERY,
    submit_button_label: 'Send message',
    success_message: 'Thanks! Your message has been sent.',
  };
}

export async function getContactConfig(env: Env): Promise<ContactFormConfig> {
  await ensureContactTables(env);
  const row = await env.DB.prepare('SELECT * FROM contact_form_settings WHERE id = ?')
    .bind('default')
    .first<ContactFormSettings>();
  if (!row) return defaultContactConfig();
  return normalizeContactConfig(row);
}

export async function upsertContactConfig(env: Env, input: ContactFormConfig): Promise<ContactFormConfig> {
  await ensureContactTables(env);
  const cfg = validateContactConfig(input);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO contact_form_settings (id, fields_json, captcha_json, delivery_json, submit_button_label, success_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       fields_json=excluded.fields_json,
       captcha_json=excluded.captcha_json,
       delivery_json=excluded.delivery_json,
       submit_button_label=excluded.submit_button_label,
       success_message=excluded.success_message,
       updated_at=excluded.updated_at`,
  )
    .bind(
      'default',
      JSON.stringify(cfg.fields),
      JSON.stringify(cfg.captcha),
      JSON.stringify(cfg.delivery),
      cfg.submit_button_label,
      cfg.success_message,
      ts,
      ts,
    )
    .run();
  return cfg;
}

export async function ensureContactTables(env: Env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contact_form_settings (
      id TEXT PRIMARY KEY,
      fields_json TEXT NOT NULL,
      captcha_json TEXT NOT NULL,
      delivery_json TEXT NOT NULL,
      submit_button_label TEXT NOT NULL DEFAULT 'Send message',
      success_message TEXT NOT NULL DEFAULT 'Thanks! Your message has been sent.',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      source_page_slug TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at DESC)'),
  ]);
}

function normalizeContactConfig(row: ContactFormSettings): ContactFormConfig {
  const fallback = defaultContactConfig();
  let fields = fallback.fields;
  let captcha = fallback.captcha;
  let delivery = fallback.delivery;
  try {
    fields = JSON.parse(row.fields_json) as ContactField[];
  } catch {
    fields = fallback.fields;
  }
  try {
    captcha = JSON.parse(row.captcha_json) as ContactCaptchaConfig;
  } catch {
    captcha = fallback.captcha;
  }
  try {
    delivery = JSON.parse(row.delivery_json) as ContactDeliveryConfig;
  } catch {
    delivery = fallback.delivery;
  }
  return validateContactConfig({
    fields,
    captcha,
    delivery,
    submit_button_label: row.submit_button_label || fallback.submit_button_label,
    success_message: row.success_message || fallback.success_message,
  });
}

export function validateContactConfig(input: ContactFormConfig): ContactFormConfig {
  const fields = Array.isArray(input.fields) ? input.fields : DEFAULT_FIELDS;
  if (fields.length === 0) throw new Error('At least one field is required');
  if (fields.length > 30) throw new Error('Too many fields (max 30)');

  const seen = new Set<string>();
  const cleanFields = fields.map((field) => {
    const key = normalizeKey(field.key);
    if (!key) throw new Error('Each field must have a valid key');
    if (seen.has(key)) throw new Error(`Duplicate field key: ${key}`);
    seen.add(key);
    const label = (field.label || '').trim();
    if (!label) throw new Error(`Field "${key}" requires a label`);
    const type = normalizeFieldType(field.type);
    const options = type === 'select'
      ? (Array.isArray(field.options) ? field.options : [])
        .map((o) => ({ label: (o.label || '').trim(), value: String(o.value ?? '').trim() }))
        .filter((o) => o.label && o.value)
      : undefined;
    if (type === 'select' && (!options || options.length === 0)) {
      throw new Error(`Select field "${key}" requires at least one option`);
    }
    return {
      key,
      label,
      type,
      required: field.required ? 1 : 0,
      placeholder: (field.placeholder || '').trim(),
      help_text: (field.help_text || '').trim(),
      options,
    };
  });

  const captchaProvider = normalizeCaptchaProvider(input.captcha?.provider);
  const captchaEnabled = input.captcha?.enabled ? 1 : 0;
  const captcha: ContactCaptchaConfig = {
    enabled: captchaEnabled,
    provider: captchaEnabled ? captchaProvider : 'none',
    site_key: (input.captcha?.site_key || '').trim(),
    secret_key: (input.captcha?.secret_key || '').trim(),
    recaptcha_action: (input.captcha?.recaptcha_action || 'contact_submit').trim(),
    recaptcha_min_score: Math.min(1, Math.max(0, Number(input.captcha?.recaptcha_min_score ?? 0.5))),
  };
  if (captcha.enabled && (!captcha.site_key || !captcha.secret_key)) {
    throw new Error('Captcha site key and secret key are required when captcha is enabled');
  }

  const deliveryProvider = normalizeDeliveryProvider(input.delivery?.provider);
  const delivery: ContactDeliveryConfig = {
    provider: deliveryProvider,
    to_email: (input.delivery?.to_email || '').trim(),
    from_email: (input.delivery?.from_email || '').trim(),
    webhook_url: (input.delivery?.webhook_url || '').trim(),
    webhook_auth_header: (input.delivery?.webhook_auth_header || '').trim(),
    smtp_host: (input.delivery?.smtp_host || '').trim(),
    smtp_port: Number(input.delivery?.smtp_port ?? 587),
    smtp_username: (input.delivery?.smtp_username || '').trim(),
    smtp_password: (input.delivery?.smtp_password || '').trim(),
    smtp_secure: input.delivery?.smtp_secure ? 1 : 0,
  };

  return {
    fields: cleanFields,
    captcha,
    delivery,
    submit_button_label: (input.submit_button_label || 'Send message').trim(),
    success_message: (input.success_message || 'Thanks! Your message has been sent.').trim(),
  };
}

function normalizeKey(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function normalizeFieldType(type: string): ContactField['type'] {
  if (type === 'email' || type === 'tel' || type === 'textarea' || type === 'select' || type === 'checkbox') return type;
  return 'text';
}

function normalizeCaptchaProvider(provider: string | undefined): ContactCaptchaConfig['provider'] {
  if (provider === 'turnstile' || provider === 'recaptcha_v2' || provider === 'recaptcha_v3') return provider;
  return 'none';
}

function normalizeDeliveryProvider(provider: string | undefined): ContactDeliveryConfig['provider'] {
  if (provider === 'smtp') return 'smtp';
  return 'webhook';
}
