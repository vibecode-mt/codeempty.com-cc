export interface Env {
  DB: D1Database;
  PAGES_KV: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
}

export interface User {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  is_admin: number;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
}

export interface OAuthApp {
  id: string;
  name: string;
  client_id: string;
  client_secret_hash: string;
  client_secret_salt: string;
  scopes: string;
  created_by: string;
  created_at: string;
}

export interface OAuthToken {
  id: string;
  app_id: string;
  token: string;
  expires_at: string;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  image_url: string | null;
  video_key: string | null;
  video_url: string | null;
  sort_order: number;
  published: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectStep {
  id: string;
  project_id: string;
  title: string;
  sort_order: number;
  video_timestamp_ms: number | null;
  tags: string | null;
  hidden: number;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  slug: string;
  title: string;
  published: number;
  show_in_menu: number;
  created_at: string;
  updated_at: string;
}

export interface BlogEntry {
  id: string;
  slug: string;
  title: string;
  entry_date: string;
  published: number;
  created_at: string;
  updated_at: string;
}

export type ContentElementType =
  | 'image'
  | 'youtube'
  | 'title'
  | 'description'
  | 'url'
  | 'prompt_code'
  | 'user_comment';
export type RenderStyle = 'default' | 'ai_response' | 'thoughts' | 'markdown';
export type ParentType = 'project_step' | 'page' | 'blog_entry';

export interface ContentElement {
  id: string;
  parent_type: ParentType;
  parent_id: string;
  type: ContentElementType;
  content: string;
  sort_order: number;
  video_timestamp_ms: number | null;
  tags: string | null;
  render_style: RenderStyle | null;
  hidden: number;
  created_at: string;
  updated_at: string;
}

export interface CommonScript {
  id: string;
  name: string;
  html_snippet: string;
  position: 'head' | 'body_end';
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
