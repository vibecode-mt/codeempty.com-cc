import { useState } from 'react';
import { api, type ProjectStep, type ContentElement } from '../api';
import HtmlEditor from './HtmlEditor';

const TYPES = ['image', 'title', 'description', 'youtube', 'url', 'prompt_code'];

function formatTimestamp(ms: number) {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const msRem = ms % 1000;
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
}

interface Props {
  projectId: string;
  screenshotUrl: string;
  timestampMs: number;
  existingSteps: ProjectStep[];
  onSaved: (step: ProjectStep, element: ContentElement) => void;
  onClose: () => void;
}

export default function CaptureModal({ projectId, screenshotUrl, timestampMs, existingSteps, onSaved, onClose }: Props) {
  const [target, setTarget] = useState<'new' | 'existing'>('new');
  const [newStepTitle, setNewStepTitle] = useState('');
  const [existingStepId, setExistingStepId] = useState(existingSteps[0]?.id ?? '');
  const [elementType, setElementType] = useState('image');
  const [caption, setCaption] = useState('');
  const [content, setContent] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      let step: ProjectStep;

      if (target === 'new') {
        if (!newStepTitle.trim()) throw new Error('Step title is required');
        step = await api.createStep(projectId, {
          title: newStepTitle.trim(),
          video_timestamp_ms: timestampMs,
        });
      } else {
        const found = existingSteps.find((s) => s.id === existingStepId);
        if (!found) throw new Error('Step not found');
        step = found;
      }

      let elementContent: string;
      if (elementType === 'image') {
        elementContent = JSON.stringify({ url: screenshotUrl, caption: caption || undefined });
      } else if (elementType === 'url') {
        elementContent = JSON.stringify({ href: content, label: urlLabel || content });
      } else {
        elementContent = content;
      }

      const element = await api.createContent('project_step', step.id, {
        type: elementType,
        content: elementContent,
        video_timestamp_ms: timestampMs,
      });

      onSaved(step, element);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">Add from video</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{formatTimestamp(timestampMs)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Screenshot preview */}
          <img
            src={screenshotUrl}
            alt="Captured frame"
            className="w-full rounded-lg border bg-gray-50 object-contain max-h-48"
          />

          {/* Target step */}
          <div>
            <label className="block text-sm font-medium mb-2">Add to</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} />
                New step
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={target === 'existing'} onChange={() => setTarget('existing')} disabled={existingSteps.length === 0} />
                Existing step
              </label>
            </div>
          </div>

          {target === 'new' ? (
            <div>
              <label className="block text-sm font-medium mb-1">Step title *</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Step title"
                value={newStepTitle}
                onChange={(e) => setNewStepTitle(e.target.value)}
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">Step</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={existingStepId}
                onChange={(e) => setExistingStepId(e.target.value)}
              >
                {existingSteps.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          )}

          {/* Element type */}
          <div>
            <label className="block text-sm font-medium mb-1">Element type</label>
            <select
              className="border rounded px-2 py-1.5 text-sm"
              value={elementType}
              onChange={(e) => { setElementType(e.target.value); setContent(''); }}
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Element content */}
          {elementType === 'image' ? (
            <div>
              <label className="block text-sm font-medium mb-1">Caption <span className="font-normal text-gray-400">(optional)</span></label>
              <HtmlEditor value={caption} onChange={setCaption} />
            </div>
          ) : elementType === 'description' ? (
            <div>
              <label className="block text-sm font-medium mb-1">Content</label>
              <HtmlEditor value={content} onChange={setContent} />
            </div>
          ) : elementType === 'url' ? (
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-1.5 text-sm" placeholder="URL (https://...)" value={content} onChange={(e) => setContent(e.target.value)} />
              <input className="w-full border rounded px-3 py-1.5 text-sm" placeholder="Label (optional)" value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">Content</label>
              <textarea
                className="w-full border rounded px-3 py-1.5 text-sm resize-y font-mono"
                rows={3}
                placeholder={elementType === 'youtube' ? 'YouTube URL or video ID' : elementType === 'title' ? 'Heading text' : 'Content'}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <div className="p-5 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
