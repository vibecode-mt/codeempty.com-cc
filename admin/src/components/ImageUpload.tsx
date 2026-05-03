import { useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  value: string;
  onChange: (url: string) => void;
}

export default function ImageUpload({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError('');
    try {
      const { url } = await api.uploadMedia(file);
      onChange(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          className="flex-1 border rounded px-3 py-1.5 text-sm"
          placeholder="Image URL or upload below"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
      {value && (
        <img src={value} alt="preview" className="max-h-48 rounded border object-contain" />
      )}
    </div>
  );
}
