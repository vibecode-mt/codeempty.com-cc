# Copilot Instructions for CodeEmpty.com

## Stack
- API: Hono v4 running in Cloudflare Pages Functions (`functions/api/[[path]].ts`)
- Admin UI: React 18 + React Router 6 + Tailwind CSS (Vite build → `dist/admin/`)
- Public pages: Server-side string templates (no framework), cached in Cloudflare KV
- Database: Cloudflare D1 (SQLite)
- Storage: Cloudflare R2 (images)

## Key constraints
- All code runs in the Cloudflare Workers runtime — no Node.js APIs, no filesystem
- Password hashing uses PBKDF2 via Web Crypto API (available in Workers)
- Session cookies are HttpOnly, SameSite=Lax (no `secure` flag so localhost works)
- Static pages are cached in KV under keys like `home`, `project:{slug}`, `page:{slug}`, `blog:{slug}`, `blog:index`
- Cache invalidation happens automatically when CMS content changes

## Auth
- Admin UI uses session cookie (`session` cookie set by `POST /api/auth/login`)
- External API uses OAuth 2.0 client credentials (`Authorization: Bearer <token>`)
- Both auth paths are handled by `src/api/middleware.ts` (`requireSession`, `requireOAuthOrSession`)

## File layout
```
functions/api/[[path]].ts  → Hono API entry point (all /api/* routes)
functions/[[path]].ts      → Public page renderer + /admin SPA passthrough
src/api/                   → Route handlers (one file per resource)
src/renderer/              → HTML page generators (home, project, page, blog)
src/types.ts               → Shared TypeScript types
src/utils.ts               → uuid, hashPassword, slugify, now, addHours
admin/src/                 → React admin SPA source
migrations/                → D1 SQL migration files
```

## Dev commands
```bash
npm run dev:admin      # Vite watch (builds admin SPA to dist/admin/)
npm run dev            # wrangler pages dev dist --port 8788
npm run db:migrate:local   # Apply D1 migrations locally (first time)
npm run build          # Production build of admin SPA
```
