import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  value: string;
  onChange: (content: string) => void;
  captionEnabled?: boolean;
}

function parseValue(v: string): { url: string; caption: string } {
  try {
    const p = JSON.parse(v) as { url?: string; caption?: string };
    if (p.url !== undefined) return { url: p.url, caption: p.caption ?? '' };
  } catch { /* plain URL */ }
  return { url: v, caption: '' };
}

export default function ImageUpload({ value, onChange, captionEnabled = false }: Props) {
  const parsed = captionEnabled ? parseValue(value) : { url: value, caption: '' };
  const [url, setUrl] = useState(parsed.url);
  const [caption, setCaption] = useState(parsed.caption);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFileRef = useRef<(file: File) => Promise<void>>();

  function emit(nextUrl: string, nextCaption: string) {
    if (captionEnabled) {
      onChange(nextUrl ? JSON.stringify({ url: nextUrl, caption: nextCaption }) : '');
    } else {
      onChange(nextUrl);
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError('');
    try {
      const { url: uploaded } = await api.uploadMedia(file);
      setUrl(uploaded);
      emit(uploaded, caption);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  handleFileRef.current = handleFile;

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); handleFileRef.current?.(file); }
          break;
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  function handleUrlChange(v: string) {
    setUrl(v);
    emit(v, caption);
  }

  function handleCaptionChange(v: string) {
    setCaption(v);
    emit(url, v);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          className="flex-1 border rounded px-3 py-1.5 text-sm"
          placeholder="Image URL or upload / paste (Ctrl+V)"
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {url && (
        <img src={url} alt="preview" className="max-h-48 rounded border object-contain" />
      )}
      {captionEnabled && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Caption / description (HTML, optional)</label>
          <textarea
            className="w-full border rounded px-3 py-1.5 text-sm resize-y"
            rows={2}
            placeholder="<p>Describe this image…</p>"
            value={caption}
            onChange={(e) => handleCaptionChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
