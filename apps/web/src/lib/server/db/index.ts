import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Disable prefetch as it is not supported for "Transaction" mode
const client = postgres(env.DATABASE_URL);
export const db = drizzle(client);