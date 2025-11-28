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

// Workflow metadata
let workflowId = $state<number | null>(null);
let workflowName = $state<string | null>(null);

// Versioning state
let activeVersionId = $state<string | null>(null);
let activeVersionNumber = $state<number | null>(null);
let hasUnpublishedChanges = $state(false);

// Selection state
let selectedNodeId = $state<string | null>(null);

// Derived: always fresh reference to selected node
const selectedNode = $derived(nodes.find((n) => n.id === selectedNodeId));

// Simple ID helper for new nodes
const generateId = () => `node_${Math.random().toString(36).substr(2, 9)}`;

// Fields that don't affect execution (don't reset status when changed)
const nonExecutionFields: (keyof AppNodeData)[] = ['label', 'description'];

// Updates a single field on the selected node (immutable for Svelte Flow reactivity)
function updateNodeData(key: keyof AppNodeData, value: any) {
	if (!selectedNodeId) return;

	// Check if this is a field that affects execution
	const affectsExecution = !nonExecutionFields.includes(key);

	nodes = nodes.map((n) => {
		if (n.id === selectedNodeId) {
			// Reset status to idle if changing an execution-affecting field
			// and the node was in error/success state
			const shouldResetStatus = affectsExecution && 
				(n.data.status === 'error' || n.data.status === 'success');
			
			return { 
				...n, 
				class: shouldResetStatus ? '' : n.class,
				data: { 
					...n.data, 
					[key]: value,
					// Reset status and clear result if we're resetting
					...(shouldResetStatus ? { status: 'idle', result: undefined } : {})
				} 
			};
		}
		return n;
	});

	autoSaveService.triggerSave();
	markAsChanged();
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
function addNode(type: 'http' | 'code' | 'delay' | 'webhook-wait' | 'router' | 'llm', position?: { x: number; y: number }) {
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
	} else if (type === 'router') {
		// Router node with default conditions
		const nodeId = generateId();
		newNode = {
			id: nodeId,
			type: 'router',
			data: {
				label: 'Router',
				routeBy: '{{prev.status}}',  // Default: route by previous node's status
				conditions: [
					{ id: 'success', label: 'Success', expression: 'value >= 200 && value < 300' },
					{ id: 'error', label: 'Error', expression: 'value >= 400' }
				],
				defaultOutput: 'default',
				routerMode: 'first_match',
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	} else if (type === 'llm') {
		// LLM Chat node with OpenAI defaults
		newNode = {
			id: generateId(),
			type: 'llm',
			data: {
				label: 'LLM Chat',
				baseUrl: 'https://api.openai.com/v1',
				apiKey: '{{$env.OPENAI_KEY}}',
				model: 'gpt-4o',
				systemPrompt: 'You are a helpful assistant.',
				userPrompt: '',
				temperature: 1,
				stream: true,
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
				description: 'Wait for external event',
				timeoutMs: 7 * 24 * 60 * 60 * 1000,  // Default 7 days
				timeoutStr: '7d',
				status: 'idle'
			},
			position: position ?? fallbackPosition
		};
	}

	nodes = [...nodes, newNode];
	autoSaveService.triggerSave();
	markAsChanged();
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
function setFlow(
	newNodes: AppNode[], 
	newEdges: Edge[], 
	newViewport?: Viewport, 
	id?: number, 
	name?: string,
	versionId?: string | null,
	versionNumber?: number | null
) {
	// Create new array references to ensure reactivity with $state.raw
	// Also reset all node statuses to idle (clear stale run state)
	nodes = newNodes.map(n => ({
		...n,
		class: '', // Clear any status-related classes
		data: {
			...n.data,
			status: 'idle',
			result: undefined
		}
	}));
	edges = [...newEdges];
	if (newViewport) {
		viewport = { ...newViewport };
	}
	if (id !== undefined) {
		workflowId = id;
	}
	if (name !== undefined) {
		workflowName = name;
	}
	if (versionId !== undefined) {
		activeVersionId = versionId;
	}
	if (versionNumber !== undefined) {
		activeVersionNumber = versionNumber;
	}
	// Reset unpublished changes flag and content hash when loading fresh
	hasUnpublishedChanges = false;
	lastContentHash = hashNodeContent(newNodes);
	
	// Also deselect any selected node to force sidebar refresh
	selectedNodeId = null;
}

// Mark that there are unpublished changes (called after edits when we have a published version)
function markAsChanged() {
	if (activeVersionId) {
		hasUnpublishedChanges = true;
	}
}

// Hash the "content" of nodes (excluding position, status, result - only things that matter for execution)
function hashNodeContent(nodeList: AppNode[]): string {
	return JSON.stringify(nodeList.map(n => ({
		id: n.id,
		type: n.type,
		data: {
			// Include all data except transient execution state
			label: n.data.label,
			url: n.data.url,
			method: n.data.method,
			headers: n.data.headers,
			body: n.data.body,
			code: n.data.code,
			inputs: n.data.inputs,
			delayMs: n.data.delayMs,
			delayStr: n.data.delayStr,
			timeoutMs: n.data.timeoutMs,
			timeoutStr: n.data.timeoutStr,
			description: n.data.description,
			routeBy: n.data.routeBy,
			conditions: n.data.conditions,
			defaultOutput: n.data.defaultOutput,
			routerMode: n.data.routerMode,
			baseUrl: n.data.baseUrl,
			apiKey: n.data.apiKey,
			model: n.data.model,
			systemPrompt: n.data.systemPrompt,
			userPrompt: n.data.userPrompt,
			temperature: n.data.temperature,
			maxTokens: n.data.maxTokens,
			stream: n.data.stream,
			messages: n.data.messages,
		}
	})).sort((a, b) => a.id.localeCompare(b.id)));
}

// Track the last "content hash" to detect meaningful changes
let lastContentHash = '';

// Check if nodes have meaningful content changes (not just position)
function hasContentChanged(newNodes: AppNode[]): boolean {
	const newHash = hashNodeContent(newNodes);
	if (newHash !== lastContentHash) {
		lastContentHash = newHash;
		return true;
	}
	return false;
}

// Reset content hash (called when loading or publishing)
function resetContentHash() {
	lastContentHash = hashNodeContent(nodes);
}

// Update version info after publishing
function setVersionInfo(versionId: string, versionNumber: number) {
	activeVersionId = versionId;
	activeVersionNumber = versionNumber;
	hasUnpublishedChanges = false;
	// Reset content hash to current state (this is now the "published" baseline)
	lastContentHash = hashNodeContent(nodes);
}

// Export as a single store object
export const flowStore = {
	// Getters (reactive)
	get nodes() { return nodes; },
	get edges() { return edges; },
	get viewport() { return viewport; },
	get workflowId() { return workflowId; },
	get workflowName() { return workflowName; },
	get selectedNodeId() { return selectedNodeId; },
	get selectedNode() { return selectedNode; },
	
	// Version getters
	get activeVersionId() { return activeVersionId; },
	get activeVersionNumber() { return activeVersionNumber; },
	get hasUnpublishedChanges() { return hasUnpublishedChanges; },

	// Setters for binding (trigger auto-save on structural changes)
	set nodes(v: AppNode[]) { 
		// Check if this is a meaningful content change (not just position/drag)
		const isContentChange = hasContentChanged(v);
		nodes = v; 
		autoSaveService.triggerSave();
		// Only mark as "unpublished" for content changes, not layout changes
		if (isContentChange) {
			markAsChanged();
		}
	},
	set edges(v: Edge[]) { 
		edges = v; 
		autoSaveService.triggerSave();
		markAsChanged(); // Edge changes are always meaningful
	},
	set viewport(v: Viewport) { 
		viewport = v; 
		autoSaveService.triggerSave(); // Save viewport changes (but don't mark as unpublished)
	},

	// Actions
	updateNodeData,
	updateNodeStatus,
	addNode,
	selectNode,
	getNode,
	setFlow,
	setVersionInfo,
	markAsChanged
};

