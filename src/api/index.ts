import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import { authRoutes } from './auth';
import { projectRoutes } from './projects';
import { pageRoutes } from './pages';
import { blogRoutes } from './blog';
import { contentRoutes } from './content';
import { oauthRoutes } from './oauth';
import { scriptRoutes } from './scripts';
import { mediaRoutes } from './media';
import { cacheRoutes } from './cache';
import { destinationRoutes } from './destinations';
import { logRoutes, recordException } from './logs';
import { publishRoutes } from './publish';
import { formRoutes } from './forms';
import { i18nRoutes } from './i18n';
import { settingsRoutes } from './settings';
import { migrationRoutes } from './migrations';

export const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.use('*', cors({ origin: '*', credentials: true }));

app.route('/auth', authRoutes);
app.route('/projects', projectRoutes);
app.route('/pages', pageRoutes);
app.route('/blog', blogRoutes);
app.route('/content', contentRoutes);
app.route('/oauth', oauthRoutes);
app.route('/scripts', scriptRoutes);
app.route('/media', mediaRoutes);
app.route('/cache', cacheRoutes);
app.route('/destinations', destinationRoutes);
app.route('/logs', logRoutes);
app.route('/publish', publishRoutes);
app.route('/forms', formRoutes);
app.route('/i18n', i18nRoutes);
app.route('/settings', settingsRoutes);
app.route('/migrations', migrationRoutes);

app.get('/health', (c) => c.json({ ok: true }));

app.onError(async (err, c) => {
  const url = new URL(c.req.url);
  try {
    await recordException(c.env, {
      method: c.req.method,
      path: `${url.pathname}${url.search}`,
      status: 500,
      errorName: err instanceof Error ? err.name : 'Error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? null : null,
      userAgent: c.req.header('user-agent') ?? null,
    });
  } catch (logError) {
    console.error('Failed to record exception log', logError);
  }

  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
