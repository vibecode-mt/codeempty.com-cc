import { useState } from 'react';
import { api } from '../api';

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

  async function saveContactConfig() {
    if (!confirm('Invalidate all cached pages? They will be re-generated on next visit.')) return;
    try {
      await api.invalidateAll();
      alert('All cached pages invalidated.');
    } catch (e) {
      alert(String(e));
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

      <div className="bg-white border rounded-xl p-6 space-y-3">
        <h2 className="font-semibold">Cache</h2>
        <p className="text-sm text-gray-500">Pages are cached for fast delivery. Invalidate when you need to force a refresh.</p>
        <button onClick={saveContactConfig} className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50">
          Invalidate all cached pages
        </button>
      </div>
    </div>
  );
}
