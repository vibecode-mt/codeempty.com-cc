import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Page } from '../api';

export default function Pages() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listPages().then(setPages).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return;
    await api.deletePage(id);
    setPages((p) => p.filter((x) => x.id !== id));
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pages</h1>
        <Link to="/pages/new" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + New page
        </Link>
      </div>
      <p className="text-sm text-gray-500">Create standalone pages (e.g. <code>/about</code>, <code>/contact</code>). Mark one page as <strong>Home</strong> to render it at <code>/</code>. Use the <strong>Project list</strong> and <strong>Blog list</strong> widgets to embed dynamic content.</p>
      {pages.length === 0 ? (
        <p className="text-gray-400">No pages yet.</p>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Title</th>
                <th className="px-4 py-3 text-left font-medium">Slug (URL)</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">In Menu</th>
                <th className="px-4 py-3 text-left font-medium">Home</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pages.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{p.title}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.is_home ? '/' : `/${p.slug}`}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.show_in_menu ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Yes</span> : <span className="text-gray-400 text-xs">No</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.is_home ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Home</span> : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link to={`/pages/${p.id}`} className="text-blue-600 hover:underline">Edit</Link>
                    <button onClick={() => handleDelete(p.id, p.title)} className="text-red-500 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
