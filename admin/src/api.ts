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

  listSteps: (projectId: string) => req<ProjectStep[]>('GET', `/projects/${projectId}/steps`),
  createStep: (projectId: string, b: Partial<ProjectStep>) => req<ProjectStep>('POST', `/projects/${projectId}/steps`, b),
  updateStep: (id: string, b: Partial<ProjectStep>) => req<ProjectStep>('PUT', `/projects/steps/${id}`, b),
  deleteStep: (id: string) => req<{ ok: boolean }>('DELETE', `/projects/steps/${id}`),
  reorderSteps: (orders: { id: string; sort_order: number }[]) => req('POST', '/projects/steps/reorder', { orders }),

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

  // Media
  uploadMedia: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/media/upload', { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    return res.json() as Promise<{ key: string; url: string }>;
  },

  // Cache
  invalidateAll: () => req('POST', '/cache/invalidate-all'),
};

// Shared types (duplicated from src/types.ts for the admin bundle)
export interface Project {
  id: string; slug: string; title: string; description: string;
  image_url: string | null; sort_order: number; published: number;
  created_at: string; updated_at: string;
}
export interface ProjectStep {
  id: string; project_id: string; title: string; sort_order: number;
  created_at: string; updated_at: string;
}
export interface Page {
  id: string; slug: string; title: string; published: number;
  created_at: string; updated_at: string;
}
export interface BlogEntry {
  id: string; slug: string; title: string; entry_date: string; published: number;
  created_at: string; updated_at: string;
}
export interface ContentElement {
  id: string; parent_type: string; parent_id: string;
  type: string; content: string; sort_order: number;
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
