import type { AppNode } from '$lib/types/app';
import { type WorkerJob, HttpMethod } from '@swiftgrid/shared';
import { flowStore } from '$lib/stores/flowStore.svelte';

// Current run ID (set when a run starts)
let currentRunId: string | null = null;

// Helper: Dig into an object using a path string "body.html_url"
function getDeepValue(obj: any, path: string): any {
	return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// The Interpolator: Replaces {{node_id.field}} with actual data
// Needs access to flowStore to look up node results
export function resolveVariables(text: string): string {
	if (!text) return text;

	return text.replace(/{{(.*?)}}/g, (match, variablePath) => {
		const cleanPath = variablePath.trim();

		// If it starts with $env, ignore it! (It's a secret handled server-side)
		if (cleanPath.startsWith('$env.')) {
			return match;
		}

		const parts = cleanPath.split('.');
		const targetNodeId = parts[0];
		const valuePath = parts.slice(1).join('.');

		const targetNode = flowStore.getNode(targetNodeId);

		if (!targetNode) {
			console.warn(`Variable Resolver: Node ${targetNodeId} not found.`);
			return `{{${cleanPath}}}`;
		}
		if (!targetNode.data.result) {
			console.warn(`Variable Resolver: Node ${targetNodeId} has no results yet.`);
			return '';
		}

		const value = getDeepValue(targetNode.data.result, valuePath);
		return value !== undefined ? String(value) : '';
	});
}

// Build the worker payload for a node (pure function)
export function buildPayload(node: AppNode): WorkerJob | null {
	// Code node
	if (node.type === 'code-execution') {
		let finalInputs = undefined;

		if (node.data.inputs) {
			const inputStr = typeof node.data.inputs === 'string'
				? node.data.inputs
				: JSON.stringify(node.data.inputs);

			const resolvedStr = resolveVariables(inputStr);

			try {
				finalInputs = JSON.parse(resolvedStr);
			} catch (e) {
				console.warn(`Failed to parse Inputs JSON for Node ${node.id}`, e);
				finalInputs = {};
			}
		}

		return {
			id: node.id,
			node: {
				type: 'CODE',
				data: {
					code: node.data.code || '',
					inputs: finalInputs
				}
			},
			max_retries: 3
		};
	}

	// LLM node
	if (node.type === 'llm') {
		// Build messages array from system + user prompts
		const messages: Array<{ role: string; content: string }> = [];
		
		if (node.data.systemPrompt) {
			messages.push({ role: 'system', content: resolveVariables(node.data.systemPrompt) });
		}
		if (node.data.userPrompt) {
			messages.push({ role: 'user', content: resolveVariables(node.data.userPrompt) });
		}
		
		// Also support raw messages array if provided
		if (node.data.messages && Array.isArray(node.data.messages)) {
			for (const msg of node.data.messages) {
				messages.push({
					role: msg.role,
					content: resolveVariables(msg.content)
				});
			}
		}
		
		return {
			id: node.id,
			node: {
				type: 'LLM',
				data: {
					base_url: resolveVariables(node.data.baseUrl || 'https://api.openai.com/v1'),
					api_key: resolveVariables(node.data.apiKey || ''),
					model: node.data.model || 'gpt-4o',
					messages: messages,
					temperature: node.data.temperature,
					max_tokens: node.data.maxTokens,
					stream: node.data.stream ?? false
				}
			},
			max_retries: 3
		};
	}

	// HTTP node
	if (node.type === 'http-request') {
		if (!node.data.url || !node.data.method) {
			console.warn(`Skipping Node ${node.id}: Missing URL or Method`);
			return null;
		}

		const finalUrl = resolveVariables(node.data.url);

		let finalHeaders: Record<string, string> | undefined = undefined;
		if (node.data.headers) {
			finalHeaders = {};
			for (const [key, val] of Object.entries(node.data.headers)) {
				finalHeaders[key] = resolveVariables(String(val));
			}
		}

		let finalBody = undefined;
		if (node.data.body) {
			const bodyString = typeof node.data.body === 'string'
				? node.data.body
				: JSON.stringify(node.data.body);

			const resolvedBodyString = resolveVariables(bodyString);
			try {
				finalBody = JSON.parse(resolvedBodyString);
			} catch (e) {
				finalBody = resolvedBodyString;
			}
		}

		return {
			id: node.id,
			node: {
				type: 'HTTP',
				data: {
					url: finalUrl,
					method: node.data.method as HttpMethod,
					headers: finalHeaders,
					body: finalBody
				}
			},
			max_retries: 3
		};
	}

	// Unsupported node type for isolated execution
	console.warn(`Node type ${node.type} not supported for isolated execution`);
	return null;
}

// Execute a single node (legacy mode - for manual single-node runs)
// Set isolated=true to prevent downstream nodes from being triggered
export async function executeNode(nodeId: string, isolated: boolean = false) {
	const node = flowStore.getNode(nodeId);
	if (!node) return;

	flowStore.updateNodeStatus(nodeId, 'running');

	const payload = buildPayload(node);

	if (!payload) {
		flowStore.updateNodeStatus(nodeId, 'idle');
		return;
	}

	console.log(`Executing ${node.type}${isolated ? ' (isolated)' : ''}`, payload);

	try {
		await fetch('/api/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ 
				...payload,
				isolated // Tell the backend not to trigger orchestration
			})
		});
	} catch (e) {
		console.error('Network error', e);
		flowStore.updateNodeStatus(nodeId, 'error');
	}
}

