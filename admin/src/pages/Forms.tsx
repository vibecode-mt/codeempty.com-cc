import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type FormDefinition } from '../api';

export default function Forms() {
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listForms().then(setForms).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete form "${name}"?`)) return;
    await api.deleteForm(id);
    setForms((f) => f.filter((x) => x.id !== id));
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Forms</h1>
        <Link to="/forms/new" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">+ New form</Link>
      </div>
      {forms.length === 0 ? (
        <p className="text-gray-500">No forms yet.</p>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Slug</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Action</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {forms.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{f.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{f.slug}</td>
                  <td className="px-4 py-3">{f.published ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Published</span> : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">Draft</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{f.submit_action_type}{f.submit_action_value ? `: ${f.submit_action_value}` : ''}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link to={`/forms/${f.id}`} className="text-blue-600 hover:underline">Edit</Link>
                    <button onClick={() => handleDelete(f.id, f.name)} className="text-red-500 hover:underline">Delete</button>
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
