import { useRef, useState } from 'react';
import { api, type ContentElement } from '../api';
import HtmlEditor from './HtmlEditor';
import ImageUpload from './ImageUpload';

interface Props {
  parentType: string;
  parentId: string;
  elements: ContentElement[];
  onChange: (els: ContentElement[]) => void;
}

const TYPES = ['title', 'description', 'image', 'youtube', 'url', 'prompt_code'];

export default function ContentElementEditor({ parentType, parentId, elements, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('description');
  const [newContent, setNewContent] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  const [error, setError] = useState('');

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  async function handleAdd() {
    setError('');
    try {
      let content = newContent;
      if (newType === 'url') {
        content = JSON.stringify({ href: newContent, label: urlLabel || newContent });
      }
      const el = await api.createContent(parentType, parentId, { type: newType, content });
      onChange([...elements, el]);
      setNewContent('');
      setUrlLabel('');
      setAdding(false);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(elId: string) {
    if (!confirm('Delete this element?')) return;
    await api.deleteContent(elId);
    onChange(elements.filter((e) => e.id !== elId));
  }

  async function handleUpdate(elId: string, content: string) {
    const updated = await api.updateContent(elId, { content });
    onChange(elements.map((e) => (e.id === elId ? updated : e)));
  }

  // Drag handlers — stopPropagation prevents bubbling into a parent step div's drag handlers
  function onDragStart(e: React.DragEvent, index: number) {
    e.stopPropagation();
    dragIndex.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.stopPropagation();
    e.preventDefault();
    setDragOver(index);
  }

  async function onDrop(e: React.DragEvent, toIndex: number) {
    e.stopPropagation();
    e.preventDefault();
    const fromIndex = dragIndex.current;
    if (fromIndex === null || fromIndex === toIndex) {
      dragIndex.current = null;
      setDragOver(null);
      return;
    }
    const next = [...elements];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const orders = next.map((el, i) => ({ id: el.id, sort_order: i }));
    onChange(next);
    dragIndex.current = null;
    setDragOver(null);
    await api.reorderContent(orders);
  }

  return (
    <div className="space-y-2">
      {elements.map((el, i) => (
        <div
          key={el.id}
          draggable
          onDragStart={(e) => onDragStart(e, i)}
          onDragOver={(e) => onDragOver(e, i)}
          onDragLeave={(e) => { e.stopPropagation(); setDragOver(null); }}
          onDrop={(e) => onDrop(e, i)}
          className={`border rounded-lg bg-white overflow-hidden transition-all ${dragOver === i && dragIndex.current !== i ? 'border-blue-400 shadow-md' : ''}`}
        >
          <ElementRow
            el={el}
            onDelete={() => handleDelete(el.id)}
            onUpdate={(c) => handleUpdate(el.id, c)}
          />
        </div>
      ))}

      {adding ? (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <select
            value={newType}
            onChange={(e) => { setNewType(e.target.value); setNewContent(''); }}
            className="border rounded px-2 py-1.5 text-sm"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          {newType === 'description' ? (
            <HtmlEditor value={newContent} onChange={setNewContent} />
          ) : newType === 'image' ? (
            <ImageUpload value={newContent} onChange={setNewContent} captionEnabled />
          ) : newType === 'url' ? (
            <div className="space-y-2">
              <input placeholder="URL (https://...)" className="w-full border rounded px-3 py-1.5 text-sm" value={newContent} onChange={(e) => setNewContent(e.target.value)} />
              <input placeholder="Label (optional)" className="w-full border rounded px-3 py-1.5 text-sm" value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} />
            </div>
          ) : (
            <textarea
              className="w-full border rounded px-3 py-1.5 text-sm resize-y font-mono"
              rows={4}
              placeholder={newType === 'youtube' ? 'YouTube URL or video ID' : newType === 'title' ? 'Heading text' : 'Content'}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
            />
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Add</button>
            <button onClick={() => { setAdding(false); setError(''); setNewContent(''); }} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full border-2 border-dashed rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          + Add content element
        </button>
      )}

      {elements.length > 1 && !adding && (
        <p className="text-xs text-gray-400 text-center">Drag elements to reorder</p>
      )}
    </div>
  );
}

function ElementRow({ el, onDelete, onUpdate }: {
  el: ContentElement;
  onDelete: () => void;
  onUpdate: (c: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(el.content);
  const [urlHref, setUrlHref] = useState(() => {
    try { return (JSON.parse(el.content) as { href: string }).href; } catch { return el.content; }
  });
  const [urlLabel, setUrlLabel] = useState(() => {
    try { return (JSON.parse(el.content) as { label?: string }).label ?? ''; } catch { return ''; }
  });

  async function save() {
    let content = draft;
    if (el.type === 'url') content = JSON.stringify({ href: urlHref, label: urlLabel || urlHref });
    await onUpdate(content);
    setEditing(false);
  }

  const preview =
    el.type === 'description' ? '(HTML)'
    : el.type === 'url' ? urlHref
    : el.type === 'image' ? (() => { try { return (JSON.parse(el.content) as { url?: string }).url ?? el.content; } catch { return el.content; } })()
    : el.content.slice(0, 100);

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b cursor-grab active:cursor-grabbing">
        <span className="text-gray-300 select-none" title="Drag to reorder">⠿</span>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400 w-24 shrink-0">{el.type}</span>
        <div className="flex-1 text-sm text-gray-700 truncate">{preview}</div>
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button onClick={() => setEditing(!editing)} className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100">{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={onDelete} className="px-2 py-0.5 text-xs border rounded text-red-500 hover:bg-red-50">Delete</button>
        </div>
      </div>

      {editing && (
        <div className="p-3 space-y-2">
          {el.type === 'description' ? (
            <HtmlEditor value={draft} onChange={setDraft} />
          ) : el.type === 'image' ? (
            <ImageUpload value={draft} onChange={setDraft} captionEnabled />
          ) : el.type === 'url' ? (
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={urlHref} onChange={(e) => setUrlHref(e.target.value)} placeholder="URL" />
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} placeholder="Label" />
            </div>
          ) : (
            <textarea className="w-full border rounded px-3 py-1.5 text-sm font-mono resize-y" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
          )}
          <button onClick={save} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Save</button>
        </div>
      )}
    </>
  );
}
