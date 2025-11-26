import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { secrets, workflowRuns, runEvents } from '$lib/server/db/schema';
import { type WorkerJob, type EnhancedWorkerJob, REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { env } from '$env/dynamic/private';

// Connect to Redis (env var or fallback to localhost)
const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

/**
 * THE INJECTOR
 * Takes the payload and swaps {{$env.KEY}} with real database values.
 */
async function injectSecrets(job: EnhancedWorkerJob): Promise<EnhancedWorkerJob> {
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));

    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            if (cleanPath.startsWith('$env.')) {
                const keyName = cleanPath.replace('$env.', '');
                return secretMap.get(keyName) || match;
            }
            return match;
        });
    };
    
    if (job.node.type === 'HTTP') {
        const data = job.node.data;

        if (data.url) data.url = processString(data.url);

        if (data.headers) {
            for (const key in data.headers) {
                data.headers[key] = processString(data.headers[key]);
            }
        }

        if (data.body) {
            if (typeof data.body === 'string') {
                data.body = processString(data.body);
            } else {
                let bodyStr = JSON.stringify(data.body);
                bodyStr = processString(bodyStr);
                try { data.body = JSON.parse(bodyStr); } catch {}
            }
        }
    } 

    return job;
}

/**
 * Single node execution (legacy mode - no run tracking)
 */
export async function POST({ request }) {
    const body = await request.json();
    
    // Check if this is a new "start run" request or legacy single-node execution
    if (body.startRun) {
        return handleStartRun(body);
    }
    
    // Legacy: single node execution without run tracking
    let job = body as WorkerJob;
    const isolated = body.isolated ?? false;
    
    // Convert to enhanced job (no run_id for legacy)
    const enhancedJob: EnhancedWorkerJob = {
        id: job.id,
        runId: undefined as any, // Will be omitted in JSON
        node: job.node,
        retryCount: 0,
        maxRetries: 3
    };

    console.log(`Received Job (legacy mode${isolated ? ', isolated' : ''}). Injecting secrets...`);
    
    const injectedJob = await injectSecrets(enhancedJob);

    const streamId = await redis.xadd(
        REDIS_STREAMS.JOBS, 
        '*', 
        'payload', 
        JSON.stringify({
            id: injectedJob.id,
            node: injectedJob.node,
            retry_count: injectedJob.retryCount,
            max_retries: injectedJob.maxRetries,
            isolated // Pass to worker so it doesn't trigger orchestration
        })
    );

    return json({ success: true, streamId, isolated });
}

/**
 * Start a full workflow run with event tracking
 */
async function handleStartRun(body: { startRun: true; workflowId?: number; graph: any; trigger?: string; startFromNode?: string }) {
    const { workflowId, graph, trigger = 'manual', startFromNode } = body;
    
    console.log(`Starting new workflow run${startFromNode ? ` from node ${startFromNode}` : ''}...`);
    
    // 1. Create the run record with snapshot
    const [run] = await db.insert(workflowRuns).values({
        workflowId: workflowId ?? null,
        snapshotGraph: graph,
        status: 'pending',
        trigger
    }).returning();
    
    console.log(`Created run: ${run.id}`);
    
    // 2. Log RUN_CREATED event
    await db.insert(runEvents).values({
        runId: run.id,
        eventType: EVENT_TYPES.RUN_CREATED,
        payload: { trigger, nodeCount: graph.nodes?.length ?? 0, startFromNode }
    });
    
    // 3. Find starting nodes
    const nodes = graph.nodes ?? [];
    const edges = graph.edges ?? [];
    
    let startingNodes: any[];
    
    if (startFromNode) {
        // Start from a specific node
        const targetNode = nodes.find((n: any) => n.id === startFromNode);
        if (!targetNode) {
            return json({ success: false, error: `Node ${startFromNode} not found` }, { status: 400 });
        }
        startingNodes = [targetNode];
    } else {
        // Find root nodes (nodes with no incoming edges)
        const targetIds = new Set(edges.map((e: any) => e.target));
        startingNodes = nodes.filter((n: any) => !targetIds.has(n.id));
        
        if (startingNodes.length === 0 && nodes.length > 0) {
            console.warn("No root nodes found, running all nodes");
            startingNodes.push(...nodes);
        }
    }
    
    // 4. Update run status to running
    await db.insert(runEvents).values({
        runId: run.id,
        eventType: EVENT_TYPES.RUN_STARTED,
        payload: { startingNodes: startingNodes.map((n: any) => n.id) }
    });
    
    // 5. Fetch secrets once for all nodes
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));
    
    // 6. Schedule starting nodes
    for (const node of startingNodes) {
        const job = buildJobFromNode(node, run.id, secretMap);
        if (job) {
            // Log NODE_SCHEDULED event
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
    
    return json({ 
        success: true, 
        runId: run.id,
        scheduledNodes: startingNodes.map((n: any) => n.id)
    });
}

/**
 * Build a worker job from a flow node
 */
function buildJobFromNode(
    node: any, 
    runId: string, 
    secretMap: Map<string, string>
): object | null {
    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            if (cleanPath.startsWith('$env.')) {
                const keyName = cleanPath.replace('$env.', '');
                return secretMap.get(keyName) || match;
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
                    inputs: node.data.inputs
                }
            },
            retry_count: 0,
            max_retries: 3
        };
    }
    
    if (node.type === 'http-request') {
        if (!node.data.url || !node.data.method) {
            console.warn(`Skipping node ${node.id}: Missing URL or method`);
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
            max_retries: 0  // Don't retry delays
        };
    }
    
    if (node.type === 'webhook-wait') {
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'WEBHOOKWAIT',
                data: {
                    timeout_ms: node.data.timeoutMs || (7 * 24 * 60 * 60 * 1000),
                    timeout_str: node.data.timeoutStr,
                    description: node.data.description || 'Wait for external event'
                }
            },
            retry_count: 0,
            max_retries: 0  // Don't retry suspensions
        };
    }
    
    if (node.type === 'router') {
        const conditions = node.data.conditions || [];
        const defaultOutput = node.data.defaultOutput || '';
        const mode = node.data.routerMode || 'first_match';
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'ROUTER',
                data: {
                    route_by: node.data.routeBy || '',
                    conditions: conditions.map((c: any) => ({
                        id: c.id,
                        label: c.label,
                        expression: c.expression
                    })),
                    default_output: defaultOutput,
                    mode: mode
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    return null;
}