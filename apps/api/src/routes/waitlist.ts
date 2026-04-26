import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createClerkClient } from '@clerk/backend';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { waitlist } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrCreateUser } from '../services/user.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const app = new Hono<{ Variables: Variables }>();

const JoinWaitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  useCase: z.string().max(500).optional(),
  language: z.enum(['cpp', 'rust', 'go', 'other']).optional(),
});

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = JoinWaitlistSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.waitlist.findFirst({
    where: eq(waitlist.email, parsed.data.email),
  });

  if (existing) {
    return c.json({ message: 'You are already on the waitlist. We will be in touch!' });
  }

  await db.insert(waitlist).values({
    email: parsed.data.email,
    name: parsed.data.name ?? null,
    useCase: parsed.data.useCase ?? null,
    language: parsed.data.language ?? null,
  });

  return c.json({ message: 'You are on the waitlist! We will notify you when your access is ready.' }, 201);
});

app.get('/status', async (c) => {
  const email = c.req.query('email');

  if (!email) {
    return c.json({ error: 'email query parameter required' }, 400);
  }

  const entry = await db.query.waitlist.findFirst({
    where: eq(waitlist.email, email),
    columns: { email: true, approved: true, approvedAt: true, createdAt: true },
  });

  if (!entry) {
    return c.json({ onWaitlist: false });
  }

  return c.json({ onWaitlist: true, approved: entry.approved, approvedAt: entry.approvedAt });
});

app.post('/:id/approve', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const user = await getOrCreateUser(clerkId);

  if (user.plan !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const entryId = c.req.param('id') as string;

  const entry = await db.query.waitlist.findFirst({ where: eq(waitlist.id, entryId) });

  if (!entry) {
    return c.json({ error: 'Waitlist entry not found' }, 404);
  }

  if (entry.approved) {
    return c.json({ error: 'Already approved' }, 400);
  }

  const [updated] = await db
    .update(waitlist)
    .set({ approved: true, approvedAt: new Date() })
    .where(eq(waitlist.id, entryId))
    .returning();

  // Add to Clerk allowlist so the email can sign up
  try {
    await clerk.allowlistIdentifiers.createAllowlistIdentifier({
      identifier: entry.email,
      notify: true,
    });
  } catch (err: any) {
    // Ignore "already on allowlist" errors
    if (!err?.message?.includes('already')) {
      console.error('Clerk allowlist error:', err);
    }
  }

  return c.json({ data: updated });
});

app.get('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const user = await getOrCreateUser(clerkId);

  if (user.plan !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const entries = await db.query.waitlist.findMany({
    orderBy: (waitlist, { asc }) => [asc(waitlist.createdAt)],
  });

  return c.json({ data: entries });
});

export default app;
