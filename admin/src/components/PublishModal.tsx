import { useEffect, useState } from 'react';
import { api, type PublishDestination, type Project } from '../api';
import { rewriteForImport } from '../lib/bundle';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
}

interface PublishProgress {
  phase: 'connecting' | 'snapshotting' | 'fetching-data' | 'uploading-media' | 'finalizing';
  current: number;
  total: number;
  label: string;
}

interface RemoteSession {
  api_url: string;
  access_token: string;
  // Cached list of remote projects (for the replace target picker)
  remoteProjects: Project[];
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

export default function PublishModal({ isOpen, onClose, projectId, projectTitle }: Props) {
  const [destinations, setDestinations] = useState<PublishDestination[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState<'create' | 'replace'>('create');
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ project_id: string; slug: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    api.listDestinations().then(setDestinations).catch(() => { /* ignore */ });
    setSession(null);
    setDestinationId('');
    setMode('create');
    setTargetId('');
    setError('');
    setDone(null);
  }, [isOpen]);

  // Connect: fetch the destination bearer + remote project list. The list is
  // needed so the user can pick a replace target.
  async function connect(destId: string) {
    setConnecting(true);
    setError('');
    setSession(null);
    setTargetId('');
    try {
      const tok = await api.issueDestinationToken(destId);
      const listRes = await fetch(`${tok.api_url}/api/projects`, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      if (!listRes.ok) throw new Error(`Couldn't list remote projects: ${listRes.status}`);
      const remoteProjects = await listRes.json() as Project[];
      setSession({ api_url: tok.api_url, access_token: tok.access_token, remoteProjects });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function handlePublish() {
    if (!session) return;
    if (mode === 'replace' && !targetId) {
      setError('Pick a target project on the destination');
      return;
    }
    setBusy(true);
    setError('');
    setDone(null);
    const destName = destinations.find((d) => d.id === destinationId)?.name ?? 'destination';
    try {
      // Auto-snapshot the source project before pushing so the publish is reversible.
      setProgress({ phase: 'snapshotting', current: 0, total: 0, label: 'Snapshotting source…' });
      await api.createVersion(projectId, `Before publish to ${destName}`);

      setProgress({ phase: 'fetching-data', current: 0, total: 0, label: 'Reading project data…' });
      const data = await api.exportData(projectId);

      const keyMap = new Map<string, string>();
      for (let i = 0; i < data.media.length; i++) {
        const m = data.media[i];
        setProgress({
          phase: 'uploading-media',
          current: i,
          total: data.media.length,
          label: `Uploading ${m.key} → ${destName}`,
        });
        // Pull the file from source
        const srcRes = await fetch(m.url, { credentials: 'include' });
        if (!srcRes.ok) throw new Error(`Source fetch failed for ${m.key}: ${srcRes.status}`);
        const blob = await srcRes.blob();
        // Push to destination using the bearer
        const fd = new FormData();
        fd.append('file', new File([blob], m.key, { type: inferMime(m.key) }));
        const destRes = await fetch(`${session.api_url}/api/media/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        });
        if (!destRes.ok) {
          const text = await destRes.text();
          throw new Error(`Destination upload failed for ${m.key}: ${destRes.status} ${text.slice(0, 200)}`);
        }
        const { key: newKey } = await destRes.json() as { key: string; url: string };
        keyMap.set(m.key, newKey);
      }

      setProgress({
        phase: 'finalizing',
        current: data.media.length,
        total: data.media.length,
        label: 'Saving project on destination…',
      });
      const { project, elements } = rewriteForImport(data.project, data.elements, keyMap);
      const importRes = await fetch(`${session.api_url}/api/projects/import`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manifest: data.manifest,
          project,
          steps: data.steps,
          elements,
          mode,
          target_project_id: mode === 'replace' ? targetId : undefined,
          idempotency_key: crypto.randomUUID(),
          label: `Published from ${data.project.slug}`,
        }),
      });
      if (!importRes.ok) {
        const text = await importRes.text();
        throw new Error(`Destination import failed: ${importRes.status} ${text.slice(0, 200)}`);
      }
      const result = await importRes.json() as { project_id: string; slug: string };
      setDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!isOpen) return null;

  const dest = destinations.find((d) => d.id === destinationId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">🚀 Publish "{projectTitle}"</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Destination</label>
            {destinations.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No destinations configured. Add one under <strong>Destinations</strong> first.
              </p>
            ) : (
              <div className="flex gap-2">
                <select
                  value={destinationId}
                  onChange={(e) => { setDestinationId(e.target.value); setSession(null); }}
                  className="flex-1 border rounded px-3 py-1.5 text-sm"
                >
                  <option value="">— Select —</option>
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.api_url})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => destinationId && connect(destinationId)}
                  disabled={!destinationId || connecting || busy}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
                >
                  {connecting ? 'Connecting…' : session ? '✓ Connected' : 'Connect'}
                </button>
              </div>
            )}
          </div>

          {session && (
            <>
              <div className="bg-gray-50 border rounded p-3 text-sm space-y-1">
                <div>Connected to <strong>{dest?.name}</strong></div>
                <div className="text-xs text-gray-500">{session.remoteProjects.length} projects on this destination</div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Mode</h3>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />
                    <span>Create as a new project on the destination</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                    <span>Replace an existing project</span>
                  </label>
                </div>
              </div>

              {mode === 'replace' && (
                <div>
                  <label className="block text-sm font-medium mb-1">Target project on destination</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-sm"
                  >
                    <option value="">— Select —</option>
                    {session.remoteProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title} ({p.slug})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    The destination will save its current state as a version before replacing.
                  </p>
                </div>
              )}
            </>
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

          {done && (
            <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900">
              ✓ Published. Destination project: <strong>{done.slug}</strong>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          {session && !done && (
            <button
              onClick={handlePublish}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
