import type { Edge, Viewport } from '@xyflow/svelte';
import type { AppNode, AppNodeData } from '$lib/types/app';
import { autoSaveService } from '$lib/services/autoSaveService.svelte';

// Initialize auto-save with a lazy getter to avoid circular imports
autoSaveService.init(() => flowStore);

// Flow state - the core of the canvas
let nodes = $state.raw<AppNode[]>([
	{
		id: '1',
		type: 'http-request',
		data: {
			label: 'HTTP Request',
			url: 'https://api.github.com/zen',
			method: 'GET',
			status: 'idle'
		},
		position: { x: 250, y: 50 }
	}
]);

let edges = $state.raw<Edge[]>([]);
let viewport = $state.raw<Viewport>({ x: 0, y: 0, zoom: 1 });

// Selection state
let selectedNodeId = $state<string | null>(null);

// Derived: always fresh reference to selected node
const selectedNode = $derived(nodes.find((n) => n.id === selectedNodeId));

// Simple ID helper for new nodes
const generateId = () => `node_${Math.random().toString(36).substr(2, 9)}`;

// Updates a single field on the selected node (immutable for Svelte Flow reactivity)
function updateNodeData(key: keyof AppNodeData, value: any) {
	if (!selectedNodeId) return;

	nodes = nodes.map((n) => {
		if (n.id === selectedNodeId) {
			return { ...n, data: { ...n.data, [key]: value } };
		}
		return n;
	});

	autoSaveService.triggerSave();
}

// Updates node status + optional result data
function updateNodeStatus(id: string, status: 'idle' | 'running' | 'success' | 'error', resultBody?: any) {
	nodes = nodes.map((n) => {
		if (n.id === id) {
			const newResult = resultBody !== undefined ? { body: resultBody } : n.data.result;

			return {
				...n,
				class:
					status === 'running'
						? 'border-blue-500!'
						: status === 'success'
							? 'border-green-500!'
							: status === 'error'
								? 'border-red-500!'
								: '',
				data: { ...n.data, status, result: newResult }
			};
		}
		return n;
	});
}

// Adds a new node at the given position (or random fallback)
function addNode(type: 'http' | 'code' | 'delay' | 'webhook-wait', position?: { x: number; y: number }) {
	const fallbackPosition = { x: Math.random() * 400, y: Math.random() * 400 };

	let newNode: AppNode;

	if (type === 'http') {
		newNode = {
			id: generateId(),
			type: 'http-request',
			data: {
				label: 'New Request',
				url: '',
				method: 'GET',
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	} else if (type === 'code') {
		newNode = {
			id: generateId(),
			type: 'code-execution',
			data: {
				label: 'JS Logic',
				code: 'return { result: "Hello World" };',
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	} else if (type === 'delay') {
		newNode = {
			id: generateId(),
			type: 'delay',
			data: {
				label: 'Wait',
				delayMs: 5000,  // Default 5 seconds
				delayStr: '5s',
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	} else {
		// Webhook Wait node
		newNode = {
			id: generateId(),
			type: 'webhook-wait',
			data: {
				label: 'Webhook Wait',
				webhookDescription: 'Wait for external event',
				webhookTimeoutMs: 7 * 24 * 60 * 60 * 1000,  // Default 7 days
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	}

	nodes = [...nodes, newNode];
	autoSaveService.triggerSave();
}

// Select a node by ID
function selectNode(id: string | null) {
	selectedNodeId = id;
}

// Get a node by ID (for execution lookups)
function getNode(id: string) {
	return nodes.find((n) => n.id === id);
}

// Replace entire flow state (used when loading from DB)
function setFlow(newNodes: AppNode[], newEdges: Edge[], newViewport?: Viewport) {
	nodes = newNodes;
	edges = newEdges;
	if (newViewport) {
		viewport = newViewport;
	}
}

// Export as a single store object
export const flowStore = {
	// Getters (reactive)
	get nodes() { return nodes; },
	get edges() { return edges; },
	get viewport() { return viewport; },
	get selectedNodeId() { return selectedNodeId; },
	get selectedNode() { return selectedNode; },

	// Setters for binding (trigger auto-save on structural changes)
	set nodes(v: AppNode[]) { 
		nodes = v; 
		autoSaveService.triggerSave();
	},
	set edges(v: Edge[]) { 
		edges = v; 
		autoSaveService.triggerSave();
	},
	set viewport(v: Viewport) { 
		viewport = v; 
		autoSaveService.triggerSave(); // Save viewport changes
	},

	// Actions
	updateNodeData,
	updateNodeStatus,
	addNode,
	selectNode,
	getNode,
	setFlow
};

