import { Hono } from 'hono';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { CreateProjectSchema } from '@realbench/shared';
import { getOrCreateUser } from '../services/user.js';

const app = new Hono<{ Variables: Variables }>();

app.get('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId') as string;

  const user = await getOrCreateUser(clerkId);

  const userProjects = await db.query.projects.findMany({
    where: (projects, { eq }) => eq(projects.userId, user.id),
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });

  return c.json({ projects: userProjects });
});

app.post('/', authMiddleware, validateBody(CreateProjectSchema), async (c) => {
  const clerkId = c.get('clerkId') as string;
  const data = c.get('validatedData');

  const user = await getOrCreateUser(clerkId);

  const [project] = await db
    .insert(projects)
    .values({
      userId: user.id,
      name: data.name,
      language: data.language,
    })
    .returning();

  return c.json({ project });
});

app.get('/:id/runs', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const projectId = c.req.param('id') as string;

  const user = await getOrCreateUser(clerkId);

  const project = await db.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.id, projectId),
  });

  if (!project || project.userId !== user.id) {
    return c.json({ error: 'Project not found or access denied' }, 404);
  }

  const runs = await db.query.profilingRuns.findMany({
    where: (profilingRuns, { eq }) => eq(profilingRuns.projectId, projectId),
    orderBy: (profilingRuns, { desc }) => [desc(profilingRuns.createdAt)],
  });

  return c.json({ runs });
});

export default app;
