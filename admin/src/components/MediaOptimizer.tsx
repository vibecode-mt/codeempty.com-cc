import { useRef, useState } from 'react';
import { api } from '../api';
import { compressImage } from '../lib/compress-image';

interface ImageItem {
  entityType: 'content_element' | 'project';
  entityId: string;
  url: string;
  rawContent?: string;
}

type ItemStatus = 'pending' | 'processing' | 'done' | 'skipped' | 'error';

interface ItemResult {
  item: ImageItem;
  status: ItemStatus;
  savedBytes: number;
  note?: string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Rebuild the content field for a content element with an updated image URL.
function rebuildContent(rawContent: string | undefined, newUrl: string): string {
  if (!rawContent) return newUrl;
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    if (typeof parsed.url === 'string') {
      return JSON.stringify({ ...parsed, url: newUrl });
    }
  } catch { /* plain URL */ }
  return newUrl;
}

// Extract the R2 key from a /api/media/<key> URL.
function extractKey(url: string): string {
  return url.replace(/^.*\/api\/media\//, '');
}

export default function MediaOptimizer() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ready' | 'optimizing' | 'done'>('idle');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [current, setCurrent] = useState(0);
  const [scanError, setScanError] = useState('');
  const cancelRef = useRef(false);

  async function handleScan() {
    setPhase('scanning');
    setScanError('');
    try {
      const list = await api.listMediaImages();
      setImages(list);
      setPhase('ready');
    } catch (e) {
      setScanError(String(e));
      setPhase('idle');
    }
  }

  async function handleOptimize() {
    setPhase('optimizing');
    cancelRef.current = false;
    setCurrent(0);
    setResults(images.map((item) => ({ item, status: 'pending', savedBytes: 0 })));

    for (let i = 0; i < images.length; i++) {
      if (cancelRef.current) break;

      setCurrent(i);
      setResults((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'processing' };
        return next;
      });

      const item = images[i];
      try {
        const res = await fetch(item.url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const originalBlob = await res.blob();

        if (!originalBlob.type.startsWith('image/')) {
          setResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: 'skipped', note: 'not an image' };
            return next;
          });
          continue;
        }

        const compressed = await compressImage(originalBlob, 1920, 0.85);

        // Skip if savings are negligible (< 10%)
        if (compressed.size >= originalBlob.size * 0.9) {
          setResults((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], status: 'skipped', note: 'already optimal' };
            return next;
          });
          continue;
        }

        const { url: newUrl } = await api.uploadMedia(compressed);

        if (item.entityType === 'content_element') {
          await api.updateContent(item.entityId, { content: rebuildContent(item.rawContent, newUrl) });
        } else {
          await api.updateProject(item.entityId, { image_url: newUrl });
        }

        // Best-effort delete of the old R2 object
        try { await api.deleteMedia(extractKey(item.url)); } catch { /* ignore */ }

        const savedBytes = originalBlob.size - compressed.size;
        setResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'done', savedBytes };
          return next;
        });
      } catch (e) {
        setResults((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'error', note: String(e) };
          return next;
        });
      }
    }

    setCurrent(images.length);
    setPhase('done');
  }

  const totalSaved = results.reduce((sum, r) => sum + r.savedBytes, 0);
  const doneCount = results.filter((r) => r.status === 'done').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const progressPct = images.length > 0
    ? Math.round(((phase === 'done' ? images.length : current) / images.length) * 100)
    : 0;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Image Optimisation</h2>
      <p className="text-sm text-gray-500 mb-4">
        Re-compress R2-hosted images to WebP to reduce page load times on mobile. Images are
        resized to at most 1920 px wide and re-encoded at 85 % quality. Existing DB references are
        updated in-place and old files are removed. New uploads are always compressed automatically.
      </p>

      {phase === 'idle' && (
        <button
          onClick={handleScan}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          Scan for images
        </button>
      )}

      {phase === 'scanning' && (
        <p className="text-sm text-gray-400">Scanning…</p>
      )}

      {phase === 'ready' && (
        <div className="space-y-3">
          <p className="text-sm">
            Found <strong>{images.length}</strong> R2-hosted image{images.length !== 1 ? 's' : ''}.
          </p>
          {images.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing to optimise.</p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleOptimize}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Optimise {images.length} image{images.length !== 1 ? 's' : ''}
              </button>
              <button
                onClick={() => { setPhase('idle'); setImages([]); }}
                className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {(phase === 'optimizing' || phase === 'done') && (
        <div className="space-y-3">
          <p className="text-sm">
            {phase === 'optimizing' ? (
              <>Processing {Math.min(current + 1, images.length)} / {images.length}…</>
            ) : (
              <>
                Done — {doneCount} optimised, {skippedCount} skipped
                {errorCount > 0 && <span className="text-red-500">, {errorCount} errors</span>}.
                {totalSaved > 0 && <strong> Saved {fmtBytes(totalSaved)}.</strong>}
              </>
            )}
          </p>

          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {results.length > 0 && (
            <div className="max-h-60 overflow-y-auto border rounded-lg divide-y text-xs font-mono">
              {results.slice(0, current + 1).map((r, idx) => (
                <div key={idx} className={`flex gap-2 px-3 py-1.5 ${r.status === 'error' ? 'text-red-600 bg-red-50' : r.status === 'skipped' ? 'text-gray-400' : r.status === 'done' ? 'text-green-700' : 'text-gray-500'}`}>
                  <span className="shrink-0">
                    {r.status === 'done' ? '✓' : r.status === 'error' ? '✗' : r.status === 'processing' ? '…' : '⊘'}
                  </span>
                  <span className="truncate flex-1">{r.item.url.split('/').pop()}</span>
                  {r.status === 'done' && <span className="shrink-0 text-green-600">−{fmtBytes(r.savedBytes)}</span>}
                  {r.note && <span className="shrink-0">{r.note}</span>}
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <button
              onClick={() => { setPhase('idle'); setImages([]); setResults([]); setScanError(''); }}
              className="px-3 py-1.5 border text-sm rounded-lg hover:bg-gray-50"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {scanError && <p className="text-red-500 text-sm mt-2">{scanError}</p>}
    </div>
  );
}
