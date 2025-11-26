import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { workflowRuns, runEvents, secrets } from '$lib/server/db/schema';
import { REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { eq, and, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

/**
 * POST /api/orchestrate
 * Called when a node completes to schedule the next nodes
 * 
 * Body: { runId: string, nodeId: string, success: boolean }
 */
export async function POST({ request }) {
    const { runId, nodeId, success } = await request.json();
    
    if (!runId || !nodeId) {
        return json({ error: 'Missing runId or nodeId' }, { status: 400 });
    }
    
    console.log(`Orchestrator: Node ${nodeId} ${success ? 'completed' : 'failed'} in run ${runId}`);
    
    // 1. Get the run and its snapshot graph
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    
    if (!run) {
        return json({ error: 'Run not found' }, { status: 404 });
    }
    
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return json({ message: 'Run already finished', status: run.status });
    }
    
    const graph = run.snapshotGraph as { nodes: any[]; edges: any[] };
    const { nodes, edges } = graph;
    
    // 2. Find nodes that depend on the completed node
    const dependentEdges = edges.filter(e => e.source === nodeId);
    const nextNodeIds = dependentEdges.map(e => e.target);
    
    if (nextNodeIds.length === 0) {
        // No more nodes to run - check if the entire run is complete
        const allEvents = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
        
        const completedNodeIds = new Set(
            allEvents
                .filter(e => e.eventType === EVENT_TYPES.NODE_COMPLETED)
                .map(e => e.nodeId)
        );
        
        const failedNodeIds = new Set(
            allEvents
                .filter(e => e.eventType === EVENT_TYPES.NODE_FAILED)
                .map(e => e.nodeId)
        );
        
        // Check if all nodes are done
        const allNodeIds = new Set(nodes.map(n => n.id));
        const doneNodeIds = new Set([...completedNodeIds, ...failedNodeIds]);
        
        const allDone = [...allNodeIds].every(id => doneNodeIds.has(id));
        
        if (allDone) {
            const hasFailed = failedNodeIds.size > 0;
            const finalStatus = hasFailed ? 'failed' : 'completed';
            
            // Update run status
            await db.update(workflowRuns)
                .set({ 
                    status: finalStatus,
                    completedAt: new Date()
                })
                .where(eq(workflowRuns.id, runId));
            
            // Log completion event
            await db.insert(runEvents).values({
                runId,
                eventType: hasFailed ? EVENT_TYPES.RUN_FAILED : EVENT_TYPES.RUN_COMPLETED,
                payload: {
                    completedNodes: [...completedNodeIds],
                    failedNodes: [...failedNodeIds]
                }
            });
            
            console.log(`Orchestrator: Run ${runId} ${finalStatus}`);
            return json({ message: `Run ${finalStatus}`, status: finalStatus });
        }
        
        return json({ message: 'No dependent nodes', scheduledNodes: [] });
    }
    
    // 3. For each dependent node, check if ALL its dependencies are satisfied
    const nodesToSchedule: any[] = [];
    
    // Get all completed nodes for this run
    const completedEvents = await db.select()
        .from(runEvents)
        .where(and(
            eq(runEvents.runId, runId),
            eq(runEvents.eventType, EVENT_TYPES.NODE_COMPLETED)
        ));
    
    const completedNodeIds = new Set(completedEvents.map(e => e.nodeId));
    
    for (const nextNodeId of nextNodeIds) {
        // Find all edges pointing TO this node
        const incomingEdges = edges.filter(e => e.target === nextNodeId);
        const requiredNodeIds = incomingEdges.map(e => e.source);
        
        // Check if all required nodes are completed
        const allDependenciesMet = requiredNodeIds.every(id => completedNodeIds.has(id));
        
        if (allDependenciesMet) {
            const node = nodes.find(n => n.id === nextNodeId);
            if (node) {
                nodesToSchedule.push(node);
            }
        } else {
            console.log(`Orchestrator: Node ${nextNodeId} waiting for dependencies`);
        }
    }
    
    if (nodesToSchedule.length === 0) {
        return json({ message: 'Dependencies not yet satisfied', scheduledNodes: [] });
    }
    
    // 4. Fetch secrets and schedule the nodes
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));
    
    const scheduledNodeIds: string[] = [];
    
    for (const node of nodesToSchedule) {
        const job = buildJobFromNode(node, runId, secretMap);
        if (job) {
            // Log NODE_SCHEDULED event
            await db.insert(runEvents).values({
                runId,
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
            
            scheduledNodeIds.push(node.id);
            console.log(`Orchestrator: Scheduled node ${node.id}`);
        }
    }
    
    return json({ 
        success: true, 
        scheduledNodes: scheduledNodeIds 
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
            max_retries: 0
        };
    }
    
    if (node.type === 'webhook-wait') {
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'WEBHOOK_WAIT',
                data: {
                    description: node.data.webhookDescription || 'Wait for webhook',
                    timeout_ms: node.data.webhookTimeoutMs || (7 * 24 * 60 * 60 * 1000)
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    return null;
}

