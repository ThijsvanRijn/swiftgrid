import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Reuse the client in dev to avoid exhausting connections on HMR
// and set a small pool max to stay under local Postgres limits.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - allow attaching to globalThis
declare const global: typeof globalThis & {
	__pgClient?: ReturnType<typeof postgres>;
	__db?: ReturnType<typeof drizzle>;
};

const client =
	global.__pgClient ??
	postgres(env.DATABASE_URL, {
		max: 10 // keep pool small for local dev to avoid "too many clients"
	});

// Disable prefetch as it is not supported for "Transaction" mode (default in postgres-js)
export const db = global.__db ?? drizzle(client);

if (!global.__pgClient) {
	global.__pgClient = client;
}
if (!global.__db) {
	global.__db = db;
}