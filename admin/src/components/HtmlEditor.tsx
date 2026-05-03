import { useRef, useEffect } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

type ToolbarItem =
  | { type: 'cmd'; cmd: string; arg?: string; icon: string; title: string; bold?: boolean; italic?: boolean }
  | { type: 'sep' };

const TOOLBAR: ToolbarItem[] = [
  { type: 'cmd', cmd: 'bold', icon: 'B', title: 'Bold', bold: true },
  { type: 'cmd', cmd: 'italic', icon: 'I', title: 'Italic', italic: true },
  { type: 'cmd', cmd: 'underline', icon: 'U', title: 'Underline' },
  { type: 'sep' },
  { type: 'cmd', cmd: 'formatBlock', arg: 'h2', icon: 'H2', title: 'Heading 2' },
  { type: 'cmd', cmd: 'formatBlock', arg: 'h3', icon: 'H3', title: 'Heading 3' },
  { type: 'cmd', cmd: 'formatBlock', arg: 'p', icon: 'P¶', title: 'Paragraph' },
  { type: 'sep' },
  { type: 'cmd', cmd: 'insertUnorderedList', icon: '• List', title: 'Bullet list' },
  { type: 'cmd', cmd: 'insertOrderedList', icon: '1. List', title: 'Numbered list' },
  { type: 'sep' },
  { type: 'cmd', cmd: 'createLink', icon: '🔗', title: 'Insert link' },
  { type: 'cmd', cmd: 'unlink', icon: '✂️', title: 'Remove link' },
  { type: 'sep' },
  { type: 'cmd', cmd: 'removeFormat', icon: 'Tx', title: 'Clear formatting' },
];

export default function HtmlEditor({ value, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isFocused = useRef(false);

  // Sync value into DOM only when not focused (avoid cursor jumping)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || isFocused.current) return;
    if (el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  function handleInput() {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function exec(cmd: string, arg?: string) {
    if (cmd === 'createLink') {
      const url = prompt('URL:');
      if (!url) return;
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, arg);
    }
    editorRef.current?.focus();
    handleInput();
  }

  return (
    <div className="border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-blue-300">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b select-none">
        {TOOLBAR.map((item, i) =>
          item.type === 'sep' ? (
            <span key={i} className="w-px h-4 bg-gray-300 mx-1" />
          ) : (
            <button
              key={i}
              type="button"
              title={item.title}
              onMouseDown={(e) => {
                e.preventDefault(); // don't lose editor focus
                exec(item.cmd, item.arg);
              }}
              className={`px-1.5 py-0.5 rounded text-xs hover:bg-gray-200 transition-colors min-w-[1.75rem] text-center
                ${item.bold ? 'font-bold' : ''} ${item.italic ? 'italic' : ''}`}
            >
              {item.icon}
            </button>
          ),
        )}
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => { isFocused.current = true; }}
        onBlur={() => {
          isFocused.current = false;
          handleInput();
        }}
        onInput={handleInput}
        className="min-h-[10rem] p-3 bg-white focus:outline-none prose prose-sm max-w-none"
        style={{ lineHeight: '1.7' }}
      />

      {/* Raw HTML toggle */}
      <details className="border-t">
        <summary className="px-3 py-1 text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
          View / edit raw HTML
        </summary>
        <textarea
          className="w-full px-3 py-2 text-xs font-mono resize-y bg-gray-50 focus:outline-none"
          rows={5}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (editorRef.current && !isFocused.current) {
              editorRef.current.innerHTML = e.target.value;
            }
          }}
        />
      </details>
    </div>
  );
}
