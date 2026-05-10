# CodeEmpty.com

A personal portfolio + project blog with a built-in CMS, hosted entirely on the **Cloudflare free tier** (Pages + Workers + D1 + KV + R2). Open source — fork it, drop in your own domain, and you have your own AI-coded vibe-coding portfolio for the price of a domain name.

> **About the site.** I'm Johnny — 20+ years coding professionally and experimenting with AI workflows long before "vibe coding" became a thing. After losing my job on Apr 30 2026 I started this YouTube channel and CodeEmpty.com to share the practical side of AI-assisted software development openly: real projects, real prompts, real debugging, real production deploys. CodeEmpty.com is itself one of those projects. Each project published here includes the full YouTube recording, the prompts used during development, screenshots, deployment steps, debugging notes, and either a live link or a downloadable build. See [/about](https://codeempty.com/about) for the full story and the future plan toward [OpenVibeHub.com](https://openvibehub.com).

---

## What's in here

A single repo with:

- **Public site** (`/`, `/projects/[slug]`, `/blog`, `/about`) — server-rendered HTML, KV-cached, Cloudflare Pages
- **Admin SPA** (`/admin`) — React + Vite, served as a static bundle from the same Pages project
- **API** (`/api/*`) — Hono on Cloudflare Workers, OAuth 2.0 client-credentials so any AI / CLI agent can drive every admin endpoint

### Highlights

- **Video-driven project authoring.** Upload a video, scrub to any moment, capture frames, and either create a step at that timestamp or attach the frame to an existing step/element. Frame-accurate fine-seek scrubber, captions auto-import from CapCut/SRT/VTT.
- **Caption import** for CapCut JSON, SRT, and VTT — auto-detects step-numbered captions (`23.`, `24a.`), preserves video timestamps, and assigns per-track tags.
- **Snapshots & restore.** Every project change can be snapshotted to a JSON-only version row in D1; restore re-runs the snapshot through an atomic `c.env.DB.batch()` so a half-applied state is impossible.
- **Bundle export / import (.codeempty).** Browser-side fflate zips a project + all referenced media. Import unpacks it again, re-uploads media, and writes everything atomically.
- **Cross-instance Publish.** Pick a destination → background job copies the project (data + media) to the destination via its public APIs. Survives Cloudflare free-tier per-Worker limits by chunking the work across recursive `/process` invocations and persisting state on each batch. Idempotency-keyed against the destination's `/import`.
- **Tags & filtering on the rendered page.** Tag with `step:Major` / `element:Detail` and they become filter chips on the public project page. Quick search hits step titles + element content. Slideshow respects active filters.
- **Slideshow.** Click any image, get a fullscreen lightbox with prev/next, auto-play (3/5/8/15 s), keyboard nav (← → space esc), and a progress slider — driven by the inline JS the renderer ships, no framework.
- **Tag manage mode.** Type `step:Major`, click Start, then every step + element row gains a one-click toggle. For the times the bulk-tag modal's filter-by-existing-tag flow doesn't fit.
- **YouTube deep-links.** Set `youtube_url` on a project; every step / element with a `video_timestamp_ms` gets a `▶ M:SS` chip that opens YouTube at that exact second.
- **OAuth on every admin endpoint.** AI agents (or `curl`) with a `write`-scoped bearer can drive the entire CMS — same surface the admin browser uses.

---

## Architecture

| Layer | Service | Why |
|---|---|---|
| Hosting | Cloudflare Pages | Static build of the public site + admin SPA |
| API | Cloudflare Workers (Pages Functions) | Hono routes under `/api/*` |
| Database | Cloudflare D1 (SQLite) | Projects, steps, elements, sessions, OAuth, versions, publish jobs |
| Cache | Cloudflare KV | Rendered HTML for `/`, `/projects/[slug]`, `/about`, `/blog/[slug]` |
| Assets | Cloudflare R2 | Uploaded images, videos, and bundle artifacts |

