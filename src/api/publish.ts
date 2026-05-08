// Server-side publish: kicks off a long-running job that copies a project to a
// remote destination via the destination's public APIs. Lives in publish_jobs;
// progresses via recursive /process invocations so the work survives the
// per-Worker-invocation budget on the free tier (50 subrequests, ~30s).
//
// Caller flow:
//   POST /api/projects/:id/publish        -> { job_id, status: 'pending' }
//   GET  /api/publish/jobs/:jobId         -> live progress + result when done
// Internal:
//   POST /api/publish/jobs/:jobId/process -> recursive worker continuation
import { Hono } from 'hono';
import type { Env, PublishDestination, PublishJob, Project, ProjectStep, ContentElement } from '../types';
import { uuid, now } from '../utils';
import { requireAdmin } from './middleware';

export const publishRoutes = new Hono<{ Bindings: Env }>();

// Tunables. MAX_PER_INVOCATION is the per-Worker-invocation upload cap; it
// has to leave headroom for the bootstrap fetch (token), the final import,
// and the self-recursion fetch. Free tier is 50 subrequests/invocation.
const MAX_PER_INVOCATION = 35;
const PARALLELISM = 4;

interface PublishState {
  destApiUrl: string;
  destToken: string;
  destTokenExpiresAt: string; // ISO
  keyMap: Record<string, string>;
  droppedKeys: string[];
  prePublishVersionId: string | null;
}

interface SnapshotShape {
  format_version: number;
  project: Project;
  steps: ProjectStep[];
  elements: ContentElement[];
}

// Return only the fields we want to expose; state_json is internal.
function publicShape(j: PublishJob): Omit<PublishJob, 'state_json'> {
  const { state_json: _omit, ...rest } = j;
  return rest;
}

// GET — live progress (poll endpoint)
publishRoutes.get('/jobs/:jobId', requireAdmin, async (c) => {
  const job = await c.env.DB.prepare('SELECT * FROM publish_jobs WHERE id = ?')
    .bind(c.req.param('jobId'))
    .first<PublishJob>();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  return c.json(publicShape(job));
});

// POST — internal continuation hook. Called by the worker recursing into itself.
publishRoutes.post('/jobs/:jobId/process', requireAdmin, async (c) => {
  const jobId = c.req.param('jobId');
  const origin = new URL(c.req.url).origin;
  const auth = c.req.header('Authorization') ?? '';
  c.executionCtx.waitUntil(processPublishJob(c.env, jobId, origin, auth));
  return c.json({ ok: true, jobId });
});

// Public entry point — exported for projects.ts to mount under
// POST /api/projects/:id/publish.
export async function startPublishJob(
  env: Env,
  ctx: ExecutionContext,
  origin: string,
  authHeader: string,
  args: {
    projectId: string;
    destinationId: string;
    mode: 'create' | 'replace';
    targetProjectId: string | null;
    label: string | null;
    createdBy: string | null;
  },
): Promise<{ ok: true; jobId: string } | { ok: false; status: 400 | 404; error: string }> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(args.projectId).first();
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const dest = await env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?').bind(args.destinationId).first();
  if (!dest) return { ok: false, status: 404, error: 'Destination not found' };
  if (args.mode !== 'create' && args.mode !== 'replace') {
    return { ok: false, status: 400, error: 'mode must be "create" or "replace"' };
  }

  const jobId = uuid();
  await env.DB
    .prepare(
      `INSERT INTO publish_jobs (id, project_id, destination_id, mode, target_project_id, label, status, progress_label, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 'Queued', ?)`,
    )
    .bind(
      jobId,
      args.projectId,
      args.destinationId,
      args.mode,
      args.targetProjectId,
      args.label,
      args.createdBy,
    )
    .run();

  // Kick off processing in the background. Returns immediately to the caller.
  ctx.waitUntil(processPublishJob(env, jobId, origin, authHeader));
  return { ok: true, jobId };
}

