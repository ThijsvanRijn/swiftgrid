<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { type HttpRequestNode, HttpMethod } from '$lib/types/worker';

	// Define custom data shape
	type AppNodeData = {
		label?: string;
		url?: string;
		method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
		// New fields for feedback
		status?: 'idle' | 'running' | 'success' | 'error';
		result?: any;
		body?: any;
		[key: string]: unknown; 
	};

	// Define specific Node type
	type AppNode = Node<AppNodeData>;

	let nodes = $state.raw<AppNode[]>([
		{
			id: '1',
			type: 'default',
			data: {
				label: 'HTTP Request',
				url: 'https://api.github.com/zen',
				method: 'GET'
			},
			position: { x: 250, y: 50 }
		}
	]);

	let edges = $state.raw<Edge[]>([]);

	let selectedNodeId = $state<string | null>(null);
	
	// Derived value: automatically updates when selectedNodeId or nodes change
	let selectedNode = $derived(nodes.find((n) => n.id === selectedNodeId));

	/**
	 * Updates node data immutably to trigger Svelte Flow reactivity
	 */
	function updateNodeData(key: keyof AppNodeData, value: any) {
		if (!selectedNodeId) return;

		nodes = nodes.map((n) => {
			if (n.id === selectedNodeId) {
				return {
					...n,
					data: {
						...n.data,
						[key]: value
					}
				};
			}
			return n;
		});
	}

	/**
	 * Handle Node Click
	 * We manually type the event object here since the specific handler type 
	 * isn't strictly exported, but we know it contains the clicked node.
	 */
	const onNodeClick = ({ node }: { node: AppNode }) => {
		selectedNodeId = node.id;
	};

	const onPaneClick = () => {
		selectedNodeId = null;
	};

	async function executeNode(nodeId: string) {
		const node = nodes.find((n) => n.id === nodeId);
		if (!node) return;

		// 1. Validation
		if (!node.data.url || !node.data.method) {
			console.warn(`Skipping Node ${nodeId}: Missing Config`);
			return;
		}

		// 2. Set UI to "Running"
		updateNodeStatus(nodeId, 'running');

		// --- THE BRAIN ACTIVATION (Data Passing Logic) ---

		// A. Resolve URL variables
		// "https://api.github.com/users/{{node_1.body.login}}" -> "https://api.github.com/users/torvalds"
		const finalUrl = resolveVariables(node.data.url);

		// B. Resolve Body variables
		let finalBody = undefined;
		
		if (node.data.body) {
			// We treat the body as a string first so we can do the regex replacement
			const bodyString = typeof node.data.body === 'string' 
				? node.data.body 
				: JSON.stringify(node.data.body);
			
			// "{"user": "{{node_1.body.login}}"}" -> "{"user": "torvalds"}"
			const resolvedBodyString = resolveVariables(bodyString);

			try {
				// Try to convert it back to a real JSON object for the API
				finalBody = JSON.parse(resolvedBodyString);
			} catch (e) {
				// If it fails (e.g. it's just plain text like "Hello {{name}}"), send as string
				finalBody = resolvedBodyString;
			}
		}
		// -------------------------------------------------

		// 3. Construct Payload
		const payload: HttpRequestNode = {
			id: node.id,
			url: finalUrl, 
			method: node.data.method as HttpMethod,
			headers: undefined,
			body: finalBody
		};

		console.log(`Executing Node ${nodeId} with Payload:`, payload);

		// 4. Fire to Backend
		try {
			await fetch('/api/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
		} catch (e) {
			console.error('Network error', e);
			updateNodeStatus(nodeId, 'error');
		}
	}

	// Helper: Dig into an object using a path string "body.html_url"
    function getDeepValue(obj: any, path: string): any {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    // The Interpolator: Replaces {{node_id.field}} with actual data
    function resolveVariables(text: string): string {
        if (!text) return text;
        
        // Regex to find {{ whatever }}
        return text.replace(/{{(.*?)}}/g, (_, variablePath) => {
            const cleanPath = variablePath.trim(); // e.g., "node_1.body.login"
            
            const parts = cleanPath.split('.');
            const targetNodeId = parts[0]; // "node_1"
            const valuePath = parts.slice(1).join('.'); // "body.login"

            // Find the node in our memory
            const targetNode = nodes.find(n => n.id === targetNodeId);
            
            // Safety checks
            if (!targetNode) {
                console.warn(`Variable Resolver: Node ${targetNodeId} not found.`);
                return `{{${cleanPath}}}`; // Leave it alone if not found
            }
            if (!targetNode.data.result) {
                console.warn(`Variable Resolver: Node ${targetNodeId} has no results yet.`);
                return ""; // Return empty if hasn't run
            }

            // Dig for the value
            const value = getDeepValue(targetNode.data.result, valuePath);
            
            // Return the value (as string) or empty string if undefined
            return value !== undefined ? String(value) : "";
        });
    }

	function runFlow() {
		// Find all target node IDs (nodes that are destinations)
		const targetIds = new Set(edges.map(e => e.target));

		// Find nodes that are NOT in that set (Roots)
		const rootNodes = nodes.filter(n => !targetIds.has(n.id));

		if (rootNodes.length === 0 && nodes.length > 0) {
			alert("Cycle detected or no roots! Running all nodes as fallback.");
			nodes.forEach(n => executeNode(n.id));
			return;
		}

		// Execute all roots
		console.log("Starting Flow with Roots:", rootNodes.map(n => n.id));
		rootNodes.forEach(n => executeNode(n.id));
	}

	function updateNodeStatus(id: string, status: 'idle' | 'running' | 'success' | 'error', resultBody?: any) {
    nodes = nodes.map(n => {
        if (n.id === id) {
            // If we have a new body, wrap it in { body: ... }
            // If not (e.g. just setting status to 'running'), keep the old result
            const newResult = resultBody !== undefined 
                ? { body: resultBody } 
                : n.data.result;

				return {
					...n,
					class: status === 'running' ? '!border-blue-500 !border-2 !bg-blue-50' :
						status === 'success' ? '!border-green-500 !border-2 !bg-green-50' :
						status === 'error'   ? '!border-red-500 !border-2 !bg-red-50' : '',
					data: { 
						...n.data, 
						status: status,
						result: newResult
					}
				};
        	}
        	return n;
    	});
	}

	import { onMount } from 'svelte';
	import type { ExecutionResult } from '$lib/types/worker';

	onMount(() => {
		const eventSource = new EventSource('/api/stream');
		
		eventSource.onmessage = (event) => {
			const result: ExecutionResult = JSON.parse(event.data);
			const isSuccess = result.status_code >= 200 && result.status_code < 300;

			// 1. Update the finished node visual state
			updateNodeStatus(result.node_id, isSuccess ? 'success' : 'error', result.body);

			// 2. DAISY CHAIN LOGIC
			if (isSuccess) {
				// Find all edges where the source is the node that just finished
				const outgoingEdges = edges.filter(e => e.source === result.node_id);
				
				if (outgoingEdges.length > 0) {
					console.log(`Node ${result.node_id} finished. Triggering ${outgoingEdges.length} children.`);
					
					// We add a tiny delay (500ms) so you can visually see the flow moving
					setTimeout(() => {
						outgoingEdges.forEach(edge => {
							executeNode(edge.target);
						});
					}, 500); 
				}
			}
		};

		// Cleanup when page closes
		return () => {
			eventSource.close();
		};
	});

	// Helper for random IDs
    const getId = () => `node_${Math.random().toString(36).substr(2, 9)}`;

    function addNode() {
        const newNode: AppNode = {
            id: getId(),
            type: 'default',
            data: {
                label: 'New Request',
                url: '',
                method: 'GET',
                status: 'idle'
            },
            // Place it slightly offset from the center or last node
            position: { x: Math.random() * 400, y: Math.random() * 400 }
        };
        
        // Svelte 5 Immutable update
        nodes = [...nodes, newNode];
    }
</script>

<div class="h-screen w-full flex flex-col text-slate-900 font-sans">
	<!-- Navbar -->
	<div class="px-6 py-3 border-b border-slate-200 flex justify-between items-center bg-white z-10 shadow-sm">
		<h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
		<button 
			onclick={addNode}
			class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 font-medium text-sm transition-colors"
		>
			+ Add Node
		</button>
		<button
			onclick={runFlow}
			class="bg-slate-900 text-white px-4 py-2 rounded-md hover:bg-slate-700 font-medium text-sm transition-colors shadow-sm"
		>
			Run Flow
		</button>
	</div>

	<!-- Main Layout -->
	<div class="grow flex overflow-hidden relative">
		
		<!-- Canvas Area -->
		<div class="grow h-full bg-slate-50 relative">
			<SvelteFlow
				bind:nodes
				bind:edges
				onnodeclick={onNodeClick}
				onpaneclick={onPaneClick}
				fitView
				class="bg-slate-50"
			>
				<Background patternColor="#cbd5e1" gap={20} />
				<Controls />
			</SvelteFlow>
		</div>

		<!-- Configuration Sidebar -->
		<!-- We conditionally render this sidebar based on the derived selectedNode -->
		{#if selectedNode}
			<div class="w-80 border-l border-slate-200 bg-white flex flex-col shadow-xl z-20 h-full transition-all">
				
				<!-- Sidebar Header -->
				<div class="p-5 border-b border-slate-100 bg-white">
					<h2 class="font-bold text-lg text-slate-800">Configuration</h2>
					<div class="text-xs text-slate-400 font-mono mt-1">ID: {selectedNode.id}</div>
				</div>

				<!-- Sidebar Form -->
				<div class="p-5 flex flex-col gap-6 overflow-y-auto grow">
					
					<!-- URL Input -->
					<div class="flex flex-col gap-2">
						<label for="url" class="text-xs font-bold uppercase text-slate-500 tracking-wider">
							Target URL
						</label>
						<input
							id="url"
							type="text"
							value={selectedNode.data.url}
							oninput={(e) => updateNodeData('url', e.currentTarget.value)}
							class="border border-slate-300 p-2.5 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
							placeholder="https://api.example.com"
						/>
					</div>

					<!-- Method Input (Native Style) -->
					<div class="flex flex-col gap-2">
						<label for="method" class="text-xs font-bold uppercase text-slate-500 tracking-wider">
							HTTP Method
						</label>
						<select
							id="method"
							value={selectedNode.data.method}
							onchange={(e) => updateNodeData('method', e.currentTarget.value)}
							class="w-full border border-slate-300 p-2 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black transition-all"
						>
							<option value="GET">GET</option>
							<option value="POST">POST</option>
							<option value="PUT">PUT</option>
							<option value="DELETE">DELETE</option>
							<option value="PATCH">PATCH</option>
						</select>
					</div>
				</div>

				<!-- JSON Body Input -->
				<div class="p-5 flex flex-col gap-2">
					<div class="flex justify-between items-center">
						<label for="body" class="text-xs font-bold uppercase text-slate-500 tracking-wider">
							JSON Body
						</label>
						<span class="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">Optional</span>
					</div>
					<textarea
						id="body"
						value={typeof selectedNode.data.body === 'string' 
							? selectedNode.data.body 
							: (selectedNode.data.body ? JSON.stringify(selectedNode.data.body, null, 2) : '')}
						oninput={(e) => updateNodeData('body', e.currentTarget.value)}
						class="border border-slate-300 p-2 rounded-md text-xs font-mono h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
						placeholder={'{"key": "{{node_1.body.value}}"}'}
					></textarea>
				</div>

				<hr class="border-slate-100 my-4" />

				<!-- Sidebar Result -->
				<div class="p-5 flex flex-col gap-3">
					<div class="flex justify-between items-center">
						<h3 class="text-xs font-bold uppercase text-slate-500 tracking-wider">
							Last Execution
						</h3>
						<!-- Status Badge -->
						{#if selectedNode.data.status}
							<span class={
								`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide
								${selectedNode.data.status === 'success' ? 'bg-green-100 text-green-700' : ''}
								${selectedNode.data.status === 'error' ? 'bg-red-100 text-red-700' : ''}
								${selectedNode.data.status === 'running' ? 'bg-blue-100 text-blue-700' : ''}
							`}>
								{selectedNode.data.status}
							</span>
						{/if}
					</div>

					<!-- JSON Output -->
					{#if selectedNode.data.result}
						<div class="relative group">
							<pre class="bg-slate-900 text-slate-50 p-3 rounded-md text-xs font-mono overflow-x-auto max-h-60 shadow-inner custom-scrollbar">{JSON.stringify(selectedNode.data.result, null, 2)}</pre>
							<!-- Copy hint -->
							<div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
								<span class="text-[10px] text-slate-400 bg-slate-800 px-1 rounded">JSON</span>
							</div>
						</div>
					{:else}
						<div class="p-4 border border-dashed border-slate-200 rounded-md text-center">
							<span class="text-xs text-slate-400">No data yet. Run the flow!</span>
						</div>
					{/if}
				</div>

				<!-- Sidebar Footer -->
				<div class="p-4 border-t border-slate-100 bg-slate-50">
					<div class="flex items-center justify-center gap-2 text-xs text-slate-500">
						<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
						Changes saved automatically
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>