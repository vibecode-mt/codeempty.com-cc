import { useEffect, useState } from 'react';
import { api, type ExceptionLog } from '../api';

function preview(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export default function Logs() {
  const [logs, setLogs] = useState<ExceptionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.listLogs(limit)
      .then(setLogs)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [limit]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Recent uncaught server exceptions recorded from the API.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Limit</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading…</div>
      ) : error ? (
        <div className="text-red-500">{error}</div>
      ) : logs.length === 0 ? (
        <p className="text-gray-500">No exceptions logged yet.</p>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Time</th>
                  <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Method</th>
                  <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Path</th>
                  <th className="px-4 py-3 text-left font-medium whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Message</th>
                  <th className="px-4 py-3 text-left font-medium">Stack</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">{log.created_at}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{log.method}</td>
                    <td className="px-4 py-3 font-mono text-xs break-all">{log.path}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-red-700 text-xs font-medium">
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{preview(log.message)}</td>
                    <td className="px-4 py-3">
                      {log.stack ? (
                        <details className="group">
                          <summary className="cursor-pointer text-blue-600 hover:underline">View stack</summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-xs bg-gray-50 border rounded p-3 max-w-3xl overflow-auto">
                            {log.stack}
                          </pre>
                        </details>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
