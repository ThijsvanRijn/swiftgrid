import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { workflows, workflowRuns } from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// GET: Load schedule configuration for a workflow
export const GET: RequestHandler = async ({ url }) => {
	const workflowId = url.searchParams.get('workflowId');
	
	if (!workflowId) {
		return json({ error: 'workflowId is required' }, { status: 400 });
	}

	const workflow = await db
		.select({
			scheduleEnabled: workflows.scheduleEnabled,
			scheduleCron: workflows.scheduleCron,
			scheduleTimezone: workflows.scheduleTimezone,
			scheduleInputData: workflows.scheduleInputData,
			scheduleNextRun: workflows.scheduleNextRun,
			scheduleOverlapMode: workflows.scheduleOverlapMode,
		})
		.from(workflows)
		.where(eq(workflows.id, parseInt(workflowId)))
		.limit(1);

	if (workflow.length === 0) {
		return json({ error: 'Workflow not found' }, { status: 404 });
	}

	const w = workflow[0];
	
	return json({
		enabled: w.scheduleEnabled ?? false,
		cron: w.scheduleCron ?? '0 9 * * 1-5',
		timezone: w.scheduleTimezone ?? 'UTC',
		inputData: w.scheduleInputData ? JSON.stringify(w.scheduleInputData) : '{}',
		overlapMode: w.scheduleOverlapMode ?? 'skip',
		nextRun: w.scheduleNextRun?.toISOString(),
	});
};

// POST: Save schedule configuration for a workflow
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { workflowId, enabled, cron, timezone, inputData, overlapMode } = body;

	if (!workflowId) {
		return json({ error: 'workflowId is required' }, { status: 400 });
	}

	// Parse input data JSON
	let parsedInputData = null;
	if (inputData && inputData !== '{}') {
		try {
			parsedInputData = JSON.parse(inputData);
		} catch {
			return json({ error: 'Invalid JSON in inputData' }, { status: 400 });
		}
	}

	// Calculate next run time if enabled
	let nextRun: Date | null = null;
	if (enabled && cron) {
		nextRun = calculateNextRun(cron, timezone || 'UTC');
	}

	// Update the workflow
	await db
		.update(workflows)
		.set({
			scheduleEnabled: enabled,
			scheduleCron: cron,
			scheduleTimezone: timezone || 'UTC',
			scheduleInputData: parsedInputData,
			scheduleNextRun: nextRun,
			scheduleOverlapMode: overlapMode || 'skip',
			updatedAt: new Date(),
		})
		.where(eq(workflows.id, parseInt(workflowId)));

	// If disabling, cancel any pending/running cron runs for this workflow
	let cancelledCount = 0;
	if (!enabled) {
		// First count how many will be cancelled
		const toCancel = await db
			.select({ id: workflowRuns.id })
			.from(workflowRuns)
			.where(and(
				eq(workflowRuns.workflowId, parseInt(workflowId)),
				eq(workflowRuns.trigger, 'cron'),
				inArray(workflowRuns.status, ['pending', 'running'])
			));
		
		if (toCancel.length > 0) {
			await db
				.update(workflowRuns)
				.set({
					status: 'cancelled',
					completedAt: new Date(),
				})
				.where(and(
					eq(workflowRuns.workflowId, parseInt(workflowId)),
					eq(workflowRuns.trigger, 'cron'),
					inArray(workflowRuns.status, ['pending', 'running'])
				));
			cancelledCount = toCancel.length;
		}
	}

	return json({
		success: true,
		nextRun: nextRun?.toISOString(),
		cancelledRuns: cancelledCount,
	});
};

/**
 * Calculate the initial next run time for a cron expression.
 * 
 * This is a simple heuristic - the Rust worker will recalculate
 * the exact time using the full cron library after the first run.
 * We just need to set it "soon enough" for the scheduler to pick it up.
 */
function calculateNextRun(cronExpr: string, _timezone: string): Date {
	const parts = cronExpr.split(' ');
	
	// Invalid cron: default to 1 hour from now
	if (parts.length !== 5) {
		return new Date(Date.now() + 60 * 60 * 1000);
	}

	// Every minute: next run in 1 minute
	if (cronExpr === '* * * * *') {
		return new Date(Date.now() + 60 * 1000);
	}
	
	// Every N minutes (*/5, */15, etc): next run in N minutes
	if (parts[0].startsWith('*/')) {
		const interval = parseInt(parts[0].slice(2));
		if (!isNaN(interval) && interval > 0) {
			return new Date(Date.now() + interval * 60 * 1000);
		}
	}

	// For all other patterns, set to 1 minute from now
	// The Rust scheduler will recalculate the correct time
	return new Date(Date.now() + 60 * 1000);
}

