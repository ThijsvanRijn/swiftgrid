import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { env } from '$env/dynamic/private';
import { TextEncoder } from 'util';
import { sanitizeGraph } from '$lib/server/sanitizeGraph';

const SHARE_SECRET = env.SHARE_TOKEN_SECRET || 'dev-share-secret';

const enc = new TextEncoder();
const keyPromise = crypto.subtle.importKey(
	'raw',
	enc.encode(SHARE_SECRET),
	{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
);

export const POST: RequestHandler = async ({ params }) => {
	const { token } = params;
	try {
		const key = await keyPromise;
		const { payload } = await jwtVerify(token, key);
		const data = payload as { wid?: number; vid?: string; sv?: number; name?: string };
		if (!data?.wid || !data?.vid) {
			return json({ error: 'Invalid token' }, { status: 400 });
		}

		// Get workflow and check shareVersion
		const [wf] = await db
			.select()
			.from(workflows)
			.where(eq(workflows.id, data.wid))
			.limit(1);

		if (!wf) return json({ error: 'Not found' }, { status: 404 });
		if (wf.shareVersion > (data.sv ?? 1)) {
			return json({ error: 'Link revoked' }, { status: 410 });
		}

		const [version] = await db
			.select()
			.from(workflowVersions)
			.where(eq(workflowVersions.id, data.vid))
			.limit(1);

		if (!version) return json({ error: 'Version not found' }, { status: 404 });

		// Clone workflow
		const [created] = await db
			.insert(workflows)
			.values({
				name: `${wf.name} (clone)`,
				graph: sanitizeGraph(version.graph),
				activeVersionId: null,
				webhookEnabled: false,
				scheduleEnabled: false,
				shareVersion: 1
			})
			.returning();

		return json({ success: true, workflowId: created.id });
	} catch (e) {
		console.error('Clone failed:', e);
		return json({ error: 'Failed to clone from share' }, { status: 400 });
	}
};


