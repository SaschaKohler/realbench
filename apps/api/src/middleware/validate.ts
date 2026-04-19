import { Context, Next } from 'hono';
import type { Variables } from '../types.js';
import { ZodSchema } from 'zod';

export function validateBody(schema: ZodSchema) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);
      c.set('validatedData', validated);
      await next();
    } catch (error) {
      return c.json({ error: 'Validation failed', details: error }, 400);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (c: Context<{ Variables: Variables }>, next: Next) => {
    try {
      const query = c.req.query();
      const validated = schema.parse(query);
      c.set('validatedData', validated);
      await next();
    } catch (error) {
      return c.json({ error: 'Validation failed', details: error }, 400);
    }
  };
}
