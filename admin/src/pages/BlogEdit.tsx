import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, type BlogEntry, type ContentElement } from '../api';
import ContentElementEditor from '../components/ContentElementEditor';

export default function BlogEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState({ title: '', slug: '', entry_date: new Date().toISOString().slice(0, 10), published: 1 });
  const [elements, setElements] = useState<ContentElement[]>([]);
  const [entryId, setEntryId] = useState<string | null>(id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (id) {
      Promise.all([api.getBlogEntry(id), api.listContent('blog_entry', id)]).then(([e, els]) => {
        setForm({ title: e.title, slug: e.slug, entry_date: e.entry_date, published: e.published });
        setElements(els);
      });
    }
  }, [id]);

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
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pub" checked={!!form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="pub" className="text-sm font-medium">Published</label>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create Entry' : 'Save Changes'}
        </button>
      </div>

      {entryId && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Content</h2>
          <ContentElementEditor
            parentType="blog_entry"
            parentId={entryId}
            elements={elements}
            onChange={setElements}
          />
        </div>
      )}
    </div>
  );
}
