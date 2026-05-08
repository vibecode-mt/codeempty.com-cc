import { useEffect, useState } from 'react';
import { api, type ProjectVersionSummary } from '../api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  // Called after a successful restore so the parent can refresh its state.
  onRestored: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const dt = Date.now() - t;
  if (dt < 60_000) return 'just now';
  if (dt < 3600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86400_000) return `${Math.floor(dt / 3600_000)}h ago`;
  return `${Math.floor(dt / 86400_000)}d ago`;
}

const SOURCE_LABEL: Record<ProjectVersionSummary['source'], string> = {
  manual: '👤 manual',
  publish: '🚀 publish',
  'import-replace': '📥 import',
};

export default function VersionsModal({ isOpen, onClose, projectId, onRestored }: Props) {
  const [versions, setVersions] = useState<ProjectVersionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');

  async function refresh() {
    setError('');
    try {
      const v = await api.listVersions(projectId);
      setVersions(v);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (isOpen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  async function handleSnapshot() {
    setBusy(true);
    setError('');
    try {
      await api.createVersion(projectId, snapshotLabel.trim() || undefined);
      setSnapshotLabel('');
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(v: ProjectVersionSummary) {
    if (!confirm(`Restore v${v.version_num}? Current state will be saved as a new version first.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.restoreVersion(projectId, v.id);
      await refresh();
      onRestored();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(v: ProjectVersionSummary) {
    if (!confirm(`Delete v${v.version_num}? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteVersion(projectId, v.id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">Versions</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex gap-2">
            <input
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              placeholder="Optional label for this snapshot"
              className="flex-1 border rounded px-3 py-1.5 text-sm"
            />
            <button
              onClick={handleSnapshot}
              disabled={busy}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              💾 Save snapshot
            </button>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">{error}</div>}

          {!versions ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No snapshots yet. Click "Save snapshot" to capture the current state.
            </p>
          ) : (
            <div className="border rounded divide-y">
              {versions.map((v) => (
                <div key={v.id} className="flex items-start gap-3 p-3">
                  <div className="font-mono text-sm font-semibold text-gray-700 shrink-0 w-12">v{v.version_num}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{v.label || <span className="text-gray-400 italic">no label</span>}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                      <span>{SOURCE_LABEL[v.source]}</span>
                      <span>{formatRelative(v.created_at)}</span>
                      <span>{formatBytes(v.size_bytes)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleRestore(v)}
                      disabled={busy}
                      className="px-2 py-1 text-xs border rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      title="Replace current state with this snapshot (current state will also be snapshotted)"
                    >
                      ↺ Restore
                    </button>
                    <button
                      onClick={() => handleDelete(v)}
                      disabled={busy}
                      className="px-2 py-1 text-xs border rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
