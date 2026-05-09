import { useEffect, useState } from 'react';
import { api } from '../api';

const LANGUAGE_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'cn', name: 'Chinese (Simplified)' },
];

export default function Settings() {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [langForm, setLangForm] = useState<{ default_language: string; supported_languages: string[] }>({
    default_language: 'en',
    supported_languages: ['en'],
  });
  const [langLoading, setLangLoading] = useState(false);
  const [langError, setLangError] = useState('');
  const [langSuccess, setLangSuccess] = useState('');

  useEffect(() => {
    api.getI18nSettings()
      .then((settings) => {
        setLangForm({
          default_language: settings.default_language,
          supported_languages: settings.supported_languages,
        });
      })
      .catch((e) => setLangError(String(e)));
  }, []);

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

  async function handleSaveLanguages(e: React.FormEvent) {
    e.preventDefault();
    setLangLoading(true);
    setLangError('');
    setLangSuccess('');
    try {
      const supported = Array.from(new Set(langForm.supported_languages));
      const updated = await api.updateI18nSettings({
        default_language: langForm.default_language.trim().toLowerCase(),
        supported_languages: supported,
      });
      setLangForm({
        default_language: updated.default_language,
        supported_languages: updated.supported_languages,
      });
      setLangSuccess('Languages updated successfully.');
    } catch (e) {
      setLangError(String(e));
    } finally {
      setLangLoading(false);
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
        <button onClick={handleInvalidateCache} className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50">
          Invalidate all cached pages
        </button>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">Languages</h2>
        <p className="text-sm text-gray-500">
          Choose the website languages here. English is the base source language. For each page/project/blog item and content block, you can then enter translated text directly in the editors by selecting a translation language.
        </p>
        <div className="text-xs text-gray-500 bg-gray-50 border rounded-lg p-3 leading-relaxed">
          Translation workflow: 1) create content in English, 2) choose supported languages here, 3) open an editor (project/page/blog) and select a translation language, 4) fill translated fields, 5) publish. External AI tools can also use the i18n export/import APIs.
        </div>
        <form onSubmit={handleSaveLanguages} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Default language code</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={langForm.default_language}
              onChange={(e) => setLangForm((f) => ({ ...f, default_language: e.target.value }))}
            >
              {langForm.supported_languages.map((code) => {
                const item = LANGUAGE_OPTIONS.find((l) => l.code === code);
                return (
                  <option key={code} value={code}>
                    {item ? `${item.name} (${code})` : code}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Supported languages</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {LANGUAGE_OPTIONS.map((lang) => {
                const checked = langForm.supported_languages.includes(lang.code);
                return (
                  <label key={lang.code} className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setLangForm((f) => {
                          const next = new Set(f.supported_languages);
                          if (e.target.checked) next.add(lang.code);
                          else next.delete(lang.code);
                          if (!next.has('en')) next.add('en');
                          const supported = Array.from(next);
                          const defaultLanguage = next.has(f.default_language) ? f.default_language : 'en';
                          return { ...f, supported_languages: supported, default_language: defaultLanguage };
                        });
                      }}
                    />
                    <span>{lang.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          {langError && <p className="text-red-500 text-sm">{langError}</p>}
          {langSuccess && <p className="text-green-600 text-sm">{langSuccess}</p>}
          <button type="submit" disabled={langLoading} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {langLoading ? 'Saving…' : 'Save Language Settings'}
          </button>
        </form>
      </div>
    </div>
  );
}
