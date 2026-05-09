import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, type Page, type ContentElement } from '../api';
import ContentElementEditor from '../components/ContentElementEditor';

export default function PageEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState({ title: '', slug: '', published: 1, show_in_menu: 0, is_home: 0 });
  const [elements, setElements] = useState<ContentElement[]>([]);
  const [pageId, setPageId] = useState<string | null>(id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (id) {
      Promise.all([api.getPage(id), api.listContent('page', id)]).then(([p, els]) => {
        setForm({ title: p.title, slug: p.slug, published: p.published, show_in_menu: p.show_in_menu, is_home: p.is_home });
        setElements(els);
      });
    }
  }, [id]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        const created = await api.createPage(form as Partial<Page>);
        setPageId(created.id);
        navigate(`/pages/${created.id}`, { replace: true });
      } else {
        await api.updatePage(id!, form as Partial<Page>);
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
        <Link to="/pages" className="text-gray-400 hover:text-gray-700">← Pages</Link>
        <h1 className="text-2xl font-bold">{isNew ? 'New Page' : 'Edit Page'}</h1>
      </div>

      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Slug (URL path) *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="about" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pub" checked={!!form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="pub" className="text-sm font-medium">Published</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="show_in_menu" checked={!!form.show_in_menu} onChange={(e) => setForm((f) => ({ ...f, show_in_menu: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="show_in_menu" className="text-sm font-medium">Show in menu</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_home" checked={!!form.is_home} onChange={(e) => setForm((f) => ({ ...f, is_home: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="is_home" className="text-sm font-medium" title="Render this page at /. Only one page can be the home.">Home page</label>
          </div>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create Page' : 'Save Changes'}
        </button>
      </div>

      {pageId && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Content</h2>
          <ContentElementEditor
            parentType="page"
            parentId={pageId}
            elements={elements}
            onChange={setElements}
          />
        </div>
      )}
    </div>
  );
}
