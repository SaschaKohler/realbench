import { Hono } from 'hono';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrCreateUser } from '../services/user.js';
import { getFlamegraphUrl } from '../services/storage.js';
import { eq } from 'drizzle-orm';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Proxy = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const app = new Hono<{ Variables: Variables }>();

app.get('/:id', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId') as string;
  const runId = c.req.param('id') as string;

  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.clerkId, clerkId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const run = await db.query.profilingRuns.findFirst({
    where: (profilingRuns, { eq }) => eq(profilingRuns.id, runId),
    with: {
      project: true,
    },
  });

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  if (run.project.userId !== user.id) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const flamegraphUrl = run.flamegraphUrl
    ? await getFlamegraphUrl(run.flamegraphUrl)
    : null;

  return c.json({ run: { ...run, flamegraphUrl } });
});

app.get('/:id/diff/:baseId', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId') as string;
  const runId = c.req.param('id') as string;
  const baseId = c.req.param('baseId') as string;

  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.clerkId, clerkId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const [currentRun, baselineRun] = await Promise.all([
    db.query.profilingRuns.findFirst({
      where: (profilingRuns, { eq }) => eq(profilingRuns.id, runId),
    }),
    db.query.profilingRuns.findFirst({
      where: (profilingRuns, { eq }) => eq(profilingRuns.id, baseId),
    }),
  ]);

  if (!currentRun || !baselineRun) {
    return c.json({ error: 'Run not found' }, 404);
  }

  if (currentRun.projectId !== baselineRun.projectId) {
    return c.json({ error: 'Runs must belong to the same project' }, 400);
  }

  const project = await db.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.id, currentRun.projectId),
  });

  if (!project || project.userId !== user.id) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const [currentFlamegraphUrl, baselineFlamegraphUrl] = await Promise.all([
    currentRun.flamegraphUrl ? getFlamegraphUrl(currentRun.flamegraphUrl) : null,
    baselineRun.flamegraphUrl ? getFlamegraphUrl(baselineRun.flamegraphUrl) : null,
  ]);

  return c.json({
    current: { ...currentRun, flamegraphUrl: currentFlamegraphUrl },
    baseline: { ...baselineRun, flamegraphUrl: baselineFlamegraphUrl },
  });
});

app.get('/:id/flamegraph', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId') as string;
  const runId = c.req.param('id') as string;

  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.clerkId, clerkId),
  });
  if (!user) return c.json({ error: 'User not found' }, 404);

  const run = await db.query.profilingRuns.findFirst({
    where: (profilingRuns, { eq }) => eq(profilingRuns.id, runId),
    with: { project: true },
  });
  if (!run) return c.json({ error: 'Run not found' }, 404);
  if (run.project.userId !== user.id) return c.json({ error: 'Access denied' }, 403);
  if (!run.flamegraphUrl) return c.json({ error: 'No flamegraph available' }, 404);

  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: run.flamegraphUrl,
  });

  const s3Response = await s3Proxy.send(command);
  const stream = s3Response.Body as Readable;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return new Response(Buffer.concat(chunks), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

app.delete('/:id', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const runId = c.req.param('id') as string;

  const user = await getOrCreateUser(clerkId);

  // Find run with project to verify ownership
  const run = await db.query.profilingRuns.findFirst({
    where: eq(profilingRuns.id, runId),
    with: {
      project: true,
    },
  });

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  if (run.project.userId !== user.id) {
    return c.json({ error: 'Access denied' }, 403);
  }

  await db.delete(profilingRuns).where(eq(profilingRuns.id, runId));

  return c.json({ success: true, message: 'Run deleted' });
});

export default app;
