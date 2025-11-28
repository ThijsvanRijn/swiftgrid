import { json } from '@sveltejs/kit';
import { createHmac, createHash } from 'crypto';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { workflows, workflowRuns, runEvents, secrets, webhookDeliveries, workflowVersions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { env } from '$env/dynamic/private';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

// Rate limit: 100 requests per minute per flow
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

/**
 * POST /api/hooks/[flowId]
 * 
 * External webhook endpoint to trigger a workflow.
 * 
 * Features:
 * - HMAC signature validation (if webhook_secret is set)
 * - Rate limiting per flow
 * - Idempotency (same request = same response)
 * - Full audit trail
 */
export async function POST({ params, request, getClientAddress }) {
    const { flowId } = params;
    const flowIdNum = parseInt(flowId, 10);
    
    if (isNaN(flowIdNum)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    // 1. Load the workflow
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowIdNum));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    if (!workflow.webhookEnabled) {
        return json({ error: 'Webhooks are not enabled for this workflow' }, { status: 403 });
    }
    
    // 2. Rate limiting
    const rateLimitKey = `webhook_ratelimit:${flowIdNum}`;
    const currentCount = await redis.incr(rateLimitKey);
    
    if (currentCount === 1) {
        // First request in window, set expiry
        await redis.pexpire(rateLimitKey, RATE_LIMIT_WINDOW_MS);
    }
    
    if (currentCount > RATE_LIMIT_MAX) {
        const ttl = await redis.pttl(rateLimitKey);
        return json(
            { error: 'Rate limit exceeded', retryAfter: Math.ceil(ttl / 1000) },
            { 
                status: 429,
                headers: { 'Retry-After': String(Math.ceil(ttl / 1000)) }
            }
        );
    }
    
    // 3. Parse request body
    const bodyText = await request.text();
    let bodyJson: any;
    
    try {
        bodyJson = bodyText ? JSON.parse(bodyText) : {};
    } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    // 4. Validate signature (if secret is configured)
    if (workflow.webhookSecret) {
        const signature = request.headers.get('x-webhook-signature') 
            || request.headers.get('x-hub-signature-256')  // GitHub format
            || request.headers.get('x-signature-256');     // Alternative
        
        if (!signature) {
            return json({ error: 'Missing webhook signature' }, { status: 401 });
        }
        
        const expectedSignature = 'sha256=' + createHmac('sha256', workflow.webhookSecret)
            .update(bodyText)
            .digest('hex');
        
        // Constant-time comparison to prevent timing attacks
        if (!timingSafeEqual(signature, expectedSignature)) {
            return json({ error: 'Invalid webhook signature' }, { status: 401 });
        }
    }
    
    // 5. Idempotency check
    const idempotencyKey = request.headers.get('x-idempotency-key') 
        || request.headers.get('idempotency-key')
        || createHash('sha256').update(bodyText).digest('hex');
    
    const [existingDelivery] = await db.select()
        .from(webhookDeliveries)
        .where(and(
            eq(webhookDeliveries.workflowId, flowIdNum),
            eq(webhookDeliveries.idempotencyKey, idempotencyKey)
        ));
    
    if (existingDelivery) {
        // Return cached response
        console.log(`Webhook: Idempotent replay for flow ${flowIdNum}`);
        return json(existingDelivery.responseBody, { status: existingDelivery.responseStatus });
    }
    
    // 6. Get the published version graph (NOT the draft!)
    // Webhooks always use the published version for production stability
    let graph: { nodes: any[]; edges: any[] };
    let versionId: string | null = null;
    
    if (workflow.activeVersionId) {
        // Use published version
        const [version] = await db.select()
            .from(workflowVersions)
            .where(eq(workflowVersions.id, workflow.activeVersionId));
        
        if (version) {
            graph = version.graph as { nodes: any[]; edges: any[] };
            versionId = version.id;
        } else {
            // Fallback to draft if version not found (shouldn't happen)
            console.warn(`Webhook: Version ${workflow.activeVersionId} not found, falling back to draft`);
            graph = workflow.graph as { nodes: any[]; edges: any[] };
        }
    } else {
        // No published version - reject the webhook
        return json({ 
            error: 'No published version available. Please publish the workflow before triggering via webhook.' 
        }, { status: 400 });
    }
    
    const clientIp = getClientAddress();
    
    const [run] = await db.insert(workflowRuns).values({
        workflowId: flowIdNum,
        workflowVersionId: versionId,
        snapshotGraph: graph,
        status: 'pending',
        trigger: 'webhook',
        inputData: bodyJson
    }).returning();
    
    console.log(`Webhook: Created run ${run.id} for flow ${flowIdNum} (version: ${versionId ? 'published' : 'draft'})`);
    
    // 7. Log RUN_CREATED event with webhook context
    await db.insert(runEvents).values({
        runId: run.id,
        eventType: EVENT_TYPES.RUN_CREATED,
        payload: {
            trigger: 'webhook',
            sourceIp: clientIp,
            idempotencyKey,
            inputData: bodyJson,
            versionId
        }
    });
    
    // 8. Find root nodes and schedule them
    const { nodes, edges } = graph;
    const targetIds = new Set(edges.map((e: any) => e.target));
    const rootNodes = nodes.filter((n: any) => !targetIds.has(n.id));
    
    if (rootNodes.length === 0 && nodes.length > 0) {
        rootNodes.push(...nodes);
    }
    
    // Log RUN_STARTED
    await db.insert(runEvents).values({
        runId: run.id,
        eventType: EVENT_TYPES.RUN_STARTED,
        payload: { rootNodes: rootNodes.map((n: any) => n.id) }
    });
    
    // Fetch secrets for injection
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));
    
    // Schedule root nodes
    for (const node of rootNodes) {
        const job = buildJobFromNode(node, run.id, secretMap, bodyJson);
        if (job) {
            await db.insert(runEvents).values({
                runId: run.id,
                nodeId: node.id,
                eventType: EVENT_TYPES.NODE_SCHEDULED,
                payload: {}
            });
            
            await redis.xadd(
                REDIS_STREAMS.JOBS,
                '*',
                'payload',
                JSON.stringify(job)
            );
        }
    }
    
    // 9. Build response
    const responseBody = {
        success: true,
        runId: run.id,
        message: 'Workflow started',
        scheduledNodes: rootNodes.map((n: any) => n.id)
    };
    
    // 10. Store delivery for idempotency
    await db.insert(webhookDeliveries).values({
        workflowId: flowIdNum,
        idempotencyKey,
        requestBody: bodyJson,
        requestHeaders: Object.fromEntries(request.headers.entries()),
        sourceIp: clientIp,
        responseStatus: 202,
        responseBody,
        runId: run.id
    });
    
    return json(responseBody, { status: 202 });
}

