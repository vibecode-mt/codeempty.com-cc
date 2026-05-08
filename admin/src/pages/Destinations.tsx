import { useEffect, useState } from 'react';
import { api, type PublishDestination } from '../api';

export default function Destinations() {
  const [items, setItems] = useState<PublishDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', api_url: '', client_id: '', client_secret: '', scopes: 'write' });
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<Record<string, 'pending' | { ok: boolean; msg: string }>>({});

  useEffect(() => {
    api.listDestinations().then(setItems).finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    setError('');
    if (!form.name.trim() || !form.api_url.trim() || !form.client_id.trim() || !form.client_secret.trim()) {
      setError('Name, API URL, client_id, and client_secret are required.');
      return;
    }
    try {
      const result = await api.createDestination(form);
      setItems((prev) => [result, ...prev]);
      setAdding(false);
      setForm({ name: '', api_url: '', client_id: '', client_secret: '', scopes: 'write' });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(d: PublishDestination) {
    if (!confirm(`Delete destination "${d.name}"? Stored credentials will be wiped.`)) return;
    await api.deleteDestination(d.id);
    setItems((prev) => prev.filter((x) => x.id !== d.id));
  }

  async function handleTest(d: PublishDestination) {
    setTesting((prev) => ({ ...prev, [d.id]: 'pending' }));
    try {
      const r = await api.testDestination(d.id);
      setTesting((prev) => ({
        ...prev,
        [d.id]: r.ok
          ? { ok: true, msg: `OK — scope: ${r.scope || '(none)'}, expires in ${r.expires_in ?? '?'}s` }
          : { ok: false, msg: r.error ?? 'Unknown error' },
      }));
    } catch (e) {
      setTesting((prev) => ({ ...prev, [d.id]: { ok: false, msg: String(e) } }));
    }
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Publish destinations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Remote CMS instances you can publish projects to. The destination admin creates an OAuth app
            with <code className="font-mono">write</code> scope; paste the credentials here.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            + Add destination
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Production"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">API base URL</label>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              value={form.api_url}
              onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
              placeholder="https://codeempty.com"
            />
            <p className="text-xs text-gray-500 mt-1">No trailing slash. The publish flow will hit <code>{'{api_url}'}/api/oauth/token</code>, etc.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">client_id</label>
              <input
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                value={form.client_id}
                onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">client_secret</label>
              <input
                type="password"
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                value={form.client_secret}
                onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Scopes</label>
            <input
              className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              value={form.scopes}
              onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
              placeholder="write"
            />
            <p className="text-xs text-gray-500 mt-1">Whatever scopes the destination's OAuth app actually grants.</p>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700">Save</button>
            <button onClick={() => { setAdding(false); setError(''); }} className="px-4 py-1.5 border text-sm rounded hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding && (
        <p className="text-sm text-gray-500 italic">No destinations yet.</p>
      )}

      <div className="space-y-2">
        {items.map((d) => {
          const status = testing[d.id];
          return (
            <div key={d.id} className="bg-white border rounded-xl p-4 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{d.name}</div>
                <div className="text-xs text-gray-500 font-mono truncate">{d.api_url}</div>
                <div className="text-xs text-gray-400 mt-1">
                  client_id <code>{d.client_id}</code> · scopes <code>{d.scopes}</code>
                </div>
                {status && status !== 'pending' && (
                  <div className={`text-xs mt-2 ${status.ok ? 'text-green-700' : 'text-red-600'}`}>
                    {status.ok ? '✓ ' : '✗ '}{status.msg}
                  </div>
                )}
                {status === 'pending' && (
                  <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <span className="animate-spin inline-block">⟳</span> Testing…
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleTest(d)}
                  disabled={status === 'pending'}
                  className="px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
                >
                  Test
                </button>
                <button
                  onClick={() => handleDelete(d)}
                  className="px-2 py-1 text-xs border rounded text-red-500 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
