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
import { publishRoutes } from './publish';
import { formRoutes } from './forms';

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
app.route('/publish', publishRoutes);
app.route('/forms', formRoutes);

app.get('/health', (c) => c.json({ ok: true }));

export default app;
