import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// GET /api/flows/{flowId}/versions - List all versions of a workflow
// =============================================================================
// Returns all published versions in descending order (newest first).
//
// Response:
//   - versions: Array of version objects
//   - activeVersionId: string | null - Currently active version
export const GET: RequestHandler = async ({ params }) => {
  const flowId = parseInt(params.flowId);
  
  if (isNaN(flowId)) {
    return json({ error: 'Invalid workflow ID' }, { status: 400 });
  }

  try {
    // Get the workflow to find active version
    const [workflow] = await db.select({
      activeVersionId: workflows.activeVersionId
    })
      .from(workflows)
      .where(eq(workflows.id, flowId))
      .limit(1);

    if (!workflow) {
      return json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Get all versions
    const versions = await db.select({
      id: workflowVersions.id,
      versionNumber: workflowVersions.versionNumber,
      changeSummary: workflowVersions.changeSummary,
      createdBy: workflowVersions.createdBy,
      createdAt: workflowVersions.createdAt,
    })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, flowId))
      .orderBy(desc(workflowVersions.versionNumber));

    return json({
      versions,
      activeVersionId: workflow.activeVersionId,
    });
  } catch (e) {
    console.error('Failed to list versions:', e);
    return json({ error: 'Failed to list versions' }, { status: 500 });
  }
};

