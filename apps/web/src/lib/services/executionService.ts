import type { AppNode } from '$lib/types/app';
import { type WorkerJob, HttpMethod } from '@swiftgrid/shared';
import { flowStore } from '$lib/stores/flowStore.svelte';

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
			}
		};
	}

	// HTTP node
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
		}
	};
}

// Execute a single node
export async function executeNode(nodeId: string) {
	const node = flowStore.getNode(nodeId);
	if (!node) return;

	flowStore.updateNodeStatus(nodeId, 'running');

	const payload = buildPayload(node);

	if (!payload) {
		flowStore.updateNodeStatus(nodeId, 'idle');
		return;
	}

	console.log(`Executing ${node.type}`, payload);

	try {
		await fetch('/api/run', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
	} catch (e) {
		console.error('Network error', e);
		flowStore.updateNodeStatus(nodeId, 'error');
	}
}

// Run the entire flow starting from root nodes
export function runFlow() {
	const targetIds = new Set(flowStore.edges.map((e) => e.target));
	const rootNodes = flowStore.nodes.filter((n) => !targetIds.has(n.id));

	if (rootNodes.length === 0 && flowStore.nodes.length > 0) {
		alert('Cycle detected or no roots! Running all nodes as fallback.');
		flowStore.nodes.forEach((n) => executeNode(n.id));
		return;
	}

	console.log('Starting Flow with Roots:', rootNodes.map((n) => n.id));
	rootNodes.forEach((n) => executeNode(n.id));
}

// Handle SSE result and trigger next nodes (daisy chain)
export function handleExecutionResult(nodeId: string, isSuccess: boolean, body: any) {
	flowStore.updateNodeStatus(nodeId, isSuccess ? 'success' : 'error', body);

	if (isSuccess) {
		const outgoingEdges = flowStore.edges.filter(e => e.source === nodeId);
		if (outgoingEdges.length > 0) {
			setTimeout(() => {
				outgoingEdges.forEach(edge => executeNode(edge.target));
			}, 500);
		}
	}
}

