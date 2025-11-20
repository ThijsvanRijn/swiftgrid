<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	// 1. Define your custom data shape
	type AppNodeData = {
		label?: string;
		url?: string;
		method?: 'GET' | 'POST';
		[key: string]: unknown; // Required index signature for Svelte Flow data
	};

	// 2. Define your specific Node type
	type AppNode = Node<AppNodeData>;

	let nodes = $state.raw<AppNode[]>([
		{
			id: '1',
			type: 'input',
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

	async function runFlow() {
    const httpNode = nodes.find((n) => n.id === '1');
    if (!httpNode) return;

    console.log('Sending to backend:', httpNode.data);

    try {
        // UNCOMMENTED AND FIXED:
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: httpNode.id,
                method: httpNode.data.method,
                url: httpNode.data.url
            })
        });

        if (response.ok) {
            // Only alert if the server actually received it
            alert(`Job sent! Server says OK.`);
        } else {
            console.error('Server error');
            alert('Server failed to accept job.');
        }
    	} catch (e) {
    	    console.error('Network error', e);
    	    alert('Network error: Check if your SvelteKit server is running.');
    	}
	}
</script>

<div class="h-screen w-full flex flex-col text-slate-900 font-sans">
	<!-- Navbar -->
	<div class="px-6 py-3 border-b border-slate-200 flex justify-between items-center bg-white z-10 shadow-sm">
		<h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
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

					<!-- Method Select -->
					<div class="flex flex-col gap-2">
						<label for="method" class="text-xs font-bold uppercase text-slate-500 tracking-wider">
							HTTP Method
						</label>
						<div class="relative">
							<select
								id="method"
								value={selectedNode.data.method}
								onchange={(e) => updateNodeData('method', e.currentTarget.value)}
								class="w-full border border-slate-300 p-2.5 rounded-md text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
							>
								<option value="GET">GET</option>
								<option value="POST">POST</option>
								<option value="PUT">PUT</option>
								<option value="DELETE">DELETE</option>
							</select>
							<!-- Custom Arrow Icon -->
							<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
								<svg class="h-4 w-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/></svg>
							</div>
						</div>
					</div>
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