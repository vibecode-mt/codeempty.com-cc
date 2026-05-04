import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  videoKey: string;
  onCapture: (screenshotUrl: string, timestampMs: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  seekRef?: React.MutableRefObject<((seconds: number) => void) | null>;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function parseTimeInput(s: string): number | null {
  const trimmed = s.trim();
  const parts = trimmed.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const sec = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(sec)) return null;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const sec = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(sec)) return null;
    return m * 60 + sec;
  }
  const raw = parseFloat(trimmed);
  return isNaN(raw) ? null : raw;
}

export default function VideoEditor({ videoKey, onCapture, onTimeUpdate, onDurationChange, seekRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState('');

  // Track whether the user is actively dragging the seek slider
  const seekingRef = useRef(false);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (seekRef) {
      seekRef.current = (seconds: number) => {
        const v = videoRef.current;
        if (v) v.currentTime = seconds;
      };
    }
  }, [seekRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      // Don't update state while the slider is being dragged — we update it directly in onSeekChange
      if (seekingRef.current) return;
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);
    };
    const onMeta = () => {
      setDuration(video.duration);
      onDurationChange?.(video.duration);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
    };
  }, [onTimeUpdate, onDurationChange]);

  // Pause video before seeking to avoid AbortError play/pause race.
  // Resume is attached to window mouseup/touchend so it fires even when the
  // pointer is released outside the slider element.
  function onSeekStart() {
    const v = videoRef.current;
    if (!v) return;
    seekingRef.current = true;
    wasPlayingRef.current = !v.paused;
    v.pause();

    function finish() {
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('touchend', finish);
      seekingRef.current = false;
      if (wasPlayingRef.current) {
        videoRef.current?.play().catch(() => {});
      }
    }
    window.addEventListener('mouseup', finish);
    window.addEventListener('touchend', finish);
  }

  function onSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
    onTimeUpdate?.(t);
  }

  function jump(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }

  function startEditingTime() {
    setTimeInput(formatTime(currentTime));
    setEditingTime(true);
  }

  function applyTimeInput() {
    setEditingTime(false);
    const parsed = parseTimeInput(timeInput);
    if (parsed !== null && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, parsed));
    }
  }

  function toggleFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      v.requestFullscreen().catch(() => {});
    }
  }

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturing) return;
    setCaptureError('');
    video.pause();
    const timestampMs = Math.round(video.currentTime * 1000);
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Frame capture failed'))), 'image/png'),
      );
      const file = new File([blob], `frame_${timestampMs}.png`, { type: 'image/png' });
      const { url } = await api.uploadMedia(file);
      onCapture(url, timestampMs);
    } catch (e) {
      setCaptureError(String(e));
    } finally {
      setCapturing(false);
    }
  }, [capturing, onCapture]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as Element;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t.closest('[contenteditable="true"]')
      ) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        playing ? v.pause() : v.play();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        captureFrame();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        jump(e.shiftKey ? -30 : e.altKey ? -300 : -5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        jump(e.shiftKey ? 30 : e.altKey ? 300 : 5);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, captureFrame]);

  function JumpBtn({ delta, label }: { delta: number; label: string }) {
    return (
      <button
        onClick={() => jump(delta)}
        className="px-2 py-1 text-xs border rounded hover:bg-gray-100 font-mono tabular-nums"
        title={`${delta > 0 ? '+' : ''}${delta}s`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* Video — fills full container width, aspect ratio preserved by browser */}
      <div className="bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={`/api/media/${videoKey}`}
          className="w-full"
          preload="metadata"
        />
      </div>

      {/* Seek slider — full width */}
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={currentTime}
        onMouseDown={onSeekStart}
        onTouchStart={onSeekStart}
        onChange={onSeekChange}
        className="w-full accent-blue-500 cursor-pointer h-2"
      />

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            playing ? v.pause() : v.play();
          }}
          className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 min-w-[76px] shrink-0"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Jump back */}
        <div className="flex gap-1 shrink-0">
          <JumpBtn delta={-300} label="−5m" />
          <JumpBtn delta={-30} label="−30s" />
          <JumpBtn delta={-5} label="−5s" />
        </div>

        {/* Editable time display */}
        <div className="flex items-center gap-1 mx-1 shrink-0">
          {editingTime ? (
            <input
              className="border rounded px-2 py-0.5 text-xs font-mono w-32"
              value={timeInput}
              onChange={(e) => setTimeInput(e.target.value)}
              onBlur={applyTimeInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyTimeInput();
                if (e.key === 'Escape') setEditingTime(false);
              }}
              autoFocus
              placeholder="MM:SS.mmm"
            />
          ) : (
            <button
              onClick={startEditingTime}
              className="text-xs font-mono text-gray-600 hover:text-blue-600 hover:underline px-1 tabular-nums"
              title="Click to jump to a specific time"
            >
              {formatTime(currentTime)}
            </button>
          )}
          <span className="text-xs text-gray-400 font-mono tabular-nums">/ {formatTime(duration)}</span>
        </div>

        {/* Jump forward */}
        <div className="flex gap-1 shrink-0">
          <JumpBtn delta={5} label="+5s" />
          <JumpBtn delta={30} label="+30s" />
          <JumpBtn delta={300} label="+5m" />
        </div>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="ml-auto px-2.5 py-1.5 text-gray-500 border rounded hover:bg-gray-100 text-sm shrink-0"
          title="Fullscreen (native browser fullscreen)"
        >
          ⛶
        </button>
      </div>

      {/* Capture row */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={captureFrame}
          disabled={capturing}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2 shrink-0"
        >
          {capturing ? <><span className="animate-spin inline-block">⟳</span> Capturing…</> : '📷 Capture Frame'}
        </button>
        <span className="text-xs text-gray-400 leading-5">
          <kbd className="bg-gray-100 px-1 rounded">Space</kbd> play/pause ·{' '}
          <kbd className="bg-gray-100 px-1 rounded">F</kbd> capture ·{' '}
          <kbd className="bg-gray-100 px-1 rounded">←→</kbd> ±5s ·{' '}
          <kbd className="bg-gray-100 px-1 rounded">Shift+←→</kbd> ±30s ·{' '}
          <kbd className="bg-gray-100 px-1 rounded">Alt+←→</kbd> ±5m · click time to type
        </span>
      </div>

      {captureError && <p className="text-red-500 text-sm">{captureError}</p>}
    </div>
  );
}
