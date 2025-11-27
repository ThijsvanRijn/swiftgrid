import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents, runAuditLog, workflows, scheduledJobs, suspensions, runStreamChunks } from '$lib/server/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// GET /api/runs/[runId] - Get run details with events
// =============================================================================
export const GET: RequestHandler = async ({ params }) => {
  const { runId } = params;

  try {
    // Get run details
    const runs = await db.select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (runs.length === 0) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const run = runs[0];

    // Get all events for this run
    const events = await db.select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.id));

    // Get workflow name
    let workflowName = 'Unknown Workflow';
    if (run.workflowId) {
      const workflow = await db.select({ name: workflows.name })
        .from(workflows)
        .where(eq(workflows.id, run.workflowId))
        .limit(1);
      if (workflow.length > 0) {
        workflowName = workflow[0].name;
      }
    }

    // Build node results from events
    const nodeResults: Record<string, {
      status: string;
      result?: unknown;
      error?: string;
      startedAt?: Date;
      completedAt?: Date;
      durationMs?: number;
    }> = {};

    for (const event of events) {
      if (!event.nodeId) continue;

      if (!nodeResults[event.nodeId]) {
        nodeResults[event.nodeId] = { status: 'pending' };
      }

      const payload = event.payload as Record<string, unknown> | null;

      switch (event.eventType) {
        case 'NODE_STARTED':
          nodeResults[event.nodeId].status = 'running';
          nodeResults[event.nodeId].startedAt = event.createdAt;
          break;
        case 'NODE_COMPLETED':
          nodeResults[event.nodeId].status = 'success';
          nodeResults[event.nodeId].result = payload?.result;
          nodeResults[event.nodeId].completedAt = event.createdAt;
          if (nodeResults[event.nodeId].startedAt) {
            nodeResults[event.nodeId].durationMs = 
              new Date(event.createdAt).getTime() - 
              new Date(nodeResults[event.nodeId].startedAt!).getTime();
          }
          break;
        case 'NODE_FAILED':
          nodeResults[event.nodeId].status = 'error';
          nodeResults[event.nodeId].error = payload?.error as string;
          nodeResults[event.nodeId].completedAt = event.createdAt;
          break;
        case 'NODE_SUSPENDED':
          nodeResults[event.nodeId].status = 'suspended';
          break;
      }
    }

    // Calculate run duration
    const durationMs = run.completedAt && run.startedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : run.startedAt
        ? Date.now() - new Date(run.startedAt).getTime()
        : null;

    return json({
      run: {
        ...run,
        workflowName,
        durationMs,
      },
      events,
      nodeResults,
    });
  } catch (e) {
    console.error('Failed to get run:', e);
    return json({ error: 'Failed to get run' }, { status: 500 });
  }
};

// =============================================================================
// DELETE /api/runs/[runId] - Delete a run (hard delete + audit log)
// =============================================================================
export const DELETE: RequestHandler = async ({ params }) => {
  const { runId } = params;

  try {
    // Get run info for audit log
    const runs = await db.select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      status: workflowRuns.status,
    })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (runs.length === 0) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const run = runs[0];

    // Create audit log entry BEFORE deleting
    if (run.workflowId) {
      await db.insert(runAuditLog).values({
        runId: run.id,
        workflowId: run.workflowId,
        action: 'DELETED',
        actor: 'user', // TODO: Get actual user ID from session
        metadata: {
          originalStatus: run.status,
          reason: 'user_request',
        },
      });
    }

    // Delete all related records first (foreign key constraints)
    await db.delete(runEvents).where(eq(runEvents.runId, runId));
    await db.delete(scheduledJobs).where(eq(scheduledJobs.runId, runId));
    await db.delete(suspensions).where(eq(suspensions.runId, runId));
    await db.delete(runStreamChunks).where(eq(runStreamChunks.runId, runId));
    
    // Delete the run
    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));

    return json({ success: true });
  } catch (e) {
    console.error('Failed to delete run:', e);
    return json({ error: 'Failed to delete run' }, { status: 500 });
  }
};

// =============================================================================
// PATCH /api/runs/[runId] - Update run (pin/unpin)
// =============================================================================
export const PATCH: RequestHandler = async ({ params, request }) => {
  const { runId } = params;
  const body = await request.json();

  try {
    const updates: Partial<{ pinned: boolean }> = {};

    if (typeof body.pinned === 'boolean') {
      updates.pinned = body.pinned;
    }

    if (Object.keys(updates).length === 0) {
      return json({ error: 'No valid updates provided' }, { status: 400 });
    }

    await db.update(workflowRuns)
      .set(updates)
      .where(eq(workflowRuns.id, runId));

    return json({ success: true });
  } catch (e) {
    console.error('Failed to update run:', e);
    return json({ error: 'Failed to update run' }, { status: 500 });
  }
};

