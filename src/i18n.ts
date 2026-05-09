import type {
  Env,
  SiteI18nSettings,
  BlogEntry,
  ContentElement,
  Page,
  Project,
  ProjectStep,
} from './types';

const FALLBACK_LANGUAGE = 'en';
let schemaReady = false;

interface SiteI18nSettingsRow {
  default_language: string;
  supported_languages_json: string;
}

const I18N_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS site_i18n_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_language TEXT NOT NULL DEFAULT 'en',
    supported_languages_json TEXT NOT NULL DEFAULT '["en"]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS project_translations (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    title TEXT,
    description TEXT,
    seo_title TEXT,
    seo_description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, language)
  )`,
  `CREATE TABLE IF NOT EXISTS page_translations (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    title TEXT,
    seo_title TEXT,
    seo_description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (page_id, language)
  )`,
  `CREATE TABLE IF NOT EXISTS blog_entry_translations (
    blog_entry_id TEXT NOT NULL REFERENCES blog_entries(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    title TEXT,
    seo_title TEXT,
    seo_description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (blog_entry_id, language)
  )`,
  `CREATE TABLE IF NOT EXISTS project_step_translations (
    step_id TEXT NOT NULL REFERENCES project_steps(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    title TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (step_id, language)
  )`,
  `CREATE TABLE IF NOT EXISTS content_element_translations (
    content_element_id TEXT NOT NULL REFERENCES content_elements(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    content TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (content_element_id, language)
  )`,
];

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeLanguageCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) return null;
  return normalized;
}

export function parseSupportedLanguages(input: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = input.split(',').map((s) => s.trim());
    }
  }

  const out = new Set<string>();
  for (const value of values) {
    const lang = normalizeLanguageCode(value);
    if (lang) out.add(lang);
  }
  if (!out.has(FALLBACK_LANGUAGE)) out.add(FALLBACK_LANGUAGE);
  return [...out];
}

async function ensureSeoColumns(env: Env, table: string): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const names = new Set(info.results.map((c) => c.name));
  if (!names.has('seo_title')) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN seo_title TEXT`).run();
  }
  if (!names.has('seo_description')) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN seo_description TEXT`).run();
  }
}

export async function ensureI18nSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  for (const sql of I18N_SCHEMA_STATEMENTS) {
    await env.DB.prepare(sql).run();
  }
  await ensureSeoColumns(env, 'projects');
  await ensureSeoColumns(env, 'pages');
  await ensureSeoColumns(env, 'blog_entries');
  schemaReady = true;
}

export async function getSiteI18nSettings(env: Env): Promise<SiteI18nSettings> {
  let row: SiteI18nSettingsRow | null = null;
  try {
    await ensureI18nSchema(env);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO site_i18n_settings (id, default_language, supported_languages_json) VALUES (1, ?, ?)',
    )
      .bind(FALLBACK_LANGUAGE, JSON.stringify([FALLBACK_LANGUAGE]))
      .run();

    row = await env.DB.prepare(
      'SELECT default_language, supported_languages_json FROM site_i18n_settings WHERE id = 1',
    ).first<SiteI18nSettingsRow>();
  } catch {
    return { default_language: FALLBACK_LANGUAGE, supported_languages: [FALLBACK_LANGUAGE] };
  }

  const supported = parseSupportedLanguages(row?.supported_languages_json ?? [FALLBACK_LANGUAGE]);
  const defaultLanguage = normalizeLanguageCode(row?.default_language) ?? FALLBACK_LANGUAGE;

  if (!supported.includes(defaultLanguage)) supported.unshift(defaultLanguage);
  return { default_language: defaultLanguage, supported_languages: Array.from(new Set(supported)) };
}

export async function saveSiteI18nSettings(
  env: Env,
  input: { default_language?: string; supported_languages?: string[] },
): Promise<SiteI18nSettings> {
  await ensureI18nSchema(env);
  const current = await getSiteI18nSettings(env);
  const supported = parseSupportedLanguages(input.supported_languages ?? current.supported_languages);
  const defaultLanguage = normalizeLanguageCode(input.default_language) ?? current.default_language;
  if (!supported.includes(defaultLanguage)) supported.unshift(defaultLanguage);
  const deduped = Array.from(new Set(supported));

  await env.DB.prepare(
    `UPDATE site_i18n_settings
      SET default_language = ?, supported_languages_json = ?, updated_at = datetime('now')
      WHERE id = 1`,
  )
    .bind(defaultLanguage, JSON.stringify(deduped))
    .run();

  return { default_language: defaultLanguage, supported_languages: deduped };
}

function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [langPart, qPart] = part.trim().split(';');
      const lang = normalizeLanguageCode(langPart);
      if (!lang) return null;
      let q = 1;
      if (qPart?.startsWith('q=')) {
        const num = Number(qPart.slice(2));
        if (!Number.isNaN(num)) q = num;
      }
      return { lang, q };
    })
    .filter((v): v is { lang: string; q: number } => v != null)
    .sort((a, b) => b.q - a.q)
    .map((v) => v.lang);
}

function pickSupportedLanguage(candidate: string | null, supported: string[]): string | null {
  if (!candidate) return null;
  if (supported.includes(candidate)) return candidate;
  const primary = candidate.split('-')[0];
  return supported.find((lang) => lang === primary || lang.startsWith(`${primary}-`)) ?? null;
}

export async function resolveLanguageFromRequest(request: Request, env: Env): Promise<string> {
  const settings = await getSiteI18nSettings(env);
  const url = new URL(request.url);
  const requested = pickSupportedLanguage(normalizeLanguageCode(url.searchParams.get('lang')), settings.supported_languages);
  if (requested) return requested;

  for (const candidate of parseAcceptLanguage(request.headers.get('Accept-Language'))) {
    const matched = pickSupportedLanguage(candidate, settings.supported_languages);
    if (matched) return matched;
  }
  return settings.default_language;
}

export async function applyProjectTranslations(env: Env, projects: Project[], language: string): Promise<Project[]> {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === FALLBACK_LANGUAGE || projects.length === 0) return projects;
  const ids = projects.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows: { project_id: string; title: string | null; description: string | null; seo_title: string | null; seo_description: string | null }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT project_id, title, description, seo_title, seo_description
         FROM project_translations
        WHERE language = ? AND project_id IN (${placeholders})`,
    )
      .bind(lang, ...ids)
      .all<{ project_id: string; title: string | null; description: string | null; seo_title: string | null; seo_description: string | null }>();
    rows = result.results;
  } catch {
    return projects;
  }

  const map = new Map(rows.map((r) => [r.project_id, r]));
  return projects.map((project) => {
    const tr = map.get(project.id);
    if (!tr) return project;
    return {
      ...project,
      title: tr.title?.trim() ? tr.title : project.title,
      description: tr.description?.trim() ? tr.description : project.description,
      seo_title: emptyToNull(tr.seo_title) ?? project.seo_title,
      seo_description: emptyToNull(tr.seo_description) ?? project.seo_description,
    };
  });
}

