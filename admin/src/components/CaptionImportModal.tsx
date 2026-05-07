import { useState, useRef } from 'react';
import { parseCaption } from '../caption-parsers';

interface ParsedCaption {
  text: string;
  timestampMs: number;
}

interface CaptionWithType extends ParsedCaption {
  type: 'step' | 'element';
  index: number;
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
  onImport: (captions: CaptionWithType[]) => Promise<void>;
}

export default function CaptionImportModal({ isOpen, onClose, onImport }: CaptionImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<CaptionWithType[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);

  const handleFileSelect = async (file: File) => {
    setError('');
    setParsed([]);
    setFileName(file.name);
    setLoading(true);

    try {
      const text = await file.text();
      const captions = parseCaption(text, file.name);

      if (captions.length === 0) {
        throw new Error('No captions found in file');
      }

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
          // First caption is always a step
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

  const handleImport = async () => {
    if (parsed.length === 0) {
      setError('No captions to import');
      return;
    }

    // Validate: first caption must be a step
    if (parsed[0].type !== 'step') {
      setError('First caption must be marked as a step');
      return;
    }

    setImporting(true);
    try {
      await onImport(parsed);
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
              <p className="mb-4 text-sm text-gray-600">
                Mark each caption as <strong>Step</strong> (topic/section header) or <strong>Element</strong> (content
                details). First item must be a step.
              </p>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {parsed.map((cap) => (
                  <div
                    key={cap.index}
                    className={`p-3 border rounded flex items-start gap-3 ${
                      cap.type === 'step' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <button
                      onClick={() => handleToggleType(cap.index)}
                      disabled={cap.index === 0}
                      className={`px-3 py-1 rounded font-medium text-sm whitespace-nowrap flex-shrink-0 transition ${
                        cap.type === 'step'
                          ? 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-100'
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                      }`}
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
              ? `${parsed.filter((c) => c.type === 'step').length} steps, ${parsed.filter((c) => c.type === 'element').length} elements`
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
                disabled={importing}
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
