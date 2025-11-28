import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents } from '$lib/server/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// GET /api/runs/active - Get active runs for a workflow with node statuses
// =============================================================================
// Query params:
//   - workflowId: Filter by workflow (required)
//
// Returns the most recent running/pending run and its node statuses
// so the UI can restore state after a page refresh.
export const GET: RequestHandler = async ({ url }) => {
  const workflowId = url.searchParams.get('workflowId');
  
  if (!workflowId) {
    return json({ error: 'workflowId is required' }, { status: 400 });
  }

  try {
    // Find the most recent running or pending run for this workflow
    const [activeRun] = await db.select()
      .from(workflowRuns)
      .where(and(
        eq(workflowRuns.workflowId, parseInt(workflowId)),
        inArray(workflowRuns.status, ['running', 'pending'])
      ))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(1);

    if (!activeRun) {
      return json({ activeRun: null });
    }

    // Get all events for this run to determine node statuses
    const events = await db.select()
      .from(runEvents)
      .where(eq(runEvents.runId, activeRun.id))
      .orderBy(runEvents.createdAt);

    // Build node status map from events
    const nodeStatuses: Record<string, { 
      status: 'idle' | 'running' | 'success' | 'error' | 'suspended';
      result?: any;
    }> = {};

    for (const event of events) {
      if (!event.nodeId) continue;
      
      switch (event.eventType) {
        case 'NODE_SCHEDULED':
        case 'NODE_STARTED':
          nodeStatuses[event.nodeId] = { status: 'running' };
          break;
        case 'NODE_COMPLETED':
          const payload = event.payload as any;
          nodeStatuses[event.nodeId] = { 
            status: 'success',
            result: payload?.result
          };
          break;
        case 'NODE_FAILED':
          const errorPayload = event.payload as any;
          nodeStatuses[event.nodeId] = { 
            status: 'error',
            result: { error: errorPayload?.error }
          };
          break;
        case 'NODE_SUSPENDED':
          nodeStatuses[event.nodeId] = { status: 'suspended' };
          break;
        case 'NODE_RESUMED':
          nodeStatuses[event.nodeId] = { status: 'running' };
          break;
      }
    }

    return json({
      activeRun: {
        id: activeRun.id,
        status: activeRun.status,
        trigger: activeRun.trigger,
        createdAt: activeRun.createdAt,
      },
      nodeStatuses
    });
  } catch (e) {
    console.error('Failed to get active run:', e);
    return json({ error: 'Failed to get active run' }, { status: 500 });
  }
};

