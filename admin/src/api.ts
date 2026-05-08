const BASE = '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  setup: (b: { username?: string }) => req<{ username: string; password: string; message: string }>('POST', '/auth/setup', b),
  login: (username: string, password: string) => req<{ ok: boolean }>('POST', '/auth/login', { username, password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => req<{ username: string; is_admin: number }>('GET', '/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    req('POST', '/auth/change-password', { current_password, new_password }),

  // Projects
  listProjects: () => req<Project[]>('GET', '/projects'),
  createProject: (b: Partial<Project>) => req<Project>('POST', '/projects', b),
  getProject: (id: string) => req<Project & { steps: ProjectStep[] }>('GET', `/projects/${id}`),
  updateProject: (id: string, b: Partial<Project>) => req<Project>('PUT', `/projects/${id}`, b),
  deleteProject: (id: string) => req<{ ok: boolean }>('DELETE', `/projects/${id}`),
  importCaptions: (
    projectId: string,
    captions: Array<{ text: string; timestampMs: number; type: 'step' | 'element'; tags?: string }>,
  ) =>
    req<{ ok: boolean; steps_created: number; total_captions: number }>('POST', `/projects/${projectId}/import-captions`, {
      captions,
    }),

  bulkDelete: (
    projectId: string,
    opts: { scope: 'steps' | 'elements'; tags?: string[]; includeUntagged?: boolean },
  ) =>
    req<{ ok: boolean; steps_deleted: number; elements_deleted: number }>(
      'POST',
      `/projects/${projectId}/bulk-delete`,
      {
        scope: opts.scope,
        tags: opts.tags ?? [],
        include_untagged: opts.includeUntagged === true,
      },
    ),

  // Bundle export — server returns metadata + media key list; browser zips
  exportData: (projectId: string) =>
    req<ExportData>('GET', `/projects/${projectId}/export-data`),

  // Publish destinations
  listDestinations: () => req<PublishDestination[]>('GET', '/destinations'),
  createDestination: (b: { name: string; api_url: string; client_id: string; client_secret: string; scopes?: string }) =>
    req<PublishDestination>('POST', '/destinations', b),
  deleteDestination: (id: string) => req<{ ok: boolean }>('DELETE', `/destinations/${id}`),
  testDestination: (id: string) =>
    req<{ ok: boolean; error?: string; scope?: string; expires_in?: number }>('POST', `/destinations/${id}/test`),
  issueDestinationToken: (id: string) =>
    req<{ api_url: string; access_token: string; expires_in: number; scope: string }>(
      'POST',
      `/destinations/${id}/issue-token`,
    ),

  // Bundle import — browser ships rewritten payload after re-uploading media
  importBundle: (body: {
    manifest: BundleManifest;
    project: Project;
    steps: ProjectStep[];
    elements: ContentElement[];
    mode: 'create' | 'replace';
    target_project_id?: string;
    label?: string;
    idempotency_key?: string;
  }) =>
    req<{ project_id: string; slug: string; version_id?: string }>('POST', '/projects/import', body),

  // Project versioning
  listVersions: (projectId: string) =>
    req<ProjectVersionSummary[]>('GET', `/projects/${projectId}/versions`),
  createVersion: (projectId: string, label?: string) =>
    req<{ id: string; version_num: number }>('POST', `/projects/${projectId}/versions`, label ? { label } : {}),
  restoreVersion: (projectId: string, versionId: string) =>
    req<{ ok: boolean; restored_version_num: number; pre_restore_version_id: string }>(
      'POST',
      `/projects/${projectId}/versions/${versionId}/restore`,
    ),
  deleteVersion: (projectId: string, versionId: string) =>
    req<{ ok: boolean }>('DELETE', `/projects/${projectId}/versions/${versionId}`),

  bulkTag: (
    projectId: string,
    opts: {
      scope: 'steps' | 'elements';
      tags?: string[];
      includeUntagged?: boolean;
      action: 'add' | 'remove';
      applyTags: string;
    },
  ) =>
    req<{ ok: boolean; updated: number }>(
      'POST',
      `/projects/${projectId}/bulk-tag`,
      {
        scope: opts.scope,
        tags: opts.tags ?? [],
        include_untagged: opts.includeUntagged === true,
        action: opts.action,
        apply_tags: opts.applyTags,
      },
    ),

  exportSrtUrl: (projectId: string, opts: { tags?: string[]; includeUntagged?: boolean; includeSteps?: boolean }) => {
    const params = new URLSearchParams();
    if (opts.tags && opts.tags.length > 0) params.set('tags', opts.tags.join(','));
    if (opts.includeUntagged) params.set('include_untagged', '1');
    if (opts.includeSteps === false) params.set('include_steps', '0');
    const qs = params.toString();
    return `/api/projects/${projectId}/export-srt${qs ? '?' + qs : ''}`;
  },

  listSteps: (projectId: string) => req<ProjectStep[]>('GET', `/projects/${projectId}/steps`),
  createStep: (projectId: string, b: Partial<ProjectStep>) => req<ProjectStep>('POST', `/projects/${projectId}/steps`, b),
  updateStep: (id: string, b: Partial<ProjectStep>) => req<ProjectStep>('PUT', `/projects/steps/${id}`, b),
  deleteStep: (id: string) => req<{ ok: boolean }>('DELETE', `/projects/steps/${id}`),
  reorderSteps: (orders: { id: string; sort_order: number }[]) => req('POST', '/projects/steps/reorder', { orders }),
  timeshiftProject: (projectId: string, split_ms: number, offset_ms: number) =>
    req<{ ok: boolean; shifted: number; elements_shifted: number }>('POST', `/projects/${projectId}/timeshift`, { split_ms, offset_ms }),

  // Pages
  listPages: () => req<Page[]>('GET', '/pages'),
  createPage: (b: Partial<Page>) => req<Page>('POST', '/pages', b),
  getPage: (id: string) => req<Page>('GET', `/pages/${id}`),
  updatePage: (id: string, b: Partial<Page>) => req<Page>('PUT', `/pages/${id}`, b),
  deletePage: (id: string) => req<{ ok: boolean }>('DELETE', `/pages/${id}`),

  // Blog
  listBlog: () => req<BlogEntry[]>('GET', '/blog'),
  createBlogEntry: (b: Partial<BlogEntry>) => req<BlogEntry>('POST', '/blog', b),
  getBlogEntry: (id: string) => req<BlogEntry>('GET', `/blog/${id}`),
  updateBlogEntry: (id: string, b: Partial<BlogEntry>) => req<BlogEntry>('PUT', `/blog/${id}`, b),
  deleteBlogEntry: (id: string) => req<{ ok: boolean }>('DELETE', `/blog/${id}`),

  // Content elements
  listContent: (parentType: string, parentId: string) =>
    req<ContentElement[]>('GET', `/content/${parentType}/${parentId}`),
  createContent: (parentType: string, parentId: string, b: Partial<ContentElement>) =>
    req<ContentElement>('POST', `/content/${parentType}/${parentId}`, b),
  updateContent: (id: string, b: Partial<ContentElement>) => req<ContentElement>('PUT', `/content/${id}`, b),
  deleteContent: (id: string) => req<{ ok: boolean }>('DELETE', `/content/${id}`),
  reorderContent: (orders: { id: string; sort_order: number }[]) => req('POST', '/content/reorder', { orders }),

  // Scripts
  listScripts: () => req<CommonScript[]>('GET', '/scripts'),
  createScript: (b: Partial<CommonScript>) => req<CommonScript>('POST', '/scripts', b),
  updateScript: (id: string, b: Partial<CommonScript>) => req<CommonScript>('PUT', `/scripts/${id}`, b),
  deleteScript: (id: string) => req<{ ok: boolean }>('DELETE', `/scripts/${id}`),

  // OAuth apps
  listOAuthApps: () => req<OAuthApp[]>('GET', '/oauth/apps'),
  createOAuthApp: (b: { name: string; scopes?: string }) =>
    req<OAuthApp & { client_secret: string }>('POST', '/oauth/apps', b),
  deleteOAuthApp: (id: string) => req<{ ok: boolean }>('DELETE', `/oauth/apps/${id}`),

  // Media — standard image upload (small files)
  uploadMedia: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    return res.json() as Promise<{ key: string; url: string }>;
  },

  // Media — chunked video upload
  videoUploadInit: async (filename: string, contentType: string) => {
    return req<{ uploadId: string; key: string }>('POST', '/media/upload/video/init', { filename, contentType });
  },

  videoUploadChunk: async (key: string, uploadId: string, partNumber: number, chunk: Blob) => {
    const res = await fetch(
      `/api/media/upload/video/chunk?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
      { method: 'POST', credentials: 'include', body: chunk },
    );
    if (!res.ok) throw new Error('Chunk upload failed');
    return res.json() as Promise<{ etag: string }>;
  },

  videoUploadComplete: async (key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) => {
    return req<{ key: string; url: string }>('POST', '/media/upload/video/complete', { key, uploadId, parts });
  },

  videoUploadAbort: async (key: string, uploadId: string) => {
    const res = await fetch(
      `/api/media/upload/video/abort?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!res.ok) throw new Error('Abort failed');
  },

  // Cache
  invalidateAll: () => req('POST', '/cache/invalidate-all'),
};

// Shared types (duplicated from src/types.ts for the admin bundle)
export interface Project {
  id: string; slug: string; title: string; description: string;
  image_url: string | null;
  video_key: string | null; video_url: string | null;
  youtube_url: string | null;
  sort_order: number; published: number;
  created_at: string; updated_at: string;
}
export interface ProjectStep {
  id: string; project_id: string; title: string; sort_order: number;
  video_timestamp_ms: number | null;
  tags: string | null;
  hidden: number;
  created_at: string; updated_at: string;
}
export interface Page {
  id: string; slug: string; title: string; published: number; show_in_menu: number;
  created_at: string; updated_at: string;
}
export interface BlogEntry {
  id: string; slug: string; title: string; entry_date: string; published: number;
  created_at: string; updated_at: string;
}
export type RenderStyle = 'default' | 'ai_response' | 'thoughts' | 'markdown';
export interface ContentElement {
  id: string; parent_type: string; parent_id: string;
  type: string; content: string; sort_order: number;
  video_timestamp_ms: number | null;
  tags: string | null;
  render_style: RenderStyle | null;
  hidden: number;
  created_at: string; updated_at: string;
}
export interface CommonScript {
  id: string; name: string; html_snippet: string;
  position: string; enabled: number; sort_order: number;
  created_at: string; updated_at: string;
}
export interface OAuthApp {
  id: string; name: string; client_id: string; scopes: string;
  created_by: string; created_at: string;
}
export interface PublishDestination {
  id: string;
  name: string;
  api_url: string;
  client_id: string;
  scopes: string;
  created_at: string;
}
export interface ProjectVersionSummary {
  id: string;
  project_id: string;
  version_num: number;
  label: string | null;
  source: 'manual' | 'publish' | 'import-replace';
  created_by: string | null;
  created_at: string;
  size_bytes: number;
}
export interface BundleManifest {
  format_version: number;
  exported_at: string;
  source_slug: string;
  stats: { step_count: number; element_count: number; media_count: number };
}
export interface ExportData {
  manifest: BundleManifest;
  project: Project;
  steps: ProjectStep[];
  elements: ContentElement[];
  media: { key: string; url: string }[];
}
