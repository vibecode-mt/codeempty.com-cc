import { useState } from 'react';
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

  async function handleAdd() {
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
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this element?')) return;
    await api.deleteContent(id);
    onChange(elements.filter((e) => e.id !== id));
  }

  async function handleUpdate(id: string, content: string) {
    const updated = await api.updateContent(id, { content });
    onChange(elements.map((e) => (e.id === id ? updated : e)));
  }

  async function moveUp(index: number) {
    if (index === 0) return;
    const next = [...elements];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    const orders = next.map((e, i) => ({ id: e.id, sort_order: i }));
    await api.reorderContent(orders);
    onChange(next);
  }

  async function moveDown(index: number) {
    if (index === elements.length - 1) return;
    const next = [...elements];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    const orders = next.map((e, i) => ({ id: e.id, sort_order: i }));
    await api.reorderContent(orders);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {elements.map((el, i) => (
        <ElementRow
          key={el.id}
          el={el}
          onDelete={() => handleDelete(el.id)}
          onUpdate={(c) => handleUpdate(el.id, c)}
          onMoveUp={() => moveUp(i)}
          onMoveDown={() => moveDown(i)}
          isFirst={i === 0}
          isLast={i === elements.length - 1}
        />
      ))}

      {adding ? (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex gap-3">
            <select
              value={newType}
              onChange={(e) => { setNewType(e.target.value); setNewContent(''); }}
              className="border rounded px-2 py-1.5 text-sm"
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {newType === 'description' ? (
            <HtmlEditor value={newContent} onChange={setNewContent} rows={6} />
          ) : newType === 'image' ? (
            <ImageUpload value={newContent} onChange={setNewContent} />
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
            <button onClick={() => { setAdding(false); setError(''); }} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full border-2 border-dashed rounded-lg py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors">
          + Add content element
        </button>
      )}
    </div>
  );
}

function ElementRow({ el, onDelete, onUpdate, onMoveUp, onMoveDown, isFirst, isLast }: {
  el: ContentElement;
  onDelete: () => void;
  onUpdate: (c: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(el.content);
  const [urlHref, setUrlHref] = useState(() => {
    try { return (JSON.parse(el.content) as { href: string }).href; } catch { return el.content; }
  });
  const [urlLabel, setUrlLabel] = useState(() => {
    try { return (JSON.parse(el.content) as { label: string }).label ?? ''; } catch { return ''; }
  });

  async function save() {
    let content = draft;
    if (el.type === 'url') content = JSON.stringify({ href: urlHref, label: urlLabel || urlHref });
    await onUpdate(content);
    setEditing(false);
  }

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400 w-24">{el.type}</span>
        <div className="flex-1 text-sm text-gray-700 truncate">
          {el.type === 'description' ? '(HTML)' : el.type === 'url' ? urlHref : el.content.slice(0, 80)}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={onMoveUp} disabled={isFirst} className="px-1.5 py-0.5 text-xs border rounded disabled:opacity-30 hover:bg-gray-100">↑</button>
          <button onClick={onMoveDown} disabled={isLast} className="px-1.5 py-0.5 text-xs border rounded disabled:opacity-30 hover:bg-gray-100">↓</button>
          <button onClick={() => setEditing(!editing)} className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100">{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={onDelete} className="px-2 py-0.5 text-xs border rounded text-red-500 hover:bg-red-50">Delete</button>
        </div>
      </div>

      {editing && (
        <div className="p-3 space-y-2">
          {el.type === 'description' ? (
            <HtmlEditor value={draft} onChange={setDraft} />
          ) : el.type === 'image' ? (
            <ImageUpload value={draft} onChange={setDraft} />
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
    </div>
  );
}
