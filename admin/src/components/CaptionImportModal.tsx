import { useMemo, useRef, useState } from 'react';
import { parseCaption, type ParsedCaption } from '../caption-parsers';

interface CaptionWithType extends ParsedCaption {
  type: 'step' | 'element';
  index: number;
  selected: boolean;
}

function formatTimestamp(ms: number) {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(1);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
}

interface CaptionImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (
    captions: Array<{ text: string; timestampMs: number; type: 'step' | 'element' }>,
    defaultTags?: string,
  ) => Promise<void>;
}

export default function CaptionImportModal({ isOpen, onClose, onImport }: CaptionImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<CaptionWithType[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [defaultTags, setDefaultTags] = useState('youtube');

  const handleFileSelect = async (file: File) => {
    setError('');
    setParsed([]);
    setFileName(file.name);
    setLoading(true);

    try {
      const text = await file.text();
      const rawCaptions = parseCaption(text, file.name);

      if (rawCaptions.length === 0) {
        throw new Error('No captions found in file');
      }

      // Sort by timestamp before assigning step/element types so that captions from
      // multiple CapCut text tracks merge into a single chronological sequence.
      // The modal still displays them grouped by source track via groupId.
      const captions = [...rawCaptions].sort((a, b) => a.timestampMs - b.timestampMs);

      // Auto-detect steps: captions starting with "<num>[letter].", e.g. "23.", "24a.".
      // Track the highest step number so a sub-sequence like 22, 1, 2, 3, 23 treats
      // the 1/2/3 as bullets (elements) and resumes step numbering at 23.
      // Equal number with a letter suffix (24 → 24a → 24b) still counts as a step.
      const stepRegex = /^\s*(\d+)([a-z]?)\./;
      let highestStepNum = -1;

      const captionTypes = captions.map((cap, idx) => {
        const match = cap.text.match(stepRegex);
        let type: 'step' | 'element' = 'element';

        if (idx === 0) {
          // First caption defaults to a step so a no-numbered file still imports cleanly
          type = 'step';
          if (match) highestStepNum = parseInt(match[1], 10);
        } else if (match) {
          const num = parseInt(match[1], 10);
          const letter = match[2];
          if (num > highestStepNum || (num === highestStepNum && letter !== '')) {
            type = 'step';
            highestStepNum = num;
          }
        }

        return {
          ...cap,
          type,
          index: idx,
          selected: true,
        };
      });

      setParsed(captionTypes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setParsed([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleType = (index: number) => {
    setParsed((prev) =>
      prev.map((cap) =>
        cap.index === index ? { ...cap, type: cap.type === 'step' ? 'element' : 'step' } : cap,
      ),
    );
  };

  const handleToggleSelect = (index: number) => {
    setParsed((prev) =>
      prev.map((cap) => (cap.index === index ? { ...cap, selected: !cap.selected } : cap)),
    );
  };

  const handleSetGroupSelection = (groupId: string, selected: boolean) => {
    setParsed((prev) =>
      prev.map((cap) => (cap.groupId === groupId ? { ...cap, selected } : cap)),
    );
  };

  // Group the parsed captions for rendering. Order preserves the parser's emission
  // order (per-track for CapCut, single bucket for SRT/VTT).
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { groupId: string; groupLabel: string; items: CaptionWithType[] }>();
    for (const cap of parsed) {
      if (!map.has(cap.groupId)) {
        order.push(cap.groupId);
        map.set(cap.groupId, { groupId: cap.groupId, groupLabel: cap.groupLabel, items: [] });
      }
      map.get(cap.groupId)!.items.push(cap);
    }
    return order.map((id) => map.get(id)!);
  }, [parsed]);

  const selectedItems = parsed.filter((c) => c.selected);
  const selectedSteps = selectedItems.filter((c) => c.type === 'step').length;
  const selectedElements = selectedItems.length - selectedSteps;

  const handleImport = async () => {
    if (selectedItems.length === 0) {
      setError('Select at least one caption to import');
      return;
    }

    if (selectedItems[0].type !== 'step') {
      setError('First selected caption must be marked as a step');
      return;
    }

    setImporting(true);
    try {
      await onImport(
        selectedItems.map((c) => ({ text: c.text, timestampMs: c.timestampMs, type: c.type })),
        defaultTags.trim() || undefined,
      );
      setParsed([]);
      setFileName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-bold">Import Captions</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {parsed.length === 0 ? (
            // File upload section
            <div>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition"
                onClick={() => fileInputRef.current?.click()}
              >
                <p className="text-gray-600 mb-2">📁 Drop file or click to select</p>
                <p className="text-sm text-gray-500">Supported: CapCut JSON (draft_content.json), SRT, VTT</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.srt,.vtt"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                className="hidden"
              />

              {fileName && (
                <div className="mt-4 p-4 bg-blue-50 rounded text-sm">
                  <p className="text-blue-900">
                    📄 {fileName} {loading && '(parsing...)'}
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-red-900">{error}</div>
              )}
            </div>
          ) : (
            // Preview section
            <div>
              <p className="mb-3 text-sm text-gray-600">
                Toggle each caption between <strong>Step</strong> (section header) and <strong>Element</strong>{' '}
                (content). Uncheck items to skip them. First selected caption must be a step.
              </p>

              <div className="mb-4 flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700 shrink-0">Tags:</label>
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono"
                  placeholder="comma-separated, applied to every imported item — e.g. youtube,intro"
                  value={defaultTags}
                  onChange={(e) => setDefaultTags(e.target.value)}
                />
              </div>

              <div className="space-y-5 max-h-[28rem] overflow-y-auto">
                {groups.map((g) => {
                  const groupSelectedCount = g.items.filter((c) => c.selected).length;
                  const allSelected = groupSelectedCount === g.items.length;
                  const noneSelected = groupSelectedCount === 0;
                  return (
                    <div key={g.groupId} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-3 px-3 py-2 bg-gray-100 border-b border-gray-200">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !allSelected && !noneSelected;
                          }}
                          onChange={(e) => handleSetGroupSelection(g.groupId, e.currentTarget.checked)}
                          className="w-4 h-4 cursor-pointer"
                          title={allSelected ? 'Deselect all in group' : 'Select all in group'}
                        />
                        <span className="text-sm font-semibold text-gray-700 flex-1 truncate">{g.groupLabel}</span>
                        <span className="text-xs text-gray-500 shrink-0">
                          {groupSelectedCount} / {g.items.length} selected
                        </span>
                      </div>
                      <div className="space-y-2 p-2">
                        {g.items.map((cap) => (
                          <div
                            key={cap.index}
                            className={`p-2 border rounded flex items-start gap-3 ${
                              !cap.selected
                                ? 'border-gray-200 bg-white opacity-50'
                                : cap.type === 'step'
                                ? 'border-blue-300 bg-blue-50'
                                : 'border-gray-200 bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={cap.selected}
                              onChange={() => handleToggleSelect(cap.index)}
                              className="w-4 h-4 mt-1 cursor-pointer shrink-0"
                              title={cap.selected ? 'Skip this caption' : 'Include this caption'}
                            />
                            <button
                              onClick={() => handleToggleType(cap.index)}
                              disabled={!cap.selected}
                              className={`px-3 py-1 rounded font-medium text-sm whitespace-nowrap flex-shrink-0 transition ${
                                cap.type === 'step'
                                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                                  : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                              } disabled:cursor-not-allowed`}
                            >
                              {cap.type === 'step' ? '📌 Step' : '📝 Element'}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 break-words">{cap.text}</p>
                              <p className="text-xs text-gray-500 mt-1">{formatTimestamp(cap.timestampMs)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-red-900">{error}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <div className="text-sm text-gray-600">
            {parsed.length > 0
              ? `${selectedSteps} steps, ${selectedElements} elements (${selectedItems.length} of ${parsed.length})`
              : ''}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (parsed.length === 0) {
                  onClose();
                } else {
                  setParsed([]);
                  setFileName('');
                  setError('');
                }
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              {parsed.length === 0 ? 'Close' : 'Clear'}
            </button>
            {parsed.length > 0 && (
              <button
                onClick={handleImport}
                disabled={importing || selectedItems.length === 0}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
