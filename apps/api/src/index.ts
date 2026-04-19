import { Hono } from 'hono';
import type { Variables } from './types.js';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import dotenv from 'dotenv';
import profileRoutes from './routes/profile.js';
import projectsRoutes from './routes/projects.js';
import runsRoutes from './routes/runs.js';

dotenv.config();

const app = new Hono<{ Variables: Variables }>();

app.use('*', logger());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://realbench-web.fly.dev',
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
];

app.use(
  '*',
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ['authorization', 'content-type'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['*'],
  })
);

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply 500MB body limit to profile endpoint for large binary uploads (SPEC §13)
app.use('/api/v1/profile', bodyLimit({ maxSize: 500 * 1024 * 1024 }));

app.route('/api/v1/profile', profileRoutes);
app.route('/api/v1/projects', projectsRoutes);
app.route('/api/v1/runs', runsRoutes);

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 RealBench API starting on port ${port}`);

if (process.env.NODE_ENV !== 'test') {
  const { serve } = await import('@hono/node-server');
  serve({
    fetch: app.fetch,
    port,
  });
  console.log(`✅ Server running on http://localhost:${port}`);
}

export default app;
