import { useMemo, useState } from 'react';
import { api, type ProjectStep, type ContentElement } from '../api';

function parseTagsString(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

interface ExportSrtModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  steps: ProjectStep[];
  stepContent: Record<string, ContentElement[]>;
}

export default function ExportSrtModal({ isOpen, onClose, projectId, steps, stepContent }: ExportSrtModalProps) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [includeSteps, setIncludeSteps] = useState(true);
  const [includeAllTypes, setIncludeAllTypes] = useState(false);

  // Derive the universe of tags from the loaded project content. Only "description"
  // and "title" elements are eligible for SRT, but tags from any item are exposed —
  // we don't want to lie to the user by hiding tags they may have applied elsewhere.
  const { allTags, untaggedCount, taggedCount, eligibleTotal } = useMemo(() => {
    const tagCounts = new Map<string, number>();
    let untagged = 0;
    let tagged = 0;
    let eligible = 0;

    for (const step of steps) {
      if (step.video_timestamp_ms == null) continue;
      eligible++;
      const tags = parseTagsString(step.tags);
      if (tags.length === 0) untagged++;
      else {
        tagged++;
        for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }

    for (const step of steps) {
      const els = stepContent[step.id] ?? [];
      for (const el of els) {
        if (el.video_timestamp_ms == null) continue;
        if (!includeAllTypes && el.type !== 'description' && el.type !== 'title') continue;
        eligible++;
        const tags = parseTagsString(el.tags);
        if (tags.length === 0) untagged++;
        else {
          tagged++;
          for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        }
      }
    }

    return {
      allTags: Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      untaggedCount: untagged,
      taggedCount: tagged,
      eligibleTotal: eligible,
    };
  }, [steps, stepContent, includeAllTypes]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function selectAll() {
    setSelectedTags(new Set(allTags.map(([t]) => t)));
  }

  function clearAll() {
    setSelectedTags(new Set());
  }

  function handleDownload() {
    const url = api.exportSrtUrl(projectId, {
      tags: Array.from(selectedTags),
      includeUntagged,
      includeSteps,
      includeAllTypes,
    });
    // Same-origin GET — browser sends the session cookie. Trigger via anchor so
    // the response Content-Disposition header drives the file save.
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!isOpen) return null;

  // Preview count of items that will be exported
  const previewCount = (() => {
    let n = 0;
    const counts = (tags: string[]) => {
      if (tags.length === 0) return includeUntagged || selectedTags.size === 0;
      if (selectedTags.size === 0) return true;
      return tags.some((t) => selectedTags.has(t));
    };
    if (includeSteps) {
      for (const s of steps) {
        if (s.video_timestamp_ms == null) continue;
        if (counts(parseTagsString(s.tags))) n++;
      }
    }
    for (const s of steps) {
      const els = stepContent[s.id] ?? [];
      for (const el of els) {
        if (el.video_timestamp_ms == null) continue;
        if (!includeAllTypes && el.type !== 'description' && el.type !== 'title') continue;
        if (counts(parseTagsString(el.tags))) n++;
      }
    }
    return n;
  })();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">Export SRT</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="text-sm text-gray-600">
            Export step titles and description/title elements with timestamps as an SRT file for YouTube.
            {' '}Items without a video timestamp are skipped.
          </p>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSteps}
                onChange={(e) => setIncludeSteps(e.currentTarget.checked)}
                className="w-4 h-4"
              />
              <span>Include step titles</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeAllTypes}
                onChange={(e) => setIncludeAllTypes(e.currentTarget.checked)}
                className="w-4 h-4"
              />
              <span>
                Include all element types
                <span className="text-gray-500 text-xs ml-1">(default: description &amp; title only)</span>
              </span>
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Filter by tags</h3>
              {allTags.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button onClick={selectAll} className="text-blue-600 hover:underline">All</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={clearAll} className="text-blue-600 hover:underline">None</button>
                </div>
              )}
            </div>

            {allTags.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No tags on this project — all eligible items will be exported.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded p-2 bg-gray-50">
                {allTags.map(([tag, count]) => (
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

            <p className="text-xs text-gray-500 mt-1">
              No tags selected = export every eligible item. Pick tags to filter; untagged items are excluded
              unless "Include untagged" is checked.
            </p>
          </div>

          {untaggedCount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeUntagged}
                onChange={(e) => setIncludeUntagged(e.currentTarget.checked)}
                className="w-4 h-4"
              />
              <span>
                Include untagged items <span className="text-gray-500">({untaggedCount} untagged, {taggedCount} tagged)</span>
              </span>
            </label>
          )}

          <div className="text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
            <strong>{previewCount}</strong> of {eligibleTotal} eligible items will be exported.
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={previewCount === 0}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            Download .srt
          </button>
        </div>
      </div>
    </div>
  );
}
