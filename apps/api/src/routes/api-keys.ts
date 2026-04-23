import { createHash, randomBytes } from 'crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrCreateUser } from '../services/user.js';

const app = new Hono<{ Variables: Variables }>();

const CreateApiKeySchema = z.object({
  label: z.string().min(1).max(100).default('CI Key'),
});

app.get('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const user = await getOrCreateUser(clerkId);

  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, user.id),
    columns: { keyHash: false },
  });

  return c.json({ data: keys });
});

app.post('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const user = await getOrCreateUser(clerkId);

  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const rawKey = `rbk_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const [created] = await db
    .insert(apiKeys)
    .values({ userId: user.id, keyHash, label: parsed.data.label })
    .returning({ id: apiKeys.id, label: apiKeys.label, createdAt: apiKeys.createdAt });

  return c.json({ data: { ...created, key: rawKey } }, 201);
});

app.delete('/:id', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const keyId = c.req.param('id') as string;
  const user = await getOrCreateUser(clerkId);

  const existing = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, keyId),
  });

  if (!existing || existing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404);
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  return c.json({ success: true });
});

export default app;
