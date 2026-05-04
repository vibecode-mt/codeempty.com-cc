import { useRef, useState } from 'react';
import { api } from '../api';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

interface Props {
  onUpload: (result: { key: string; url: string }) => void;
  onError?: (msg: string) => void;
}

export default function VideoUpload({ onUpload, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0–100
  const [bytesUploaded, setBytesUploaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [speed, setSpeed] = useState(0); // bytes/sec
  const [error, setError] = useState('');
  const abortRef = useRef<{ key: string; uploadId: string } | null>(null);
  const startTimeRef = useRef<number>(0);

  async function handleFile(file: File) {
    setError('');
    setUploading(true);
    setProgress(0);
    setBytesUploaded(0);
    setTotalBytes(file.size);
    startTimeRef.current = Date.now();

    let key = '';
    let uploadId = '';

    try {
      const init = await api.videoUploadInit(file.name, file.type || 'video/mp4');
      key = init.key;
      uploadId = init.uploadId;
      abortRef.current = { key, uploadId };

      const parts: { partNumber: number; etag: string }[] = [];
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const { etag } = await api.videoUploadChunk(key, uploadId, i + 1, chunk);
        parts.push({ partNumber: i + 1, etag });

        const uploaded = end;
        setBytesUploaded(uploaded);
        setProgress(Math.round((uploaded / file.size) * 100));
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setSpeed(elapsed > 0 ? uploaded / elapsed : 0);
      }

      const result = await api.videoUploadComplete(key, uploadId, parts);
      abortRef.current = null;
      setUploading(false);
      onUpload(result);
    } catch (e) {
      const msg = String(e);
      setError(msg);
      onError?.(msg);
      setUploading(false);
      if (abortRef.current) {
        api.videoUploadAbort(abortRef.current.key, abortRef.current.uploadId).catch(() => {});
        abortRef.current = null;
      }
    }
  }

  function formatBytes(b: number) {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatEta() {
    if (speed === 0 || totalBytes === 0) return '…';
    const remaining = totalBytes - bytesUploaded;
    const secs = remaining / speed;
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    return `${(secs / 3600).toFixed(1)}h`;
  }

  if (uploading) {
    return (
      <div className="border rounded-xl p-5 space-y-3 bg-gray-50">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 font-medium">Uploading video…</span>
          <span className="text-gray-500">{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>{formatBytes(bytesUploaded)} / {formatBytes(totalBytes)}</span>
          <span>{formatBytes(speed)}/s · ETA {formatEta()}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <div className="text-3xl mb-2">🎬</div>
        <p className="text-sm font-medium text-gray-700">Click or drag a video file here</p>
        <p className="text-xs text-gray-400 mt-1">MP4, MOV, WebM · up to 1 hour</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </div>
  );
}
