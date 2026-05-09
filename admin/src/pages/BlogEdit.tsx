import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, type BlogEntry, type ContentElement } from '../api';
import ContentElementEditor from '../components/ContentElementEditor';

export default function BlogEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState({
    title: '',
    seo_title: '',
    seo_description: '',
    slug: '',
    entry_date: new Date().toISOString().slice(0, 10),
    published: 1,
  });
  const [elements, setElements] = useState<ContentElement[]>([]);
  const [entryId, setEntryId] = useState<string | null>(id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>([]);
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [translationLanguage, setTranslationLanguage] = useState('');
  const [translation, setTranslation] = useState({ title: '', seo_title: '', seo_description: '' });
  const [translationSaving, setTranslationSaving] = useState(false);

  useEffect(() => {
    if (id) {
      Promise.all([api.getBlogEntry(id), api.listContent('blog_entry', id)]).then(([e, els]) => {
        setForm({
          title: e.title,
          seo_title: e.seo_title ?? '',
          seo_description: e.seo_description ?? '',
          slug: e.slug,
          entry_date: e.entry_date,
          published: e.published,
        });
        setElements(els);
      });
    }
  }, [id]);

  useEffect(() => {
    api.getI18nSettings().then((settings) => {
      setSupportedLanguages(settings.supported_languages);
      setDefaultLanguage(settings.default_language);
      const first = settings.supported_languages.find((l) => l !== settings.default_language) ?? '';
      setTranslationLanguage(first);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!entryId || !translationLanguage) return;
    api.getEntityTranslation('blog_entry', entryId, translationLanguage)
      .then((row) => {
        setTranslation({
          title: typeof row.title === 'string' ? row.title : '',
          seo_title: typeof row.seo_title === 'string' ? row.seo_title : '',
          seo_description: typeof row.seo_description === 'string' ? row.seo_description : '',
        });
      })
      .catch(() => setTranslation({ title: '', seo_title: '', seo_description: '' }));
  }, [entryId, translationLanguage]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        const created = await api.createBlogEntry(form as Partial<BlogEntry>);
        setEntryId(created.id);
        navigate(`/blog/${created.id}`, { replace: true });
      } else {
        await api.updateBlogEntry(id!, form as Partial<BlogEntry>);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTranslation() {
    if (!entryId || !translationLanguage) return;
    setTranslationSaving(true);
    try {
      await api.updateEntityTranslation('blog_entry', entryId, {
        language: translationLanguage,
        title: translation.title,
        seo_title: translation.seo_title,
        seo_description: translation.seo_description,
      });
    } finally {
      setTranslationSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/blog" className="text-gray-400 hover:text-gray-700">← Blog</Link>
        <h1 className="text-2xl font-bold">{isNew ? 'New Entry' : 'Edit Entry'}</h1>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date *</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="auto-generated" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">SEO title</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.seo_title} onChange={(e) => setForm((f) => ({ ...f, seo_title: e.target.value }))} placeholder="Optional search/social title" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">SEO description</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.seo_description} onChange={(e) => setForm((f) => ({ ...f, seo_description: e.target.value }))} placeholder="Optional description meta tag" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pub" checked={!!form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="pub" className="text-sm font-medium">Published</label>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create Entry' : 'Save Changes'}
        </button>
      </div>

      {!!entryId && supportedLanguages.some((l) => l !== defaultLanguage) && (
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold">Translations</h2>
          <div>
            <label className="block text-sm font-medium mb-1">Translation language</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={translationLanguage} onChange={(e) => setTranslationLanguage(e.target.value)}>
              <option value="">Select language</option>
              {supportedLanguages.filter((l) => l !== defaultLanguage).map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          {translationLanguage && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Translated title</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" value={translation.title} onChange={(e) => setTranslation((t) => ({ ...t, title: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Translated SEO title</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" value={translation.seo_title} onChange={(e) => setTranslation((t) => ({ ...t, seo_title: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Translated SEO description</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={translation.seo_description} onChange={(e) => setTranslation((t) => ({ ...t, seo_description: e.target.value }))} />
              </div>
              <button onClick={handleSaveTranslation} disabled={translationSaving} className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50 disabled:opacity-60">
                {translationSaving ? 'Saving translation…' : 'Save Translation Fields'}
              </button>
            </>
          )}
        </div>
      )}

      {entryId && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Content</h2>
          <ContentElementEditor
            parentType="blog_entry"
            parentId={entryId}
            elements={elements}
            onChange={setElements}
            translationLanguage={translationLanguage || undefined}
          />
        </div>
      )}
    </div>
  );
}