Every layer is on the free tier. The architecture choices reflect that — for example, the Publish job processes media uploads in **batches of 35 per Worker invocation** so we never trip the 50-subrequest free-tier cap, and continues across recursive self-fetches if more remains.

### Data model

```
projects
  └─ project_steps              (ordered, optional video_timestamp_ms, tags, hidden)
       └─ content_elements      (image | youtube | title | description | url | prompt_code | user_comment)
                                 with type-specific JSON content, optional render_style
                                 (default | markdown | ai_response | thoughts), tags, hidden

pages, blog_entries             also host content_elements (parent_type discriminates)

project_versions                JSON snapshots of {project, steps, elements} — no media duplication
publish_destinations            named remote-instance OAuth credentials
publish_jobs                    background publish queue with state_json + progress

oauth_apps / oauth_tokens       client-credentials grant
upload_sessions                 multipart-upload ownership tracking
idempotency_log                 dedupes import-replay
common_scripts                  injectable head/body scripts (analytics, etc.)
```

Migrations live in `migrations/`. Apply locally: `npm run db:migrate:local`. Apply to prod: `npm run db:migrate`.

Before running migrations, export a backup:

```bash
# local
npx wrangler d1 export DB --local --output backups/local-before-migration.sql

# production
npx wrangler d1 export DB --output backups/prod-before-migration.sql
```

`wrangler d1 migrations apply` does not wipe a database on its own; it executes the SQL in migration files. Any destructive SQL in those files (for example `DROP TABLE`) will still remove data.

---

## Cloudflare setup (one-time)