// Per-invocation worker step. Loads job state, makes progress, then either
// finalizes or self-recurses with another /process call.
export async function processPublishJob(
  env: Env,
  jobId: string,
  origin: string,
  authHeader: string,
): Promise<void> {
  const job = await env.DB.prepare('SELECT * FROM publish_jobs WHERE id = ?').bind(jobId).first<PublishJob>();
  if (!job) return;
  if (job.status === 'done' || job.status === 'failed') return;

  // Mark processing (idempotent)
  await env.DB
    .prepare("UPDATE publish_jobs SET status = 'processing', updated_at = ? WHERE id = ? AND status IN ('pending','processing')")
    .bind(now(), jobId)
    .run();

  let state: PublishState = job.state_json
    ? (JSON.parse(job.state_json) as PublishState)
    : { destApiUrl: '', destToken: '', destTokenExpiresAt: '', keyMap: {}, droppedKeys: [], prePublishVersionId: null };

  try {
    // 1) Bootstrap: snapshot source + obtain dest bearer (only first invocation).
    if (!state.destToken || !state.destApiUrl) {
      await setProgress(env, jobId, 'Snapshotting source project');
      const dest = await env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?').bind(job.destination_id).first<PublishDestination>();
      if (!dest) throw new Error('Destination disappeared');

      const tokenRes = await fetch(`${dest.api_url}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: dest.client_id,
          client_secret: dest.client_secret,
        }),
      });
      if (!tokenRes.ok) {
        const t = await tokenRes.text();
        throw new Error(`Destination /oauth/token: ${tokenRes.status} ${t.slice(0, 200)}`);
      }
      const tokenData = await tokenRes.json<{ access_token: string; expires_in: number }>();
      state.destApiUrl = dest.api_url;
      state.destToken = tokenData.access_token;
      state.destTokenExpiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();

      // Auto-snapshot source so the publish is reversible
      const snap = await snapshotProjectToVersions(env, job.project_id, 'publish', `Before publish to ${dest.name}`, job.created_by);
      state.prePublishVersionId = snap.id;
      await persistState(env, jobId, state);
    }

    // Refresh dest token if near expiry
    if (state.destTokenExpiresAt && new Date(state.destTokenExpiresAt).getTime() < Date.now()) {
      const dest = await env.DB.prepare('SELECT * FROM publish_destinations WHERE id = ?').bind(job.destination_id).first<PublishDestination>();
      if (!dest) throw new Error('Destination disappeared');
      const tokenRes = await fetch(`${dest.api_url}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: dest.client_id,
          client_secret: dest.client_secret,
        }),
      });
      if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json<{ access_token: string; expires_in: number }>();
      state.destToken = tokenData.access_token;
      state.destTokenExpiresAt = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();
      await persistState(env, jobId, state);
    }

    // 2) Build the latest snapshot every invocation. Cheap (D1 reads), avoids
    // staleness, and keeps state_json from ballooning with the full payload.
    const snapshot = await buildSnapshot(env, job.project_id);
    const allKeys = collectMediaKeys(snapshot.project, snapshot.elements);

    // Skip the project's source-video R2 file — it's typically gigabytes and
    // exceeds the destination's single-shot upload body limit.
    const skipKeys = new Set<string>();
    if (snapshot.project.video_key) skipKeys.add(snapshot.project.video_key);

    const targets = allKeys.filter((k) => !skipKeys.has(k));
    const remaining = targets.filter((k) => !state.keyMap[k]);

    await env.DB
      .prepare("UPDATE publish_jobs SET progress_total = ?, progress_current = ?, progress_label = ?, updated_at = ? WHERE id = ?")
      .bind(targets.length, targets.length - remaining.length, `Uploading media (${targets.length - remaining.length}/${targets.length})`, now(), jobId)
      .run();

    // 3) Upload up to MAX_PER_INVOCATION media files this round.
    const slice = remaining.slice(0, MAX_PER_INVOCATION);

    for (let i = 0; i < slice.length; i += PARALLELISM) {
      const batch = slice.slice(i, i + PARALLELISM);
      const results = await Promise.all(batch.map((oldKey) => uploadOne(env, state, oldKey)));
      for (const r of results) {
        if ('error' in r) {
          throw new Error(`Upload failed for ${r.oldKey}: ${r.error}`);
        }
        state.keyMap[r.oldKey] = r.newKey;
      }
      // Save state every batch so a crash can resume
      await persistState(env, jobId, state);
      await env.DB
        .prepare("UPDATE publish_jobs SET progress_current = progress_current + ?, progress_label = ?, updated_at = ? WHERE id = ?")
        .bind(batch.length, `Uploading media (${Object.keys(state.keyMap).length}/${targets.length})`, now(), jobId)
        .run();
    }

    // 4) Are we done?
    const stillRemaining = targets.filter((k) => !state.keyMap[k]);
    if (stillRemaining.length > 0) {
      // Continue in another invocation. The fetch reuses the caller's auth so
      // the recursive endpoint still passes requireAdmin.
      await setProgress(env, jobId, `Uploading media (${Object.keys(state.keyMap).length}/${targets.length}) — continuing…`);
      await fetch(`${origin}/api/publish/jobs/${jobId}/process`, {
        method: 'POST',
        headers: { Authorization: authHeader },
      });
      return;
    }

    // 5) Finalize: rewrite URLs and POST /api/projects/import on destination.
    await setProgress(env, jobId, 'Saving project on destination');
    state.droppedKeys = Array.from(skipKeys);
    const droppedSet = skipKeys;
    const project = rewriteProjectMediaUrls(snapshot.project, state.keyMap, droppedSet);
    const elements = rewriteImageUrls(snapshot.elements, state.keyMap);

    const importRes = await fetch(`${state.destApiUrl}/api/projects/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.destToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manifest: {
          format_version: 1,
          exported_at: now(),
          source_slug: snapshot.project.slug,
          stats: {
            step_count: snapshot.steps.length,
            element_count: snapshot.elements.length,
            media_count: targets.length,
          },
        },
        project,
        steps: snapshot.steps,
        elements,
        mode: job.mode,
        target_project_id: job.target_project_id,
        idempotency_key: jobId, // job id IS our idempotency key
        label: job.label ?? `Published from ${snapshot.project.slug}`,
      }),
    });
    if (!importRes.ok) {
      const text = await importRes.text();
      throw new Error(`Destination /import: ${importRes.status} ${text.slice(0, 300)}`);
    }
    const result = await importRes.json<{ project_id: string; slug: string; version_id?: string }>();

    await env.DB
      .prepare(
        "UPDATE publish_jobs SET status = 'done', result_project_id = ?, result_slug = ?, progress_label = ?, updated_at = ? WHERE id = ?",
      )
      .bind(result.project_id, result.slug, 'Done', now(), jobId)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB
      .prepare("UPDATE publish_jobs SET status = 'failed', error = ?, progress_label = ?, updated_at = ? WHERE id = ?")
      .bind(msg, 'Failed', now(), jobId)
      .run();
  }
}

async function setProgress(env: Env, jobId: string, label: string): Promise<void> {
  await env.DB
    .prepare("UPDATE publish_jobs SET progress_label = ?, updated_at = ? WHERE id = ?")
    .bind(label, now(), jobId)
    .run();
}

async function persistState(env: Env, jobId: string, state: PublishState): Promise<void> {
  await env.DB
    .prepare("UPDATE publish_jobs SET state_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(state), now(), jobId)
    .run();
}

interface UploadOk { oldKey: string; newKey: string }
interface UploadErr { oldKey: string; error: string }

async function uploadOne(env: Env, state: PublishState, oldKey: string): Promise<UploadOk | UploadErr> {
  // R2 binding read on the source — does not count against subrequest budget.
  const obj = await env.MEDIA.get(oldKey);
  if (!obj) return { oldKey, error: 'source media missing' };
  const blob = await obj.blob();
  const fd = new FormData();
  fd.append(
    'file',
    new File([blob], oldKey, { type: obj.httpMetadata?.contentType || 'application/octet-stream' }),
  );
  const upRes = await fetch(`${state.destApiUrl}/api/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.destToken}` },
    body: fd,
  });
  if (!upRes.ok) {
    const t = await upRes.text();
    return { oldKey, error: `${upRes.status} ${t.slice(0, 200)}` };
  }
  const { key: newKey } = (await upRes.json()) as { key: string; url: string };
  return { oldKey, newKey };
}

// ───── Snapshot/rewrite helpers — duplicated from projects.ts on purpose so
// publish.ts doesn't take a circular dependency on it. Kept tiny.

async function buildSnapshot(env: Env, projectId: string): Promise<SnapshotShape> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
  if (!project) throw new Error('Project not found');

  const stepsRes = await env.DB
    .prepare('SELECT * FROM project_steps WHERE project_id = ? ORDER BY sort_order ASC')
    .bind(projectId)
    .all<ProjectStep>();
  const steps = stepsRes.results;

  let elements: ContentElement[] = [];
  if (steps.length > 0) {
    const ph = steps.map(() => '?').join(',');
    const elsRes = await env.DB
      .prepare(`SELECT * FROM content_elements WHERE parent_type = 'project_step' AND parent_id IN (${ph}) ORDER BY parent_id, sort_order ASC`)
      .bind(...steps.map((s) => s.id))
      .all<ContentElement>();
    elements = elsRes.results;
  }
  return { format_version: 1, project, steps, elements };
}

async function snapshotProjectToVersions(
  env: Env,
  projectId: string,
  source: 'publish',
  label: string,
  createdBy: string | null,
): Promise<{ id: string; version_num: number }> {
  const snapshot = await buildSnapshot(env, projectId);
  const lastRow = await env.DB
    .prepare('SELECT COALESCE(MAX(version_num), 0) as v FROM project_versions WHERE project_id = ?')
    .bind(projectId)
    .first<{ v: number }>();
  const versionNum = (lastRow?.v ?? 0) + 1;
  const id = uuid();
  await env.DB
    .prepare(
      `INSERT INTO project_versions (id, project_id, version_num, label, snapshot_json, source, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, projectId, versionNum, label, JSON.stringify(snapshot), source, createdBy)
    .run();
  return { id, version_num: versionNum };
}

