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

export default function VideoEditor({ videoKey, onCapture, onTimeUpdate, onDurationChange, seekRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');

  // Expose seek function to parent
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

  // Keyboard shortcuts: Space = play/pause, F = capture frame
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        playing ? video.pause() : video.play();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        captureFrame();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, captureFrame]);

  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        src={`/api/media/${videoKey}`}
        className="w-full rounded-lg bg-black"
        style={{ maxHeight: '480px' }}
        preload="metadata"
      />

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            playing ? v.pause() : v.play();
          }}
          className="px-3 py-1.5 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 min-w-[72px]"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.001}
          value={currentTime}
          onChange={(e) => {
            const v = videoRef.current;
            if (!v) return;
            v.currentTime = Number(e.target.value);
          }}
          className="flex-1 accent-blue-500"
        />

        <span className="text-xs font-mono text-gray-500 shrink-0 w-36 text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={captureFrame}
          disabled={capturing}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
        >
          {capturing ? (
            <>
              <span className="animate-spin inline-block">⟳</span> Capturing…
            </>
          ) : (
            '📷 Capture Frame'
          )}
        </button>
        <span className="text-xs text-gray-400">
          at <span className="font-mono">{formatTime(currentTime)}</span>
          {' — '}keyboard:{' '}
          <kbd className="bg-gray-100 px-1 rounded text-xs">Space</kbd> play/pause ·{' '}
          <kbd className="bg-gray-100 px-1 rounded text-xs">F</kbd> capture
        </span>
      </div>

      {captureError && <p className="text-red-500 text-sm">{captureError}</p>}
    </div>
  );
}
