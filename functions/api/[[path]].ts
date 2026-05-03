import { app } from '../../src/api/index';
import type { Env } from '../../src/types';

export const onRequest: PagesFunction<Env> = (ctx) =>
  app.fetch(ctx.request, ctx.env, ctx);
