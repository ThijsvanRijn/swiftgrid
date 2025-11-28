import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/flows/{flowId}/rollback - Rollback to a specific version
// =============================================================================
// Sets the active version to a previous version.
// Does NOT modify the draft (graph column) - user can still edit freely.
//
// Request body:
//   - versionNumber: number - Version to rollback to
//
// Response:
//   - success: boolean
//   - activeVersionId: string - The new active version ID
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

    // Find the version to rollback to
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

    // Update the workflow to point to this version
    await db.update(workflows)
      .set({ 
        activeVersionId: targetVersion.id,
        updatedAt: new Date()
      })
      .where(eq(workflows.id, flowId));

    console.log(`Rolled back workflow ${flowId} to version ${versionNumber}`);

    return json({
      success: true,
      activeVersionId: targetVersion.id,
      versionNumber: targetVersion.versionNumber,
    });
  } catch (e) {
    console.error('Failed to rollback workflow:', e);
    return json({ error: 'Failed to rollback workflow' }, { status: 500 });
  }
};