function collectMediaKeys(project: Project, elements: ContentElement[]): string[] {
  const keys = new Set<string>();
  const fromUrl = (u: string | null | undefined) => {
    if (!u) return;
    const m = u.match(/^\/api\/media\/(.+)$/);
    if (m) keys.add(m[1]);
  };
  fromUrl(project.image_url);
  fromUrl(project.video_url);
  if (project.video_key) keys.add(project.video_key);
  for (const el of elements) {
    if (el.type === 'image') {
      try {
        const parsed = JSON.parse(el.content) as { url?: string };
        fromUrl(parsed.url);
      } catch { /* ignore */ }
    }
  }
  return Array.from(keys);
}

function rewriteProjectMediaUrls(p: Project, keyMap: Record<string, string>, dropped: Set<string>): Project {
  const remap = (url: string | null | undefined): string | null => {
    if (!url) return url ?? null;
    const m = url.match(/^\/api\/media\/(.+)$/);
    if (!m) return url;
    if (dropped.has(m[1])) return null;
    return keyMap[m[1]] ? `/api/media/${keyMap[m[1]]}` : url;
  };
  return {
    ...p,
    image_url: remap(p.image_url),
    video_url: remap(p.video_url),
    video_key: p.video_key ? (dropped.has(p.video_key) ? null : (keyMap[p.video_key] ?? p.video_key)) : null,
  };
}

function rewriteImageUrls(elements: ContentElement[], keyMap: Record<string, string>): ContentElement[] {
  return elements.map((e) => {
    if (e.type !== 'image') return e;
    try {
      const parsed = JSON.parse(e.content) as { url?: string; caption?: string };
      if (parsed.url) {
        const m = parsed.url.match(/^\/api\/media\/(.+)$/);
        if (m && keyMap[m[1]]) parsed.url = `/api/media/${keyMap[m[1]]}`;
      }
      return { ...e, content: JSON.stringify(parsed) };
    } catch {
      return e;
    }
  });
}
