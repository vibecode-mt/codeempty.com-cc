import { useRef, useState } from 'react';
import { api, type ContentElement, type RenderStyle } from '../api';
import HtmlEditor from './HtmlEditor';
import ImageUpload from './ImageUpload';
import TagsEditor from './TagsEditor';

const RENDER_STYLE_OPTIONS: { value: RenderStyle; label: string; help: string }[] = [
  { value: 'default', label: 'Default (HTML)', help: 'Treat content as raw HTML — the existing editor.' },
  { value: 'markdown', label: 'Markdown', help: 'Parse content as markdown.' },
  { value: 'ai_response', label: 'AI response', help: 'Markdown rendering with an "AI response" callout style.' },
  { value: 'thoughts', label: 'Thoughts', help: 'Markdown rendering styled as inline thoughts.' },
];

function parseUserComment(content: string): { text: string; username: string; profile_url: string; comment_url: string } {
  try {
    const parsed = JSON.parse(content) as { text?: string; username?: string; profile_url?: string; comment_url?: string };
    return {
      text: parsed.text ?? '',
      username: parsed.username ?? '',
      profile_url: parsed.profile_url ?? '',
      comment_url: parsed.comment_url ?? '',
    };
  } catch {
    return { text: content, username: '', profile_url: '', comment_url: '' };
  }
}

function stringifyUserComment(c: { text: string; username: string; profile_url: string; comment_url: string }): string {
  return JSON.stringify({
    text: c.text,
    username: c.username,
    profile_url: c.profile_url || undefined,
    comment_url: c.comment_url || undefined,
  });
}

