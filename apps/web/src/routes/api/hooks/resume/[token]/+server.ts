import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { suspensions, runEvents, workflowRuns } from '$lib/server/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { env } from '$env/dynamic/private';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

/**
 * POST /api/hooks/resume/[token]
 * 
 * Resume a suspended workflow with the provided payload.
 * 
 * The token was generated when the WebhookWait node suspended the workflow.
 * External systems call this endpoint to continue the workflow.
 */
export async function POST({ params, request, getClientAddress }) {
    const { token } = params;
    
    if (!token) {
        return json({ error: 'Missing resume token' }, { status: 400 });
    }
    
    // 1. Find the suspension
    const [suspension] = await db.select()
        .from(suspensions)
        .where(and(
            eq(suspensions.resumeToken, token),
            isNull(suspensions.resumedAt)  // Not already resumed
        ));
    
    if (!suspension) {
        return json({ error: 'Suspension not found or already resumed' }, { status: 404 });
    }
    
    // 2. Check if expired
    if (suspension.expiresAt && new Date(suspension.expiresAt) < new Date()) {
        return json({ 
            error: 'Suspension has expired',
            expiredAt: suspension.expiresAt
        }, { status: 410 }); // 410 Gone
    }
    
    // 3. Check if run is still active
    const [run] = await db.select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, suspension.runId));
    
    if (!run || run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return json({ 
            error: 'Workflow run is no longer active',
            runStatus: run?.status
        }, { status: 409 });
    }
    
    // 4. Parse the webhook payload
    let payload: any = {};
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
        try {
            payload = await request.json();
        } catch {
            return json({ error: 'Invalid JSON body' }, { status: 400 });
        }
    } else {
        // For non-JSON, store as text
        payload = { raw: await request.text() };
    }
    
    const clientIp = getClientAddress();
    
    console.log(`Resume: Token ${token.slice(0, 8)}... for run ${suspension.runId}`);
    
    // 5. Mark suspension as resumed
    await db.update(suspensions)
        .set({
            resumedAt: new Date(),
            resumedBy: clientIp,
            resumePayload: payload
        })
        .where(eq(suspensions.id, suspension.id));
    
    // 6. Log NODE_RESUMED event
    await db.insert(runEvents).values({
        runId: suspension.runId,
        nodeId: suspension.nodeId,
        eventType: EVENT_TYPES.NODE_RESUMED,
        payload: {
            source: 'webhook',
            resumeToken: token,
            sourceIp: clientIp,
            webhookPayload: payload
        }
    });
    
    // 7. Create a WebhookResume job to continue the workflow
    const resumeJob = {
        id: suspension.nodeId,
        run_id: suspension.runId,
        node: {
            type: 'WEBHOOKRESUME',
            data: {
                resume_token: token,
                payload: payload
            }
        },
        retry_count: 0,
        max_retries: 0
    };
    
    // 8. Push to Redis queue
    await redis.xadd(
        REDIS_STREAMS.JOBS,
        '*',
        'payload',
        JSON.stringify(resumeJob)
    );
    
    return json({
        success: true,
        message: 'Workflow resumed',
        runId: suspension.runId,
        nodeId: suspension.nodeId
    }, { status: 202 });
}

/**
 * GET /api/hooks/resume/[token]
 * 
 * Check the status of a suspension (useful for debugging)
 */
export async function GET({ params }) {
    const { token } = params;
    
    if (!token) {
        return json({ error: 'Missing resume token' }, { status: 400 });
    }
    
    const [suspension] = await db.select()
        .from(suspensions)
        .where(eq(suspensions.resumeToken, token));
    
    if (!suspension) {
        return json({ error: 'Suspension not found' }, { status: 404 });
    }
    
    const isExpired = suspension.expiresAt && new Date(suspension.expiresAt) < new Date();
    const isResumed = !!suspension.resumedAt;
    
    return json({
        token,
        runId: suspension.runId,
        nodeId: suspension.nodeId,
        type: suspension.suspensionType,
        status: isResumed ? 'resumed' : isExpired ? 'expired' : 'waiting',
        createdAt: suspension.createdAt,
        expiresAt: suspension.expiresAt,
        resumedAt: suspension.resumedAt,
        resumedBy: suspension.resumedBy
    });
}

