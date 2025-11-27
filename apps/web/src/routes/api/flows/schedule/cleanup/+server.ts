import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents, scheduledJobs, suspensions, runStreamChunks } from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// POST /api/flows/schedule/cleanup - Clean up stuck cron runs
// =============================================================================
export const POST: RequestHandler = async () => {
  try {
    // Find stuck cron runs (pending or running for more than 1 hour)
    const stuckRuns = await db.select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(and(
        eq(workflowRuns.trigger, 'cron'),
        inArray(workflowRuns.status, ['pending', 'running'])
      ));

    if (stuckRuns.length === 0) {
      return json({ message: 'No stuck cron runs found', cleaned: 0 });
    }

    const runIds = stuckRuns.map(r => r.id);

    // Delete related records
    for (const runId of runIds) {
      await db.delete(runEvents).where(eq(runEvents.runId, runId));
      await db.delete(scheduledJobs).where(eq(scheduledJobs.runId, runId));
      await db.delete(suspensions).where(eq(suspensions.runId, runId));
      await db.delete(runStreamChunks).where(eq(runStreamChunks.runId, runId));
    }

    // Delete the runs
    await db.delete(workflowRuns).where(inArray(workflowRuns.id, runIds));

    return json({ 
      message: `Cleaned up ${runIds.length} stuck cron run(s)`,
      cleaned: runIds.length 
    });
  } catch (e) {
    console.error('Failed to cleanup cron runs:', e);
    return json({ error: 'Failed to cleanup' }, { status: 500 });
  }
};

