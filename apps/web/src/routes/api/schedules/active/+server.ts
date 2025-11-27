import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflows } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// =============================================================================
// GET /api/schedules/active - Get all active schedules
// =============================================================================
export const GET: RequestHandler = async () => {
  try {
    const activeSchedules = await db.select({
      workflowId: workflows.id,
      workflowName: workflows.name,
      cron: workflows.scheduleCron,
      timezone: workflows.scheduleTimezone,
      nextRun: workflows.scheduleNextRun,
      overlapMode: workflows.scheduleOverlapMode,
    })
      .from(workflows)
      .where(eq(workflows.scheduleEnabled, true));

    return json({
      count: activeSchedules.length,
      schedules: activeSchedules.map(s => ({
        workflowId: s.workflowId,
        workflowName: s.workflowName,
        cron: s.cron,
        timezone: s.timezone || 'UTC',
        nextRun: s.nextRun?.toISOString(),
        overlapMode: s.overlapMode || 'skip',
      })),
    });
  } catch (e) {
    console.error('Failed to get active schedules:', e);
    return json({ error: 'Failed to get active schedules' }, { status: 500 });
  }
};

