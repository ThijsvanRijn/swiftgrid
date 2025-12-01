import { json } from '@sveltejs/kit';
import Redis from 'ioredis';
import { db } from '$lib/server/db/index';
import { workflowRuns, runEvents } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { REDIS_STREAMS } from '@swiftgrid/shared';
import type { RequestHandler } from './$types';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// =============================================================================
// POST /api/runs/[runId]/replay - Re-run with same inputs
// =============================================================================
export const POST: RequestHandler = async ({ params }) => {
  const { runId } = params;

  try {
    // Get original run
    const runs = await db.select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    if (runs.length === 0) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const originalRun = runs[0];

    // Create new run with same inputs but fresh snapshot
    const [newRun] = await db.insert(workflowRuns).values({
      workflowId: originalRun.workflowId,
      snapshotGraph: originalRun.snapshotGraph, // Use same graph snapshot
      status: 'pending',
      trigger: 'manual', // Replay is always manual
      inputData: originalRun.inputData, // Same input data
    }).returning();

    // Log RUN_CREATED event
    await db.insert(runEvents).values({
      runId: newRun.id,
      eventType: 'RUN_CREATED',
      payload: {
        trigger: 'replay',
        originalRunId: runId,
      },
    });

    // Update status to running
    await db.update(workflowRuns)
      .set({ 
        status: 'running',
        startedAt: new Date(),
      })
      .where(eq(workflowRuns.id, newRun.id));

    // Log RUN_STARTED event
    await db.insert(runEvents).values({
      runId: newRun.id,
      eventType: 'RUN_STARTED',
      payload: {},
    });

    // Find root nodes (nodes with no incoming edges)
    const graph = originalRun.snapshotGraph as { nodes: any[]; edges: any[] };
    const nodesWithIncoming = new Set(graph.edges.map((e: any) => e.target));
    const rootNodes = graph.nodes.filter((n: any) => !nodesWithIncoming.has(n.id));

    // Schedule root nodes
    for (const node of rootNodes) {
      // Build job payload
      const job = buildJobFromNode(node, newRun.id, originalRun.inputData);
      
      // Skip unknown node types
      if (!job) {
        console.warn(`Skipping unknown node type in replay: ${node.type}`);
        continue;
      }
      
      // Log NODE_SCHEDULED event
      await db.insert(runEvents).values({
        runId: newRun.id,
        nodeId: node.id,
        eventType: 'NODE_SCHEDULED',
        payload: {},
      });
      
      // Push to Redis
      await redis.xadd(
        REDIS_STREAMS.JOBS,
        '*',
        'payload',
        JSON.stringify(job)
      );
    }

    return json({ 
      success: true, 
      runId: newRun.id,
      originalRunId: runId,
    });
  } catch (e) {
    console.error('Failed to replay run:', e);
    return json({ error: 'Failed to replay run' }, { status: 500 });
  }
};

// Helper to build job from node (must match format in /api/run)
function buildJobFromNode(node: any, runId: string, inputData: any): any {
  const baseJob = {
    id: node.id,
    run_id: runId,
    retry_count: 0,
    max_retries: 3,
    isolated: false,
    context: inputData || {},
  };

  switch (node.type) {
    case 'http-request':
      return {
        ...baseJob,
        node: {
          type: 'HTTP',
          data: {
            url: node.data.url || '',
            method: node.data.method || 'GET',
            headers: node.data.headers || {},
            body: node.data.body || null,
          },
        },
      };
    case 'code-execution':
      return {
        ...baseJob,
        node: {
          type: 'CODE',
          data: {
            code: node.data.code || '',
            inputs: node.data.inputs || null,
          },
        },
      };
    case 'delay':
      return {
        ...baseJob,
        max_retries: 0,
        node: {
          type: 'DELAY',
          data: {
            duration_ms: node.data.delayMs || 5000,
            duration_str: node.data.delayStr,
          },
        },
      };
    case 'webhook-wait':
      return {
        ...baseJob,
        max_retries: 0,
        node: {
          type: 'WEBHOOKWAIT',
          data: {
            timeout_ms: node.data.timeoutMs || 7 * 24 * 60 * 60 * 1000,
            timeout_str: node.data.timeoutStr,
            description: node.data.description || 'Wait for external event',
          },
        },
      };
    case 'router':
      return {
        ...baseJob,
        max_retries: 0,
        node: {
          type: 'ROUTER',
          data: {
            route_by: node.data.routeBy || '',
            conditions: (node.data.conditions || []).map((c: any) => ({
              id: c.id,
              label: c.label,
              expression: c.expression,
            })),
            default_output: node.data.defaultOutput || '',
            mode: node.data.routerMode || 'first_match',
          },
        },
      };
    case 'llm':
      const messages: Array<{ role: string; content: string }> = [];
      if (node.data.systemPrompt) {
        messages.push({ role: 'system', content: node.data.systemPrompt });
      }
      if (node.data.userPrompt) {
        messages.push({ role: 'user', content: node.data.userPrompt });
      }
      if (node.data.messages && Array.isArray(node.data.messages)) {
        messages.push(...node.data.messages);
      }
      return {
        ...baseJob,
        node: {
          type: 'LLM',
          data: {
            base_url: node.data.baseUrl || 'https://api.openai.com/v1',
            api_key: node.data.apiKey || '',
            model: node.data.model || 'gpt-4o',
            messages: messages,
            temperature: node.data.temperature,
            max_tokens: node.data.maxTokens,
            stream: node.data.stream ?? false,
          },
        },
      };
    default:
      console.warn(`Unknown node type for replay: ${node.type}`);
      return null;
  }
}