function formatTimestamp(ms: number) {
  const total = ms / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(1);
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`;
}

interface Props {
  parentType: string;
  parentId: string;
  elements: ContentElement[];
  onChange: (els: ContentElement[]) => void;
}

const TYPES = ['title', 'description', 'image', 'youtube', 'url', 'prompt_code', 'user_comment'];

export default function ContentElementEditor({ parentType, parentId, elements, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('description');
  const [newContent, setNewContent] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  const [newRenderStyle, setNewRenderStyle] = useState<RenderStyle>('default');
  const [newComment, setNewComment] = useState({ text: '', username: '', profile_url: '', comment_url: '' });
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
      } else if (newType === 'user_comment') {
        if (!newComment.text.trim()) {
          setError('Comment text is required');
          return;
        }
        content = stringifyUserComment(newComment);
      }
      const el = await api.createContent(parentType, parentId, {
        type: newType,
        content,
        render_style: newType === 'description' ? newRenderStyle : null,
      });
      onChange([...elements, el]);
      setNewContent('');
      setUrlLabel('');
      setNewComment({ text: '', username: '', profile_url: '', comment_url: '' });
      setNewRenderStyle('default');
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

  async function handleUpdateTags(elId: string, tags: string) {
    const updated = await api.updateContent(elId, { tags });
    onChange(elements.map((e) => (e.id === elId ? updated : e)));
  }

  async function handleUpdateRenderStyle(elId: string, render_style: RenderStyle) {
    const updated = await api.updateContent(elId, { render_style });
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
            onUpdateTags={(t) => handleUpdateTags(el.id, t)}
            onUpdateRenderStyle={(s) => handleUpdateRenderStyle(el.id, s)}
          />
        </div>
      ))}

      {adding ? (
        <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newType}
              onChange={(e) => { setNewType(e.target.value); setNewContent(''); setNewRenderStyle('default'); }}
              className="border rounded px-2 py-1.5 text-sm"
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {newType === 'description' && (
              <select
                value={newRenderStyle}
                onChange={(e) => setNewRenderStyle(e.target.value as RenderStyle)}
                className="border rounded px-2 py-1.5 text-sm"
                title="Render style (default = HTML, others use markdown)"
              >
                {RENDER_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>

          {newType === 'description' ? (
            newRenderStyle === 'default' ? (
              <HtmlEditor value={newContent} onChange={setNewContent} />
            ) : (
              <textarea
                className="w-full border rounded px-3 py-1.5 text-sm resize-y font-mono"
                rows={6}
                placeholder="Markdown — supports headings, lists, code blocks, links, **bold**, *italic*"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
            )
          ) : newType === 'image' ? (
            <ImageUpload value={newContent} onChange={setNewContent} captionEnabled />
          ) : newType === 'url' ? (
            <div className="space-y-2">
              <input placeholder="URL (https://...)" className="w-full border rounded px-3 py-1.5 text-sm" value={newContent} onChange={(e) => setNewContent(e.target.value)} />
              <input placeholder="Label (optional)" className="w-full border rounded px-3 py-1.5 text-sm" value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} />
            </div>
          ) : newType === 'user_comment' ? (
            <div className="space-y-2">
              <input
                placeholder="Username (e.g. @viewer123)"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={newComment.username}
                onChange={(e) => setNewComment({ ...newComment, username: e.target.value })}
              />
              <input
                placeholder="Profile URL (optional)"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={newComment.profile_url}
                onChange={(e) => setNewComment({ ...newComment, profile_url: e.target.value })}
              />
              <input
                placeholder="Link to the comment (optional)"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={newComment.comment_url}
                onChange={(e) => setNewComment({ ...newComment, comment_url: e.target.value })}
              />
              <textarea
                placeholder="Comment text (markdown supported)"
                className="w-full border rounded px-3 py-1.5 text-sm resize-y"
                rows={4}
                value={newComment.text}
                onChange={(e) => setNewComment({ ...newComment, text: e.target.value })}
              />
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

function ElementRow({ el, onDelete, onUpdate, onUpdateTags, onUpdateRenderStyle }: {
  el: ContentElement;
  onDelete: () => void;
  onUpdate: (c: string) => void;
  onUpdateTags: (tags: string) => Promise<void>;
  onUpdateRenderStyle: (s: RenderStyle) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(el.content);
  const [urlHref, setUrlHref] = useState(() => {
    try { return (JSON.parse(el.content) as { href: string }).href; } catch { return el.content; }
  });
  const [urlLabel, setUrlLabel] = useState(() => {
    try { return (JSON.parse(el.content) as { label?: string }).label ?? ''; } catch { return ''; }
  });
  const [comment, setComment] = useState(() => parseUserComment(el.content));

  async function save() {
    let content = draft;
    if (el.type === 'url') content = JSON.stringify({ href: urlHref, label: urlLabel || urlHref });
    else if (el.type === 'user_comment') content = stringifyUserComment(comment);
    await onUpdate(content);
    setEditing(false);
  }

  const preview =
    el.type === 'description' ? (el.render_style && el.render_style !== 'default' ? `(${el.render_style})` : '(HTML)')
    : el.type === 'url' ? urlHref
    : el.type === 'image' ? (() => { try { return (JSON.parse(el.content) as { url?: string }).url ?? el.content; } catch { return el.content; } })()
    : el.type === 'user_comment' ? (() => { const c = parseUserComment(el.content); return c.username ? `${c.username}: ${c.text.slice(0, 80)}` : c.text.slice(0, 100); })()
    : el.content.slice(0, 100);

  const showRenderBadge = el.type === 'description' && el.render_style && el.render_style !== 'default';

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b cursor-grab active:cursor-grabbing">
        <span className="text-gray-300 select-none" title="Drag to reorder">⠿</span>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400 w-24 shrink-0">{el.type}</span>
        {showRenderBadge && (
          <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">
            {el.render_style}
          </span>
        )}
        <div className="flex-1 text-sm text-gray-700 truncate">{preview}</div>
        {el.video_timestamp_ms != null && (
          <span className="text-xs font-mono bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded shrink-0">
            ⏱ {formatTimestamp(el.video_timestamp_ms)}
          </span>
        )}
        <TagsEditor tags={el.tags} onChange={onUpdateTags} className="shrink-0" />
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button onClick={() => setEditing(!editing)} className="px-2 py-0.5 text-xs border rounded hover:bg-gray-100">{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={onDelete} className="px-2 py-0.5 text-xs border rounded text-red-500 hover:bg-red-50">Delete</button>
        </div>
      </div>

      {editing && (
        <div className="p-3 space-y-2">
          {el.type === 'description' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Render style:</span>
              <select
                value={el.render_style ?? 'default'}
                onChange={(e) => onUpdateRenderStyle(e.target.value as RenderStyle)}
                className="border rounded px-2 py-1 text-xs"
              >
                {RENDER_STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="text-gray-400">{RENDER_STYLE_OPTIONS.find((o) => o.value === (el.render_style ?? 'default'))?.help}</span>
            </div>
          )}
          {el.type === 'description' ? (
            (el.render_style ?? 'default') === 'default' ? (
              <HtmlEditor value={draft} onChange={setDraft} />
            ) : (
              <textarea
                className="w-full border rounded px-3 py-1.5 text-sm resize-y font-mono"
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Markdown content"
              />
            )
          ) : el.type === 'image' ? (
            <ImageUpload value={draft} onChange={setDraft} captionEnabled />
          ) : el.type === 'url' ? (
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={urlHref} onChange={(e) => setUrlHref(e.target.value)} placeholder="URL" />
              <input className="w-full border rounded px-3 py-1.5 text-sm" value={urlLabel} onChange={(e) => setUrlLabel(e.target.value)} placeholder="Label" />
            </div>
          ) : el.type === 'user_comment' ? (
            <div className="space-y-2">
              <input
                placeholder="Username"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={comment.username}
                onChange={(e) => setComment({ ...comment, username: e.target.value })}
              />
              <input
                placeholder="Profile URL (optional)"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={comment.profile_url}
                onChange={(e) => setComment({ ...comment, profile_url: e.target.value })}
              />
              <input
                placeholder="Link to the comment (optional)"
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={comment.comment_url}
                onChange={(e) => setComment({ ...comment, comment_url: e.target.value })}
              />
              <textarea
                placeholder="Comment text (markdown supported)"
                className="w-full border rounded px-3 py-1.5 text-sm resize-y"
                rows={4}
                value={comment.text}
                onChange={(e) => setComment({ ...comment, text: e.target.value })}
              />
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
