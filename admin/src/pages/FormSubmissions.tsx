import { useMemo, useState, useEffect } from 'react';
import { api, type FormSubmission } from '../api';

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

export default function FormSubmissions() {
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

  const rows = useMemo<RowRecord[]>(() =>
    submissions.map((sub) => {
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

  const allColumns = useMemo(() => {
    const cols = new Set<string>();
    rows.forEach((r) => {
      Object.keys(r).forEach((k) => cols.add(k));
    });
    return Array.from(cols).sort((a, b) => {
      const order = ['_id', 'form_name', 'form_slug', 'created_at', 'status', 'source_page_slug', 'error_message'];
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [rows]);

  const forms = useMemo(() => {
    const m = new Set(rows.map((r) => r.form_slug || '').filter(Boolean));
    return Array.from(m).sort();
  }, [rows]);

  const pages = useMemo(() => {
    const m = new Set(rows.map((r) => r.source_page_slug || '').filter(Boolean));
    return Array.from(m).sort();
  }, [rows]);

  const statuses = useMemo(() => {
    const m = new Set(rows.map((r) => r.status || '').filter(Boolean));
    return Array.from(m).sort();
  }, [rows]);

  const filtered = useMemo<RowRecord[]>(() => {
    let result = rows;

    if (query) {
      const q = query.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((v) =>
          typeof v === 'string' && v.toLowerCase().includes(q)
        )
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }

    if (pageFilter !== 'all') {
      result = result.filter((r) => r.source_page_slug === pageFilter);
    }

    if (formFilter !== 'all') {
      result = result.filter((r) => r.form_slug === formFilter);
    }

    result.sort((a, b) => {
      const aVal = a[sortBy] ?? '';
      const bVal = b[sortBy] ?? '';
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [rows, query, statusFilter, pageFilter, formFilter, sortBy, sortDir]);

  function handleExportCsv() {
    if (filtered.length === 0) return;
    const cols = allColumns.filter((c) => !c.startsWith('_'));
    const csv = [
      cols.join(','),
      ...filtered.map((r) =>
        cols.map((c) => {
          const v = r[c] ?? '';
          const needsQuote = v.includes(',') || v.includes('"') || v.includes('\n');
          return needsQuote ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-submissions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="text-gray-400">Loading…</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  const displayCols = allColumns.filter((c) => !c.startsWith('_'));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Form Submissions</h1>
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-white border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Search all fields…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={formFilter}
            onChange={(e) => setFormFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All forms</option>
            {forms.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={pageFilter}
            onChange={(e) => setPageFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All pages</option>
            {pages.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="text-sm text-gray-500 flex items-center">
            {filtered.length} of {rows.length} submissions
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No submissions yet.</p>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  {displayCols.map((col) => (
                    <th
                      key={col}
                      onClick={() => {
                        if (sortBy === col) {
                          setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortBy(col);
                          setSortDir('asc');
                        }
                      }}
                      className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                    >
                      <div className="flex items-center gap-1">
                        {col}
                        {sortBy === col && (
                          <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((row) => (
                  <tr key={row._id} className="hover:bg-gray-50">
                    {displayCols.map((col) => (
                      <td key={col} className="px-4 py-3 text-sm max-w-xs truncate">
                        {row[col] || ''}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setRawOpenId(rawOpenId === row._id ? null : row._id)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {rawOpenId === row._id ? 'Hide' : 'View'} JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rawOpenId && (
        <div className="bg-gray-900 text-gray-100 border rounded-xl p-4">
          <button
            onClick={() => setRawOpenId(null)}
            className="mb-2 text-xs text-gray-400 hover:text-white"
          >
            ✕ Close
          </button>
          <pre className="overflow-x-auto text-xs font-mono max-h-96">
            {filtered.find((r) => r._id === rawOpenId)?._raw &&
              JSON.stringify(
                JSON.parse(filtered.find((r) => r._id === rawOpenId)?._raw || '{}'),
                null,
                2
              )}
          </pre>
        </div>
      )}
    </div>
  );
}
