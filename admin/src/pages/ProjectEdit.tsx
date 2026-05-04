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
  const [captureData, setCaptureData] = useState<{ url: string; timestampMs: number } | null>(null);

  // Drag state for steps
  const dragStep = useRef<number | null>(null);
  const [dragOverStep, setDragOverStep] = useState<number | null>(null);

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
    // Re-fetch all steps since backend re-sorted sort_orders for all steps after timestamp insertion
    const pid = projectId ?? id;
    if (pid) {
      api.listSteps(pid).then(setSteps);
    }
    setStepContent((prev) => ({
      ...prev,
      [step.id]: [...(prev[step.id] ?? []), element],
    }));
    setCaptureData(null);
  }

  async function addStep() {
    if (!projectId || !newStepTitle.trim()) return;
    setStepError('');
    try {
      const step = await api.createStep(projectId, { title: newStepTitle });
      setSteps((s) => [...s, step]);
      setNewStepTitle('');
    } catch (e) {
      setStepError(String(e));
    }
  }

  async function deleteStep(stepId: string) {
    if (!confirm('Delete this step and all its content?')) return;
    await api.deleteStep(stepId);
    setSteps((s) => s.filter((x) => x.id !== stepId));
  }

  // Drag-and-drop handlers for steps
  function onStepDragStart(index: number) {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 max-w-3xl">
        <Link to="/projects" className="text-gray-400 hover:text-gray-700">← Projects</Link>
        <h1 className="text-2xl font-bold">{isNew ? 'New Project' : 'Edit Project'}</h1>
      </div>

      {/* Project metadata form */}
      <div className="bg-white border rounded-xl p-6 space-y-4 max-w-3xl">
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

      {/* Video section — always visible; upload enabled after first save */}
      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Video <span className="text-sm font-normal text-gray-400">— build steps from video frames</span></h2>
          {videoKey && !replacingVideo && pid && (
            <button
              onClick={() => setReplacingVideo(true)}
              className="text-xs text-blue-600 hover:underline"
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
              />
              <VideoTimeline
                projectId={pid}
                steps={steps}
                duration={videoDuration}
                currentTime={videoCurrentTime}
                onSeek={(s) => videoSeekRef.current?.(s)}
                onStepsChanged={setSteps}
              />
            </div>
          )}
        </div>

      {/* Steps */}
      {pid && (
        <div className="space-y-3 max-w-3xl">
          <h2 className="text-lg font-semibold">Steps <span className="text-sm font-normal text-gray-400">— drag to reorder</span></h2>

          {steps.map((step, i) => (
            <div
              key={step.id}
              draggable
              onDragStart={() => onStepDragStart(i)}
              onDragOver={(e) => onStepDragOver(e, i)}
              onDragLeave={() => setDragOverStep(null)}
              onDrop={(e) => onStepDrop(e, i)}
              className={`bg-white border rounded-xl overflow-hidden transition-all ${dragOverStep === i && dragStep.current !== i ? 'border-blue-400 shadow-md' : ''}`}
            >
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b cursor-grab active:cursor-grabbing">
                <span className="text-gray-300 mr-1 select-none" title="Drag to reorder">⠿</span>
                <span className="font-medium text-sm flex-1">{step.title}</span>
                {step.video_timestamp_ms != null && (
                  <span className="text-xs font-mono bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                    ⏱ {formatTimestamp(step.video_timestamp_ms)}
                  </span>
                )}
                <button onClick={() => deleteStep(step.id)} className="text-xs text-red-500 px-2 border rounded hover:bg-red-50">Delete</button>
              </div>
              <div className="p-4">
                <ContentElementEditor
                  parentType="project_step"
                  parentId={step.id}
                  elements={stepContent[step.id] ?? []}
                  onChange={(els) => setStepContent((prev) => ({ ...prev, [step.id]: els }))}
                />
              </div>
            </div>
          ))}

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
                className="px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-40"
              >
                Add step
              </button>
            </div>
            {stepError && <p className="text-red-500 text-sm">{stepError}</p>}
          </div>
        </div>
      )}

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
    </div>
  );
}
