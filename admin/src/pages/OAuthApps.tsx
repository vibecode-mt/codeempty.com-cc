import { useEffect, useState } from 'react';
import { api, type OAuthApp } from '../api';

export default function OAuthApps() {
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', scopes: 'read' });
  const [newSecret, setNewSecret] = useState<{ client_id: string; client_secret: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listOAuthApps().then(setApps).finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    setError('');
    try {
      const result = await api.createOAuthApp(form);
      setApps((prev) => [...prev, result]);
      setNewSecret({ client_id: result.client_id, client_secret: result.client_secret });
      setAdding(false);
      setForm({ name: '', scopes: 'read' });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete app "${name}"? All tokens will be revoked.`)) return;
    await api.deleteOAuthApp(id);
    setApps((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Apps</h1>
          <p className="text-sm text-gray-500 mt-0.5">Register apps that can access the API via OAuth 2.0 client credentials.</p>
        </div>
        <button onClick={() => setAdding(true)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + Register app
        </button>
      </div>

      {newSecret && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
          <p className="font-medium text-yellow-800">Save these credentials — the secret will not be shown again.</p>
          <div className="font-mono text-sm space-y-1">
            <p><span className="text-gray-500">client_id:</span> {newSecret.client_id}</p>
            <p><span className="text-gray-500">client_secret:</span> {newSecret.client_secret}</p>
          </div>
          <p className="text-xs text-yellow-700">Token endpoint: <code>POST /api/oauth/token</code> with <code>grant_type=client_credentials</code></p>
          <button onClick={() => setNewSecret(null)} className="text-sm text-yellow-700 underline">Dismiss</button>
        </div>
      )}

      {adding && (
        <div className="border rounded-xl bg-white p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">App name *</label>
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="My MCP Client" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Scopes</label>
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={form.scopes} onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))} placeholder="read" />
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Register</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      )}

      {apps.length === 0 && !adding ? (
        <p className="text-gray-400">No apps registered yet.</p>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Client ID</th>
                <th className="px-4 py-3 text-left font-medium">Scopes</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {apps.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{a.client_id}</td>
                  <td className="px-4 py-3 text-gray-500">{a.scopes}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{a.created_at?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(a.id, a.name)} className="text-red-500 hover:underline text-sm">Delete</button>
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
