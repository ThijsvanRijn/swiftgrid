import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { SignJWT, jwtVerify } from 'jose';
import { TextEncoder } from 'util';
import Redis from 'ioredis';
import { sanitizeGraph } from '$lib/server/sanitizeGraph';

const SHARE_SECRET = env.SHARE_TOKEN_SECRET || 'dev-share-secret';
const SHARE_TTL_SECONDS = parseInt(env.SHARE_TOKEN_TTL || '604800', 10); // 7 days default
const redis = new Redis(env.REDIS_URL || 'redis://127.0.0.1:6379');

const enc = new TextEncoder();
const keyPromise = crypto.subtle.importKey(
	'raw',
	enc.encode(SHARE_SECRET),
	{ name: 'HMAC', hash: 'SHA-256' },
	false,
	['sign', 'verify']
);

export const POST: RequestHandler = async ({ params }) => {
	const workflowId = parseInt(params.workflowId);
	if (Number.isNaN(workflowId)) {
		return json({ error: 'Invalid workflow id' }, { status: 400 });
	}

	try {
		const [wf] = await db
			.select({
				id: workflows.id,
				activeVersionId: workflows.activeVersionId,
				updatedAt: workflows.updatedAt,
				name: workflows.name,
				shareVersion: workflows.shareVersion,
				graph: workflows.graph
			})
			.from(workflows)
			.where(eq(workflows.id, workflowId))
			.limit(1);

		if (!wf) {
			return json({ error: 'Not found' }, { status: 404 });
		}

		if (!wf.activeVersionId) {
			return json({ error: 'Workflow has no active version to share' }, { status: 400 });
		}

		// Rate limit: 10 per minute per workflow (simple)
		const rlKey = `rate:share:${workflowId}`;
		const current = await redis.incr(rlKey);
		if (current === 1) await redis.expire(rlKey, 60);
		if (current > 10) {
			return json({ error: 'Too many share links, try again soon' }, { status: 429 });
		}

		const key = await keyPromise;
		const token = await new SignJWT({
			wid: wf.id,
			vid: wf.activeVersionId,
			sv: wf.shareVersion ?? 1,
			name: wf.name
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setExpirationTime(`${SHARE_TTL_SECONDS}s`)
			.setIssuedAt()
			.sign(key);

		return json({
			shareUrl: `/share/${token}`,
			expiresIn: SHARE_TTL_SECONDS,
			workflow: { ...wf, graph: sanitizeGraph(wf.graph) }
		});
	} catch (e) {
		console.error('Failed to issue share token:', e);
		return json({ error: 'Failed to create share link' }, { status: 500 });
	}
};


