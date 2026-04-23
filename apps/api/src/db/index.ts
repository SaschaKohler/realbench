import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';
import * as schema from './schema.js';

dotenv.config();

const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

console.log('🔌 Connecting to database:', connectionString.replace(/:[^:@]+@/, ':****@'));

const client = postgres(connectionString, {
  connect_timeout: 30,
  idle_timeout: 20,
  max_lifetime: 60 * 10,
  max: 10,
});

export const db = drizzle(client, { schema });
