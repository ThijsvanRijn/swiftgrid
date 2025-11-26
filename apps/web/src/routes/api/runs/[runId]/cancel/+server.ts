import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents, runAuditLog } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/runs/[runId]/cancel - Cancel a running workflow
// =============================================================================
export const POST: RequestHandler = async ({ params }) => {
  const { runId } = params;

  try {
    // Get run
    const runs = await db.select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (runs.length === 0) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const run = runs[0];

    // Can only cancel running or pending runs
    if (!['running', 'pending'].includes(run.status)) {
      return json({ 
        error: `Cannot cancel run with status '${run.status}'` 
      }, { status: 400 });
    }

    // Update status to cancelled
    await db.update(workflowRuns)
      .set({ 
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(workflowRuns.id, runId));

    // Log RUN_CANCELLED event
    await db.insert(runEvents).values({
      runId: runId,
      eventType: 'RUN_CANCELLED',
      payload: {
        cancelledBy: 'user', // TODO: Get actual user ID
        previousStatus: run.status,
      },
    });

    // Create audit log entry
    await db.insert(runAuditLog).values({
      runId: runId,
      workflowId: run.workflowId!,
      action: 'CANCELLED',
      actor: 'user', // TODO: Get actual user ID
      metadata: {
        previousStatus: run.status,
      },
    });

    return json({ success: true });
  } catch (e) {
    console.error('Failed to cancel run:', e);
    return json({ error: 'Failed to cancel run' }, { status: 500 });
  }
};

