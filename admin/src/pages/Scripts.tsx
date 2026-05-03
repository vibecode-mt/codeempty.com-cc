import { useEffect, useState } from 'react';
import { api, type CommonScript } from '../api';

export default function Scripts() {
  const [scripts, setScripts] = useState<CommonScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', html_snippet: '', position: 'head', enabled: 1 });
  const [error, setError] = useState('');

  useEffect(() => {
    api.listScripts().then(setScripts).finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    setError('');
    try {
      const s = await api.createScript(form as Partial<CommonScript>);
      setScripts((prev) => [...prev, s]);
      setAdding(false);
      setForm({ name: '', html_snippet: '', position: 'head', enabled: 1 });
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleEnabled(s: CommonScript) {
    const updated = await api.updateScript(s.id, { enabled: s.enabled ? 0 : 1 });
    setScripts((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete script "${name}"?`)) return;
    await api.deleteScript(id);
    setScripts((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Common Scripts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Google Analytics, Microsoft Clarity, etc. Added to every public page.</p>
        </div>
        <button onClick={() => setAdding(true)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + Add script
        </button>
      </div>

      {adding && (
        <div className="border rounded-xl bg-white p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Google Analytics" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Position</label>
              <select className="w-full border rounded px-3 py-1.5 text-sm" value={form.position} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}>
                <option value="head">&lt;head&gt;</option>
                <option value="body_end">End of &lt;body&gt;</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">HTML snippet</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm font-mono resize-y"
              rows={6}
              value={form.html_snippet}
              onChange={(e) => setForm((f) => ({ ...f, html_snippet: e.target.value }))}
              placeholder="<script async src='...'></script>"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Add</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {scripts.length === 0 && !adding ? (
        <p className="text-gray-400">No scripts added yet.</p>
      ) : (
        <div className="space-y-2">
          {scripts.map((s) => (
            <div key={s.id} className="border rounded-xl bg-white p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs text-gray-400">{s.position === 'head' ? '<head>' : 'body end'}</span>
                </div>
                <pre className="text-xs text-gray-500 mt-1 overflow-hidden whitespace-nowrap text-ellipsis">{s.html_snippet.slice(0, 100)}</pre>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleEnabled(s)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button onClick={() => handleDelete(s.id, s.name)} className="text-xs text-red-500 hover:underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
