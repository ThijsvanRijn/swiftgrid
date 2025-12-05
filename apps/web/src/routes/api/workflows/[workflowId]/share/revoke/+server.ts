import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params }) => {
	const workflowId = parseInt(params.workflowId);
	if (Number.isNaN(workflowId)) {
		return json({ error: 'Invalid workflow id' }, { status: 400 });
	}

	try {
		const [wf] = await db
			.update(workflows)
			.set({ shareVersion: workflows.shareVersion + 1 })
			.where(eq(workflows.id, workflowId))
			.returning({ id: workflows.id, shareVersion: workflows.shareVersion });

		if (!wf) {
			return json({ error: 'Workflow not found' }, { status: 404 });
		}

		return json({ success: true, shareVersion: wf.shareVersion });
	} catch (e) {
		console.error('Failed to revoke share links:', e);
		return json({ error: 'Failed to revoke share links' }, { status: 500 });
	}
};


