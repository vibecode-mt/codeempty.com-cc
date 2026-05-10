import { unzip, zip } from 'fflate';
import type { SiteExportPayload } from '../api';

export interface SiteTransferProgress {
  phase: 'fetching-media' | 'uploading-media' | 'compressing' | 'done';
  current: number;
  total: number;
  label: string;
}

export interface ParsedSiteArchive {
  payload: SiteExportPayload;
  media: Map<string, Uint8Array>;
}

function rewriteUrl(
  value: string | null | undefined,
  mode: 'export' | 'import',
  keyMap?: Map<string, string>,
): string | null {
  if (!value) return value ?? null;

  const match = value.match(mode === 'export' ? /^\/api\/media\/(.+)$/ : /^(?:\/api\/media\/|\.?\/?media\/)(.+)$/);
  if (!match) return value;

  const oldKey = match[1];
  if (mode === 'export') return `./media/${oldKey}`;
  const newKey = keyMap?.get(oldKey) ?? oldKey;
  return `/api/media/${newKey}`;
}

function rewritePayloadForExport(payload: SiteExportPayload): SiteExportPayload {
  const cloned: SiteExportPayload = JSON.parse(JSON.stringify(payload));
  const projects = Array.isArray(cloned.tables.projects) ? cloned.tables.projects : [];
  const elements = Array.isArray(cloned.tables.content_elements) ? cloned.tables.content_elements : [];

  for (const row of projects) {
    if (typeof row.image_url === 'string') row.image_url = rewriteUrl(row.image_url, 'export');
    if (typeof row.video_url === 'string') row.video_url = rewriteUrl(row.video_url, 'export');
  }

  for (const row of elements) {
    if (row.type !== 'image' || typeof row.content !== 'string') continue;
    try {
      const parsed = JSON.parse(row.content) as { url?: string; caption?: string };
      if (typeof parsed.url === 'string') {
        parsed.url = rewriteUrl(parsed.url, 'export') ?? parsed.url;
      }
      row.content = JSON.stringify(parsed);
    } catch {
      // Keep legacy/plain content as-is.
    }
  }

  return cloned;
}

export function rewritePayloadForImport(payload: SiteExportPayload, keyMap: Map<string, string>): SiteExportPayload {
  const cloned: SiteExportPayload = JSON.parse(JSON.stringify(payload));
  const projects = Array.isArray(cloned.tables.projects) ? cloned.tables.projects : [];
  const elements = Array.isArray(cloned.tables.content_elements) ? cloned.tables.content_elements : [];

  for (const row of projects) {
    if (typeof row.image_url === 'string') row.image_url = rewriteUrl(row.image_url, 'import', keyMap);
    if (typeof row.video_url === 'string') row.video_url = rewriteUrl(row.video_url, 'import', keyMap);
    if (typeof row.video_key === 'string') row.video_key = keyMap.get(row.video_key) ?? row.video_key;
  }

  for (const row of elements) {
    if (row.type !== 'image' || typeof row.content !== 'string') continue;
    try {
      const parsed = JSON.parse(row.content) as { url?: string; caption?: string };
      if (typeof parsed.url === 'string') {
        parsed.url = rewriteUrl(parsed.url, 'import', keyMap) ?? parsed.url;
      }
      row.content = JSON.stringify(parsed);
    } catch {
      // Keep legacy/plain content as-is.
    }
  }

  return cloned;
}

export async function buildSiteArchive(
  payload: SiteExportPayload,
  onProgress?: (p: SiteTransferProgress) => void,
): Promise<Blob> {
  const exportPayload = rewritePayloadForExport(payload);
  const media = Array.isArray(payload.media) ? payload.media : [];
  const enc = new TextEncoder();
  const files: Record<string, [Uint8Array, { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }]> = {
    'export.json': [enc.encode(JSON.stringify(exportPayload, null, 2)), {}],
  };

  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    onProgress?.({
      phase: 'fetching-media',
      current: i,
      total: media.length,
      label: `Fetching ${item.key}`,
    });
    const res = await fetch(item.url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch ${item.key}: ${res.status}`);
    files[`media/${item.key}`] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
  }

  onProgress?.({ phase: 'compressing', current: media.length, total: media.length, label: 'Building archive…' });
  const zipBytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
  onProgress?.({ phase: 'done', current: media.length, total: media.length, label: 'Done' });

  return new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
}

export async function readSiteArchive(file: File): Promise<ParsedSiteArchive> {
  const isLikelyJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
  if (isLikelyJson) {
    const payload = JSON.parse(await file.text()) as SiteExportPayload;
    return { payload, media: new Map<string, Uint8Array>() };
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(fileBytes, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  const exportJson = entries['export.json'];
  if (!exportJson) throw new Error('Archive is missing export.json');
  const payload = JSON.parse(new TextDecoder().decode(exportJson)) as SiteExportPayload;
  const media = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('media/')) continue;
    media.set(name.slice('media/'.length), bytes);
  }
  return { payload, media };
}
