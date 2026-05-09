import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ContactField, type FormDefinition, type FormSubmission } from '../api';

const FIELD_TYPES: ContactField['type'][] = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'];

function defaultField(): ContactField {
  return { key: 'field_name', label: 'Field name', type: 'text', required: 0, placeholder: '', help_text: '', options: [] };
}

export default function FormEdit() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);

  const [form, setForm] = useState<FormDefinition>({
    id: '',
    slug: '',
    name: '',
    published: 1,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: 1, placeholder: 'Your name' },
      { key: 'email', label: 'Email', type: 'email', required: 1, placeholder: 'you@example.com' },
      { key: 'message', label: 'Message', type: 'textarea', required: 1, placeholder: 'Your message' },
    ],
    captcha: { enabled: 0, provider: 'none', site_key: '', secret_key: '', recaptcha_action: 'form_submit', recaptcha_min_score: 0.5 },
    delivery: { provider: 'webhook', to_email: '', from_email: '', webhook_url: '', webhook_auth_header: '', smtp_host: '', smtp_port: 587, smtp_username: '', smtp_password: '', smtp_secure: 0 },
    submit_action_type: 'message',
    submit_action_value: '',
    success_message: 'Thanks! Your submission has been saved.',
    created_at: '',
    updated_at: '',
  });

  useEffect(() => {
    if (isNew || !id) return;
    Promise.all([api.getForm(id), api.listFormSubmissions(id)])
      .then(([f, subs]) => {
        setForm(f);
        setSubmissions(subs);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      if (isNew) {
        const created = await api.createForm(form);
        navigate(`/forms/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await api.updateForm(id, form);
        setForm(updated);
        setSaved(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addSubmission() {
    if (!id) return;
    const raw = prompt('Enter submission JSON payload', '{"fields":{"example":"value"}}');
    if (!raw) return;
    try {
      JSON.parse(raw);
      const created = await api.createFormSubmission(id, { payload_json: raw, status: 'stored' });
      setSubmissions((s) => [created, ...s]);
    } catch {
      alert('Invalid JSON');
    }
  }

  async function editSubmission(sub: FormSubmission) {
    if (!id) return;
    const raw = prompt('Edit submission JSON payload', sub.payload_json);
    if (raw == null) return;
    try {
      JSON.parse(raw);
      const updated = await api.updateFormSubmission(id, sub.id, { payload_json: raw });
      setSubmissions((s) => s.map((x) => x.id === sub.id ? updated : x));
    } catch {
      alert('Invalid JSON');
    }
  }

  async function removeSubmission(sub: FormSubmission) {
    if (!id) return;
    if (!confirm('Delete this submission?')) return;
    await api.deleteFormSubmission(id, sub.id);
    setSubmissions((s) => s.filter((x) => x.id !== sub.id));
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/forms" className="text-gray-400 hover:text-gray-700">← Forms</Link>
        <h1 className="text-2xl font-bold">{isNew ? 'New Form' : 'Edit Form'}</h1>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input className="w-full border rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug</label>
            <input className="w-full border rounded px-3 py-2 text-sm font-mono" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2 pt-7">
            <input type="checkbox" checked={!!form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked ? 1 : 0 }))} />
            <span className="text-sm font-medium">Published</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Submit action</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.submit_action_type} onChange={(e) => setForm((f) => ({ ...f, submit_action_type: e.target.value as FormDefinition['submit_action_type'] }))}>
              <option value="message">Show success message</option>
              <option value="redirect">Redirect to URL/page</option>
              <option value="show_summary">Show summary</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Submit action value</label>
            <input className="w-full border rounded px-3 py-2 text-sm" value={form.submit_action_value} onChange={(e) => setForm((f) => ({ ...f, submit_action_value: e.target.value }))} placeholder={form.submit_action_type === 'redirect' ? '/thank-you' : ''} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Success message</label>
          <input className="w-full border rounded px-3 py-2 text-sm" value={form.success_message} onChange={(e) => setForm((f) => ({ ...f, success_message: e.target.value }))} />
        </div>

        <div className="border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Fields</h2>
            <button onClick={() => setForm((f) => ({ ...f, fields: [...f.fields, defaultField()] }))} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">+ Add field</button>
          </div>
          <div className="space-y-2">
            {form.fields.map((field, idx) => (
              <div key={`${field.key}-${idx}`} className="grid grid-cols-12 gap-2 items-end border rounded p-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Key</label>
                  <input className="w-full border rounded px-2 py-1 text-sm font-mono" value={field.key} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, key: e.target.value } : x) }))} />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Label</label>
                  <input className="w-full border rounded px-2 py-1 text-sm" value={field.label} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Type</label>
                  <select className="w-full border rounded px-2 py-1 text-sm" value={field.type} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, type: e.target.value as ContactField['type'] } : x) }))}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Placeholder</label>
                  <input className="w-full border rounded px-2 py-1 text-sm" value={field.placeholder ?? ''} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, placeholder: e.target.value } : x) }))} />
                </div>
                <label className="col-span-1 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={!!field.required} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, required: e.target.checked ? 1 : 0 } : x) }))} />
                  Req
                </label>
                <button className="col-span-1 px-2 py-1 text-xs border rounded text-red-500 hover:bg-red-50" onClick={() => setForm((f) => ({ ...f, fields: f.fields.filter((_, i) => i !== idx) }))}>Delete</button>
                {field.type === 'select' && (
                  <div className="col-span-12">
                    <label className="block text-xs text-gray-500 mb-1">Options (one per line: label|value)</label>
                    <textarea
                      className="w-full border rounded px-2 py-1 text-xs font-mono"
                      rows={3}
                      value={(field.options ?? []).map((o) => `${o.label}|${o.value}`).join('\n')}
                      onChange={(e) => {
                        const options = e.target.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
                          const [label, value] = line.includes('|') ? line.split('|', 2) : [line, line];
                          return { label: label.trim(), value: value.trim() };
                        });
                        setForm((f) => ({ ...f, fields: f.fields.map((x, i) => i === idx ? { ...x, options } : x) }));
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border rounded p-4">
          <div className="space-y-2">
            <h2 className="font-semibold">Captcha</h2>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.captcha.enabled} onChange={(e) => setForm((f) => ({ ...f, captcha: { ...f.captcha, enabled: e.target.checked ? 1 : 0 } }))} />Enable captcha</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.captcha.provider} onChange={(e) => setForm((f) => ({ ...f, captcha: { ...f.captcha, provider: e.target.value as FormDefinition['captcha']['provider'] } }))}>
              <option value="none">None</option>
              <option value="turnstile">Cloudflare Turnstile</option>
              <option value="recaptcha_v2">Google reCAPTCHA v2</option>
              <option value="recaptcha_v3">Google reCAPTCHA v3</option>
            </select>
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Site key" value={form.captcha.site_key} onChange={(e) => setForm((f) => ({ ...f, captcha: { ...f.captcha, site_key: e.target.value } }))} />
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Secret key" value={form.captcha.secret_key} onChange={(e) => setForm((f) => ({ ...f, captcha: { ...f.captcha, secret_key: e.target.value } }))} />
          </div>
          <div className="space-y-2">
            <h2 className="font-semibold">Delivery</h2>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.delivery.provider} onChange={(e) => setForm((f) => ({ ...f, delivery: { ...f.delivery, provider: e.target.value as FormDefinition['delivery']['provider'] } }))}>
              <option value="webhook">Webhook</option>
              <option value="smtp">SMTP (config only)</option>
            </select>
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="To email" value={form.delivery.to_email} onChange={(e) => setForm((f) => ({ ...f, delivery: { ...f.delivery, to_email: e.target.value } }))} />
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="From email" value={form.delivery.from_email} onChange={(e) => setForm((f) => ({ ...f, delivery: { ...f.delivery, from_email: e.target.value } }))} />
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Webhook URL" value={form.delivery.webhook_url ?? ''} onChange={(e) => setForm((f) => ({ ...f, delivery: { ...f.delivery, webhook_url: e.target.value } }))} />
            <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Auth header (optional)" value={form.delivery.webhook_auth_header ?? ''} onChange={(e) => setForm((f) => ({ ...f, delivery: { ...f.delivery, webhook_auth_header: e.target.value } }))} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create Form' : 'Save Changes'}
          </button>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>

      {!isNew && (
        <div className="bg-white border rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Form Data (Submissions)</h2>
            <button onClick={addSubmission} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">+ Add row</button>
          </div>
          {submissions.length === 0 ? (
            <p className="text-sm text-gray-500">No submissions yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {submissions.map((sub) => (
                <div key={sub.id} className="border rounded p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-500 font-mono">{sub.created_at}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{sub.status}</span>
                      <button onClick={() => editSubmission(sub)} className="text-blue-600 hover:underline text-xs">Edit</button>
                      <button onClick={() => removeSubmission(sub)} className="text-red-500 hover:underline text-xs">Delete</button>
                    </div>
                  </div>
                  <pre className="bg-gray-50 border rounded p-2 text-xs overflow-auto mt-2">{sub.payload_json}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