/**
 * GET /api/hooks/[flowId]
 * 
 * Returns webhook configuration info (for documentation/testing)
 */
export async function GET({ params }) {
    const { flowId } = params;
    const flowIdNum = parseInt(flowId, 10);
    
    if (isNaN(flowIdNum)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowIdNum));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    return json({
        flowId: flowIdNum,
        name: workflow.name,
        webhookEnabled: workflow.webhookEnabled,
        hasSecret: !!workflow.webhookSecret,
        endpoint: `/api/hooks/${flowIdNum}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(workflow.webhookSecret ? { 'X-Webhook-Signature': 'sha256=<hmac_of_body>' } : {}),
            'X-Idempotency-Key': '(optional) unique key to prevent duplicate runs'
        }
    });
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Build a worker job from a flow node
 * Similar to the one in /api/run but with webhook input injection
 */
function buildJobFromNode(
    node: any, 
    runId: string, 
    secretMap: Map<string, string>,
    webhookInput: any
): object | null {
    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            
            // Handle $env.KEY
            if (cleanPath.startsWith('$env.')) {
                const keyName = cleanPath.replace('$env.', '');
                return secretMap.get(keyName) || match;
            }
            
            // Handle $input.field (webhook payload)
            if (cleanPath.startsWith('$input.')) {
                const inputPath = cleanPath.replace('$input.', '');
                const value = getDeepValue(webhookInput, inputPath);
                return value !== undefined ? String(value) : match;
            }
            
            return match;
        });
    };
    
    if (node.type === 'code-execution') {
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'CODE',
                data: {
                    code: node.data.code || '',
                    inputs: {
                        ...node.data.inputs,
                        $webhook: webhookInput  // Inject webhook payload
                    }
                }
            },
            retry_count: 0,
            max_retries: 3
        };
    }
    
    if (node.type === 'http-request') {
        if (!node.data.url || !node.data.method) {
            return null;
        }
        
        let finalHeaders: Record<string, string> | undefined;
        if (node.data.headers) {
            finalHeaders = {};
            for (const [key, val] of Object.entries(node.data.headers)) {
                finalHeaders[key] = processString(String(val));
            }
        }
        
        let finalBody = node.data.body;
        if (finalBody) {
            if (typeof finalBody === 'string') {
                finalBody = processString(finalBody);
            } else {
                let bodyStr = JSON.stringify(finalBody);
                bodyStr = processString(bodyStr);
                try { finalBody = JSON.parse(bodyStr); } catch {}
            }
        }
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'HTTP',
                data: {
                    url: processString(node.data.url),
                    method: node.data.method,
                    headers: finalHeaders,
                    body: finalBody
                }
            },
            retry_count: 0,
            max_retries: 3
        };
    }
    
    if (node.type === 'delay') {
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'DELAY',
                data: {
                    duration_ms: node.data.delayMs || 5000,
                    duration_str: node.data.delayStr
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    return null;
}

/**
 * Get a nested value from an object using dot notation
 */
function getDeepValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

