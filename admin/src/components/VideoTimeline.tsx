import { useRef, useState } from 'react';
import { api, type ProjectStep } from '../api';

interface Props {
  projectId: string;
  steps: ProjectStep[];
  duration: number; // seconds
  currentTime: number; // seconds
  onSeek: (seconds: number) => void;
  onStepsChanged: (steps: ProjectStep[]) => void;
}

function formatTimestamp(ms: number) {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(2);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${s.padStart(5, '0')}`;
}

export default function VideoTimeline({ projectId, steps, duration, currentTime, onSeek, onStepsChanged }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingStepId = useRef<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [splitSec, setSplitSec] = useState('');
  const [offsetSec, setOffsetSec] = useState('');
  const [shifting, setShifting] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [shiftResult, setShiftResult] = useState('');

  const stepsWithTimestamp = steps.filter((s) => s.video_timestamp_ms != null);

  function posFromEvent(e: React.MouseEvent | MouseEvent) {
    const bar = barRef.current;
    if (!bar || duration === 0) return null;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return (x / rect.width) * duration;
  }

  function onBarClick(e: React.MouseEvent) {
    if (draggingStepId.current) return;
    const t = posFromEvent(e);
    if (t !== null) onSeek(t);
  }

  function onMarkerMouseDown(e: React.MouseEvent, stepId: string) {
    e.stopPropagation();
    draggingStepId.current = stepId;

    function onMouseMove(ev: MouseEvent) {
      const t = posFromEvent(ev);
      if (t === null) return;
      // Optimistic update in UI
      onStepsChanged(
        steps.map((s) => (s.id === stepId ? { ...s, video_timestamp_ms: Math.round(t * 1000) } : s)),
      );
    }

    async function onMouseUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      const t = posFromEvent(ev);
      draggingStepId.current = null;
      if (t === null) return;
      const newMs = Math.round(t * 1000);
      try {
        const updated = await api.updateStep(stepId, { video_timestamp_ms: newMs });
        onStepsChanged(steps.map((s) => (s.id === stepId ? updated : s)));
      } catch {
        // revert on error by refreshing — caller can reload
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  async function applyShift() {
    setShiftError('');
    setShiftResult('');
    const splitMs = Math.round(parseFloat(splitSec) * 1000);
    const offsetMs = Math.round(parseFloat(offsetSec) * 1000);
    if (isNaN(splitMs) || isNaN(offsetMs)) {
      setShiftError('Enter valid numbers for both fields');
      return;
    }
    setShifting(true);
    try {
      const res = await api.timeshiftProject(projectId, splitMs, offsetMs);
      setShiftResult(`Shifted ${res.shifted} step(s) and ${res.elements_shifted} element(s).`);
      // Update local step timestamps for immediate feedback
      onStepsChanged(
        steps.map((s) => {
          if (s.video_timestamp_ms != null && s.video_timestamp_ms >= splitMs) {
            return { ...s, video_timestamp_ms: Math.max(0, s.video_timestamp_ms + offsetMs) };
          }
          return s;
        }),
      );
    } catch (e) {
      setShiftError(String(e));
    } finally {
      setShifting(false);
    }
  }

  if (duration === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Video Timeline</span>
        <button
          onClick={() => setShiftOpen((v) => !v)}
          className="text-xs text-blue-600 hover:underline"
        >
          {shiftOpen ? '▲ Hide Time-Shift' : '▼ Time-Shift'}
        </button>
      </div>

      {/* Timeline bar */}
      <div
        ref={barRef}
        onClick={onBarClick}
        className="relative h-8 bg-gray-100 rounded-lg cursor-pointer select-none border"
      >
        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-blue-500 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        />

        {/* Step markers */}
        {stepsWithTimestamp.map((step) => {
          const pct = ((step.video_timestamp_ms! / 1000) / duration) * 100;
          return (
            <div
              key={step.id}
              className="absolute top-0 bottom-0 flex flex-col items-center cursor-grab active:cursor-grabbing"
              style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
              onMouseDown={(e) => onMarkerMouseDown(e, step.id)}
              title={`${step.title} — ${formatTimestamp(step.video_timestamp_ms!)}`}
            >
              <div className="w-3 h-3 rounded-full bg-orange-500 border-2 border-white shadow mt-1 shrink-0" />
              <span className="text-[9px] font-medium text-orange-700 leading-none mt-0.5 whitespace-nowrap max-w-[60px] overflow-hidden text-ellipsis">
                {step.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      {stepsWithTimestamp.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {stepsWithTimestamp.map((s) => (
            <button
              key={s.id}
              onClick={() => onSeek(s.video_timestamp_ms! / 1000)}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600"
            >
              <span className="w-2 h-2 rounded-full bg-orange-500 inline-block shrink-0" />
              {s.title}
              <span className="text-gray-400 font-mono">{formatTimestamp(s.video_timestamp_ms!)}</span>
            </button>
          ))}
        </div>
      )}

      {stepsWithTimestamp.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-1">Capture frames to add step markers to the timeline</p>
      )}

      {/* Time-Shift panel */}
      {shiftOpen && (
        <div className="border rounded-xl p-4 bg-amber-50 space-y-3">
          <p className="text-sm font-medium text-amber-800">Shift steps after a point in time</p>
          <p className="text-xs text-amber-700">Use this when you replace the video with an edited version — shift all steps and elements that fall after the edit point forward or backward by a fixed amount.</p>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1">Split point (seconds)</label>
              <input
                type="number"
                step="0.001"
                className="border rounded px-2 py-1.5 text-sm w-36"
                placeholder="e.g. 60"
                value={splitSec}
                onChange={(e) => setSplitSec(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1">Offset (seconds, negative = shift back)</label>
              <input
                type="number"
                step="0.001"
                className="border rounded px-2 py-1.5 text-sm w-44"
                placeholder="e.g. 5 or -3.5"
                value={offsetSec}
                onChange={(e) => setOffsetSec(e.target.value)}
              />
            </div>
            <button
              onClick={applyShift}
              disabled={shifting}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-60"
            >
              {shifting ? 'Applying…' : 'Apply Shift'}
            </button>
          </div>
          {shiftError && <p className="text-red-500 text-sm">{shiftError}</p>}
          {shiftResult && <p className="text-green-700 text-sm">{shiftResult}</p>}
        </div>
      )}
    </div>
  );
}
