import { createHash } from 'crypto';
import { Context, Next } from 'hono';
import type { Variables } from '../types.js';
import { verifyToken } from '@clerk/backend';
import { db } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { apiKeys } from '../db/schema.js';

export async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    console.log('❌ Auth failed: No Authorization header or wrong format');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);

  // Try API key auth first (prefix: "rbk_")
  if (token.startsWith('rbk_')) {
    const keyHash = createHash('sha256').update(token).digest('hex');
    const apiKey = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.keyHash, keyHash),
      with: { user: true },
    });

    if (!apiKey) {
      console.log('❌ Auth failed: Invalid API key');
      return c.json({ error: 'Invalid API key' }, 401);
    }

    db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKey.id)).execute().catch(() => {});

    console.log('✅ API key auth success for user:', apiKey.user.clerkId);
    c.set('userId', apiKey.user.clerkId);
    c.set('clerkId', apiKey.user.clerkId);
    await next();
    return;
  }

  // Fall back to Clerk JWT verification
  console.log('🔑 Attempting to verify Clerk token...');
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    console.log('✅ Auth success:', payload.sub);
    c.set('userId', payload.sub);
    c.set('clerkId', payload.sub);
    await next();
  } catch (error) {
    console.error('❌ Auth failed: Token verification error:', error);
    return c.json({ error: 'Invalid token' }, 401);
  }
}
