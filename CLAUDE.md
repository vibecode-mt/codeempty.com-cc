# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeEmpty.com — a personal portfolio/blog site with a full CMS backend. Hosted on **Cloudflare Pages** (free plan) with serverless API via **Cloudflare Workers**, deployed automatically from GitHub on push.

## Cloudflare Stack

| Layer | Service | Purpose |
|---|---|---|
| Hosting | Cloudflare Pages | Static site serving |
| API | Cloudflare Workers | Backend / CMS API |
| Database | Cloudflare D1 (SQLite) | Content storage |
| Cache | Cloudflare KV | Pre-rendered static pages |
| Assets | Cloudflare R2 | Uploaded images |

Everything must run within Cloudflare's **free plan limits** — no long-running processes, no Node.js native addons, no filesystem writes.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Local dev server (Wrangler)
npm run build        # Build for production
npm run deploy       # Deploy to Cloudflare (requires wrangler login)
npm run test         # Run tests
npm run lint         # Lint
```

Single test: `npm test -- --testNamePattern="test name"`

Database migrations: `wrangler d1 migrations apply DB --local` (local) / `wrangler d1 migrations apply DB` (prod)

## Architecture

### Site Pages (Cloudflare Pages / static)
- `/` — Home: grid of project cards (image + title + description → links to `/projects/[slug]`)
- `/projects/[slug]` — Project detail: ordered list of steps, each step has ordered content elements
- `/about` — About me: list of content elements
- `/blog` — Diary/Blog: content elements grouped by date
- `/admin` — CMS backend (client-side React SPA, protected by login)

### Static Page Generation + Invalidation (KV Cache)
When a visitor hits any public URL (`/projects/[slug]`, `/about`, `/blog`), the Worker:
1. Checks KV for a cached pre-rendered HTML string keyed by slug + content hash
2. If found, serves it directly (fast path)
3. If not found, renders HTML, stores in KV, then serves it
4. On CMS content update, the Worker deletes the affected KV key(s) to invalidate

### CMS API (Cloudflare Workers — `/api/*`)
RESTful JSON API consumed by:
- The `/admin` frontend (cookie/session auth for admin UI)
- External AI tools via MCP (OAuth 2.0 bearer tokens)

**Auth model:**
- Admin account created at first boot with a generated GUID password (stored hashed in D1)
- Session cookie for the admin UI (`/api/auth/login`, `/api/auth/logout`)
- OAuth 2.0 client credentials for API consumers — admin can register apps in the CMS to get client_id / client_secret; tokens are issued by `/api/oauth/token`

### Content Model
```
Project
  └── Steps (ordered)
        └── ContentElements (ordered)
              type: image | youtube | title | description | url | prompt_code

Page (about, blog entries)
  └── ContentElements (ordered)
        type: image | youtube | title | description | url | prompt_code

BlogEntry
  date, slug
  └── ContentElements (ordered)

OAuthApp
  client_id, client_secret_hash, name, created_by, scopes

AdminUser
  username, password_hash, created_at

CommonScript
  name, html_snippet, enabled   ← Google Analytics, Clarity, etc.
```

### MCP API Surface
All public CMS operations are available under `/api/v1/` (OAuth-protected). Future MCP clients call these endpoints directly.

## Deployment (CI/CD)

GitHub → Cloudflare Pages integration (configured in Cloudflare dashboard). Every push to `main` triggers a build+deploy. Workers are deployed separately via `wrangler deploy` or bundled via the Pages Functions directory convention (`functions/`).

See `README.md` for Cloudflare dashboard setup steps required by a non-technical operator.

## Key Constraints

- No server-side sessions that require sticky routing — use D1 for session tokens
- KV reads are eventually consistent; use `cacheTtl` appropriately
- D1 free tier: 5 GB storage, 5M reads/day, 100K writes/day — keep queries efficient
- R2 free tier: 10 GB storage, 1M Class A ops/month — serve images via R2 public URL, not proxied through Workers
- Workers free tier: 100K requests/day, 10ms CPU per request (use streaming where possible)
