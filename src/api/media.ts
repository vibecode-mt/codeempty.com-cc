import { Hono } from 'hono';
import type { Env } from '../types';
import { uuid } from '../utils';
import { requireSession, requireSessionOrOAuthWithScope } from './middleware';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// Standard image upload (small files). Accepts session OR an OAuth bearer with
// 'write' scope so cross-instance publish flows can re-upload media against
// the destination without holding a session cookie.
mediaRoutes.post('/upload', requireSessionOrOAuthWithScope('write'), async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const key = `${uuid()}.${ext}`;

  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ key, url: `/api/media/${key}` }, 201);
});

// Chunked video upload — init
mediaRoutes.post('/upload/video/init', requireSession, async (c) => {
  const { filename, contentType } = await c.req.json<{ filename: string; contentType: string }>();
  if (!filename || !contentType) return c.json({ error: 'filename and contentType are required' }, 400);

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  const key = `${uuid()}.${ext}`;
  const upload = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });

  return c.json({ uploadId: upload.uploadId, key });
});

// Chunked video upload — upload one part
mediaRoutes.post('/upload/video/chunk', requireSession, async (c) => {
  const key = c.req.query('key');
  const uploadId = c.req.query('uploadId');
  const partNumber = Number(c.req.query('partNumber'));
  if (!key || !uploadId || !partNumber) return c.json({ error: 'key, uploadId, and partNumber are required' }, 400);

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, c.req.raw.body!);

  return c.json({ etag: part.etag });
});

// Chunked video upload — complete
mediaRoutes.post('/upload/video/complete', requireSession, async (c) => {
  const { key, uploadId, parts } = await c.req.json<{
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }>();
  if (!key || !uploadId || !parts) return c.json({ error: 'key, uploadId, and parts are required' }, 400);

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.complete(parts);

  return c.json({ key, url: `/api/media/${key}` }, 201);
});

// Chunked video upload — abort
mediaRoutes.delete('/upload/video/abort', requireSession, async (c) => {
  const key = c.req.query('key');
  const uploadId = c.req.query('uploadId');
  if (!key || !uploadId) return c.json({ error: 'key and uploadId are required' }, 400);

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.abort();

  return c.json({ ok: true });
});

// Serve media with Range request support for video seeking
mediaRoutes.get('/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const rangeHeader = c.req.header('Range');

  let object: R2ObjectBody | null;
  let status = 200;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const offset = parseInt(match[1], 10);
      const endByte = match[2] ? parseInt(match[2], 10) : undefined;
      const length = endByte !== undefined ? endByte - offset + 1 : undefined;
      object = await c.env.MEDIA.get(key, { range: length !== undefined ? { offset, length } : { offset } });
      status = 206;
    } else {
      object = await c.env.MEDIA.get(key);
    }
  } else {
    object = await c.env.MEDIA.get(key);
  }

  if (!object) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  if (status === 206 && rangeHeader) {
    const size = object.size;
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)!;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(end - start + 1));
    // Videos must not be immutably cached so the browser can seek
    headers.set('cache-control', 'public, max-age=3600');
  } else {
    headers.set('Accept-Ranges', 'bytes');
    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    }
  }

  return new Response(object.body, { status, headers });
});

mediaRoutes.delete('/:key{.+}', requireSession, async (c) => {
  await c.env.MEDIA.delete(c.req.param('key'));
  return c.json({ ok: true });
});
