import { useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { readBundle, rewriteForImport, type ParsedBundle } from '../lib/bundle';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentProjectId: string | null;
  // Called after a successful import. Receives the destination project id —
  // either the same as currentProjectId (replace) or a new id (create).
  onImported: (projectId: string) => void;
}

interface UploadProgress {
  phase: 'parsing' | 'uploading-media' | 'finalizing';
  current: number;
  total: number;
  label: string;
}

function inferMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    default: return 'application/octet-stream';
  }
}

export default function ImportBundleModal({ isOpen, onClose, currentProjectId, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedBundle | null>(null);
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [mode, setMode] = useState<'create' | 'replace'>('create');
  const [targetId, setTargetId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    api.listProjects().then(setProjects).catch(() => { /* ignore */ });
    if (currentProjectId) {
      setTargetId(currentProjectId);
    }
  }, [isOpen, currentProjectId]);

  function reset() {
    setFile(null);
    setParsed(null);
    setParseError('');
    setError('');
    setProgress(null);
  }

  async function handleFile(f: File) {
    reset();
    setFile(f);
    setParsing(true);
    try {
      const p = await readBundle(f);
      setParsed(p);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    if (mode === 'replace' && !targetId) {
      setError('Pick a target project to replace');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const keyMap = new Map<string, string>();
      const mediaList = Array.from(parsed.media.entries());
      for (let i = 0; i < mediaList.length; i++) {
        const [oldKey, bytes] = mediaList[i];
        setProgress({
          phase: 'uploading-media',
          current: i,
          total: mediaList.length,
          label: `Uploading ${oldKey}`,
        });
        const blob = new Blob([bytes as unknown as BlobPart], { type: inferMime(oldKey) });
        const uploadFile = new File([blob], oldKey, { type: inferMime(oldKey) });
        const { key: newKey } = await api.uploadMedia(uploadFile);
        keyMap.set(oldKey, newKey);
      }

      setProgress({
        phase: 'finalizing',
        current: mediaList.length,
        total: mediaList.length,
        label: 'Saving project…',
      });

      const { project, elements } = rewriteForImport(parsed.project, parsed.elements, keyMap);
      const resp = await api.importBundle({
        manifest: parsed.manifest,
        project,
        steps: parsed.steps,
        elements,
        mode,
        target_project_id: mode === 'replace' ? targetId : undefined,
        idempotency_key: crypto.randomUUID(),
        label: mode === 'replace' ? `Imported bundle (${file?.name ?? 'unnamed'})` : undefined,
      });

      onImported(resp.project_id);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!isOpen) return null;

  const stats = parsed?.manifest.stats;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">Import bundle</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!parsed && (
            <div>
              <label className="block text-sm font-medium mb-1">Bundle file (.codeempty)</label>
              <input
                type="file"
                accept=".codeempty,application/zip"
                onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleFile(f); }}
                className="w-full text-sm"
              />
              {parsing && <p className="text-sm text-gray-500 mt-2">Parsing bundle…</p>}
              {parseError && (
                <p className="text-sm text-red-600 mt-2">Failed to read bundle: {parseError}</p>
              )}
            </div>
          )}

          {parsed && (
            <>
              <div className="bg-gray-50 border rounded p-3 text-sm space-y-1">
                <div><strong>{parsed.project.title}</strong> <span className="text-gray-400">/{parsed.project.slug}</span></div>
                {stats && (
                  <div className="text-xs text-gray-500">
                    {stats.step_count} steps · {stats.element_count} elements · {stats.media_count} media files
                  </div>
                )}
                <div className="text-xs text-gray-400">From {parsed.manifest.source_slug} on {parsed.manifest.exported_at.split('T')[0]}</div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Mode</h3>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />
                    <span>Create as a new project (slug auto-suffixed if it collides)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                    <span>Replace an existing project</span>
                  </label>
                </div>
              </div>

              {mode === 'replace' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Target project</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm"
                  >
                    <option value="">— Select —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.slug}){p.id === currentProjectId ? ' ← current' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Current state will be saved as a new version before replacement.
                  </p>
                </div>
              )}

              {progress && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900 flex items-center gap-3">
                  <span className="animate-spin inline-block">⟳</span>
                  <span className="flex-1">{progress.label}</span>
                  {progress.total > 0 && (
                    <span className="font-mono text-xs">{progress.current} / {progress.total}</span>
                  )}
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={() => { reset(); onClose(); }}
            disabled={busy}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {parsed && (
            <button
              onClick={handleImport}
              disabled={busy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
