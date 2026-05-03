import { useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}

export default function HtmlEditor({ value, onChange, rows = 10 }: Props) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b text-sm">
        <button
          type="button"
          onClick={() => setPreview(false)}
          className={`px-2 py-0.5 rounded ${!preview ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          HTML
        </button>
        <button
          type="button"
          onClick={() => setPreview(true)}
          className={`px-2 py-0.5 rounded ${preview ? 'bg-white shadow text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Preview
        </button>
      </div>
      {preview ? (
        <div
          className="p-3 min-h-[8rem] prose max-w-none bg-white"
          dangerouslySetInnerHTML={{ __html: value }}
        />
      ) : (
        <textarea
          className="w-full p-3 font-mono text-sm bg-white resize-y focus:outline-none"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
