import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

function sanitizeGraph(graph: any) {
	if (!graph) return graph;
	const stripData = (data: any) => {
		if (!data) return data;
		// remove runtime/state fields
		const {
			status,
			result,
			mapProgress,
			mapCompletedCount,
			mapTotalCount,
			mapWorkflowName,
			mapWorkflowId: _mWid, // keep? we keep below
			...rest
		} = data;
		return {
			...rest,
			// keep map workflow references if present
			...(data.mapWorkflowId ? { mapWorkflowId: data.mapWorkflowId } : {}),
			...(data.mapVersionId ? { mapVersionId: data.mapVersionId } : {}),
			...(data.mapVersionNumber ? { mapVersionNumber: data.mapVersionNumber } : {}),
			...(data.mapConcurrency ? { mapConcurrency: data.mapConcurrency } : {}),
			...(data.mapFailFast !== undefined ? { mapFailFast: data.mapFailFast } : {}),
			...(data.mapInputArray ? { mapInputArray: data.mapInputArray } : {}),
		};
	};

	return {
		...graph,
		nodes: (graph.nodes || []).map((n: any) => ({
			id: n.id,
			type: n.type,
			position: n.position,
			data: stripData(n.data),
		})),
		edges: graph.edges || [],
	};
}

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

		const versionsRaw = await db
			.select()
			.from(workflowVersions)
			.where(eq(workflowVersions.workflowId, workflowId))
			.orderBy(desc(workflowVersions.versionNumber));

		const versions = versionsRaw.map((v) => ({
			...v,
			graph: sanitizeGraph(v.graph)
		}));

		// Minimal sanitization: drop webhook secret
		const { webhookSecret, ...sanitizedWorkflow } = wf;

		return json({
			workflow: { ...sanitizedWorkflow, graph: sanitizeGraph(wf.graph) },
			versions
		});
	} catch (e) {
		console.error('Export failed:', e);
		return json({ error: 'Failed to export workflow' }, { status: 500 });
	}
};


