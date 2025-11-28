import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { eq, max } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/flows/{flowId}/publish - Publish current draft as new version
// =============================================================================
// Creates an immutable version snapshot from the current graph.
// The new version becomes the active version for scheduled runs.
//
// Request body:
//   - changeSummary?: string - Description of changes in this version
//
// Response:
//   - versionId: string - UUID of the new version
//   - versionNumber: number - Sequential version number
export const POST: RequestHandler = async ({ params, request }) => {
  const flowId = parseInt(params.flowId);
  
  if (isNaN(flowId)) {
    return json({ error: 'Invalid workflow ID' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { changeSummary } = body as { changeSummary?: string };

    // Get the current workflow
    const [workflow] = await db.select()
      .from(workflows)
      .where(eq(workflows.id, flowId))
      .limit(1);

    if (!workflow) {
      return json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Get the next version number
    const [maxVersion] = await db.select({ max: max(workflowVersions.versionNumber) })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, flowId));

    const nextVersionNumber = (maxVersion?.max ?? 0) + 1;

    // Create the new version
    const [newVersion] = await db.insert(workflowVersions).values({
      workflowId: flowId,
      versionNumber: nextVersionNumber,
      graph: workflow.graph,
      changeSummary: changeSummary || `Version ${nextVersionNumber}`,
      createdBy: 'user', // TODO: Replace with actual user when auth is added
    }).returning();

    // Update the workflow to point to this version
    await db.update(workflows)
      .set({ 
        activeVersionId: newVersion.id,
        updatedAt: new Date()
      })
      .where(eq(workflows.id, flowId));

    console.log(`Published workflow ${flowId} as version ${nextVersionNumber} (${newVersion.id})`);

    return json({
      versionId: newVersion.id,
      versionNumber: newVersion.versionNumber,
      createdAt: newVersion.createdAt,
    });
  } catch (e) {
    console.error('Failed to publish workflow:', e);
    return json({ error: 'Failed to publish workflow' }, { status: 500 });
  }
};

