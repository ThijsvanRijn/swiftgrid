import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

	let postgresStatus: 'up' | 'down' = 'down';
	let redisStatus: 'up' | 'down' = 'down';

	try {
		await db.execute(sql`select 1`);
		postgresStatus = 'up';
	} catch (e) {
		console.error('Healthcheck: Postgres down', e);
		postgresStatus = 'down';
	}

	try {
		await redis.ping();
		redisStatus = 'up';
	} catch (e) {
		console.error('Healthcheck: Redis down', e);
		redisStatus = 'down';
	} finally {
		await redis.quit();
	}

	return json({
		postgres: postgresStatus,
		redis: redisStatus
	});
};


