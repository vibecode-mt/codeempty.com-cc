import { useMemo, useState } from 'react';
import { api, type FormSubmission } from '../api';
import { useEffect } from 'react';

type FlatRecord = Record<string, string>;
type RowRecord = FlatRecord & { _id: string; _raw: string };

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}

function flattenJson(value: unknown, prefix = '', out: FlatRecord = {}): FlatRecord {
  if (value == null) return out;
  if (Array.isArray(value)) {
    out[prefix || 'value'] = JSON.stringify(value);
    return out;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        flattenJson(v, next, out);
      } else if (Array.isArray(v)) {
        out[next] = JSON.stringify(v);
      } else if (typeof v === 'boolean') {
        out[next] = v ? 'true' : 'false';
      } else if (v == null) {
        out[next] = '';
      } else {
        out[next] = String(v);
      }
    }
    return out;
  }
  out[prefix || 'value'] = String(value);
  return out;
}

export default function ContactSubmissions() {
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageFilter, setPageFilter] = useState('all');
  const [formFilter, setFormFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [rawOpenId, setRawOpenId] = useState<string | null>(null);

  useEffect(() => {
    api.listAllFormSubmissions()
      .then(setSubmissions)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo<RowRecord[]>(() => submissions.map((sub) => {
    const payload = parsePayload(sub.payload_json);
    const flat = flattenJson(payload);
    return {
      _id: sub.id,
      _raw: sub.payload_json,
      id: sub.id,
      form_slug: sub.form_slug ?? '',
      form_name: sub.form_name ?? '',
      created_at: sub.created_at,
      status: sub.status,
      source_page_slug: sub.source_page_slug ?? '',
      error_message: sub.error_message ?? '',
      ...flat,
    };
  }), [submissions]);

  const columns = useMemo(() => {
    const base = ['created_at', 'form_name', 'form_slug', 'status', 'source_page_slug', 'error_message', 'id'];
    const dynamic = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!key.startsWith('_') && !base.includes(key)) dynamic.add(key);
      }
    }
    return [...base, ...Array.from(dynamic).sort()];
  }, [rows]);

  const statuses = useMemo(() => ['all', ...Array.from(new Set(rows.map((r) => r.status))).sort()], [rows]);
  const pages = useMemo(() => ['all', ...Array.from(new Set(rows.map((r) => r.source_page_slug).filter(Boolean))).sort()], [rows]);
  const forms = useMemo(() => ['all', ...Array.from(new Set(rows.map((r) => r.form_slug).filter(Boolean))).sort()], [rows]);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (pageFilter !== 'all' && row.source_page_slug !== pageFilter) return false;
      if (formFilter !== 'all' && row.form_slug !== formFilter) return false;
      if (!q) return true;
      for (const val of Object.values(row)) {
        if (String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
    filtered.sort((a, b) => {
      const av = String(a[sortBy] ?? '');
      const bv = String(b[sortBy] ?? '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [rows, query, statusFilter, pageFilter, formFilter, sortBy, sortDir]);

  function changeSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(col);
    setSortDir(col === 'created_at' ? 'desc' : 'asc');
  }

  function exportCsv() {
    const escape = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const header = columns.map(escape).join(',');
    const lines = filteredSorted.map((row) => columns.map((c) => escape(String(row[c] ?? ''))).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contact-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="text-gray-400">Loading submissions…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Form Data</h1>
          <p className="text-sm text-gray-500">Flattened table view with search, filter, sort, CSV export, and raw JSON.</p>
        </div>
        <button onClick={exportCsv} className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50" disabled={filteredSorted.length === 0}>
          Export CSV
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          className="border rounded px-3 py-2 text-sm min-w-[280px]"
          placeholder="Quick search across all columns…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="border rounded px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {statuses.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
        </select>
        <select className="border rounded px-3 py-2 text-sm" value={pageFilter} onChange={(e) => setPageFilter(e.target.value)}>
          {pages.map((p) => <option key={p} value={p}>{p === 'all' ? 'All pages' : p}</option>)}
        </select>
        <select className="border rounded px-3 py-2 text-sm" value={formFilter} onChange={(e) => setFormFilter(e.target.value)}>
          {forms.map((f) => <option key={f} value={f}>{f === 'all' ? 'All forms' : f}</option>)}
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filteredSorted.length} / {rows.length} rows</span>
      </div>

      <div className="bg-white border rounded-xl overflow-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  <button onClick={() => changeSort(col)} className="hover:underline">
                    {col} {sortBy === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Raw</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredSorted.length === 0 ? (
              <tr><td className="px-3 py-4 text-gray-500" colSpan={columns.length + 1}>No submissions found.</td></tr>
            ) : (
              filteredSorted.map((row) => (
                <tr key={row._id} className="hover:bg-gray-50 align-top">
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-2 max-w-[320px]">
                      <div className="truncate" title={String(row[col] ?? '')}>{String(row[col] ?? '')}</div>
                    </td>
                  ))}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button onClick={() => setRawOpenId((id) => id === row._id ? null : row._id)} className="px-2 py-1 text-xs border rounded hover:bg-gray-100">
                      {rawOpenId === row._id ? 'Hide JSON' : 'View JSON'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rawOpenId && (
        <div className="bg-white border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Raw JSON</h2>
            <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => setRawOpenId(null)}>Close</button>
          </div>
          <pre className="bg-gray-50 border rounded p-3 text-xs overflow-auto">
            {rows.find((r) => r._id === rawOpenId)?._raw ?? ''}
          </pre>
        </div>
      )}
    </div>
  );
}
