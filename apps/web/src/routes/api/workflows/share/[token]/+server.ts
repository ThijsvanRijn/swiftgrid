import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { jwtVerify } from 'jose';
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

export const GET: RequestHandler = async ({ params }) => {
	const { token } = params;
	try {
		const key = await keyPromise;
		const { payload } = await jwtVerify(token, key);
		const data = payload as { wid?: number; vid?: string; sv?: number };
		if (!data?.wid || !data?.vid) {
			return json({ error: 'Invalid token' }, { status: 400 });
		}

		// Get workflow and active version graph
		const [wf] = await db
			.select({
				id: workflows.id,
				name: workflows.name,
				activeVersionId: workflows.activeVersionId,
				updatedAt: workflows.updatedAt,
				shareVersion: workflows.shareVersion,
				graph: workflows.graph
			})
			.from(workflows)
			.where(eq(workflows.id, data.wid))
			.limit(1);

		if (!wf) return json({ error: 'Not found' }, { status: 404 });
		if (wf.activeVersionId !== data.vid) {
			return json({ error: 'Version no longer active' }, { status: 410 });
		}
		if ((wf.shareVersion ?? 1) > (data.sv ?? 1)) {
			return json({ error: 'Link revoked by owner' }, { status: 410 });
		}

		const [version] = await db
			.select({
				id: workflowVersions.id,
				versionNumber: workflowVersions.versionNumber,
				graph: workflowVersions.graph,
				changeSummary: workflowVersions.changeSummary,
				createdAt: workflowVersions.createdAt,
			})
			.from(workflowVersions)
			.where(eq(workflowVersions.id, data.vid))
			.limit(1);

		if (!version) return json({ error: 'Version not found' }, { status: 404 });

		// Sanitize: no secrets exist in versions, but keep payload minimal
		return json({
			workflow: {
				id: wf.id,
				name: wf.name,
				activeVersionId: wf.activeVersionId,
				updatedAt: wf.updatedAt,
				graph: sanitizeGraph(wf.graph)
			},
			version: { ...version, graph: sanitizeGraph(version.graph) },
		});
	} catch (e) {
		console.error('Share token failure:', e);
		return json({ error: 'Invalid or expired token' }, { status: 400 });
	}
};


