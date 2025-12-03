import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { workflowRuns, runEvents, suspensions } from '$lib/server/db/schema';
import { getSecretsMap } from '$lib/server/secretsCache';
import { REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { env } from '$env/dynamic/private';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

/**
 * Get the result of a Router node and evaluate which outputs should fire
 * This is called when a router node completes, to determine downstream routing
 */
async function evaluateRouterForRun(
    runId: string, 
    nodeId: string,
    routerNode: any,
    nodeOutputs: Map<string, any>
): Promise<{ firedOutputs: string[] } | null> {
    // Get the router's config from the node
    const routeByRaw = routerNode.data.routeBy || '';
    const conditions = routerNode.data.conditions || [];
    const defaultOutput = routerNode.data.defaultOutput || '';
    const mode = routerNode.data.routerMode || 'first_match';
    
    // Resolve the routeBy expression using node outputs
    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            const dotIndex = cleanPath.indexOf('.');
            if (dotIndex > 0) {
                const refNodeId = cleanPath.substring(0, dotIndex);
                const fieldPath = cleanPath.substring(dotIndex + 1);
                const nodeOutput = nodeOutputs.get(refNodeId);
                if (nodeOutput !== undefined) {
                    const pathParts = fieldPath.split('.');
                    let value: any = nodeOutput;
                    for (const part of pathParts) {
                        if (value && typeof value === 'object' && part in value) {
                            value = value[part];
                        } else {
                            return match;
                        }
                    }
                    return typeof value === 'string' ? value : JSON.stringify(value);
                }
            } else {
                // No field path: {{nodeId}} - return entire node output
                const nodeOutput = nodeOutputs.get(cleanPath);
                if (nodeOutput !== undefined) {
                    return typeof nodeOutput === 'string' ? nodeOutput : JSON.stringify(nodeOutput);
                }
            }
            return match;
        });
    };
    
    const routeByResolved = processString(routeByRaw);
    
    // Parse the resolved value
    let routeByValue: any = routeByResolved;
    if (/^-?\d+(\.\d+)?$/.test(routeByResolved)) {
        routeByValue = parseFloat(routeByResolved);
    } else if (routeByResolved === 'true') {
        routeByValue = true;
    } else if (routeByResolved === 'false') {
        routeByValue = false;
    } else {
        try { routeByValue = JSON.parse(routeByResolved); } catch {}
    }
    
    // Evaluate conditions
    const firedOutputs = evaluateRouterConditions(routeByValue, conditions, defaultOutput, mode);
    
    console.log(`Router ${nodeId}: routeBy="${routeByRaw}" resolved to ${JSON.stringify(routeByValue)}, fired: [${firedOutputs.join(', ')}]`);
    
    return { firedOutputs };
}

/**
 * Evaluate router conditions and determine which outputs to fire
 * Uses simple JS evaluation (sandboxed in the future)
 */
