import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  videoKey: string;
  onCapture: (screenshotUrl: string, timestampMs: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  seekRef?: React.MutableRefObject<((seconds: number) => void) | null>;
  // Imperative capture: returns the uploaded URL + timestamp without going through onCapture
  captureRef?: React.MutableRefObject<(() => Promise<{ url: string; timestampMs: number } | null>) | null>;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Frame-accurate scrubber spanning ±WINDOW_S seconds around the current time.
// Lets the user nudge a few hundred ms at a time without the main slider's
// whole-video resolution. Frame-step buttons assume 30fps as a default since
// HTMLVideoElement doesn't expose actual frame rate.
const FINE_WINDOW_S = 5;
const ASSUMED_FPS = 30;
const FRAME_S = 1 / ASSUMED_FPS;

function FineSeek({
  videoRef, currentTime, duration, cached, onChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  currentTime: number;
  duration: number;
  cached: boolean;
  onChange: (t: number) => void;
}) {
  // Center the window on currentTime. The slider's value is the absolute time;
  // the window scrolls as the user drags or as the video plays.
  const min = Math.max(0, currentTime - FINE_WINDOW_S);
  const max = Math.min(duration || currentTime + FINE_WINDOW_S, currentTime + FINE_WINDOW_S);

  function applyTime(t: number) {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(duration || t, t));
    v.currentTime = clamped;
    onChange(clamped);
  }

  function nudge(deltaS: number) {
    applyTime(currentTime + deltaS);
  }

  function onFineChange(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    onChange(t);
    // Same caveat as the main slider: only push to <video> when blob-cached,
    // otherwise every change fires a Range request and saturates the browser.
    if (cached && videoRef.current) videoRef.current.currentTime = t;
  }

  function onFineRelease() {
    if (!videoRef.current) return;
    videoRef.current.currentTime = currentTime;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className="shrink-0">Fine:</span>
      <button
        onClick={() => nudge(-FRAME_S)}
        className="px-1.5 py-0.5 border rounded hover:bg-gray-100 font-mono shrink-0"
        title="Step back one frame (≈33ms at 30fps)"
      >
        ⏮ 1f
      </button>
      <button
        onClick={() => nudge(-0.25)}
        className="px-1.5 py-0.5 border rounded hover:bg-gray-100 font-mono shrink-0"
        title="−250ms"
      >
        −250ms
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={FRAME_S}
        value={currentTime}
        onChange={onFineChange}
        onMouseUp={onFineRelease}
        onTouchEnd={onFineRelease}
        className="flex-1 accent-purple-500 cursor-pointer"
        title={`±${FINE_WINDOW_S}s around current time, frame-accurate`}
      />
      <button
        onClick={() => nudge(0.25)}
        className="px-1.5 py-0.5 border rounded hover:bg-gray-100 font-mono shrink-0"
        title="+250ms"
      >
        +250ms
      </button>
      <button
        onClick={() => nudge(FRAME_S)}
        className="px-1.5 py-0.5 border rounded hover:bg-gray-100 font-mono shrink-0"
        title="Step forward one frame (≈33ms at 30fps)"
      >
        1f ⏭
      </button>
    </div>
  );
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

export default function VideoEditor({ videoKey, onCapture, onTimeUpdate, onDurationChange, seekRef, captureRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState('');
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);

  // Blob URL caching for instant seeking
  const [videoSrc, setVideoSrc] = useState(`/api/media/${videoKey}`);
  const [cached, setCached] = useState(false);
  const [caching, setCaching] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);
  const [cacheError, setCacheError] = useState('');
  const blobUrlRef = useRef<string | null>(null);
  const pendingRestoreRef = useRef<number | null>(null);
  const wasPlayingBeforeSrcChangeRef = useRef(false);

  // Revoke blob URL when component unmounts
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // After src changes to a blob URL, wait for canplay then restore position + speed + resume
  useEffect(() => {
    const v = videoRef.current;
    if (!v || pendingRestoreRef.current === null) return;
    const t = pendingRestoreRef.current;
    const resume = wasPlayingBeforeSrcChangeRef.current;
    pendingRestoreRef.current = null;
    wasPlayingBeforeSrcChangeRef.current = false;
    function onReady() {
      v.currentTime = t;
      v.playbackRate = speedRef.current;
      if (resume) v.play().catch(() => {});
    }
    v.addEventListener('canplay', onReady, { once: true });
    return () => v.removeEventListener('canplay', onReady);
  }, [videoSrc]);

  async function cacheVideo() {
    if (caching || cached) return;
    setCaching(true);
    setCacheProgress(0);
    setCacheError('');
    try {
      const res = await fetch(`/api/media/${videoKey}`, { credentials: 'include' });
      if (!res.ok || !res.body) throw new Error(`Fetch failed: ${res.status}`);

      const contentLength = parseInt(res.headers.get('Content-Length') ?? '0', 10);
      const contentType = res.headers.get('Content-Type') ?? 'video/mp4';
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastReportedPct = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
        }
        if (contentLength > 0) {
          const pct = Math.round((received / contentLength) * 100);
          if (pct !== lastReportedPct) {
            lastReportedPct = pct;
            setCacheProgress(pct);
          }
        }
      }

      const blob = new Blob(chunks, { type: contentType });
      const url = URL.createObjectURL(blob);

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;

      // Clean up any stale seek handlers so they don't interfere after src switch
      if (finishSeekRef.current) {
        window.removeEventListener('mouseup', finishSeekRef.current);
        window.removeEventListener('touchend', finishSeekRef.current);
        finishSeekRef.current = null;
      }
      seekingRef.current = false;
      wasPlayingBeforeSrcChangeRef.current = videoRef.current != null && !videoRef.current.paused;
      pendingRestoreRef.current = videoRef.current?.currentTime ?? 0;
      setVideoSrc(url);
      setCached(true);
    } catch (e) {
      setCacheError(`Caching failed: ${e}`);
    } finally {
      setCaching(false);
    }
  }

  // Seek drag state
  const seekingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const sliderValueRef = useRef(0);      // latest slider position during drag
  const finishSeekRef = useRef<(() => void) | null>(null);  // one active mouseup handler at a time

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

  function onSeekStart() {
    const v = videoRef.current;
    if (!v) return;

    // Remove any previous finish handler — rapid drag-release-drag stacks handlers
    // without this, causing multiple play() calls and the 20s hang
    if (finishSeekRef.current) {
      window.removeEventListener('mouseup', finishSeekRef.current);
      window.removeEventListener('touchend', finishSeekRef.current);
    }

    if (!seekingRef.current) wasPlayingRef.current = !v.paused;
    seekingRef.current = true;
    v.pause();

    const finish = () => {
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('touchend', finish);
      finishSeekRef.current = null;
      seekingRef.current = false;

      // Apply the final position in one go — avoids flooding the server with
      // one Range request per pixel dragged when the video isn't blob-cached
      v.currentTime = sliderValueRef.current;
      setCurrentTime(sliderValueRef.current);
      onTimeUpdate?.(sliderValueRef.current);

      if (wasPlayingRef.current) v.play().catch(() => {});
    };

    finishSeekRef.current = finish;
    window.addEventListener('mouseup', finish);
    window.addEventListener('touchend', finish);
  }

  function onSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    sliderValueRef.current = t;
    // Always update slider display and timeline so the UI feels responsive
    setCurrentTime(t);
    onTimeUpdate?.(t);
    // Only push to the video element when data is local (blob-cached).
    // Without caching, every change fires a Range request; 100+ during a drag
    // saturates the browser's connection pool and causes the 20s hang.
    if (cached && videoRef.current) videoRef.current.currentTime = t;
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

  function changeSpeed(s: number) {
    speedRef.current = s;
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
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

  // Captures, uploads, and returns the resulting URL/timestamp. Caller decides
  // what to do with the result (the on-screen "Capture Frame" button forwards
  // to onCapture; the imperative captureRef returns the result directly).
  const doCapture = useCallback(async (): Promise<{ url: string; timestampMs: number } | null> => {
    const video = videoRef.current;
    if (!video || capturing) return null;
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
      return { url, timestampMs };
    } catch (e) {
      setCaptureError(String(e));
      return null;
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const captureFrame = useCallback(async () => {
    const result = await doCapture();
    if (result) onCapture(result.url, result.timestampMs);
  }, [doCapture, onCapture]);

  useEffect(() => {
    if (captureRef) captureRef.current = doCapture;
  }, [captureRef, doCapture]);

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
        playing ? v.pause() : v.play().catch(() => {});
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
      {/* Cache-for-seeking bar */}
      <div className="flex items-center gap-3 text-sm">
        {cached ? (
          <span className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Cached in memory — seeking is instant
          </span>
        ) : caching ? (
          <div className="flex items-center gap-2 flex-1">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${cacheProgress}%` }} />
            </div>
            <span className="text-xs text-gray-500 tabular-nums shrink-0">{cacheProgress}%</span>
            <span className="text-xs text-gray-400 shrink-0">Downloading for fast seeking…</span>
          </div>
        ) : (
          <button
            onClick={cacheVideo}
            className="text-xs px-3 py-1.5 border rounded-lg hover:bg-gray-50 text-gray-600 flex items-center gap-1.5"
            title="Download the full video into browser memory for instant seeking"
          >
            ⚡ Cache for fast seeking
          </button>
        )}
        {cacheError && <span className="text-xs text-red-500">{cacheError}</span>}
      </div>

      {/* Video — fills full container width; preload=auto lets browser buffer ahead */}
      <div className="bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full"
          preload="auto"
        />
      </div>

      {/* Seek slider with hover-time tooltip */}
      <div className="relative">
        {hoverTime !== null && (
          <div
            className="absolute bottom-full mb-1 -translate-x-1/2 bg-gray-800 text-white text-xs font-mono rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap"
            style={{ left: Math.max(30, Math.min(hoverX, 9999)) }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onMouseDown={onSeekStart}
          onTouchStart={onSeekStart}
          onChange={onSeekChange}
          onMouseMove={(e) => {
            if (!duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            setHoverX(x);
            setHoverTime((x / rect.width) * duration);
          }}
          onMouseLeave={() => setHoverTime(null)}
          className="w-full accent-blue-500 cursor-pointer h-2"
        />
      </div>

      {/* Fine-seek slider — ±5s window centered on the current time, for frame
          accuracy near a captured timestamp. Updates only the browser's
          currentTime; the main slider above re-renders to follow. */}
      <FineSeek
        videoRef={videoRef}
        currentTime={currentTime}
        duration={duration}
        cached={cached}
        onChange={(t) => {
          setCurrentTime(t);
          onTimeUpdate?.(t);
        }}
      />

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            playing ? v.pause() : v.play().catch(() => {});
          }}
          className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 min-w-[76px] shrink-0"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        <div className="flex gap-1 shrink-0">
          <JumpBtn delta={-300} label="−5m" />
          <JumpBtn delta={-30} label="−30s" />
          <JumpBtn delta={-5} label="−5s" />
        </div>

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

        <div className="flex gap-1 shrink-0">
          <JumpBtn delta={5} label="+5s" />
          <JumpBtn delta={30} label="+30s" />
          <JumpBtn delta={300} label="+5m" />
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="flex items-center border rounded overflow-hidden text-xs font-mono" title="Playback speed">
            {[0.5, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                className={`px-2 py-1.5 leading-none transition-colors ${speed === s ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            onClick={toggleFullscreen}
            className="px-2.5 py-1.5 text-gray-500 border rounded hover:bg-gray-100 text-sm"
            title="Fullscreen"
          >
            ⛶
          </button>
        </div>
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
