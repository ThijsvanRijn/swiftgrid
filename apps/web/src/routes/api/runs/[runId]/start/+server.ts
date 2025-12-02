import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db';
import { secrets, workflowRuns, runEvents } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { REDIS_STREAMS, EVENT_TYPES } from '@swiftgrid/shared';
import { env } from '$env/dynamic/private';

const redis = new Redis(env.REDIS_URL ?? 'redis://127.0.0.1:6379');

/**
 * POST /api/runs/[runId]/start
 * 
 * Starts a run that has already been created in the database.
 * Used by the Rust worker to start child sub-flow runs with proper template interpolation.
 * 
 * The run must already exist with:
 * - snapshot_graph: The workflow graph to execute
 * - input_data: The trigger/input data for template interpolation ({{$trigger.field}})
 */
export async function POST({ params }) {
    const { runId } = params;
    
    if (!runId) {
        return json({ error: 'Missing runId' }, { status: 400 });
    }
    
    console.log(`Starting run ${runId}...`);
    
    // 1. Get the run
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    
    if (!run) {
        return json({ error: 'Run not found' }, { status: 404 });
    }
    
    if (run.status !== 'pending') {
        return json({ error: `Run already ${run.status}` }, { status: 400 });
    }
    
    const graph = run.snapshotGraph as { nodes: any[]; edges: any[] };
    const nodes = graph.nodes ?? [];
    const edges = graph.edges ?? [];
    const triggerData = run.inputData;
    
    // 2. Find root nodes (nodes with no incoming edges)
    const targetIds = new Set(edges.map((e: any) => e.target));
    const startingNodes = nodes.filter((n: any) => !targetIds.has(n.id));
    
    if (startingNodes.length === 0) {
        return json({ error: 'No root nodes found in workflow' }, { status: 400 });
    }
    
    // 3. Update run status to running
    await db.update(workflowRuns)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    
    // 4. Log RUN_STARTED event
    await db.insert(runEvents).values({
        runId: runId,
        eventType: EVENT_TYPES.RUN_STARTED,
        payload: { startingNodes: startingNodes.map((n: any) => n.id) }
    });
    
    // 5. Fetch secrets for variable interpolation
    const allSecrets = await db.select().from(secrets);
    const secretMap = new Map(allSecrets.map(s => [s.key, s.value]));
    
    // 6. Schedule starting nodes
    const scheduledNodes: string[] = [];
    
    for (const node of startingNodes) {
        const job = buildJobFromNode(node, runId, secretMap, triggerData);
        if (job) {
            // Log NODE_SCHEDULED event
            await db.insert(runEvents).values({
                runId: runId,
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
            
            scheduledNodes.push(node.id);
        }
    }
    
    console.log(`Run ${runId} started with nodes: ${scheduledNodes.join(', ')}`);
    
    return json({ 
        success: true, 
        runId,
        scheduledNodes
    });
}

/**
 * Build a worker job from a flow node with full template interpolation
 */
function buildJobFromNode(
    node: any, 
    runId: string, 
    secretMap: Map<string, string>,
    triggerData?: any
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
            
            return match;
        });
    };
    
    if (node.type === 'code-execution') {
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
    
    if (node.type === 'llm') {
        const messages: Array<{ role: string; content: string }> = [];
        
        if (node.data.systemPrompt) {
            messages.push({ role: 'system', content: processString(node.data.systemPrompt) });
        }
        if (node.data.userPrompt) {
            messages.push({ role: 'user', content: processString(node.data.userPrompt) });
        }
        
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
    
    if (node.type === 'router') {
        return {
            id: node.id,
            run_id: runId,
            node: {
                type: 'ROUTER',
                data: {
                    route_by: node.data.routeBy || '',
                    conditions: (node.data.conditions || []).map((c: any) => ({
                        id: c.id,
                        label: c.label,
                        expression: c.expression
                    })),
                    default_output: node.data.defaultOutput || '',
                    mode: node.data.routerMode || 'first_match'
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
    
    if (node.type === 'subflow') {
        let finalInput = node.data.subflowInput;
        if (finalInput) {
            if (typeof finalInput === 'string') {
                finalInput = processString(finalInput);
                try {
                    finalInput = JSON.parse(finalInput);
                } catch {
                    // Keep as string
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
                    current_depth: 0,
                    depth_limit: 10,
                    timeout_ms: node.data.subflowTimeoutMs || 0,
                    output_path: node.data.subflowOutputPath || null,
                    max_retries: node.data.subflowMaxRetries || 0
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    if (node.type === 'map') {
        let inputArray = node.data.mapInputArray;
        let items: any[] = [];
        
        if (inputArray) {
            if (typeof inputArray === 'string') {
                inputArray = processString(inputArray);
                try {
                    const parsed = JSON.parse(inputArray);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                    } else {
                        items = [parsed];
                    }
                } catch {
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
                    current_depth: 0,
                    depth_limit: 10
                }
            },
            retry_count: 0,
            max_retries: 0
        };
    }
    
    console.warn(`Unknown node type: ${node.type}`);
    return null;
}

