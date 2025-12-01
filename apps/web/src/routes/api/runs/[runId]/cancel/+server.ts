import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents, runAuditLog } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

// =============================================================================
// POST /api/runs/[runId]/cancel - Cancel a running workflow
// =============================================================================
// This endpoint:
// 1. Updates the run status in the database
// 2. Logs a RUN_CANCELLED event
// 3. Publishes a cancellation signal to Redis pub/sub
//
// The worker listens on cancel:{runId} and will abort in-flight operations.
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

    // Create audit log entry (only if we have workflowId)
    if (run.workflowId) {
      await db.insert(runAuditLog).values({
        runId: runId,
        workflowId: run.workflowId,
        action: 'CANCELLED',
        actor: 'user', // TODO: Get actual user ID
        metadata: {
          previousStatus: run.status,
        },
      });
    }

    // Publish cancellation signal to Redis pub/sub
    // Workers subscribed to cancel:* will receive this and abort in-flight work
    await redis.publish(`cancel:${runId}`, 'cancel');
    console.log(`Published cancellation signal for run ${runId}`);

    return json({ success: true });
  } catch (e) {
    console.error('Failed to cancel run:', e);
    return json({ error: 'Failed to cancel run' }, { status: 500 });
  }
};

