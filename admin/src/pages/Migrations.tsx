import { useEffect, useState, useCallback } from 'react';
import { api, type MigrationStatus, type MigrationApplyResult } from '../api';

export default function Migrations() {
  const [migrations, setMigrations] = useState<MigrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<MigrationApplyResult[] | null>(null);
  const [applyMessage, setApplyMessage] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.listMigrations()
      .then((res) => setMigrations(res.migrations))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = migrations.filter((m) => !m.applied);
  const applied = migrations.filter((m) => m.applied);

  async function handleApply() {
    setApplying(true);
    setApplyResults(null);
    setApplyMessage('');
    try {
      const res = await api.applyMigrations();
      setApplyResults(res.applied);
      setApplyMessage(res.message ?? (res.ok ? 'Migrations applied successfully.' : 'Some migrations failed.'));
      load();
    } catch (e) {
      setApplyMessage(String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Database Migrations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            View and apply pending D1 schema migrations.
          </p>
        </div>
        <button
          onClick={handleApply}
          disabled={applying || pending.length === 0 || loading}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {applying ? 'Applying…' : `Apply ${pending.length} Pending`}
        </button>
      </div>

      {applyMessage && (
        <div className={`rounded-lg px-4 py-3 text-sm ${applyResults?.some((r) => !r.ok) ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          <p className="font-medium">{applyMessage}</p>
          {applyResults && applyResults.length > 0 && (
            <ul className="mt-2 space-y-1">
              {applyResults.map((r) => (
                <li key={r.name} className="flex items-start gap-2">
                  <span>{r.ok ? '✓' : '✗'}</span>
                  <span className="font-mono">{r.name}</span>
                  {r.error && <span className="text-red-600">— {r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-gray-400">Loading…</div>
      ) : error ? (
        <div className="text-red-500">{error}</div>
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-yellow-700 mb-2">
                Pending ({pending.length})
              </h2>
              <div className="border border-yellow-200 rounded-xl overflow-hidden bg-yellow-50">
                <table className="w-full text-sm">
                  <thead className="bg-yellow-100 border-b border-yellow-200">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-yellow-800">Migration</th>
                      <th className="px-4 py-2 text-left font-medium text-yellow-800">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-yellow-100">
                    {pending.map((m) => (
                      <tr key={m.name} className="hover:bg-yellow-100/60">
                        <td className="px-4 py-2 font-mono text-xs">{m.name}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-full bg-yellow-200 px-2 py-0.5 text-yellow-800 text-xs font-medium">
                            Pending
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {applied.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-gray-600 mb-2">
                Applied ({applied.length})
              </h2>
              <div className="border rounded-xl overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Migration</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Applied At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {applied.map((m) => (
                      <tr key={m.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">{m.name}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-green-700 text-xs font-medium">
                            Applied
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">{m.applied_at ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {migrations.length === 0 && (
            <p className="text-gray-500">No migrations found.</p>
          )}
        </>
      )}
    </div>
  );
}
