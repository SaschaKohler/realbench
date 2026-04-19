import { Hono } from 'hono';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

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

  return c.json({ run });
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

  return c.json({
    current: currentRun,
    baseline: baselineRun,
  });
});

export default app;
