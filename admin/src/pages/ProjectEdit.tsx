import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, type Project, type ProjectStep, type ContentElement } from '../api';
import ContentElementEditor from '../components/ContentElementEditor';
import ImageUpload from '../components/ImageUpload';
import HtmlEditor from '../components/HtmlEditor';
import VideoUpload from '../components/VideoUpload';
import VideoEditor from '../components/VideoEditor';
import VideoTimeline from '../components/VideoTimeline';
import CaptureModal from '../components/CaptureModal';
import CaptionImportModal from '../components/CaptionImportModal';
import ExportSrtModal from '../components/ExportSrtModal';
import BulkDeleteModal from '../components/BulkDeleteModal';
import TagsEditor from '../components/TagsEditor';

function formatTimestamp(ms: number) {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(1);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
}

export default function ProjectEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [form, setForm] = useState({ title: '', slug: '', description: '', image_url: '', sort_order: 0, published: 1 });
  const [steps, setSteps] = useState<ProjectStep[]>([]);
  const [stepContent, setStepContent] = useState<Record<string, ContentElement[]>>({});
  const [newStepTitle, setNewStepTitle] = useState('');
  const [projectId, setProjectId] = useState<string | null>(id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [stepError, setStepError] = useState('');

  // Video state
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [replacingVideo, setReplacingVideo] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const videoSeekRef = useRef<((seconds: number) => void) | null>(null);
  const videoCaptureRef = useRef<(() => Promise<{ url: string; timestampMs: number } | null>) | null>(null);
  const [captureData, setCaptureData] = useState<{ url: string; timestampMs: number } | null>(null);

  // Layout state
  const [metaOpen, setMetaOpen] = useState(isNew);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set());
  const [filteredStepId, setFilteredStepId] = useState<string | null>(null);
  const [stepSearch, setStepSearch] = useState('');

  // Drag state for steps
  const dragStep = useRef<number | null>(null);
  const [dragOverStep, setDragOverStep] = useState<number | null>(null);

  // Caption import + SRT export + bulk delete state
  const [showCaptionImport, setShowCaptionImport] = useState(false);
  const [showExportSrt, setShowExportSrt] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  useEffect(() => {
    if (id) {
      api.getProject(id).then((p) => {
        setForm({ title: p.title, slug: p.slug, description: p.description, image_url: p.image_url ?? '', sort_order: p.sort_order, published: p.published });
        setSteps(p.steps);
        setVideoKey(p.video_key ?? null);
      });
    }
  }, [id]);

  useEffect(() => {
    steps.forEach((s) => {
      if (!stepContent[s.id]) {
        api.listContent('project_step', s.id).then((els) => {
          setStepContent((prev) => ({ ...prev, [s.id]: els }));
        });
      }
    });
  }, [steps]);

  function toggleStep(stepId: string) {
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  function onFilterStep(stepId: string) {
    setFilteredStepId((prev) => {
      if (prev === stepId) return null; // toggle off
      setExpandedStepIds((s) => new Set([...s, stepId]));
      setStepSearch('');
      return stepId;
    });
  }

  function seekToMs(ms: number) {
    videoSeekRef.current?.(ms / 1000);
  }

  // Insert a freshly created element at the top of a step's element list.
  // The server places new elements at the end (MAX(sort_order)+1) so we follow
  // up with a reorder call to push this one to position 0.
  async function prependStepElement(stepId: string, newEl: ContentElement) {
    const existing = stepContent[stepId] ?? [];
    const next = [newEl, ...existing];
    setStepContent((prev) => ({ ...prev, [stepId]: next }));
    setExpandedStepIds((prev) => new Set([...prev, stepId]));
    const orders = next.map((e, i) => ({ id: e.id, sort_order: i }));
    await api.reorderContent(orders);
  }

  // Capture current video frame and create an image element under the given step.
  async function addFrameToStep(stepId: string) {
    if (!videoCaptureRef.current) return;
    const result = await videoCaptureRef.current();
    if (!result) return;
    const el = await api.createContent('project_step', stepId, {
      type: 'image',
      content: JSON.stringify({ url: result.url }),
      video_timestamp_ms: result.timestampMs,
    });
    await prependStepElement(stepId, el);
  }

  // Upload a chosen image file and create an image element under the given step.
  async function addUploadToStep(stepId: string, file: File) {
    const { url } = await api.uploadMedia(file);
    const el = await api.createContent('project_step', stepId, {
      type: 'image',
      content: JSON.stringify({ url }),
    });
    await prependStepElement(stepId, el);
  }

  async function toggleStepHidden(step: ProjectStep) {
    const updated = await api.updateStep(step.id, { hidden: step.hidden ? 0 : 1 });
    setSteps((prev) => prev.map((s) => (s.id === step.id ? updated : s)));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        const created = await api.createProject(form as Partial<Project>);
        setProjectId(created.id);
        navigate(`/projects/${created.id}`, { replace: true });
      } else {
        await api.updateProject(id!, form as Partial<Project>);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onVideoUploaded({ key, url }: { key: string; url: string }) {
    setVideoKey(key);
    setReplacingVideo(false);
    const pid = projectId ?? id;
    if (pid) {
      await api.updateProject(pid, { video_key: key, video_url: url });
    }
  }

  const handleCapture = useCallback((url: string, timestampMs: number) => {
    setCaptureData({ url, timestampMs });
  }, []);

  function onCaptureSaved(step: ProjectStep, element: ContentElement) {
    const pid = projectId ?? id;
    if (pid) {
      api.listSteps(pid).then(setSteps);
    }
    setStepContent((prev) => ({
      ...prev,
      [step.id]: [...(prev[step.id] ?? []), element],
    }));
    setExpandedStepIds((prev) => new Set([...prev, step.id]));
    setCaptureData(null);
  }

  async function addStep() {
    if (!projectId || !newStepTitle.trim()) return;
    setStepError('');
    try {
      const step = await api.createStep(projectId, { title: newStepTitle });
      setSteps((s) => [...s, step]);
      setExpandedStepIds((prev) => new Set([...prev, step.id]));
      setNewStepTitle('');
    } catch (e) {
      setStepError(String(e));
    }
  }

  async function deleteStep(stepId: string) {
    if (!confirm('Delete this step and all its content?')) return;
    await api.deleteStep(stepId);
    setSteps((s) => s.filter((x) => x.id !== stepId));
    if (filteredStepId === stepId) setFilteredStepId(null);
  }

  async function handleCaptionImport(
    captions: Array<{ text: string; timestampMs: number; type: 'step' | 'element'; tags?: string }>,
  ) {
    if (!projectId) {
      throw new Error('Project not found');
    }

    try {
      const result = await api.importCaptions(projectId, captions);
      // Refresh steps after import
      const updated = await api.getProject(projectId);
      setSteps(updated.steps);
      // Expand first newly imported step
      if (updated.steps.length > 0) {
        setExpandedStepIds((prev) => new Set([...prev, updated.steps[0].id]));
      }
      // Reload content for all steps
      for (const step of updated.steps) {
        const content = await api.listContent('project_step', step.id);
        setStepContent((prev) => ({ ...prev, [step.id]: content }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      throw e;
    }
  }

  // Drag-and-drop handlers for steps
  function onStepDragStart(e: React.DragEvent, index: number) {
    e.stopPropagation();
    dragStep.current = index;
  }

  function onStepDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverStep(index);
  }

  async function onStepDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    const fromIndex = dragStep.current;
    if (fromIndex === null || fromIndex === toIndex) {
      dragStep.current = null;
      setDragOverStep(null);
      return;
    }
    const next = [...steps];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const orders = next.map((s, i) => ({ id: s.id, sort_order: i }));
    setSteps(next);
    dragStep.current = null;
    setDragOverStep(null);
    await api.reorderSteps(orders);
  }

  const pid = projectId ?? id;

  const visibleSteps = steps.filter((s) => {
    if (filteredStepId && s.id !== filteredStepId) return false;
    if (stepSearch.trim() && !s.title.toLowerCase().includes(stepSearch.toLowerCase())) return false;
    return true;
  });

  // ── Video section JSX ──────────────────────────────────────────────────────
  const videoSection = (
    <div className="bg-white border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Video <span className="text-sm font-normal text-gray-400">— build steps from video frames</span>
        </h2>
        {videoKey && !replacingVideo && pid && (
          <button
            onClick={() => setReplacingVideo(true)}
            className="text-xs text-blue-600 hover:underline shrink-0"
          >
            Replace Video
          </button>
        )}
      </div>

      {!pid ? (
        <div className="border-2 border-dashed rounded-xl p-6 text-center text-gray-400">
          <div className="text-3xl mb-2">🎬</div>
          <p className="text-sm">Save the project above to enable video upload.</p>
          <p className="text-xs mt-1">You'll then be able to upload a video, pause at any point, capture a frame, and create steps from it.</p>
        </div>
      ) : !videoKey || replacingVideo ? (
        <>
          {replacingVideo && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Uploading a new video keeps your existing steps and elements. Use the Time-Shift tool after uploading to adjust timestamps if the video was edited.
            </p>
          )}
          <VideoUpload onUpload={onVideoUploaded} onError={(msg) => setError(msg)} />
          {replacingVideo && (
            <button onClick={() => setReplacingVideo(false)} className="text-xs text-gray-500 hover:underline">
              Cancel replace
            </button>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <VideoEditor
            videoKey={videoKey}
            onCapture={handleCapture}
            onTimeUpdate={setVideoCurrentTime}
            onDurationChange={setVideoDuration}
            seekRef={videoSeekRef}
            captureRef={videoCaptureRef}
          />
          <VideoTimeline
            projectId={pid}
            steps={steps}
            duration={videoDuration}
            currentTime={videoCurrentTime}
            onSeek={(s) => videoSeekRef.current?.(s)}
            onStepsChanged={setSteps}
            onFilterStep={onFilterStep}
            filteredStepId={filteredStepId}
          />
        </div>
      )}
    </div>
  );

  // ── Steps section JSX ──────────────────────────────────────────────────────
  const stepsSection = pid ? (
    <div className="space-y-3">
      {/* Steps header + search + filter status */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-base font-semibold">
            Steps <span className="text-sm font-normal text-gray-400">— drag ⠿ to reorder</span>
          </h2>
          {filteredStepId && (
            <button
              onClick={() => setFilteredStepId(null)}
              className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full hover:bg-orange-200 flex items-center gap-1"
            >
              {steps.find(s => s.id === filteredStepId)?.title ?? 'Filtered'}
              <span className="font-bold">×</span>
            </button>
          )}
          {steps.length > 3 && !filteredStepId && (
            <input
              className="ml-auto border rounded-lg px-2 py-1 text-xs w-44"
              placeholder="Search steps…"
              value={stepSearch}
              onChange={(e) => setStepSearch(e.target.value)}
            />
          )}
          {stepSearch && (
            <button onClick={() => setStepSearch('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
          )}
        </div>
        {visibleSteps.length === 0 && (steps.length > 0) && (
          <p className="text-sm text-gray-400">No steps match your search.</p>
        )}
      </div>

      {visibleSteps.map((step, i) => {
        const realIndex = steps.indexOf(step);
        const isExpanded = expandedStepIds.has(step.id);
        const elementCount = stepContent[step.id]?.length;
        return (
          <div
            key={step.id}
            draggable
            onDragStart={(e) => onStepDragStart(e, realIndex)}
            onDragOver={(e) => onStepDragOver(e, realIndex)}
            onDragLeave={() => setDragOverStep(null)}
            onDrop={(e) => onStepDrop(e, realIndex)}
            className={`bg-white border rounded-xl overflow-hidden transition-all ${dragOverStep === realIndex && dragStep.current !== realIndex ? 'border-blue-400 shadow-md' : ''} ${step.hidden ? 'opacity-50' : ''}`}
          >
            {/* Step header — click to expand/collapse */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border-b select-none hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => toggleStep(step.id)}
            >
              <span
                className="text-gray-300 mr-1 cursor-grab active:cursor-grabbing select-none"
                title="Drag to reorder"
                onClick={(e) => e.stopPropagation()}
              >
                ⠿
              </span>
              <span className="font-medium text-sm flex-1 truncate">{step.title}</span>
              {elementCount != null && (
                <span className="text-xs text-gray-400 shrink-0 hidden sm:block">
                  {elementCount} {elementCount === 1 ? 'element' : 'elements'}
                </span>
              )}
              {step.video_timestamp_ms != null && (
                <button
                  onClick={(e) => { e.stopPropagation(); seekToMs(step.video_timestamp_ms!); }}
                  className="text-xs font-mono bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded shrink-0 hover:bg-orange-200 cursor-pointer"
                  title="Jump video to this timestamp"
                >
                  ⏱ {formatTimestamp(step.video_timestamp_ms)}
                </button>
              )}
              <TagsEditor
                tags={step.tags}
                onChange={async (tags) => {
                  const updated = await api.updateStep(step.id, { tags });
                  setSteps((prev) => prev.map((s) => (s.id === step.id ? updated : s)));
                }}
                className="shrink-0"
              />
              {videoKey && (
                <button
                  onClick={(e) => { e.stopPropagation(); addFrameToStep(step.id); }}
                  className="text-xs text-blue-600 px-2 py-0.5 border rounded hover:bg-blue-50 shrink-0"
                  title="Capture current video frame as an image element"
                >
                  + frame
                </button>
              )}
              <label
                className="text-xs text-gray-600 px-2 py-0.5 border rounded hover:bg-gray-100 shrink-0 cursor-pointer"
                title="Upload an image file as an image element"
                onClick={(e) => e.stopPropagation()}
              >
                + upload
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) addUploadToStep(step.id, f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                onClick={(e) => { e.stopPropagation(); toggleStepHidden(step); }}
                className={`text-xs px-2 py-0.5 border rounded shrink-0 ${
                  step.hidden ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'text-gray-500 hover:bg-gray-100'
                }`}
                title={step.hidden ? 'Hidden — click to show' : 'Visible — click to hide on the public site'}
              >
                {step.hidden ? '🙈 hidden' : '👁'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteStep(step.id); }}
                className="text-xs text-red-500 px-2 py-0.5 border rounded hover:bg-red-50 shrink-0"
              >
                Delete
              </button>
              <span className="text-gray-400 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
            </div>

            {isExpanded && (
              <div className="p-4">
                <ContentElementEditor
                  parentType="project_step"
                  parentId={step.id}
                  elements={stepContent[step.id] ?? []}
                  onChange={(els) => setStepContent((prev) => ({ ...prev, [step.id]: els }))}
                  onSeek={seekToMs}
                  onCaptureFrame={videoKey ? () => videoCaptureRef.current?.() ?? Promise.resolve(null) : undefined}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            placeholder="New step title — press Enter or click Add step"
            value={newStepTitle}
            onChange={(e) => setNewStepTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStep()}
          />
          <button
            onClick={addStep}
            disabled={!newStepTitle.trim()}
            className="px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-40 shrink-0"
          >
            Add step
          </button>
          <button
            onClick={() => setShowCaptionImport(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 shrink-0"
            title="Import captions from CapCut JSON or SRT files"
          >
            📥 Import
          </button>
          <button
            onClick={() => setShowExportSrt(true)}
            disabled={steps.length === 0}
            className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export selected steps/elements as an SRT file for YouTube"
          >
            📤 Export SRT
          </button>
          <button
            onClick={() => setShowBulkDelete(true)}
            disabled={steps.length === 0}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Bulk delete steps or elements by tag"
          >
            🗑 Bulk delete
          </button>
        </div>
        {stepError && <p className="text-red-500 text-sm">{stepError}</p>}
      </div>
    </div>
  ) : null;

  // ── Metadata card JSX ──────────────────────────────────────────────────────
  const metadataCard = (
    <div className="bg-white border rounded-xl overflow-hidden">
      <button
        type="button"
        className={`w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors ${!isNew ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
        onClick={() => { if (!isNew) setMetaOpen((o) => !o); }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {metaOpen || isNew ? (
            <h2 className="text-base font-semibold">{isNew ? 'Project Details' : 'Edit Details'}</h2>
          ) : (
            <>
              <span className="font-semibold text-sm truncate">{form.title || 'Untitled'}</span>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${form.published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {form.published ? 'Published' : 'Draft'}
              </span>
              {form.slug && <span className="text-xs text-gray-400 font-mono truncate hidden sm:block">/{form.slug}</span>}
            </>
          )}
        </div>
        {!isNew && <span className="text-xs text-gray-400 shrink-0 ml-3">{metaOpen ? '▲' : '▼ Edit'}</span>}
      </button>

      {metaOpen && (
        <div className="px-5 pb-5 border-t pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Slug <span className="text-gray-400 font-normal">(auto-generated if blank)</span></label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="my-project" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description / Overview</label>
            <HtmlEditor
              value={form.description}
              onChange={(v) => setForm((f) => ({ ...f, description: v }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cover Image</label>
            <ImageUpload value={form.image_url} onChange={(url) => setForm((f) => ({ ...f, image_url: url }))} />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Sort order</label>
              <input type="number" className="w-20 border rounded-lg px-3 py-2 text-sm" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} />
            </div>
            <div className="flex items-center gap-2 mt-5">
              <input type="checkbox" id="pub" checked={!!form.published} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked ? 1 : 0 }))} />
              <label htmlFor="pub" className="text-sm font-medium">Published</label>
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving…' : saved ? '✓ Saved' : isNew ? 'Create Project' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );

  // ── Page layout ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/projects" className="text-gray-400 hover:text-gray-700 shrink-0">← Projects</Link>
        <h1 className="text-xl font-bold truncate">{isNew ? 'New Project' : form.title || 'Edit Project'}</h1>
      </div>

      <div className="space-y-5">
        <div className="max-w-3xl">{metadataCard}</div>
        {videoSection}
        {pid && stepsSection}
      </div>

      {/* Capture modal */}
      {captureData && pid && (
        <CaptureModal
          projectId={pid}
          screenshotUrl={captureData.url}
          timestampMs={captureData.timestampMs}
          existingSteps={steps}
          onSaved={onCaptureSaved}
          onClose={() => setCaptureData(null)}
        />
      )}

      {/* Caption import modal */}
      {pid && (
        <CaptionImportModal
          isOpen={showCaptionImport}
          onClose={() => setShowCaptionImport(false)}
          onImport={handleCaptionImport}
        />
      )}

      {/* SRT export modal */}
      {pid && (
        <ExportSrtModal
          projectId={pid}
          steps={steps}
          stepContent={stepContent}
          isOpen={showExportSrt}
          onClose={() => setShowExportSrt(false)}
        />
      )}

      {/* Bulk delete modal */}
      {pid && (
        <BulkDeleteModal
          projectId={pid}
          steps={steps}
          stepContent={stepContent}
          isOpen={showBulkDelete}
          onClose={() => setShowBulkDelete(false)}
          onDeleted={async () => {
            // Refresh steps + content after a deletion
            const updated = await api.getProject(pid);
            setSteps(updated.steps);
            const map: Record<string, ContentElement[]> = {};
            for (const step of updated.steps) {
              map[step.id] = await api.listContent('project_step', step.id);
            }
            setStepContent(map);
          }}
        />
      )}
    </div>
  );
}
