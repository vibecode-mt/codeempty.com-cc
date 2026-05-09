import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ContactField, type ContactFormConfig } from '../api';

const FIELD_TYPES: ContactField['type'][] = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'];

function defaultField(): ContactField {
  return { key: 'field_name', label: 'Field name', type: 'text', required: 0, placeholder: '', help_text: '', options: [] };
}

export default function Settings() {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [contact, setContact] = useState<ContactFormConfig | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactSuccess, setContactSuccess] = useState('');

  useEffect(() => {
    api.getContactConfig()
      .then((cfg) => {
        setContact(cfg);
      })
      .catch((e) => setContactError(String(e)))
      .finally(() => setContactLoading(false));
  }, []);

  const captchaInstructions = useMemo(() => {
    if (!contact || !contact.captcha.enabled || contact.captcha.provider === 'none') return '';
    if (contact.captcha.provider === 'turnstile') {
      return 'Turnstile setup: create a widget in Cloudflare Dashboard → Turnstile, set allowed domain(s), then paste site key + secret key.';
    }
    if (contact.captcha.provider === 'recaptcha_v2') {
      return 'reCAPTCHA v2 setup: create “I am not a robot” keys at Google reCAPTCHA admin, add your domain(s), then paste site key + secret key.';
    }
    return 'reCAPTCHA v3 setup: create score-based keys at Google reCAPTCHA admin, add your domain(s), then paste site key + secret key.';
  }, [contact]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.new_password !== form.confirm) { setError('New passwords do not match'); return; }
    if (form.new_password.length < 8) { setError('New password must be at least 8 characters'); return; }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await api.changePassword(form.current_password, form.new_password);
      setSuccess('Password updated successfully.');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleInvalidateCache() {
    if (!confirm('Invalidate all cached pages? They will be re-generated on next visit.')) return;
    try {
      await api.invalidateAll();
      alert('All cached pages invalidated.');
    } catch (e) {
      alert(String(e));
    }
  }

  async function saveContactConfig() {
    if (!contact) return;
    setContactSaving(true);
    setContactError('');
    setContactSuccess('');
    try {
      const saved = await api.updateContactConfig(contact);
      setContact(saved);
      setContactSuccess('Contact form settings saved.');
    } catch (e) {
      setContactError(String(e));
    } finally {
      setContactSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">Change Password</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Current password</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.new_password} onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm new password</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}
          <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
          <h2 className="font-semibold">Contact Form</h2>
          <p className="text-sm text-gray-500 mt-1">Configure fields, captcha, and delivery for the <code>contact</code> widget.</p>
          </div>
          <Link
            to="/settings/contact-setup"
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 whitespace-nowrap"
          >
            Setup guide
          </Link>
          <Link
            to="/contact-submissions"
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 whitespace-nowrap"
          >
            View submissions
          </Link>
        </div>
        {contactLoading || !contact ? (
          <p className="text-gray-400 text-sm">Loading contact settings…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Submit button label</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={contact.submit_button_label} onChange={(e) => setContact((c) => c ? { ...c, submit_button_label: e.target.value } : c)} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Success message</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={contact.success_message} onChange={(e) => setContact((c) => c ? { ...c, success_message: e.target.value } : c)} />
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Fields</h3>
                <button
                  type="button"
                  onClick={() => setContact((c) => c ? { ...c, fields: [...c.fields, defaultField()] } : c)}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                >
                  + Add field
                </button>
              </div>
              <div className="space-y-3">
                {contact.fields.map((field, idx) => (
                  <div key={`${field.key}-${idx}`} className="border rounded p-3 grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Key</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm font-mono"
                        value={field.key}
                        onChange={(e) => setContact((c) => c ? {
                          ...c,
                          fields: c.fields.map((f, i) => i === idx ? { ...f, key: e.target.value } : f),
                        } : c)}
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Label</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={field.label}
                        onChange={(e) => setContact((c) => c ? {
                          ...c,
                          fields: c.fields.map((f, i) => i === idx ? { ...f, label: e.target.value } : f),
                        } : c)}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Type</label>
                      <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={field.type}
                        onChange={(e) => setContact((c) => c ? {
                          ...c,
                          fields: c.fields.map((f, i) => i === idx ? { ...f, type: e.target.value as ContactField['type'] } : f),
                        } : c)}
                      >
                        {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-gray-500 mb-1">Placeholder / Help</label>
                      <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={field.placeholder ?? ''}
                        onChange={(e) => setContact((c) => c ? {
                          ...c,
                          fields: c.fields.map((f, i) => i === idx ? { ...f, placeholder: e.target.value } : f),
                        } : c)}
                      />
                    </div>
                    <label className="col-span-1 flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={!!field.required}
                        onChange={(e) => setContact((c) => c ? {
                          ...c,
                          fields: c.fields.map((f, i) => i === idx ? { ...f, required: e.target.checked ? 1 : 0 } : f),
                        } : c)}
                      />
                      Req
                    </label>
                    <button
                      type="button"
                      onClick={() => setContact((c) => c ? { ...c, fields: c.fields.filter((_, i) => i !== idx) } : c)}
                      className="col-span-1 px-2 py-1 text-xs border rounded text-red-500 hover:bg-red-50"
                    >
                      Delete
                    </button>
                    {field.type === 'select' && (
                      <div className="col-span-12">
                        <label className="block text-xs text-gray-500 mb-1">Select options (one per line: label|value)</label>
                        <textarea
                          className="w-full border rounded px-2 py-1 text-xs font-mono"
                          rows={3}
                          value={(field.options ?? []).map((o) => `${o.label}|${o.value}`).join('\n')}
                          onChange={(e) => {
                            const options = e.target.value
                              .split('\n')
                              .map((line) => line.trim())
                              .filter(Boolean)
                              .map((line) => {
                                const [label, value] = line.includes('|') ? line.split('|', 2) : [line, line];
                                return { label: label.trim(), value: value.trim() };
                              });
                            setContact((c) => c ? {
                              ...c,
                              fields: c.fields.map((f, i) => i === idx ? { ...f, options } : f),
                            } : c);
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium">Captcha</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!contact.captcha.enabled}
                  onChange={(e) => setContact((c) => c ? {
                    ...c,
                    captcha: { ...c.captcha, enabled: e.target.checked ? 1 : 0, provider: e.target.checked ? c.captcha.provider : 'none' },
                  } : c)}
                />
                Enable captcha
              </label>
              {contact.captcha.enabled === 1 && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Provider</label>
                    <select
                      className="w-full border rounded px-3 py-2 text-sm"
                      value={contact.captcha.provider}
                      onChange={(e) => setContact((c) => c ? { ...c, captcha: { ...c.captcha, provider: e.target.value as ContactFormConfig['captcha']['provider'] } } : c)}
                    >
                      <option value="turnstile">Cloudflare Turnstile</option>
                      <option value="recaptcha_v2">Google reCAPTCHA v2</option>
                      <option value="recaptcha_v3">Google reCAPTCHA v3</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Site key</label>
                    <input className="w-full border rounded px-3 py-2 text-sm font-mono" value={contact.captcha.site_key} onChange={(e) => setContact((c) => c ? { ...c, captcha: { ...c.captcha, site_key: e.target.value } } : c)} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Secret key</label>
                    <input className="w-full border rounded px-3 py-2 text-sm font-mono" value={contact.captcha.secret_key} onChange={(e) => setContact((c) => c ? { ...c, captcha: { ...c.captcha, secret_key: e.target.value } } : c)} />
                  </div>
                  {contact.captcha.provider === 'recaptcha_v3' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">Action</label>
                        <input className="w-full border rounded px-3 py-2 text-sm font-mono" value={contact.captcha.recaptcha_action ?? ''} onChange={(e) => setContact((c) => c ? { ...c, captcha: { ...c.captcha, recaptcha_action: e.target.value } } : c)} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Min score (0-1)</label>
                        <input type="number" min={0} max={1} step={0.1} className="w-full border rounded px-3 py-2 text-sm" value={contact.captcha.recaptcha_min_score ?? 0.5} onChange={(e) => setContact((c) => c ? { ...c, captcha: { ...c.captcha, recaptcha_min_score: Number(e.target.value) } } : c)} />
                      </div>
                    </>
                  )}
                </div>
              )}
              {captchaInstructions && <p className="text-xs text-gray-500">{captchaInstructions}</p>}
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-medium">Delivery</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Provider</label>
                  <select
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={contact.delivery.provider}
                    onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, provider: e.target.value as ContactFormConfig['delivery']['provider'] } } : c)}
                  >
                    <option value="webhook">Webhook (recommended for Workers)</option>
                    <option value="smtp">SMTP (config only)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To email</label>
                  <input className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.to_email} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, to_email: e.target.value } } : c)} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">From email</label>
                  <input className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.from_email} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, from_email: e.target.value } } : c)} />
                </div>
              </div>
              {contact.delivery.provider === 'webhook' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL</label>
                    <input className="w-full border rounded px-3 py-2 text-sm font-mono" value={contact.delivery.webhook_url ?? ''} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, webhook_url: e.target.value } } : c)} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Auth header (optional)</label>
                    <input className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="Bearer xxxxx" value={contact.delivery.webhook_auth_header ?? ''} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, webhook_auth_header: e.target.value } } : c)} />
                  </div>
                  <p className="col-span-2 text-xs text-gray-500">Webhook is the Worker-compatible delivery method. Point it to your mail service endpoint (SES/Lambda, Zapier, Make, etc.).</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP host</label>
                      <input className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.smtp_host ?? ''} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, smtp_host: e.target.value } } : c)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP port</label>
                      <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.smtp_port ?? 587} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, smtp_port: Number(e.target.value) } } : c)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP username</label>
                      <input className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.smtp_username ?? ''} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, smtp_username: e.target.value } } : c)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP password</label>
                      <input className="w-full border rounded px-3 py-2 text-sm" value={contact.delivery.smtp_password ?? ''} onChange={(e) => setContact((c) => c ? { ...c, delivery: { ...c.delivery, smtp_password: e.target.value } } : c)} />
                    </div>
                  </div>
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Cloudflare Workers cannot open raw SMTP connections. SMTP values are stored for compatibility, but live delivery currently uses the webhook provider.</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveContactConfig} disabled={contactSaving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {contactSaving ? 'Saving…' : 'Save Contact Settings'}
              </button>
              {contactError && <p className="text-sm text-red-500">{contactError}</p>}
              {contactSuccess && <p className="text-sm text-green-600">{contactSuccess}</p>}
            </div>
          </>
        )}
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-3">
        <h2 className="font-semibold">Cache</h2>
        <p className="text-sm text-gray-500">Pages are cached for fast delivery. Invalidate when you need to force a refresh.</p>
        <button onClick={handleInvalidateCache} className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50">
          Invalidate all cached pages
        </button>
      </div>
    </div>
  );
}
