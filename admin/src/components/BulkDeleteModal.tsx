import { useMemo, useState } from 'react';
import { api, type ProjectStep, type ContentElement } from '../api';

function parseTagsString(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

interface BulkDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
  projectId: string;
  steps: ProjectStep[];
  stepContent: Record<string, ContentElement[]>;
}

export default function BulkDeleteModal({ isOpen, onClose, onDeleted, projectId, steps, stepContent }: BulkDeleteModalProps) {
  const [scope, setScope] = useState<'steps' | 'elements'>('elements');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const { stepTags, elementTags, stepsTotal, elementsTotal } = useMemo(() => {
    const stepTagCounts = new Map<string, number>();
    const elementTagCounts = new Map<string, number>();
    let stepsTotal = 0;
    let elementsTotal = 0;

    for (const s of steps) {
      stepsTotal++;
      for (const t of parseTagsString(s.tags)) stepTagCounts.set(t, (stepTagCounts.get(t) ?? 0) + 1);
    }
    for (const s of steps) {
      const els = stepContent[s.id] ?? [];
      for (const e of els) {
        elementsTotal++;
        for (const t of parseTagsString(e.tags)) elementTagCounts.set(t, (elementTagCounts.get(t) ?? 0) + 1);
      }
    }
    return {
      stepTags: Array.from(stepTagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      elementTags: Array.from(elementTagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      stepsTotal,
      elementsTotal,
    };
  }, [steps, stepContent]);

  const activeTagList = scope === 'steps' ? stepTags : elementTags;

  const matchesFilter = (tags: string[]) => {
    const filterTags = Array.from(selectedTags);
    if (tags.length === 0) return includeUntagged || filterTags.length === 0;
    if (filterTags.length === 0) return true;
    return tags.some((t) => filterTags.includes(t));
  };

  const previewCount = (() => {
    let n = 0;
    if (scope === 'steps') {
      for (const s of steps) {
        if (matchesFilter(parseTagsString(s.tags))) n++;
      }
    } else {
      for (const s of steps) {
        const els = stepContent[s.id] ?? [];
        for (const e of els) {
          if (matchesFilter(parseTagsString(e.tags))) n++;
        }
      }
    }
    return n;
  })();

  // Estimate cascading deletion: deleting a step also deletes its elements
  const previewElementsCascaded = (() => {
    if (scope !== 'steps') return 0;
    let n = 0;
    for (const s of steps) {
      if (matchesFilter(parseTagsString(s.tags))) {
        n += (stepContent[s.id] ?? []).length;
      }
    }
    return n;
  })();

  const requireConfirmation = previewCount > 0;
  const confirmOk = !requireConfirmation || confirm.trim().toUpperCase() === 'DELETE';

  function toggleTag(t: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function reset() {
    setSelectedTags(new Set());
    setIncludeUntagged(false);
    setConfirm('');
    setError('');
  }

  async function handleDelete() {
    if (!confirmOk) return;
    setDeleting(true);
    setError('');
    try {
      await api.bulkDelete(projectId, {
        scope,
        tags: Array.from(selectedTags),
        includeUntagged,
      });
      reset();
      onDeleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold text-red-600">Bulk delete</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold mb-2">Scope</h3>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={scope === 'elements'}
                  onChange={() => { setScope('elements'); setSelectedTags(new Set()); }}
                />
                <span>Elements only ({elementsTotal} total)</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={scope === 'steps'}
                  onChange={() => { setScope('steps'); setSelectedTags(new Set()); }}
                />
                <span>Steps and their elements ({stepsTotal} total)</span>
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Filter by tags</h3>
            {activeTagList.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No tags on {scope === 'steps' ? 'steps' : 'elements'} — selecting nothing will match everything.
              </p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto border rounded p-2 bg-gray-50">
                {activeTagList.map(([tag, count]) => (
                  <label key={tag} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white px-2 py-1 rounded">
                    <input
                      type="checkbox"
                      checked={selectedTags.has(tag)}
                      onChange={() => toggleTag(tag)}
                      className="w-4 h-4"
                    />
                    <span className="font-mono text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded text-xs">{tag}</span>
                    <span className="text-gray-500 text-xs">({count})</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">No tags selected = match every {scope === 'steps' ? 'step' : 'element'}.</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeUntagged}
              onChange={(e) => setIncludeUntagged(e.currentTarget.checked)}
              className="w-4 h-4"
            />
            <span>
              Include untagged items{selectedTags.size > 0 ? ' (in addition to tag matches)' : ''}
            </span>
          </label>

          <div className={`text-sm rounded px-3 py-2 ${previewCount > 0 ? 'bg-red-50 border border-red-200 text-red-900' : 'bg-gray-50 border border-gray-200 text-gray-700'}`}>
            {previewCount === 0 ? (
              <>Nothing matches — refine your filter.</>
            ) : scope === 'steps' ? (
              <>
                Will delete <strong>{previewCount}</strong> step{previewCount === 1 ? '' : 's'} and{' '}
                <strong>{previewElementsCascaded}</strong> nested element{previewElementsCascaded === 1 ? '' : 's'}.
              </>
            ) : (
              <>Will delete <strong>{previewCount}</strong> element{previewCount === 1 ? '' : 's'}.</>
            )}
          </div>

          {requireConfirmation && (
            <div>
              <label className="block text-sm mb-1">
                Type <span className="font-mono font-bold">DELETE</span> to confirm:
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                placeholder="DELETE"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">{error}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || !confirmOk || previewCount === 0}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