function evaluateRouterConditions(
    routeByValue: any,
    conditions: Array<{ id: string; expression: string }>,
    defaultOutput: string,
    mode: string
): string[] {
    const firedOutputs: string[] = [];
    
    for (const condition of conditions) {
        try {
            // Create a simple evaluator with 'value' as the input
            const evalFn = new Function('value', `return ${condition.expression}`);
            const result = evalFn(routeByValue);
            
            if (result) {
                firedOutputs.push(condition.id);
                
                // In first_match mode, stop after first match
                if (mode === 'first_match') {
                    return firedOutputs;
                }
            }
        } catch (e) {
            console.warn(`Router condition eval error for ${condition.id}:`, e);
        }
    }
    
    // If no conditions matched and we have a default, use it
    if (firedOutputs.length === 0 && defaultOutput) {
        firedOutputs.push(defaultOutput);
    }
    
    return firedOutputs;
}

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
    
    // First, get completed node outputs for variable resolution
    const completedEvents = await db.select()
        .from(runEvents)
        .where(and(
            eq(runEvents.runId, runId),
            eq(runEvents.eventType, EVENT_TYPES.NODE_COMPLETED)
        ));
    
    const nodeOutputs = new Map<string, any>();
    for (const event of completedEvents) {
        if (event.nodeId && event.payload && typeof event.payload === 'object') {
            const payload = event.payload as { result?: any };
            if (payload.result !== undefined) {
                nodeOutputs.set(event.nodeId, payload.result);
            }
        }
    }
    
    // 2. Find nodes that depend on the completed node
    // For Router nodes, we need to check which output handle(s) fired
    const completedNode = nodes.find(n => n.id === nodeId);
    let dependentEdges = edges.filter(e => e.source === nodeId);
    
    // If the completed node was a Router, filter edges based on which outputs fired
    if (completedNode?.type === 'router') {
        const routerResult = await evaluateRouterForRun(runId, nodeId, completedNode, nodeOutputs);
        if (routerResult?.firedOutputs) {
            const firedOutputs = new Set(routerResult.firedOutputs);
            dependentEdges = dependentEdges.filter(e => 
                !e.sourceHandle || firedOutputs.has(e.sourceHandle)
            );
            console.log(`Router ${nodeId} fired outputs: ${[...firedOutputs].join(', ')}`);
        }
    }
    
    // If the completed node was a SubFlow, route to success or error handle based on child result
    if (completedNode?.type === 'subflow') {
        const nodeOutput = nodeOutputs.get(nodeId);
        const routeTo = nodeOutput?.route_to; // 'error' if child failed with fail_on_error=false
        
        if (routeTo === 'error') {
            // Child failed - route to error handle only
            dependentEdges = dependentEdges.filter(e => e.sourceHandle === 'error');
            console.log(`SubFlow ${nodeId} routing to error handle (child failed)`);
        } else {
            // Child succeeded - route to success handle only
            dependentEdges = dependentEdges.filter(e => !e.sourceHandle || e.sourceHandle === 'success');
            console.log(`SubFlow ${nodeId} routing to success handle`);
        }
    }
    
    // If the completed node was a Map, route to success or error handle based on batch result
    if (completedNode?.type === 'map') {
        const nodeOutput = nodeOutputs.get(nodeId);
        const routeTo = nodeOutput?.route_to; // 'error' if all failed or fail_fast triggered
        const stats = nodeOutput?.stats;
        
        if (routeTo === 'error') {
            // Batch failed - route to error handle only
            dependentEdges = dependentEdges.filter(e => e.sourceHandle === 'error');
            console.log(`Map ${nodeId} routing to error handle (batch failed: ${stats?.failed}/${stats?.total})`);
        } else {
            // Batch succeeded (possibly with partial failures) - route to success handle
            dependentEdges = dependentEdges.filter(e => !e.sourceHandle || e.sourceHandle === 'success');
            if (stats?.failed > 0) {
                console.log(`Map ${nodeId} routing to success handle (partial failures: ${stats.failed}/${stats.total})`);
            } else {
                console.log(`Map ${nodeId} routing to success handle (all succeeded: ${stats?.completed}/${stats?.total})`);
            }
        }
    }
    
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
        
        console.log(`Orchestrator: Run ${runId} - allNodes: [${[...allNodeIds].join(', ')}], doneNodes: [${[...doneNodeIds].join(', ')}], allDone: ${allDone}`);
        console.log(`Orchestrator: Run ${runId} - trigger: ${run.trigger}, parentRunId: ${run.parentRunId}, parentNodeId: ${run.parentNodeId}`);
        
        if (allDone) {
            const hasFailed = failedNodeIds.size > 0;
            const finalStatus = hasFailed ? 'failed' : 'completed';
            
            // Collect final output from leaf nodes
            const leafNodeIds = nodes
                .filter(n => !edges.some(e => e.source === n.id))
                .map(n => n.id);
            
            let outputData: any = null;
            if (leafNodeIds.length === 1) {
                // Single leaf node - use its output
                outputData = nodeOutputs.get(leafNodeIds[0]) || null;
            } else if (leafNodeIds.length > 1) {
                // Multiple leaf nodes - return map of all outputs
                outputData = {};
                for (const leafId of leafNodeIds) {
                    const output = nodeOutputs.get(leafId);
                    if (output !== undefined) {
                        outputData[leafId] = output;
                    }
                }
            }
            
            // Update run status and output
            await db.update(workflowRuns)
                .set({ 
                    status: finalStatus,
                    completedAt: new Date(),
                    outputData: outputData
                })
                .where(eq(workflowRuns.id, runId));
            
            // Log completion event
            await db.insert(runEvents).values({
                runId,
                eventType: hasFailed ? EVENT_TYPES.RUN_FAILED : EVENT_TYPES.RUN_COMPLETED,
                payload: {
                    completedNodes: [...completedNodeIds],
                    failedNodes: [...failedNodeIds],
                    output: outputData
                }
            });
            
            console.log(`Orchestrator: Run ${runId} ${finalStatus}`);
            
            // Check if this run has a parent (sub-flow or map child case)
            console.log(`Orchestrator: Checking parent - parentRunId: ${run.parentRunId}, parentNodeId: ${run.parentNodeId}, trigger: ${run.trigger}`);
            if (run.parentRunId && run.parentNodeId) {
                // Check if this is a map child by looking at the trigger
                console.log(`Orchestrator: Has parent! trigger=${run.trigger}, inputData=${JSON.stringify(run.inputData)}`);
                if (run.trigger === 'map') {
                    // This is a map child - send MapChildComplete job
                    const inputData = run.inputData as { batch_id?: string; index?: number } | null;
                    const batchId = inputData?.batch_id;
                    const itemIndex = inputData?.index ?? 0;
                    
                    console.log(`Orchestrator: Map child - batchId=${batchId}, itemIndex=${itemIndex}`);
                    if (batchId) {
                        console.log(`Orchestrator: Map child completed for batch ${batchId} index ${itemIndex}`);
                        
                        const mapCompleteJob = {
                            id: run.parentNodeId,
                            run_id: run.parentRunId,
                            node: {
                                type: 'MAPCHILDCOMPLETE',
                                data: {
                                    batch_id: batchId,
                                    item_index: itemIndex,
                                    child_run_id: runId,
                                    success: !hasFailed,
                                    output: outputData,
                                    error: hasFailed ? 'Map iteration failed' : null
                                }
                            },
                            retry_count: 0,
                            max_retries: 0
                        };
                        
                        await redis.xadd(
                            REDIS_STREAMS.JOBS,
                            '*',
                            'payload',
                            JSON.stringify(mapCompleteJob)
                        );
                        
                        return json({ message: 'Map child completion sent', batchId, itemIndex });
                    }
                }
                
                console.log(`Orchestrator: Resuming parent run ${run.parentRunId} node ${run.parentNodeId}`);
                
                // Look up the suspension to get output_path for mapping and retry info
                const [suspension] = await db.select()
                    .from(suspensions)
                    .where(and(
                        eq(suspensions.runId, run.parentRunId),
                        eq(suspensions.nodeId, run.parentNodeId),
                        eq(suspensions.suspensionType, 'subflow'),
                        isNull(suspensions.resumedAt)
                    ))
                    .limit(1);
                
                const context = (suspension?.executionContext || {}) as {
                    output_path?: string;
                    max_retries?: number;
                    retry_count?: number;
                    workflow_id?: number;
                    version_id?: string;
                    input?: any;
                    timeout_ms?: number;
                    depth_limit?: number;
                    fail_on_error?: boolean;
                };
                
                // Check if we should retry on failure
                const maxRetries = context.max_retries || 0;
                const retryCount = context.retry_count || 0;
                
                if (hasFailed && retryCount < maxRetries && suspension) {
                    // Retry the sub-flow
                    console.log(`Orchestrator: Retrying sub-flow (attempt ${retryCount + 1}/${maxRetries})`);
                    
                    // Update retry count in suspension
                    const newContext = { ...context, retry_count: retryCount + 1 };
                    await db.update(suspensions)
                        .set({ executionContext: newContext })
                        .where(eq(suspensions.id, suspension.id));
                    
                    // Push a new SubFlow job to spawn another child
                    const retryJob = {
                        id: run.parentNodeId,
                        run_id: run.parentRunId,
                        node: {
                            type: 'SUBFLOW',
                            data: {
                                workflow_id: context.workflow_id,
                                version_id: context.version_id || null,
                                input: context.input,
                                fail_on_error: context.fail_on_error || false,
                                current_depth: run.depth || 0,
                                depth_limit: context.depth_limit || 10,
                                timeout_ms: context.timeout_ms || 0,
                                output_path: context.output_path || null,
                                max_retries: 0 // Don't nest retries
                            }
                        },
                        retry_count: retryCount + 1,
                        max_retries: 0
                    };
                    
                    await redis.xadd(
                        REDIS_STREAMS.JOBS,
                        '*',
                        'payload',
                        JSON.stringify(retryJob)
                    );
                    
                    return json({ message: 'Sub-flow retry scheduled', retry: retryCount + 1 });
                }
                
                // Apply output mapping if configured
                let finalOutput = outputData;
                if (!hasFailed && context.output_path && outputData) {
                    // Navigate the path (e.g., "result.data.items")
                    const pathParts = context.output_path.split('.');
                    let value: any = outputData;
                    for (const part of pathParts) {
                        if (value && typeof value === 'object' && part in value) {
                            value = value[part];
                        } else {
                            console.warn(`Output mapping: path "${context.output_path}" not found in output`);
                            value = outputData; // Fall back to full output
                            break;
                        }
                    }
                    finalOutput = value;
                    console.log(`Orchestrator: Applied output mapping "${context.output_path}"`);
                }
                
                // Mark suspension as resolved
                if (suspension) {
                    await db.update(suspensions)
                        .set({
                            resumedAt: new Date(),
                            resumedBy: 'orchestrator:child_completed',
                            resumePayload: { child_run_id: runId, success: !hasFailed, retries: retryCount }
                        })
                        .where(eq(suspensions.id, suspension.id));
                }
                
                // Push a SubFlowResume job to wake up the parent
                const resumeJob = {
                    id: run.parentNodeId,
                    run_id: run.parentRunId,
                    node: {
                        type: 'SUBFLOWRESUME',
                        data: {
                            child_run_id: runId,
                            output: finalOutput,
                            success: !hasFailed,
                            error: hasFailed ? 'Sub-flow failed' : null
                        }
                    },
                    retry_count: 0,
                    max_retries: 0
                };
                
                await redis.xadd(
                    REDIS_STREAMS.JOBS,
                    '*',
                    'payload',
                    JSON.stringify(resumeJob)
                );
                
                // Update parent run status back to running
                await db.update(workflowRuns)
                    .set({ status: 'running' })
                    .where(eq(workflowRuns.id, run.parentRunId));
            }
            
            return json({ message: `Run ${finalStatus}`, status: finalStatus });
        }
        
        return json({ message: 'No dependent nodes', scheduledNodes: [] });
    }
    
    // 3. For each dependent node, check if ALL its dependencies are satisfied
    const nodesToSchedule: any[] = [];
    
    // Use the completedEvents we already fetched above
    const completedNodeIds = new Set(completedEvents.map(e => e.nodeId));
    
    // Get nodes that have already been scheduled or are in progress (to avoid re-scheduling)
    const allEvents = await db.select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId));
    
    const alreadyScheduledOrRunning = new Set(
        allEvents
            .filter(e => 
                e.eventType === EVENT_TYPES.NODE_SCHEDULED ||
                e.eventType === EVENT_TYPES.NODE_STARTED ||
                e.eventType === 'NODE_SUSPENDED' // Map/SubFlow nodes waiting for children
            )
            .map(e => e.nodeId)
    );
    
    for (const nextNodeId of nextNodeIds) {
        // Skip nodes that are already scheduled, running, or suspended
        if (alreadyScheduledOrRunning.has(nextNodeId) && !completedNodeIds.has(nextNodeId)) {
            console.log(`Orchestrator: Node ${nextNodeId} already scheduled/running/suspended, skipping`);
            continue;
        }
        
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
    
    // 4. Get secrets for variable interpolation (cached, 60s TTL)
    const secretMap = await getSecretsMap();
    
    const scheduledNodeIds: string[] = [];
    
    for (const node of nodesToSchedule) {
        const job = buildJobFromNode(node, runId, secretMap, nodeOutputs, run.inputData, run.depth || 0);
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
    secretMap: Map<string, string>,
    nodeOutputs: Map<string, any>,
    triggerData?: any, // Input data passed to the run (webhook payload, subflow input, etc.)
    runDepth: number = 0 // Current depth of the run (for nested Map/SubFlow limits)
): object | null {
    const processString = (str: string) => {
        return str.replace(/{{(.*?)}}/g, (match, variablePath) => {
            const cleanPath = variablePath.trim();
            
            // Handle environment variables: {{$env.KEY}}
            if (cleanPath.startsWith('$env.')) {
                const keyName = cleanPath.replace('$env.', '');
                return secretMap.get(keyName) || match;
            }
            
            // Handle trigger/input data: {{$trigger.field}} or {{$input.field}}
            if (cleanPath.startsWith('$trigger.') || cleanPath.startsWith('$input.')) {
                const fieldPath = cleanPath.replace(/^\$(trigger|input)\./, '');
                if (triggerData !== undefined && triggerData !== null) {
                    const pathParts = fieldPath.split('.');
                    let value: any = triggerData;
                    for (const part of pathParts) {
                        if (value && typeof value === 'object' && part in value) {
                            value = value[part];
                        } else {
                            return match; // Path not found, keep original
                        }
                    }
                    return typeof value === 'string' ? value : JSON.stringify(value);
                }
                return match;
            }
            
            // Handle node output references: {{nodeId.field}} or {{nodeId.field.nested}} or {{nodeId}}
            const dotIndex = cleanPath.indexOf('.');
            if (dotIndex > 0) {
                // Has a field path: {{nodeId.field}}
                const refNodeId = cleanPath.substring(0, dotIndex);
                const fieldPath = cleanPath.substring(dotIndex + 1);
                
                const nodeOutput = nodeOutputs.get(refNodeId);
                if (nodeOutput !== undefined) {
                    // Navigate the field path (supports nested: "body.data.id")
                    const pathParts = fieldPath.split('.');
                    let value: any = nodeOutput;
                    for (const part of pathParts) {
                        if (value && typeof value === 'object' && part in value) {
                            value = value[part];
                        } else {
                            return match; // Path not found, keep original
                        }
                    }
                    // Return stringified value for JSON compatibility
                    return typeof value === 'string' ? value : JSON.stringify(value);
                }
            } else {
                // No field path: {{nodeId}} - return entire node output
                const nodeOutput = nodeOutputs.get(cleanPath);
                if (nodeOutput !== undefined) {
                    return typeof nodeOutput === 'string' ? nodeOutput : JSON.stringify(nodeOutput);
                }
            }
            
            return match;
        });
    };
    
    if (node.type === 'code-execution') {
        // Process inputs through variable interpolation
        let finalInputs = node.data.inputs;
        if (finalInputs) {
            const inputStr = typeof finalInputs === 'string' 
                ? finalInputs 
                : JSON.stringify(finalInputs);
            const resolvedStr = processString(inputStr);
            try {
                finalInputs = JSON.parse(resolvedStr);
            } catch {
                finalInputs = resolvedStr;
            }
        }
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'CODE',
                data: {
                    code: node.data.code || '',
                    inputs: finalInputs
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
                type: 'WEBHOOKWAIT',
                data: {
                    timeout_ms: node.data.timeoutMs || (7 * 24 * 60 * 60 * 1000),
                    timeout_str: node.data.timeoutStr,
                    description: node.data.description || 'Wait for external event'
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    if (node.type === 'router') {
        // Router node: just send the config to the worker
        // The actual routing evaluation happens in the orchestrator when the node completes
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
    
    if (node.type === 'llm') {
        // Build messages array from system + user prompts
        const messages: Array<{ role: string; content: string }> = [];
        
        if (node.data.systemPrompt) {
            messages.push({ role: 'system', content: processString(node.data.systemPrompt) });
        }
        if (node.data.userPrompt) {
            messages.push({ role: 'user', content: processString(node.data.userPrompt) });
        }
        
        // Also support raw messages array if provided
        if (node.data.messages && Array.isArray(node.data.messages)) {
            for (const msg of node.data.messages) {
                messages.push({
                    role: msg.role,
                    content: processString(msg.content)
                });
            }
        }
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'LLM',
                data: {
                    base_url: processString(node.data.baseUrl || 'https://api.openai.com/v1'),
                    api_key: processString(node.data.apiKey || ''),
                    model: node.data.model || 'gpt-4o',
                    messages: messages,
                    temperature: node.data.temperature,
                    max_tokens: node.data.maxTokens,
                    stream: node.data.stream ?? false
                }
            },
            retry_count: 0,
            max_retries: 3
        };
    }
    
    if (node.type === 'subflow') {
        // Process input through variable interpolation
        let finalInput = node.data.subflowInput;
        if (finalInput) {
            if (typeof finalInput === 'string') {
                finalInput = processString(finalInput);
                // Try to parse as JSON if it looks like JSON
                try {
                    finalInput = JSON.parse(finalInput);
                } catch {
                    // Keep as string if not valid JSON
                }
            } else {
                const inputStr = JSON.stringify(finalInput);
                const resolvedStr = processString(inputStr);
                try {
                    finalInput = JSON.parse(resolvedStr);
                } catch {
                    finalInput = resolvedStr;
                }
            }
        }
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'SUBFLOW',
                data: {
                    workflow_id: node.data.subflowWorkflowId,
                    version_id: node.data.subflowVersionId || null,
                    input: finalInput,
                    fail_on_error: node.data.subflowFailOnError || false,
                    current_depth: 0, // Will be set by worker based on parent run
                    depth_limit: 10,
                    timeout_ms: node.data.subflowTimeoutMs || 0,
                    output_path: node.data.subflowOutputPath || null,
                    max_retries: node.data.subflowMaxRetries || 0
                }
            },
            retry_count: 0,
            max_retries: 0 // Sub-flow node itself doesn't retry, child runs do
        };
    }
    
    if (node.type === 'map') {
        // Process input array through variable interpolation
        let inputArray = node.data.mapInputArray;
        let items: any[] = [];
        
        if (inputArray) {
            if (typeof inputArray === 'string') {
                inputArray = processString(inputArray);
                // Try to parse as JSON array
                try {
                    const parsed = JSON.parse(inputArray);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                    } else {
                        // Wrap single value in array
                        items = [parsed];
                    }
                } catch {
                    // If not valid JSON, treat as single item
                    items = [inputArray];
                }
            } else if (Array.isArray(inputArray)) {
                items = inputArray;
            } else {
                items = [inputArray];
            }
        }
        
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'MAP',
                data: {
                    workflow_id: node.data.mapWorkflowId,
                    version_id: node.data.mapVersionId || null,
                    items: items,
                    concurrency: node.data.mapConcurrency || 5,
                    fail_fast: node.data.mapFailFast || false,
                    timeout_ms: node.data.mapTimeoutMs || null,
                    current_depth: runDepth,
                    depth_limit: node.data.mapDepthLimit || 10
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    return null;
}

