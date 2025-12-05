import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

type ExportedWorkflow = {
	workflow: any;
	versions: Array<{
		versionNumber: number;
		changeSummary: string | null;
		graph: any;
		createdBy: string | null;
		createdAt: string;
		id: string;
	}>;
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as ExportedWorkflow;
		if (!body.workflow || !Array.isArray(body.versions)) {
			return json({ error: 'Invalid payload' }, { status: 400 });
		}

		const sourceWorkflow = body.workflow;
		const versions = body.versions;

		// Create new workflow
		const [created] = await db
			.insert(workflows)
			.values({
				name: `${sourceWorkflow.name || 'Imported Workflow'}`,
				graph: sourceWorkflow.graph ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
				webhookEnabled: false,
				scheduleEnabled: false,
				shareVersion: 1
			})
			.returning();

		// Import versions in order
		let newActiveVersionId: string | null = null;
		const sorted = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
		for (const v of sorted) {
			const [inserted] = await db
				.insert(workflowVersions)
				.values({
					workflowId: created.id,
					versionNumber: v.versionNumber,
					graph: v.graph,
					changeSummary: v.changeSummary,
					createdBy: v.createdBy ?? 'import',
				})
				.returning();

			// If this was the highest version (assume last in sorted), set active pointer
			newActiveVersionId = inserted.id;
		}

		if (newActiveVersionId) {
			await db
				.update(workflows)
				.set({
					activeVersionId: newActiveVersionId
				})
				.where(eq(workflows.id, created.id));
		}

		return json({
			success: true,
			workflowId: created.id
		});
	} catch (e) {
		console.error('Import failed:', e);
		return json({ error: 'Failed to import workflow' }, { status: 500 });
	}
};


