import { useMemo, useState } from 'react';
import { api, type ProjectStep, type ContentElement } from '../api';

function parseTagsString(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

interface BulkTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
  projectId: string;
  steps: ProjectStep[];
  stepContent: Record<string, ContentElement[]>;
}

export default function BulkTagModal({ isOpen, onClose, onApplied, projectId, steps, stepContent }: BulkTagModalProps) {
  const [scope, setScope] = useState<'steps' | 'elements'>('steps');
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [includeUntagged, setIncludeUntagged] = useState(true); // bulk-tag commonly seeds untagged items
  const [action, setAction] = useState<'add' | 'remove'>('add');
  const [applyTags, setApplyTags] = useState('step:major');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { stepTags, elementTags, stepsTotal, elementsTotal } = useMemo(() => {
    const stepCounts = new Map<string, number>();
    const elCounts = new Map<string, number>();
    let stepsTotal = 0;
    let elementsTotal = 0;
    for (const s of steps) {
      stepsTotal++;
      for (const t of parseTagsString(s.tags)) stepCounts.set(t, (stepCounts.get(t) ?? 0) + 1);
    }
    for (const s of steps) {
      const els = stepContent[s.id] ?? [];
      for (const e of els) {
        elementsTotal++;
        for (const t of parseTagsString(e.tags)) elCounts.set(t, (elCounts.get(t) ?? 0) + 1);
      }
    }
    return {
      stepTags: Array.from(stepCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      elementTags: Array.from(elCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      stepsTotal,
      elementsTotal,
    };
  }, [steps, stepContent]);

  const activeTagList = scope === 'steps' ? stepTags : elementTags;

  const matchesFilter = (tags: string[]) => {
    const ft = Array.from(filterTags);
    if (tags.length === 0) return includeUntagged || ft.length === 0;
    if (ft.length === 0) return true;
    return tags.some((t) => ft.includes(t));
  };

  const previewCount = (() => {
    let n = 0;
    if (scope === 'steps') {
      for (const s of steps) if (matchesFilter(parseTagsString(s.tags))) n++;
    } else {
      for (const s of steps) {
        const els = stepContent[s.id] ?? [];
        for (const e of els) if (matchesFilter(parseTagsString(e.tags))) n++;
      }
    }
    return n;
  })();

  function toggleFilterTag(t: string) {
    setFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function handleApply() {
    setBusy(true);
    setError('');
    try {
      await api.bulkTag(projectId, {
        scope,
        tags: Array.from(filterTags),
        includeUntagged,
        action,
        applyTags,
      });
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">Bulk tag</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="text-sm text-gray-600">
            Apply or remove tags on every {scope} that matches the filter below. Use a namespaced
            tag like <code className="font-mono bg-gray-100 px-1 rounded">step:Major</code> or
            <code className="font-mono bg-gray-100 px-1 rounded mx-1">element:Detail</code> to
            create a filter group on the public page.
          </p>

          <div>
            <h3 className="text-sm font-semibold mb-2">Scope</h3>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={scope === 'steps'}
                  onChange={() => { setScope('steps'); setFilterTags(new Set()); }}
                />
                <span>Steps ({stepsTotal} total)</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={scope === 'elements'}
                  onChange={() => { setScope('elements'); setFilterTags(new Set()); }}
                />
                <span>Elements ({elementsTotal} total)</span>
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Filter (which {scope} to touch)</h3>
            {activeTagList.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No tags on {scope} yet — selecting nothing matches every {scope.slice(0, -1)}.
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2 bg-gray-50">
                {activeTagList.map(([tag, count]) => (
                  <label key={tag} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white px-2 py-1 rounded">
                    <input
                      type="checkbox"
                      checked={filterTags.has(tag)}
                      onChange={() => toggleFilterTag(tag)}
                      className="w-4 h-4"
                    />
                    <span className="font-mono text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded text-xs">{tag}</span>
                    <span className="text-gray-500 text-xs">({count})</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">No filter tags selected = match every {scope.slice(0, -1)}.</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeUntagged}
              onChange={(e) => setIncludeUntagged(e.currentTarget.checked)}
              className="w-4 h-4"
            />
            <span>Include untagged items</span>
          </label>

          <div>
            <h3 className="text-sm font-semibold mb-2">Action</h3>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={action === 'add'} onChange={() => setAction('add')} />
                <span>Add tags</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={action === 'remove'} onChange={() => setAction('remove')} />
                <span>Remove tags</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Tags to {action}</label>
            <input
              value={applyTags}
              onChange={(e) => setApplyTags(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm font-mono"
              placeholder="step:major, important"
            />
            <p className="text-xs text-gray-500 mt-1">
              Comma-separate for multiple. Convention: <code>step:&lt;value&gt;</code> on steps and{' '}
              <code>element:&lt;value&gt;</code> on elements drives the public-page filter UI.
            </p>
          </div>

          <div className="text-sm rounded px-3 py-2 bg-blue-50 border border-blue-200 text-blue-900">
            Will {action === 'add' ? 'add tags to' : 'remove tags from'}{' '}
            <strong>{previewCount}</strong> matching {scope === 'steps' ? 'step' : 'element'}{previewCount === 1 ? '' : 's'}.
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={busy || previewCount === 0 || !applyTags.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Applying…' : action === 'add' ? 'Add tags' : 'Remove tags'}
          </button>
        </div>
      </div>
    </div>
  );
}
