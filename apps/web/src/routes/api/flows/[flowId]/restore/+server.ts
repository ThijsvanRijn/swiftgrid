import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/flows/{flowId}/restore - Restore draft from a specific version
// =============================================================================
// Copies the graph from a version into the draft (workflows.graph).
// Does NOT change the active published version.
//
// Request body:
//   - versionNumber: number - Version to restore from
//
// Response:
//   - success: boolean
//   - message: string
export const POST: RequestHandler = async ({ params, request }) => {
  const flowId = parseInt(params.flowId);
  
  if (isNaN(flowId)) {
    return json({ error: 'Invalid workflow ID' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { versionNumber } = body as { versionNumber: number };

    if (typeof versionNumber !== 'number' || versionNumber < 1) {
      return json({ error: 'Invalid version number' }, { status: 400 });
    }

    // Find the version to restore from
    const [targetVersion] = await db.select()
      .from(workflowVersions)
      .where(and(
        eq(workflowVersions.workflowId, flowId),
        eq(workflowVersions.versionNumber, versionNumber)
      ))
      .limit(1);

    if (!targetVersion) {
      return json({ error: `Version ${versionNumber} not found` }, { status: 404 });
    }

    // Update the draft graph with the version's graph
    await db.update(workflows)
      .set({ 
        graph: targetVersion.graph,
        updatedAt: new Date()
      })
      .where(eq(workflows.id, flowId));

    console.log(`Restored draft of workflow ${flowId} from version ${versionNumber}`);

    return json({
      success: true,
      message: `Draft restored from version ${versionNumber}`,
      graph: targetVersion.graph,
    });
  } catch (e) {
    console.error('Failed to restore draft:', e);
    return json({ error: 'Failed to restore draft' }, { status: 500 });
  }
};

