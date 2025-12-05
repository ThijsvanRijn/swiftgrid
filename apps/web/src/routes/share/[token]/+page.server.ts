import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { jwtVerify } from 'jose';
import { TextEncoder } from 'util';
import { sanitizeGraph } from '$lib/server/sanitizeGraph';
import { error } from '@sveltejs/kit';

const SHARE_SECRET = env.SHARE_TOKEN_SECRET || 'dev-share-secret';

const enc = new TextEncoder();
const keyPromise = crypto.subtle.importKey(
	'raw',
	enc.encode(SHARE_SECRET),
	{ name: 'HMAC', hash: 'SHA-256' },
	false,
	['verify']
);

export const load: PageServerLoad = async ({ params }) => {
	const { token } = params;
	
	try {
		const key = await keyPromise;
		const { payload } = await jwtVerify(token, key);
		const data = payload as { wid?: number; vid?: string; sv?: number; name?: string };
		
		if (!data?.wid || !data?.vid) {
			throw error(400, 'Invalid share link');
		}

		// Get workflow
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

		if (!wf) {
			throw error(404, 'Workflow not found');
		}
		
		if (wf.activeVersionId !== data.vid) {
			throw error(410, 'This version is no longer active. The owner may have published a new version.');
		}
		
		if ((wf.shareVersion ?? 1) > (data.sv ?? 1)) {
			throw error(410, 'This share link has been revoked by the owner.');
		}

		// Get version details
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

		if (!version) {
			throw error(404, 'Version not found');
		}

		return {
			token,
			workflow: {
				id: wf.id,
				name: wf.name,
				updatedAt: wf.updatedAt,
			},
			version: {
				id: version.id,
				versionNumber: version.versionNumber,
				changeSummary: version.changeSummary,
				createdAt: version.createdAt,
			},
			graph: sanitizeGraph(version.graph)
		};
	} catch (e: unknown) {
		// Re-throw SvelteKit errors
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		console.error('Share page load error:', e);
		throw error(400, 'Invalid or expired share link');
	}
};

