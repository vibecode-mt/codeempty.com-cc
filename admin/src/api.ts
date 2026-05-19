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
  setup: async (setupSecret: string) => {
    const res = await fetch(`${BASE}/auth/setup`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-setup-secret': setupSecret,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<{ username: string; password: string; message: string }>;
  },
  login: (username: string, password: string) => req<{ ok: boolean }>('POST', '/auth/login', { username, password }),
  logout: () => req<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => req<{ username: string; is_admin: number }>('GET', '/auth/me'),
  changePassword: (current_password: string, new_password: string) =>
    req('POST', '/auth/change-password', { current_password, new_password }),
  listLogs: (limit = 100) => req<ExceptionLog[]>('GET', `/logs?limit=${encodeURIComponent(String(limit))}`),

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
  exportData: (projectId: string, includeVideo = false) =>
    req<ExportData>('GET', `/projects/${projectId}/export-data?include_video=${includeVideo ? '1' : '0'}`),

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
    project_translations?: ProjectTranslation[];
    project_step_translations?: ProjectStepTranslation[];
    content_element_translations?: ContentElementTranslation[];
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

  exportSrtUrl: (projectId: string, opts: { tags?: string[]; includeUntagged?: boolean; includeSteps?: boolean; includeAllTypes?: boolean }) => {
    const params = new URLSearchParams();
    if (opts.tags && opts.tags.length > 0) params.set('tags', opts.tags.join(','));
    if (opts.includeUntagged) params.set('include_untagged', '1');
    if (opts.includeSteps === false) params.set('include_steps', '0');
    if (opts.includeAllTypes) params.set('include_all_types', '1');
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

  // Media — list all R2-hosted image URLs tracked in the DB (for bulk optimiser)
  listMediaImages: () =>
    req<Array<{ entityType: 'content_element' | 'project'; entityId: string; url: string; rawContent?: string }>>(
      'GET',
      '/media/list-images',
    ),

  // Media — delete an R2 object by key
  deleteMedia: async (key: string) => {
    const res = await fetch(`/api/media/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error('Delete failed');
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
  generateSitemap: () => req<{ ok: boolean; xml: string; url_count: number }>('POST', '/cache/sitemap/generate'),

  // Site import/export
  exportSite: async (includeProjects: boolean) => {
    const res = await fetch(`/api/settings/export?include_projects=${includeProjects ? '1' : '0'}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<SiteExportPayload>;
  },
  importSite: (payload: SiteExportPayload, mode: 'replace' | 'merge') =>
    req<{ ok: boolean; mode: 'replace' | 'merge'; includes_projects: boolean; inserted: Record<string, number> }>(
      'POST',
      '/settings/import',
      { payload, mode },
    ),

  // i18n
  getI18nSettings: () => req<SiteI18nSettings>('GET', '/i18n/settings'),
  updateI18nSettings: (b: SiteI18nSettings) => req<SiteI18nSettings>('PUT', '/i18n/settings', b),
  exportTranslations: (language: string) => req<TranslationExport>('GET', `/i18n/translations/export?language=${encodeURIComponent(language)}`),
  importTranslations: (b: TranslationImport) => req<{ ok: boolean; language: string; upserts: number }>('POST', '/i18n/translations/import', b),
  getEntityTranslation: (entity: EntityTranslationTarget, id: string, language: string) =>
    req<Record<string, unknown>>('GET', `/i18n/translations/${entity}/${id}?language=${encodeURIComponent(language)}`),
  updateEntityTranslation: (entity: EntityTranslationTarget, id: string, body: { language: string } & Record<string, unknown>) =>
    req<Record<string, unknown>>('PUT', `/i18n/translations/${entity}/${id}`, body),

  // Generic forms
  listForms: () => req<FormDefinition[]>('GET', '/forms'),
  listAllFormSubmissions: () => req<FormSubmission[]>('GET', '/forms/submissions'),
  createForm: (b: Partial<FormDefinition>) => req<FormDefinition>('POST', '/forms', b),
  getForm: (id: string) => req<FormDefinition>('GET', `/forms/${id}`),
  updateForm: (id: string, b: Partial<FormDefinition>) => req<FormDefinition>('PUT', `/forms/${id}`, b),
  deleteForm: (id: string) => req<{ ok: boolean }>('DELETE', `/forms/${id}`),
  listFormSubmissions: (id: string) => req<FormSubmission[]>('GET', `/forms/${id}/submissions`),
  createFormSubmission: (id: string, b: { payload_json?: string; status?: string; source_page_slug?: string }) =>
    req<FormSubmission>('POST', `/forms/${id}/submissions`, b),
  updateFormSubmission: (id: string, submissionId: string, b: Partial<FormSubmission>) =>
    req<FormSubmission>('PUT', `/forms/${id}/submissions/${submissionId}`, b),
  deleteFormSubmission: (id: string, submissionId: string) =>
    req<{ ok: boolean }>('DELETE', `/forms/${id}/submissions/${submissionId}`),
   testFormWebhook: (id: string, body?: { delivery?: Partial<DeliveryConfig> }) =>
     req<{ webhook_url: string; webhook_configured: boolean; test_result: { ok: boolean; error?: string }; payload: unknown }>('POST', `/forms/${id}/test-webhook`, body),
};

// Shared types (duplicated from src/types.ts for the admin bundle)
export interface Project {
  id: string; slug: string; title: string; description: string;
  seo_title: string | null;
  seo_description: string | null;
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
  id: string; slug: string; title: string; seo_title: string | null; seo_description: string | null; published: number; show_in_menu: number;
  is_home: number;
  created_at: string; updated_at: string;
}
export interface BlogEntry {
  id: string; slug: string; title: string; seo_title: string | null; seo_description: string | null; entry_date: string; published: number;
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
export interface ExceptionLog {
  id: string;
  created_at: string;
  method: string;
  path: string;
  status: number;
  error_name: string;
  message: string;
  stack: string | null;
  user_agent: string | null;
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
  project_translations: ProjectTranslation[];
  project_step_translations: ProjectStepTranslation[];
  content_element_translations: ContentElementTranslation[];
  media: { key: string; url: string }[];
}
export interface ProjectTranslation {
  project_id: string;
  language: string;
  title: string | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
}
export interface ProjectStepTranslation {
  step_id: string;
  language: string;
  title: string | null;
}
export interface ContentElementTranslation {
  content_element_id: string;
  language: string;
  content: string | null;
}
export interface SiteExportPayload {
  format_version: number;
  exported_at: string;
  includes_projects: boolean;
  media?: Array<{ key: string; url: string }>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox';
export interface FieldOption {
  label: string;
  value: string;
}
export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: number;
  placeholder?: string;
  help_text?: string;
  options?: FieldOption[];
}
export type CaptchaProvider = 'none' | 'turnstile' | 'recaptcha_v2' | 'recaptcha_v3';
export interface CaptchaConfig {
  enabled: number;
  provider: CaptchaProvider;
  site_key: string;
  secret_key: string;
  recaptcha_action?: string;
  recaptcha_min_score?: number;
}
export type DeliveryProvider = 'webhook' | 'smtp';
export interface DeliveryConfig {
  provider: DeliveryProvider;
  to_email: string;
  from_email: string;
  webhook_url?: string;
  webhook_auth_header?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_secure?: number;
}

export interface FormDefinition {
  id: string;
  slug: string;
  name: string;
  published: number;
  fields: FormField[];
  captcha: CaptchaConfig;
  delivery: DeliveryConfig;
  submit_action_type: 'message' | 'redirect' | 'show_summary';
  submit_action_value: string;
  success_message: string;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  form_slug?: string;
  form_name?: string;
  source_page_slug: string | null;
  payload_json: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteI18nSettings {
  default_language: string;
  supported_languages: string[];
  published_languages: string[];
}

export interface TranslationExport {
  source_language: string;
  target_language: string;
  projects: Array<{
    id: string;
    slug: string;
    source: { title: string; description: string; seo_title: string | null; seo_description: string | null };
    translation: { title: string | null; description: string | null; seo_title: string | null; seo_description: string | null } | null;
  }>;
  pages: Array<{
    id: string;
    slug: string;
    source: { title: string; seo_title: string | null; seo_description: string | null };
    translation: { title: string | null; seo_title: string | null; seo_description: string | null } | null;
  }>;
  blog_entries: Array<{
    id: string;
    slug: string;
    entry_date: string;
    source: { title: string; seo_title: string | null; seo_description: string | null };
    translation: { title: string | null; seo_title: string | null; seo_description: string | null } | null;
  }>;
  project_steps: Array<{
    id: string;
    project_id: string;
    source: { title: string };
    translation: { title: string | null } | null;
  }>;
  content_elements: Array<{
    id: string;
    parent_type: string;
    parent_id: string;
    type: string;
    source: { content: string };
    translation: { content: string | null } | null;
  }>;
  forms: Array<{
    id: string;
    source: { name: string; success_message: string; fields_json: string };
    translation: { name: string | null; success_message: string | null; fields_json: string | null } | null;
  }>;
  site: {
    id: string;
    source: { title: string };
    translation: { title: string | null } | null;
  };
}

export interface TranslationImport {
  language: string;
  projects?: Array<{ id: string; title?: string | null; description?: string | null; seo_title?: string | null; seo_description?: string | null }>;
  pages?: Array<{ id: string; title?: string | null; seo_title?: string | null; seo_description?: string | null }>;
  blog_entries?: Array<{ id: string; title?: string | null; seo_title?: string | null; seo_description?: string | null }>;
  project_steps?: Array<{ id: string; title?: string | null }>;
  content_elements?: Array<{ id: string; content?: string | null }>;
  forms?: Array<{ id: string; name?: string | null; success_message?: string | null; fields_json?: string | null }>;
  site?: { title?: string | null };
}

export type EntityTranslationTarget = 'project' | 'page' | 'blog_entry' | 'project_step' | 'content_element' | 'form' | 'site';

