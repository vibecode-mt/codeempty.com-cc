import { Hono } from 'hono';
import type { Env } from '../types';
import { uuid } from '../utils';
import { requireAdmin } from './middleware';

export const mediaRoutes = new Hono<{ Bindings: Env }>();

// Standard image upload (small files). Accepts session OR an OAuth bearer with
// 'write' scope so cross-instance publish flows can re-upload media against
// the destination without holding a session cookie.
mediaRoutes.post('/upload', requireAdmin, async (c) => {
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

// Verify the requesting user owns this multipart upload (i.e. they're the
// session that called /init for this uploadId+key). Without this, any
// authenticated user could push parts into someone else's upload.
async function ownsUpload(env: Env, uploadId: string, key: string, userId: string): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT user_id FROM upload_sessions WHERE upload_id = ? AND r2_key = ?')
    .bind(uploadId, key)
    .first<{ user_id: string }>();
  return !!row && row.user_id === userId;
}

// Chunked video upload — init
mediaRoutes.post('/upload/video/init', requireAdmin, async (c) => {
  const { filename, contentType } = await c.req.json<{ filename: string; contentType: string }>();
  if (!filename || !contentType) return c.json({ error: 'filename and contentType are required' }, 400);

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin';
  const key = `${uuid()}.${ext}`;
  const upload = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });

  const userId = (c.get('userId' as never) as string | undefined) ?? '';
  await c.env.DB
    .prepare('INSERT INTO upload_sessions (upload_id, r2_key, user_id, purpose) VALUES (?, ?, ?, ?)')
    .bind(upload.uploadId, key, userId, 'media')
    .run();

  return c.json({ uploadId: upload.uploadId, key });
});

// Chunked video upload — upload one part
mediaRoutes.post('/upload/video/chunk', requireAdmin, async (c) => {
  const key = c.req.query('key');
  const uploadId = c.req.query('uploadId');
  const partNumber = Number(c.req.query('partNumber'));
  if (!key || !uploadId || !partNumber) return c.json({ error: 'key, uploadId, and partNumber are required' }, 400);

  const userId = (c.get('userId' as never) as string | undefined) ?? '';
  if (!(await ownsUpload(c.env, uploadId, key, userId))) {
    return c.json({ error: 'Not the owner of this upload session' }, 403);
  }

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, c.req.raw.body!);

  return c.json({ etag: part.etag });
});

// Chunked video upload — complete
mediaRoutes.post('/upload/video/complete', requireAdmin, async (c) => {
  const { key, uploadId, parts } = await c.req.json<{
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }>();
  if (!key || !uploadId || !parts) return c.json({ error: 'key, uploadId, and parts are required' }, 400);

  const userId = (c.get('userId' as never) as string | undefined) ?? '';
  if (!(await ownsUpload(c.env, uploadId, key, userId))) {
    return c.json({ error: 'Not the owner of this upload session' }, 403);
  }

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.complete(parts);

  // Drop the ownership row — the multipart session is gone so no one will
  // call chunk/complete with this id again.
  await c.env.DB
    .prepare('DELETE FROM upload_sessions WHERE upload_id = ? AND r2_key = ?')
    .bind(uploadId, key)
    .run();

  return c.json({ key, url: `/api/media/${key}` }, 201);
});

// Chunked video upload — abort
mediaRoutes.delete('/upload/video/abort', requireAdmin, async (c) => {
  const key = c.req.query('key');
  const uploadId = c.req.query('uploadId');
  if (!key || !uploadId) return c.json({ error: 'key and uploadId are required' }, 400);

  const userId = (c.get('userId' as never) as string | undefined) ?? '';
  if (!(await ownsUpload(c.env, uploadId, key, userId))) {
    return c.json({ error: 'Not the owner of this upload session' }, 403);
  }

  const upload = c.env.MEDIA.resumeMultipartUpload(key, uploadId);
  await upload.abort();

  await c.env.DB
    .prepare('DELETE FROM upload_sessions WHERE upload_id = ? AND r2_key = ?')
    .bind(uploadId, key)
    .run();

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

mediaRoutes.delete('/:key{.+}', requireAdmin, async (c) => {
  await c.env.MEDIA.delete(c.req.param('key'));
  return c.json({ ok: true });
});