### 1. Cloudflare account
Sign up at [cloudflare.com](https://cloudflare.com).

### 2. Connect your domain
**Websites → Add a site** → enter your domain → follow the nameserver swap.

### 3. Create the D1 database
**Workers & Pages → D1 → Create database** → name it `codeempty-db`. Copy the **Database ID** into `wrangler.toml` (replacing `database_id`).

### 4. Create the KV namespace
**Workers & Pages → KV → Create namespace** → `codeempty-pages-kv`. Copy the namespace id into `wrangler.toml`.

### 5. Create the R2 bucket
**R2 Object Storage → Create bucket** → `codeempty-media`.

### 6. Connect GitHub to Pages
**Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
- Build command: `npm run build`
- Build output directory: `dist`

### 7. Attach bindings to Pages
After the Pages project exists, **Settings → Functions**:
- D1 binding: `DB` → `codeempty-db`
- KV binding: `PAGES_KV` → `codeempty-pages-kv`
- R2 binding: `MEDIA` → `codeempty-media`

Redeploy so the bindings take effect.

### 8. Run migrations
```bash
npm install
npx wrangler login
npm run db:migrate           # applies every migration in migrations/ to remote D1
```

### 9. Create your admin
Visit `https://<your-domain>/admin/setup` → click **Create Admin Account**. Save the generated password — you can also reset it later from the Settings page.

---

## Local development

```bash
npm install

# Terminal 1 — rebuild the admin SPA on every change
npm run dev:admin

# Terminal 2 — local Pages server (serves dist/ and Functions)
npm run db:migrate:local     # first time only
npm run dev
```

Open:
- [http://localhost:8788](http://localhost:8788) — public site
- [http://localhost:8788/admin](http://localhost:8788/admin) — CMS

Tip: hot-reload picks up source changes for the Worker but not for the admin SPA — the admin bundle is rebuilt by `dev:admin` (vite watch), and the Pages server serves the latest `dist/admin/` on the next request.

---

## Deploying

Push to `main` → Cloudflare Pages auto-deploys (build hook). Or manually:
```bash
npm run deploy
```

Database migrations are **not** applied automatically by Pages — run `npm run db:migrate` from your machine after pushing schema changes.

---

## Authoring workflows

### Build a project from a video

1. **Projects → + New project** → save
2. **Upload a video** (chunked to R2 — supports any size; the upload bar shows speed + ETA)
3. Scrub the video. The frame-accurate **Fine** seek bar lets you nudge ±1 frame / ±250 ms / ±5 s without leaving the current shot.
4. **📷 Capture Frame** (or hit `F`) → modal opens with the screenshot, lets you create a new step at that timestamp or attach the frame to an existing step
5. Or skip the modal: click `+ frame` directly on a step to drop the current frame in as an image element. On a description element, `+ frame` *replaces* the description with an image whose caption is the description's text.
6. The video timeline below the player shows every timestamped step as a marker. Drag a marker to retime that step.

### Import captions

Drop a CapCut `draft_content.json`, an `.srt`, or a `.vtt` file into **📥 Import**. The browser parses it locally (no upload), shows a per-track preview with select-all and per-row checkboxes, auto-detects step-numbered captions like `23.` / `24a.`, and lets you tag every imported item with track-derived tags + a custom global tag.

### Export captions / publish to YouTube

**📤 Export SRT** turns step titles + description elements into a YouTube-ready SRT, optionally filtered by tag (e.g. only `youtube`-tagged items).

### Versioning

**🗂 Versions** lets you save a manual snapshot at any point and restore later. Restores run through the same atomic batch as imports, and a "Before restore" snapshot is auto-created so the operation is reversible.

### Bundle export / import

**📦 Export bundle** downloads `<slug>.codeempty` — a ZIP containing `manifest.json`, `project.json`, project translations, and `media/<key>` for every selected R2 file the project references (source video optional). **📥 Import bundle** uploads that bundle to a fresh project (with auto-suffixed slug) or replaces an existing one (with auto-snapshot first), restoring translations too.

### Publish to a remote instance

Add an OAuth app on the destination (`/admin/oauth`) with `write` scope. Add a destination on the source (`/admin/destinations`) with the destination's `client_id` / `client_secret`. Then **🚀 Publish** on a project → pick destination → create-new or replace. The browser orchestrates the transfer, OR call `POST /api/projects/:id/publish` directly and poll `GET /api/publish/jobs/:job_id`.

---

## API

Every admin endpoint accepts **either** a session cookie (browser admin) **or** an `Authorization: Bearer <token>` header where the token has the right OAuth scope. Read-side endpoints accept any valid bearer; write-side endpoints require `write` scope. The bearer's scope check uses a `write` ⊃ `read` hierarchy, so a write-scoped token also satisfies read-scoped routes.

### OAuth — get a token

Register an app at `/admin/oauth` with `read` and/or `write` scopes. Then:

```http
POST /api/oauth/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
```

→ `{ "access_token": "...", "token_type": "Bearer", "expires_in": 86400, "scope": "write" }`

### Projects

```
GET    /api/projects                          list (any-auth)
GET    /api/projects/public                   list of published only (no auth)
POST   /api/projects                          create (write)
GET    /api/projects/:id                      get with steps (any-auth)
PUT    /api/projects/:id                      update (write)
DELETE /api/projects/:id                      delete (write)

POST   /api/projects/:projectId/steps         create step (write)
GET    /api/projects/:projectId/steps         list steps (any-auth)
PUT    /api/projects/steps/:id                update step (write)
DELETE /api/projects/steps/:id                delete step + cascade content_elements (write)
POST   /api/projects/steps/reorder            { orders: [{id, sort_order}] } (write)

POST   /api/projects/:id/timeshift            shift timestamps after a split (write)
POST   /api/projects/:id/import-captions      bulk-create steps + elements with timestamps (write)
GET    /api/projects/:id/export-srt           filter by tag, returns SRT (write)

POST   /api/projects/:id/bulk-tag             scope/filter/action/apply_tags (write)
POST   /api/projects/:id/bulk-delete          scope/filter (write)
```

### Versions

```
POST   /api/projects/:id/versions             snapshot now (write)
GET    /api/projects/:id/versions             list (write)
POST   /api/projects/:id/versions/:vid/restore  restore + auto-snapshot current (write)
DELETE /api/projects/:id/versions/:vid        delete (write)
```

### Bundle export / import

```
GET    /api/projects/:id/export-data          JSON + media key list; browser zips locally (write)
                                              query: include_video=1|0
POST   /api/projects/import                   atomic batch; mode=create|replace; idempotency-keyed (write)
```

### Publish

```
GET    /api/destinations                      list (write)
POST   /api/destinations                      add (write) — body: {name, api_url, client_id, client_secret, scopes?}
DELETE /api/destinations/:id                  remove (write)
POST   /api/destinations/:id/test             validates the destination's OAuth grant (write)
POST   /api/destinations/:id/issue-token      proxies a fresh bearer for the destination (write)

POST   /api/projects/:id/publish              start a background publish job (write)
                                              body: {destination_id, mode?, target_project_id?, label?}
                                              → 202 {job_id, status: 'pending', poll_url}
GET    /api/publish/jobs/:jobId               status + progress + result (write)
POST   /api/publish/jobs/:jobId/process       internal continuation hook (write)
```

### Pages, blog, content elements, scripts

```
GET/POST/PUT/DELETE /api/pages[/:id]
GET/POST/PUT/DELETE /api/blog[/:id]
GET/POST/PUT/DELETE /api/content/:parentType/:parentId  (parentType = project_step | page | blog_entry)
POST                /api/content/reorder
GET/POST/PUT/DELETE /api/scripts[/:id]
```

### Media

```
POST   /api/media/upload                      single-shot, multipart/form-data, write or session
                                              → {key, url}
POST   /api/media/upload/video/init           multipart upload init (write)
POST   /api/media/upload/video/chunk          one part, raw body (write, ownership-checked)
POST   /api/media/upload/video/complete       finalizes (write, ownership-checked)
DELETE /api/media/upload/video/abort          cancel + cleanup (write, ownership-checked)
GET    /api/media/:key                        public, supports Range requests
DELETE /api/media/:key                        (write)
```

### Cache

```
POST   /api/cache/invalidate-all              wipes KV + cache_keys table (write)
POST   /api/cache/invalidate/:key             single key (write)
```

### Settings backup/restore

```
GET    /api/settings/export?include_projects=1|0      export site data JSON (write)
                                                      when include_projects=1, response includes a full media list
POST   /api/settings/import                            import site payload (write)
                                                      body: { payload, mode: "merge" | "replace" }
```

### Health

```
GET    /api/health                            → {ok: true}
```

---

## Operating notes

- **Free-tier per-Worker subrequest cap (50)** is the binding constraint for cross-instance publish. The publish job batches 35 media uploads per invocation and recurses via `/process`. Persisted `state_json` makes each batch a checkpoint — if a Worker dies mid-flight, the next `/process` resumes only the unfinished media.
- **Source video files** (`projects.video_key`) are typically gigabytes and exceed the destination's single-shot upload body limit. The publish flow skips them (the public site uses `youtube_url` anyway).
- **KV cache** has 24h TTL and is invalidated whenever a project / page / blog row is saved. Code-only deploys don't bust the cache — call `POST /api/cache/invalidate-all` after a renderer change.
- **OAuth tokens** are 24h. Re-issuing a token via `/api/oauth/token` invalidates any prior tokens for that app — single-token-at-a-time semantics.
- **Multipart upload ownership**: every chunked-upload session is tied to the user (or OAuth app id) that called `/init`; chunk/complete/abort 403 if anyone else tries.

---

## Project philosophy

CodeEmpty.com is an open-source application built openly through vibe coding. Sprints are videos: build → publish → review → improve → repeat. The site itself is the demo; the README and the `/about` page describe the broader goal — help more people use AI to build useful things, share the prompts and the debugging, ship the working software publicly.

Open workflows. Open iterations. Open building.
