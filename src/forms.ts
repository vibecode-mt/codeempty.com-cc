import type {
  ContactCaptchaConfig,
  ContactDeliveryConfig,
  ContactField,
  Env,
  FormDefinition,
  FormSubmitActionType,
} from './types';
import { now, slugify } from './utils';

export interface FormConfig {
  id: string;
  slug: string;
  name: string;
  published: number;
  fields: ContactField[];
  captcha: ContactCaptchaConfig;
  delivery: ContactDeliveryConfig;
  submit_action_type: FormSubmitActionType;
  submit_action_value: string;
  success_message: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_CAPTCHA: ContactCaptchaConfig = {
  enabled: 0,
  provider: 'none',
  site_key: '',
  secret_key: '',
  recaptcha_action: 'form_submit',
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

const DEFAULT_FIELDS: ContactField[] = [
  { key: 'name', label: 'Name', type: 'text', required: 1, placeholder: 'Your name' },
  { key: 'email', label: 'Email', type: 'email', required: 1, placeholder: 'you@example.com' },
  { key: 'message', label: 'Message', type: 'textarea', required: 1, placeholder: 'Your message' },
];

export async function ensureFormsTables(env: Env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS forms (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      fields_json TEXT NOT NULL,
      captcha_json TEXT NOT NULL,
      delivery_json TEXT NOT NULL,
      submit_action_type TEXT NOT NULL DEFAULT 'message',
      submit_action_value TEXT,
      success_message TEXT NOT NULL DEFAULT 'Thanks! Your submission has been saved.',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS form_submissions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      source_page_slug TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stored',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created ON form_submissions(form_id, created_at DESC)'),
  ]);
}

export function parseFormConfig(row: FormDefinition): FormConfig {
  let fields = DEFAULT_FIELDS;
  let captcha = DEFAULT_CAPTCHA;
  let delivery = DEFAULT_DELIVERY;
  try { fields = JSON.parse(row.fields_json) as ContactField[]; } catch {}
  try { captcha = JSON.parse(row.captcha_json) as ContactCaptchaConfig; } catch {}
  try { delivery = JSON.parse(row.delivery_json) as ContactDeliveryConfig; } catch {}
  return validateFormConfig({
    id: row.id,
    slug: row.slug,
    name: row.name,
    published: row.published ? 1 : 0,
    fields,
    captcha,
    delivery,
    submit_action_type: row.submit_action_type,
    submit_action_value: row.submit_action_value ?? '',
    success_message: row.success_message || 'Thanks! Your submission has been saved.',
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export function validateFormConfig(input: Omit<FormConfig, 'fields'> & { fields: ContactField[] }): FormConfig {
  const fields = Array.isArray(input.fields) ? input.fields : DEFAULT_FIELDS;
  if (fields.length === 0) throw new Error('At least one field is required');
  if (fields.length > 50) throw new Error('Too many fields (max 50)');

  const seen = new Set<string>();
  const cleanFields = fields.map((f) => {
    const key = normalizeKey(f.key);
    if (!key) throw new Error('Each field needs a valid key');
    if (seen.has(key)) throw new Error(`Duplicate field key: ${key}`);
    seen.add(key);
    const type = normalizeFieldType(f.type);
    const options = type === 'select'
      ? (Array.isArray(f.options) ? f.options : [])
        .map((o) => ({ label: String(o.label ?? '').trim(), value: String(o.value ?? '').trim() }))
        .filter((o) => o.label && o.value)
      : undefined;
    if (type === 'select' && (!options || options.length === 0)) {
      throw new Error(`Select field "${key}" requires options`);
    }
    return {
      key,
      label: String(f.label ?? '').trim() || key,
      type,
      required: f.required ? 1 : 0,
      placeholder: String(f.placeholder ?? '').trim(),
      help_text: String(f.help_text ?? '').trim(),
      options,
    };
  });

  const provider = input.captcha?.provider;
  const captcha: ContactCaptchaConfig = {
    enabled: input.captcha?.enabled ? 1 : 0,
    provider: provider === 'turnstile' || provider === 'recaptcha_v2' || provider === 'recaptcha_v3' ? provider : 'none',
    site_key: String(input.captcha?.site_key ?? '').trim(),
    secret_key: String(input.captcha?.secret_key ?? '').trim(),
    recaptcha_action: String(input.captcha?.recaptcha_action ?? 'form_submit').trim(),
    recaptcha_min_score: Math.min(1, Math.max(0, Number(input.captcha?.recaptcha_min_score ?? 0.5))),
  };
  if (!captcha.enabled) captcha.provider = 'none';

  const delivery: ContactDeliveryConfig = {
    provider: input.delivery?.provider === 'smtp' ? 'smtp' : 'webhook',
    to_email: String(input.delivery?.to_email ?? '').trim(),
    from_email: String(input.delivery?.from_email ?? '').trim(),
    webhook_url: String(input.delivery?.webhook_url ?? '').trim(),
    webhook_auth_header: String(input.delivery?.webhook_auth_header ?? '').trim(),
    smtp_host: String(input.delivery?.smtp_host ?? '').trim(),
    smtp_port: Number(input.delivery?.smtp_port ?? 587),
    smtp_username: String(input.delivery?.smtp_username ?? '').trim(),
    smtp_password: String(input.delivery?.smtp_password ?? '').trim(),
    smtp_secure: input.delivery?.smtp_secure ? 1 : 0,
  };

  const actionType = input.submit_action_type === 'redirect' || input.submit_action_type === 'show_summary'
    ? input.submit_action_type
    : 'message';

  return {
    ...input,
    slug: slugify(input.slug),
    name: String(input.name ?? '').trim(),
    published: input.published ? 1 : 0,
    fields: cleanFields,
    captcha,
    delivery,
    submit_action_type: actionType,
    submit_action_value: String(input.submit_action_value ?? '').trim(),
    success_message: String(input.success_message ?? '').trim() || 'Thanks! Your submission has been saved.',
    created_at: input.created_at || now(),
    updated_at: input.updated_at || now(),
  };
}

function normalizeKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function normalizeFieldType(type: string): ContactField['type'] {
  if (type === 'email' || type === 'tel' || type === 'textarea' || type === 'select' || type === 'checkbox') return type;
  return 'text';
}