export async function applyPageTranslations(env: Env, pages: Page[], language: string): Promise<Page[]> {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === FALLBACK_LANGUAGE || pages.length === 0) return pages;
  const ids = pages.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows: { page_id: string; title: string | null; seo_title: string | null; seo_description: string | null }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT page_id, title, seo_title, seo_description
         FROM page_translations
        WHERE language = ? AND page_id IN (${placeholders})`,
    )
      .bind(lang, ...ids)
      .all<{ page_id: string; title: string | null; seo_title: string | null; seo_description: string | null }>();
    rows = result.results;
  } catch {
    return pages;
  }

  const map = new Map(rows.map((r) => [r.page_id, r]));
  return pages.map((page) => {
    const tr = map.get(page.id);
    if (!tr) return page;
    return {
      ...page,
      title: tr.title?.trim() ? tr.title : page.title,
      seo_title: emptyToNull(tr.seo_title) ?? page.seo_title,
      seo_description: emptyToNull(tr.seo_description) ?? page.seo_description,
    };
  });
}

export async function applyBlogEntryTranslations(env: Env, entries: BlogEntry[], language: string): Promise<BlogEntry[]> {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === FALLBACK_LANGUAGE || entries.length === 0) return entries;
  const ids = entries.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows: { blog_entry_id: string; title: string | null; seo_title: string | null; seo_description: string | null }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT blog_entry_id, title, seo_title, seo_description
         FROM blog_entry_translations
        WHERE language = ? AND blog_entry_id IN (${placeholders})`,
    )
      .bind(lang, ...ids)
      .all<{ blog_entry_id: string; title: string | null; seo_title: string | null; seo_description: string | null }>();
    rows = result.results;
  } catch {
    return entries;
  }

  const map = new Map(rows.map((r) => [r.blog_entry_id, r]));
  return entries.map((entry) => {
    const tr = map.get(entry.id);
    if (!tr) return entry;
    return {
      ...entry,
      title: tr.title?.trim() ? tr.title : entry.title,
      seo_title: emptyToNull(tr.seo_title) ?? entry.seo_title,
      seo_description: emptyToNull(tr.seo_description) ?? entry.seo_description,
    };
  });
}

export async function applyProjectStepTranslations(env: Env, steps: ProjectStep[], language: string): Promise<ProjectStep[]> {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === FALLBACK_LANGUAGE || steps.length === 0) return steps;
  const ids = steps.map((s) => s.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows: { step_id: string; title: string | null }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT step_id, title FROM project_step_translations WHERE language = ? AND step_id IN (${placeholders})`,
    )
      .bind(lang, ...ids)
      .all<{ step_id: string; title: string | null }>();
    rows = result.results;
  } catch {
    return steps;
  }

  const map = new Map(rows.map((r) => [r.step_id, r]));
  return steps.map((step) => {
    const tr = map.get(step.id);
    if (!tr?.title?.trim()) return step;
    return { ...step, title: tr.title };
  });
}

export async function applyContentElementTranslations(
  env: Env,
  elements: ContentElement[],
  language: string,
): Promise<ContentElement[]> {
  const lang = normalizeLanguageCode(language);
  if (!lang || lang === FALLBACK_LANGUAGE || elements.length === 0) return elements;
  const ids = elements.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  let rows: { content_element_id: string; content: string | null }[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT content_element_id, content
         FROM content_element_translations
        WHERE language = ? AND content_element_id IN (${placeholders})`,
    )
      .bind(lang, ...ids)
      .all<{ content_element_id: string; content: string | null }>();
    rows = result.results;
  } catch {
    return elements;
  }

  const map = new Map(rows.map((r) => [r.content_element_id, r]));
  return elements.map((el) => {
    const tr = map.get(el.id);
    if (!tr?.content?.trim()) return el;
    return { ...el, content: tr.content };
  });
}
