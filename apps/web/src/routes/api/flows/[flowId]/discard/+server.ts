import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/flows/{flowId}/discard - Discard draft changes, reset to published
// =============================================================================
// Resets the draft (workflows.graph) to match the active published version.
// Requires that a published version exists.
//
// Response:
//   - success: boolean
//   - message: string
//   - graph: object - The restored graph
export const POST: RequestHandler = async ({ params }) => {
  const flowId = parseInt(params.flowId);
  
  if (isNaN(flowId)) {
    return json({ error: 'Invalid workflow ID' }, { status: 400 });
  }

  try {
    // Get the workflow with its active version
    const [workflow] = await db.select()
      .from(workflows)
      .where(eq(workflows.id, flowId))
      .limit(1);

    if (!workflow) {
      return json({ error: 'Workflow not found' }, { status: 404 });
    }

    if (!workflow.activeVersionId) {
      return json({ error: 'No published version to restore from' }, { status: 400 });
    }

    // Get the active version's graph
    const [activeVersion] = await db.select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflow.activeVersionId))
      .limit(1);

    if (!activeVersion) {
      return json({ error: 'Active version not found' }, { status: 404 });
    }

    // Reset the draft to match the published version
    await db.update(workflows)
      .set({ 
        graph: activeVersion.graph,
        updatedAt: new Date()
      })
      .where(eq(workflows.id, flowId));

    console.log(`Discarded draft changes for workflow ${flowId}, restored to v${activeVersion.versionNumber}`);

    return json({
      success: true,
      message: `Draft reset to v${activeVersion.versionNumber}`,
      graph: activeVersion.graph,
      versionNumber: activeVersion.versionNumber,
    });
  } catch (e) {
    console.error('Failed to discard draft:', e);
    return json({ error: 'Failed to discard draft' }, { status: 500 });
  }
};

