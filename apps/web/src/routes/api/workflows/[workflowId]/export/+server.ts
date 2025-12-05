import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
	const workflowId = parseInt(params.workflowId);
	if (Number.isNaN(workflowId)) {
		return json({ error: 'Invalid workflow id' }, { status: 400 });
	}

	try {
		const [wf] = await db
			.select()
			.from(workflows)
			.where(eq(workflows.id, workflowId))
			.limit(1);

		if (!wf) {
			return json({ error: 'Workflow not found' }, { status: 404 });
		}

		const versions = await db
			.select()
			.from(workflowVersions)
			.where(eq(workflowVersions.workflowId, workflowId))
			.orderBy(desc(workflowVersions.versionNumber));

		// Minimal sanitization: drop webhook secret
		const { webhookSecret, ...sanitizedWorkflow } = wf;

		return json({
			workflow: sanitizedWorkflow,
			versions
		});
	} catch (e) {
		console.error('Export failed:', e);
		return json({ error: 'Failed to export workflow' }, { status: 500 });
	}
};


