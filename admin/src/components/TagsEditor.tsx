import { useEffect, useRef, useState } from 'react';

interface TagsEditorProps {
  tags: string | null;
  onChange: (tags: string) => Promise<void> | void;
  className?: string;
  placeholder?: string;
}

function parseTagsString(s: string | null): string[] {
  if (!s) return [];
  return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export default function TagsEditor({ tags, onChange, className, placeholder }: TagsEditorProps) {
  const list = parseTagsString(tags);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(list.join(', '));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(list.join(', '));
  }, [tags, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const normalized = parseTagsString(draft).join(',');
    if (normalized !== (tags ?? '')) {
      await onChange(normalized);
    }
    setEditing(false);
  }

  function cancel() {
    setDraft(list.join(', '));
    setEditing(false);
  }

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') cancel();
            }}
            onBlur={commit}
            placeholder={placeholder ?? 'tag1, tag2'}
            className="border rounded px-1.5 py-0.5 text-xs font-mono w-44"
          />
        </>
      ) : list.length === 0 ? (
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-gray-300 hover:text-blue-500 underline-offset-2 hover:underline"
          title="Add tags"
        >
          + tags
        </button>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 flex-wrap"
          title="Click to edit tags"
        >
          {list.map((t) => (
            <span
              key={t}
              className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-mono"
            >
              {t}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}
