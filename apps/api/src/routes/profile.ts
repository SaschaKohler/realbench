import { Hono } from 'hono';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrCreateUser } from '../services/user.js';
import { ProfileRequestSchema } from '@realbench/shared';
import { enqueueProfilingJob } from '../workers/queue.js';
import { uploadBinary } from '../services/storage.js';

const app = new Hono<{ Variables: Variables }>();

app.post('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');

  const formData = await c.req.formData();
  const binaryFile = formData.get('binary') as File;

  if (!binaryFile) {
    return c.json({ error: 'Binary file is required' }, 400);
  }

  const parsed = ProfileRequestSchema.safeParse({
    projectId: formData.get('projectId'),
    commitSha: formData.get('commitSha'),
    branch: formData.get('branch'),
    buildType: formData.get('buildType'),
    binaryName: formData.get('binaryName') || binaryFile.name,
  });

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;

  const user = await getOrCreateUser(clerkId);

  const project = await db.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.id, data.projectId),
  });

  if (!project || project.userId !== user.id) {
    return c.json({ error: 'Project not found or access denied' }, 404);
  }

  const binaryBuffer = Buffer.from(await binaryFile.arrayBuffer());

  const binaryKey = await uploadBinary(data.projectId, data.commitSha, binaryBuffer);

  const [run] = await db
    .insert(profilingRuns)
    .values({
      projectId: data.projectId,
      commitSha: data.commitSha,
      branch: data.branch,
      buildType: data.buildType,
      status: 'pending',
    })
    .returning();

  await enqueueProfilingJob({
    runId: run.id,
    projectId: data.projectId,
    binaryKey,
    commitSha: data.commitSha,
    branch: data.branch,
    buildType: data.buildType,
  });

  return c.json({
    runId: run.id,
    status: 'pending',
    message: 'Profiling job enqueued',
  });
});

export default app;
