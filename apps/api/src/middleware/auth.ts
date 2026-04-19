import { Context, Next } from 'hono';
import type { Variables } from '../types.js';
import { verifyToken } from '@clerk/backend';

export async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    console.log('❌ Auth failed: No Authorization header or wrong format');
    console.log('Headers:', c.req.header());
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.substring(7);
  console.log('🔑 Attempting to verify token...');

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
