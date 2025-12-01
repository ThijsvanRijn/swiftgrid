import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents, workflows, workflowVersions } from '$lib/server/db/schema';
import { desc, eq, and, sql, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// GET /api/runs - List all runs with filters
// =============================================================================
// Query params:
//   - workflowId: Filter by workflow
//   - status: Filter by status (completed, failed, running, pending)
//   - trigger: Filter by trigger (manual, webhook, cron)
//   - limit: Number of results (default 20, max 100)
//   - cursor: Pagination cursor (run ID to start after)
//   - pinned: Filter pinned runs only (true/false)
export const GET: RequestHandler = async ({ url }) => {
  try {
    const workflowId = url.searchParams.get('workflowId');
    const status = url.searchParams.get('status');
    const trigger = url.searchParams.get('trigger');
    const pinned = url.searchParams.get('pinned');
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    // Build conditions
    const conditions = [];
    
    if (workflowId) {
      conditions.push(eq(workflowRuns.workflowId, parseInt(workflowId)));
    }
    if (status) {
      conditions.push(eq(workflowRuns.status, status));
    }
    if (trigger) {
      conditions.push(eq(workflowRuns.trigger, trigger));
    }
    if (pinned === 'true') {
      conditions.push(eq(workflowRuns.pinned, true));
    }
    if (cursor) {
      // Get the createdAt of the cursor run for pagination
      const cursorRun = await db.select({ createdAt: workflowRuns.createdAt })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, cursor))
        .limit(1);
      
      if (cursorRun.length > 0 && cursorRun[0].createdAt) {
        conditions.push(sql`${workflowRuns.createdAt} < ${cursorRun[0].createdAt}`);
      }
    }

    // Query runs with workflow name and version info
    const runs = await db.select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      workflowVersionId: workflowRuns.workflowVersionId,
      versionNumber: workflowVersions.versionNumber,
      status: workflowRuns.status,
      trigger: workflowRuns.trigger,
      pinned: workflowRuns.pinned,
      inputData: workflowRuns.inputData,
      outputData: workflowRuns.outputData,
      createdAt: workflowRuns.createdAt,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      // Sub-flow parent linking
      parentRunId: workflowRuns.parentRunId,
      parentNodeId: workflowRuns.parentNodeId,
      depth: workflowRuns.depth,
    })
      .from(workflowRuns)
      .leftJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
      .leftJoin(workflowVersions, eq(workflowRuns.workflowVersionId, workflowVersions.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowRuns.createdAt))
      .limit(limit + 1); // Fetch one extra to check if there's more

    // Check if there's more results
    const hasMore = runs.length > limit;
    const results = hasMore ? runs.slice(0, limit) : runs;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Get error info for failed runs
    const failedRunIds = results.filter(r => r.status === 'failed').map(r => r.id);
    let errorMap: Record<string, string> = {};
    
    if (failedRunIds.length > 0) {
      const errorEvents = await db.select({
        runId: runEvents.runId,
        payload: runEvents.payload,
      })
        .from(runEvents)
        .where(and(
          inArray(runEvents.runId, failedRunIds),
          eq(runEvents.eventType, 'NODE_FAILED')
        ));
      
      for (const event of errorEvents) {
        if (event.runId && event.payload) {
          const payload = event.payload as { error?: string };
          if (payload.error && !errorMap[event.runId]) {
            errorMap[event.runId] = payload.error;
          }
        }
      }
    }

    // Calculate duration for completed runs
    const enrichedResults = results.map(run => ({
      ...run,
      durationMs: run.completedAt && run.startedAt 
        ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
        : null,
      error: errorMap[run.id] || null,
    }));

    // Get total count (with same filters)
    const countConditions = [];
    if (workflowId) countConditions.push(eq(workflowRuns.workflowId, parseInt(workflowId)));
    if (status) countConditions.push(eq(workflowRuns.status, status));
    if (trigger) countConditions.push(eq(workflowRuns.trigger, trigger));
    if (pinned === 'true') countConditions.push(eq(workflowRuns.pinned, true));

    const [{ count: totalCount }] = await db.select({ count: sql<number>`count(*)` })
      .from(workflowRuns)
      .where(countConditions.length > 0 ? and(...countConditions) : undefined);

    return json({
      runs: enrichedResults,
      nextCursor,
      hasMore,
      totalCount: Number(totalCount),
    });
  } catch (e) {
    console.error('Failed to list runs:', e);
    return json({ error: 'Failed to list runs' }, { status: 500 });
  }
};

