import { zip, unzip } from 'fflate';
import type { Project, ProjectStep, ContentElement, ExportData, BundleManifest } from '../api';
export type { ExportData, BundleManifest };

export interface BundleProgress {
  phase: 'fetching-media' | 'compressing' | 'done';
  current: number;
  total: number;
  label: string;
}

// /api/media/<key>  →  ./media/<key>. Returns input unchanged if it's an
// external URL we don't own.
function rewriteUrl(url: string | null | undefined, mode: 'export' | 'import'): string | null {
  if (!url) return url ?? null;
  if (mode === 'export') {
    const m = url.match(/^\/api\/media\/(.+)$/);
    if (m) return `./media/${m[1]}`;
    return url;
  }
  // import: ./media/<key>  →  /api/media/<key>  (after key remap)
  const m = url.match(/^\.?\/?media\/(.+)$/);
  if (m) return `/api/media/${m[1]}`;
  return url;
}

// Build a project payload safe for the bundle: all R2-owned URLs become
// ./media/<key> so the bundle is self-contained. External URLs (youtube,
// url-element href, user_comment profile_url/comment_url) are left alone.
function rewriteForExport(project: Project, elements: ContentElement[]): {
  project: Project;
  elements: ContentElement[];
} {
  const p: Project = {
    ...project,
    image_url: rewriteUrl(project.image_url, 'export'),
    video_url: rewriteUrl(project.video_url, 'export'),
    // video_key stays as a raw key — already relative.
  };
  const els: ContentElement[] = elements.map((e) => {
    if (e.type !== 'image') return e;
    try {
      const parsed = JSON.parse(e.content) as { url?: string; caption?: string };
      if (parsed.url) parsed.url = rewriteUrl(parsed.url, 'export') ?? parsed.url;
      return { ...e, content: JSON.stringify(parsed) };
    } catch { return e; }
  });
  return { project: p, elements: els };
}

// Builds a Blob suitable for download. Memory-bound: a 100MB project sits
// in browser memory once. For larger, consider a streaming approach with the
// File System Access API.
export async function buildBundle(
  data: ExportData,
  onProgress?: (p: BundleProgress) => void,
): Promise<Blob> {
  const enc = new TextEncoder();
  const files: Record<string, [Uint8Array, { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {};

  files['manifest.json'] = [enc.encode(JSON.stringify(data.manifest, null, 2)), {}];

  const rewritten = rewriteForExport(data.project, data.elements);
  files['project.json'] = [
    enc.encode(JSON.stringify({
      project: rewritten.project,
      steps: data.steps,
      elements: rewritten.elements,
    }, null, 2)),
    {},
  ];

  for (let i = 0; i < data.media.length; i++) {
    const m = data.media[i];
    onProgress?.({
      phase: 'fetching-media',
      current: i,
      total: data.media.length,
      label: `Fetching ${m.key}`,
    });
    const res = await fetch(m.url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch ${m.key}: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    files[`media/${m.key}`] = [buf, { level: 0 }]; // already-compressed media — STORE
  }

  onProgress?.({
    phase: 'compressing',
    current: data.media.length,
    total: data.media.length,
    label: 'Building archive…',
  });

  const zipBytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  onProgress?.({
    phase: 'done',
    current: data.media.length,
    total: data.media.length,
    label: 'Done',
  });

  // The double-cast works around a Uint8Array<ArrayBufferLike> vs BlobPart
  // mismatch in newer TS DOM lib; the runtime type is fine for Blob().
  return new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
}

export interface ParsedBundle {
  manifest: BundleManifest;
  project: Project;
  steps: ProjectStep[];
  elements: ContentElement[];
  media: Map<string, Uint8Array>; // key (without "media/" prefix) → bytes
}

export async function readBundle(blob: Blob): Promise<ParsedBundle> {
  const ab = await blob.arrayBuffer();
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(new Uint8Array(ab), (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  const dec = new TextDecoder();
  const manifestBytes = entries['manifest.json'];
  const projectBytes = entries['project.json'];
  if (!manifestBytes || !projectBytes) {
    throw new Error('Bundle is missing manifest.json or project.json');
  }

  const manifest = JSON.parse(dec.decode(manifestBytes)) as BundleManifest;
  const projectPayload = JSON.parse(dec.decode(projectBytes)) as {
    project: Project;
    steps: ProjectStep[];
    elements: ContentElement[];
  };

  const media = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith('media/')) {
      media.set(name.slice('media/'.length), bytes);
    }
  }

  return {
    manifest,
    project: projectPayload.project,
    steps: projectPayload.steps,
    elements: projectPayload.elements,
    media,
  };
}

// Translate ./media/<key> URLs in a parsed bundle to /api/media/<newKey> using
// a remap from oldKey → newKey produced when re-uploading media on import.
export function rewriteForImport(
  project: Project,
  elements: ContentElement[],
  keyMap: Map<string, string>,
): { project: Project; elements: ContentElement[] } {
  const remap = (url: string | null | undefined): string | null => {
    if (!url) return url ?? null;
    const m = url.match(/^\.?\/?media\/(.+)$/);
    if (!m) return url;
    const oldKey = m[1];
    const newKey = keyMap.get(oldKey) ?? oldKey;
    return `/api/media/${newKey}`;
  };
  const p: Project = {
    ...project,
    image_url: remap(project.image_url),
    video_url: remap(project.video_url),
    video_key: project.video_key ? (keyMap.get(project.video_key) ?? project.video_key) : null,
  };
  const els: ContentElement[] = elements.map((e) => {
    if (e.type !== 'image') return e;
    try {
      const parsed = JSON.parse(e.content) as { url?: string; caption?: string };
      if (parsed.url) parsed.url = remap(parsed.url) ?? parsed.url;
      return { ...e, content: JSON.stringify(parsed) };
    } catch { return e; }
  });
  return { project: p, elements: els };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke to next tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
