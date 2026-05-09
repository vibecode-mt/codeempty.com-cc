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
  youtube_url: string | null;
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
  is_home: number;
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
  | 'user_comment'
  | 'widget';
export type RenderStyle = 'default' | 'ai_response' | 'thoughts' | 'markdown';
export type ParentType = 'project_step' | 'page' | 'blog_entry';

export type WidgetKind = 'project_list' | 'blog_list' | 'form' | 'form_data';
export interface WidgetContent {
  kind: WidgetKind;
}

export type ContactFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox';
export interface ContactFieldOption {
  label: string;
  value: string;
}
export interface ContactField {
  key: string;
  label: string;
  type: ContactFieldType;
  required: number;
  placeholder?: string;
  help_text?: string;
  options?: ContactFieldOption[];
}

export type ContactCaptchaProvider = 'none' | 'turnstile' | 'recaptcha_v2' | 'recaptcha_v3';
export interface ContactCaptchaConfig {
  enabled: number;
  provider: ContactCaptchaProvider;
  site_key: string;
  secret_key: string;
  recaptcha_action?: string;
  recaptcha_min_score?: number;
}

export type ContactDeliveryProvider = 'webhook' | 'smtp';
export interface ContactDeliveryConfig {
  provider: ContactDeliveryProvider;
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

export interface ContactFormSettings {
  id: string;
  fields_json: string;
  captcha_json: string;
  delivery_json: string;
  submit_button_label: string;
  success_message: string;
  created_at: string;
  updated_at: string;
}

export interface ContactSubmission {
  id: string;
  source_page_slug: string | null;
  payload_json: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export type FormSubmitActionType = 'message' | 'redirect' | 'show_summary';

export interface FormDefinition {
  id: string;
  slug: string;
  name: string;
  published: number;
  fields_json: string;
  captcha_json: string;
  delivery_json: string;
  submit_action_type: FormSubmitActionType;
  submit_action_value: string | null;
  success_message: string;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  source_page_slug: string | null;
  payload_json: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface ProjectVersion {
  id: string;
  project_id: string;
  version_num: number;
  label: string | null;
  snapshot_json: string;
  source: 'manual' | 'publish' | 'import-replace';
  created_by: string | null;
  created_at: string;
}

export interface PublishDestination {
  id: string;
  name: string;
  api_url: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  created_at: string;
}

export interface PublishJob {
  id: string;
  project_id: string;
  destination_id: string;
  mode: 'create' | 'replace';
  target_project_id: string | null;
  label: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  progress_current: number;
  progress_total: number;
  progress_label: string | null;
  result_project_id: string | null;
  result_slug: string | null;
  error: string | null;
  state_json: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