/**
 * Run the flow starting from a specific node (and all downstream)
 */
export async function runFromNode(nodeId: string) {
	// Reset statuses for this node and all downstream
	const nodesToReset = getDownstreamNodes(nodeId);
	nodesToReset.forEach(id => flowStore.updateNodeStatus(id, 'idle'));
	
	// Build the graph snapshot
	const graph = {
		nodes: flowStore.nodes.map(n => ({
			id: n.id,
			type: n.type,
			data: n.data,
			position: n.position
		})),
		edges: flowStore.edges.map(e => ({
			id: e.id,
			source: e.source,
			sourceHandle: e.sourceHandle,  // Important for Router node routing
			target: e.target,
			targetHandle: e.targetHandle
		}))
	};
	
	console.log(`Starting flow from node ${nodeId}...`);
	
	try {
		const response = await fetch('/api/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				startRun: true,
				workflowId: flowStore.workflowId, // Include workflow ID for history filtering
				startFromNode: nodeId, // Start from this specific node
				graph,
				trigger: 'manual'
			})
		});
		
		const result = await response.json();
		
		if (result.success) {
			currentRunId = result.runId;
			console.log(`Run started from ${nodeId}: ${currentRunId}`);
			
			result.scheduledNodes.forEach((id: string) => {
				flowStore.updateNodeStatus(id, 'running');
			});
		}
	} catch (e) {
		console.error('Network error:', e);
	}
}

/**
 * Get all nodes downstream from a given node (including the node itself)
 */
function getDownstreamNodes(nodeId: string): string[] {
	const result = new Set<string>([nodeId]);
	const queue = [nodeId];
	
	while (queue.length > 0) {
		const current = queue.shift()!;
		const outgoing = flowStore.edges.filter(e => e.source === current);
		
		for (const edge of outgoing) {
			if (!result.has(edge.target)) {
				result.add(edge.target);
				queue.push(edge.target);
			}
		}
	}
	
	return Array.from(result);
}

/**
 * Get all starting nodes (nodes with no incoming edges)
 */
export function getStartingNodes(): string[] {
	const nodesWithIncoming = new Set(flowStore.edges.map(e => e.target));
	return flowStore.nodes
		.filter(n => !nodesWithIncoming.has(n.id))
		.map(n => n.id);
}

/**
 * Run the entire flow as a tracked run with event logging
 */
export async function runFlow() {
	// Reset all node statuses
	flowStore.nodes.forEach(n => flowStore.updateNodeStatus(n.id, 'idle'));
	
	// Build the graph snapshot
	const graph = {
		nodes: flowStore.nodes.map(n => ({
			id: n.id,
			type: n.type,
			data: n.data,
			position: n.position
		})),
		edges: flowStore.edges.map(e => ({
			id: e.id,
			source: e.source,
			sourceHandle: e.sourceHandle,  // Important for Router node routing
			target: e.target,
			targetHandle: e.targetHandle
		}))
	};
	
	console.log('Starting tracked workflow run...');
	
	try {
		const response = await fetch('/api/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				startRun: true,
				workflowId: flowStore.workflowId, // Include workflow ID for history filtering
				graph,
				trigger: 'manual'
			})
		});
		
		const result = await response.json();
		
		if (result.success) {
			currentRunId = result.runId;
			console.log(`Run started: ${currentRunId}`);
			console.log(`Scheduled nodes: ${result.scheduledNodes.join(', ')}`);
			
			// Mark scheduled nodes as running
			result.scheduledNodes.forEach((nodeId: string) => {
				flowStore.updateNodeStatus(nodeId, 'running');
			});
		} else {
			console.error('Failed to start run:', result);
		}
	} catch (e) {
		console.error('Network error starting run:', e);
	}
}

/**
 * Handle SSE result and trigger next nodes
 * For tracked runs, calls the orchestrator API
 * For legacy runs, does client-side chaining
 */
export async function handleExecutionResult(nodeId: string, isSuccess: boolean, body: any, runId?: string) {
	flowStore.updateNodeStatus(nodeId, isSuccess ? 'success' : 'error', body);

		const outgoingEdges = flowStore.edges.filter(e => e.source === nodeId);
	
	if (runId) {
		// Tracked run: call orchestrator to schedule next nodes
		try {
			const response = await fetch('/api/orchestrate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ runId, nodeId, success: isSuccess })
			});
			
			const result = await response.json();
			
			if (result.scheduledNodes?.length > 0) {
				console.log(`Orchestrator scheduled: ${result.scheduledNodes.join(', ')}`);
				// Mark scheduled nodes as running
				result.scheduledNodes.forEach((id: string) => {
					flowStore.updateNodeStatus(id, 'running');
				});
			}
			
			if (result.status === 'completed' || result.status === 'failed') {
				console.log(`Run ${runId} finished: ${result.status}`);
				currentRunId = null;
			}
		} catch (e) {
			console.error('Failed to call orchestrator:', e);
		}
	} else if (isSuccess && outgoingEdges.length > 0) {
		// Legacy run: client-side chaining
			setTimeout(() => {
				outgoingEdges.forEach(edge => executeNode(edge.target));
			}, 500);
		}
	}

/**
 * Get the current run ID (for debugging/UI)
 */
export function getCurrentRunId(): string | null {
	return currentRunId;
}

