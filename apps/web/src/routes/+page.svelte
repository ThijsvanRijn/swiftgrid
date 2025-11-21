<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Edge
		// type Node is no longer needed here if we use AppNode
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	// 1. Import the shared types you created
	import type { AppNode, AppNodeData } from '$lib/types/app';
	
	// 2. Import Worker types
	import { type WorkerJob, HttpMethod } from '$lib/types/worker';

	// 3. Import your Custom Component
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';

	// 4. Register the Custom Node Type
	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent
	};

	// State uses the imported AppNode type
	let nodes = $state.raw<AppNode[]>([
		{
			id: '1',
			type: 'http-request', // Update this to use your new component!
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
		activeTab = 'config'; 
	};

	const onPaneClick = () => {
		selectedNodeId = null;
	};

	async function executeNode(nodeId: string) {
		const node = nodes.find((n) => n.id === nodeId);
		if (!node) return;

		// Set UI to "Running" immediately
		updateNodeStatus(nodeId, 'running');

		let payload: WorkerJob;

		// =================================================
		// PATH A: CODE NODE
		// =================================================
		if (node.type === 'code-execution') {
			// 1. Resolve "Inputs" (The JSON variables passed to JS)
			let finalInputs = undefined;
			
			if (node.data.inputs) {
				// Treat as string for variable replacement {{...}}
				const inputStr = typeof node.data.inputs === 'string' 
					? node.data.inputs 
					: JSON.stringify(node.data.inputs);
				
				const resolvedStr = resolveVariables(inputStr);
				
				try { 
					finalInputs = JSON.parse(resolvedStr); 
				} catch (e) {
					console.warn(`Failed to parse Inputs JSON for Node ${nodeId}`, e);
					// If parse fails, defaulting to empty object is safer for JS execution
					finalInputs = {}; 
				}
			}

			// 2. Construct Payload
			payload = {
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
		
		// =================================================
		// PATH B: HTTP NODE (Default)
		// =================================================
		else {
			// 1. HTTP-Specific Validation
			if (!node.data.url || !node.data.method) {
				console.warn(`Skipping Node ${nodeId}: Missing URL or Method`);
				// Reset status since we aren't running
				updateNodeStatus(nodeId, 'idle'); 
				return;
			}

			// 2. Resolve URL
			const finalUrl = resolveVariables(node.data.url);

			// 3. Resolve Headers
			let finalHeaders: Record<string, string> | undefined = undefined;
			if (node.data.headers) {
				finalHeaders = {};
				for (const [key, val] of Object.entries(node.data.headers)) {
					finalHeaders[key] = resolveVariables(String(val));
				}
			}
			
			// 4. Resolve Body
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

			// 5. Construct Payload
			payload = {
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

		console.log(`Executing ${node.type}`, payload);

		// =================================================
		// SEND TO BACKEND
		// =================================================
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
        return text.replace(/{{(.*?)}}/g, (match, variablePath) => {
			const cleanPath = variablePath.trim(); // e.g., "node_1.body.login"

			// If it starts with $env, ignore it! (It's a secret)
			if (cleanPath.startsWith('$env.')) {
                return match; 
            }
            
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
					class: status === 'running' ? 'border-blue-500!' :
						status === 'success' ? 'border-green-500!' :
						status === 'error'   ? 'border-red-500!' : '',
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

	// Secrets Management
	type SecretItem = { key: string; createdAt: string };
	let availableSecrets = $state<SecretItem[]>([]);
	let secretKeyInput = $state('');
	let secretValueInput = $state('');

	async function loadSecrets() {
		const res = await fetch('/api/secrets');
		if (res.ok) availableSecrets = await res.json();
	}

	async function saveSecret() {
		if (!secretKeyInput || !secretValueInput) return;
		
		const res = await fetch('/api/secrets', {
			method: 'POST',
			body: JSON.stringify({ key: secretKeyInput, value: secretValueInput })
		});
		
		if (res.ok) {
			// Clear inputs and reload list
			secretKeyInput = '';
			secretValueInput = '';
			loadSecrets();
			alert("Secret saved!");
		}
	}

	import { onMount } from 'svelte';
	import type { ExecutionResult } from '$lib/types/worker';

	let isDark = $state(false);

	function toggleTheme() {
		isDark = !isDark;
		updateTheme();
	}

	function updateTheme() {
        const html = document.documentElement;
        if (isDark) {
            html.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            html.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }

	onMount(() => {
		const stored = localStorage.getItem('theme');
        if (stored) {
            isDark = stored === 'dark';
        } else {
            // 2. Fallback to System Preference
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        
        updateTheme();
		loadLatestFlow();
		loadSecrets();

		// Listen for Real-time Updates from Rust
		const eventSource = new EventSource('/api/stream');
		
		eventSource.onmessage = (event) => {
			const result: ExecutionResult = JSON.parse(event.data);
			const isSuccess = result.status_code >= 200 && result.status_code < 300;

			// Update the node visual state
			updateNodeStatus(result.node_id, isSuccess ? 'success' : 'error', result.body);

			// DAISY CHAIN LOGIC (Trigger next node)
			if (isSuccess) {
				const outgoingEdges = edges.filter(e => e.source === result.node_id);
				if (outgoingEdges.length > 0) {
					setTimeout(() => {
						outgoingEdges.forEach(edge => executeNode(edge.target));
					}, 500); 
				}
			}
		};

		return () => eventSource.close();
	});

	// Helper for random IDs
    const getId = () => `node_${Math.random().toString(36).substr(2, 9)}`;

	function addNode(type: 'http' | 'code' = 'http') {
		const isHttp = type === 'http';
		
		const newNode: AppNode = {
			id: getId(),
			type: isHttp ? 'http-request' : 'code-execution', // Switch type
			data: {
				label: isHttp ? 'New Request' : 'JS Logic',
				// Initialize defaults based on type
				url: isHttp ? '' : undefined,
				method: isHttp ? 'GET' : undefined,
				code: isHttp ? undefined : 'return { result: "Hello World" };',
				status: 'idle'
			},
			position: { x: Math.random() * 400, y: Math.random() * 400 }
		};
		nodes = [...nodes, newNode];
	}

    async function saveFlow() {
        // We send the raw arrays. Svelte 5 proxies (from $state) serialize fine via JSON.stringify
        try {
            const response = await fetch('/api/flows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodes, edges })
            });
            
            if (response.ok) {
                // Visual feedback (could be a toast later)
                const btn = document.getElementById('saveBtn');
                if (btn) {
                    const originalText = btn.innerText;
                    btn.innerText = "Saved!";
                    setTimeout(() => btn.innerText = originalText, 2000);
                }
            }
        } catch (e) {
            console.error("Save failed", e);
            alert("Failed to save flow to DB");
        }
    }

    async function loadLatestFlow() {
        try {
            const response = await fetch('/api/flows');
            const data = await response.json();

            if (data.graph) {
                // Restore state from DB
                // We cast to any because the DB JSONB type is generic
                const graph = data.graph as any;
                nodes = graph.nodes || [];
                edges = graph.edges || [];
                console.log("Flow loaded from DB!");
            }
        } catch (e) {
            console.error("Load failed", e);
        }
    }

	// Sidebar State
    let activeTab = $state<'config' | 'secrets' | 'test'>('config');
    
    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        // You could add a small toast notification here in the future
		alert("Copied to clipboard");
    }

    // HEADERS MANAGEMENT
    function addHeader() {
        if (!selectedNodeId) return;
        
        // We treat headers as a generic object in data, 
        // but for editing we need to ensure it exists.
        nodes = nodes.map(n => {
            if (n.id === selectedNodeId) {
                const currentHeaders = n.data.headers || {};
                // Add a blank entry placeholder if needed, 
                // but easier: just let user type in a new row UI.
                // Actually, let's initialize it if missing.
                return { ...n, data: { ...n.data, headers: { ...currentHeaders, "": "" } } };
            }
            return n;
        });
    }

    // Helper to update a specific header key/value
    // Since standard JSON objects don't preserve order or allow editing keys easily,
    // we often convert to array for UI, but let's do a direct edit for simplicity.
    function updateHeaderKey(oldKey: string, newKey: string) {
        if (!selectedNode) return;
        const headers = { ...selectedNode.data.headers };
        const value = headers[oldKey];
        delete headers[oldKey];
        headers[newKey] = value; // Re-assign with new key
        updateNodeData('headers', headers);
    }

    function updateHeaderValue(key: string, newValue: string) {
        if (!selectedNode) return;
        const headers = { ...selectedNode.data.headers };
        headers[key] = newValue;
        updateNodeData('headers', headers);
    }

    function removeHeader(key: string) {
        if (!selectedNode) return;
        const headers = { ...selectedNode.data.headers };
        delete headers[key];
        updateNodeData('headers', headers);
    }
</script>

<div class="h-screen w-full flex flex-col text-foreground font-sans bg-background">
	<!-- Navbar -->
	<div class="px-6 py-3 border-b border-border flex justify-between items-center bg-card z-10 shadow-xs">
		<div class="flex items-center gap-4">
            <h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
            <!-- THEME TOGGLE -->
            <button 
                onclick={toggleTheme}
                class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
            >
                {#if isDark} 🌙 {:else} ☀️ {/if}
            </button>
        </div>
		<div class="flex gap-2">
			<button 
				onclick={() => addNode('http')}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				+ Add HTTP Node
			</button>
			<button 
				onclick={() => addNode('code')}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				+ Add Code Node
			</button>
			<button 
				id="saveBtn"
				onclick={saveFlow}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				Save
			</button>
            <button
            	onclick={runFlow}
                class="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-colors"
            >
                Run Flow
            </button>
			<!-- Toggle Theme Button -->
			<button 
				onclick={toggleTheme}
				class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors border border-border bg-background text-foreground"
				title="Toggle Theme"
			>
				{#if isDark}
					<!-- Moon Icon -->
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
				{:else}
					<!-- Sun Icon -->
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
				{/if}
			</button>
		</div>
	</div>

	<!-- Main Layout -->
	<div class="grow flex overflow-hidden relative">
		
		<!-- Canvas Area -->
		<div class="grow h-full bg-background relative">
            <SvelteFlow
                bind:nodes={nodes}
                bind:edges={edges}
                nodeTypes={nodeTypes}
                colorMode={isDark ? 'dark' : 'light'}
                onnodeclick={onNodeClick}
                onpaneclick={onPaneClick}
                fitView
                class="bg-muted/20" 
            >
				<Background patternColor={isDark ? '#334155' : '#cbd5e1'} gap={20} />
				<Controls />
			</SvelteFlow>
		</div>

		<!-- Configuration Sidebar -->
		{#if selectedNode}
			<div class="w-96 border-l border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col shadow-xl z-20 h-full transition-all">
				
				<!-- 1. UTILITY HEADER (ID & Close) -->
				<div class="px-4 py-2 border-b border-sidebar-border bg-sidebar-accent/50 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Node ID</span>
                        <!-- Code block: bg-white -> bg-background -->
                        <code class="text-xs font-mono bg-background px-1.5 py-0.5 rounded border border-border text-muted-foreground select-all">
                            {selectedNode.id}
                        </code>
                    </div>
                    <button onclick={() => selectedNodeId = null} class="text-muted-foreground hover:text-foreground">
                        ×
                    </button>
                </div>

				<!-- TABS CONTAINER -->
				<div class="flex border-b border-sidebar-border p-2 gap-1 bg-sidebar">
					
					<!-- Config Tab -->
					<button 
						onclick={() => activeTab = 'config'}
						class={`
							px-3 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all border
							${activeTab === 'config' 
								? 'bg-background border-sidebar-border text-foreground shadow-sm' 
								: 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}
						`}
					>
						Configure
					</button>

					<!-- Secrets Tab -->
					<button 
						onclick={() => activeTab = 'secrets'}
						class={`
							px-3 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all border
							${activeTab === 'secrets' 
								? 'bg-background border-sidebar-border text-blue-600 shadow-sm' 
								: 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}
						`}
					>
						Secrets
					</button>
					
					<!-- Test/Debug Tab -->
					<button 
						onclick={() => activeTab = 'test'}
						class={`
							px-3 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all border
							${activeTab === 'test' 
								? 'bg-background border-sidebar-border text-purple-600 shadow-sm' 
								: 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}
						`}
					>
						Results
					</button>
				</div>

				<!-- 3. CONTENT AREA -->
				<div class="p-5 flex flex-col gap-6 overflow-y-auto grow bg-sidebar relative">
					
					<!-- VIEW: CONFIGURATION -->
					{#if activeTab === 'config'}

						{#if selectedNode.type === 'http-request'}
							<!-- HTTP NODE CONFIGURATION -->
							<div class="flex flex-col gap-2">
								<label for="url" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
									Target URL
								</label>
								<input
									id="url"
									type="text"
									value={selectedNode.data.url}
									oninput={(e) => updateNodeData('url', e.currentTarget.value)}
									class="border border-input bg-background p-2.5 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow font-mono text-foreground"
									placeholder="https://api.example.com"
								/>
							</div>

							<!-- Method Input -->
							<div class="flex flex-col gap-2">
								<label for="method" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
									HTTP Method
								</label>
								<select
									id="method"
									value={selectedNode.data.method}
									onchange={(e) => updateNodeData('method', e.currentTarget.value)}
									class="w-full border border-input bg-background p-2 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all text-foreground"
								>
									<option value="GET">GET</option>
									<option value="POST">POST</option>
									<option value="PUT">PUT</option>
									<option value="DELETE">DELETE</option>
									<option value="PATCH">PATCH</option>
								</select>
							</div>

							<!-- Headers Input -->
							<div class="flex flex-col gap-2">
								<div class="flex justify-between items-center">
									<span class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
										Headers
									</span>
									<button 
										onclick={() => {
											// Logic to add a temporary unique key
											const key = `New-Header-${Math.floor(Math.random() * 100)}`;
											updateHeaderValue(key, '');
										}}
										class="text-[10px] bg-accent hover:bg-accent-foreground text-accent-foreground px-2 py-1 rounded transition-colors"
									>
										+ Add
									</button>
								</div>
								
								{#if selectedNode.data.headers && Object.keys(selectedNode.data.headers).length > 0}
									<div class="flex flex-col gap-2 border border-sidebar-border rounded p-2 bg-sidebar-accent">
										{#each Object.entries(selectedNode.data.headers) as [key, value]}
											<div class="flex gap-1 items-center">
												<!-- Key Input -->
												<input 
													type="text" 
													value={key}
													onchange={(e) => updateHeaderKey(key, e.currentTarget.value)}
													class="w-1/3 text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
													placeholder="Key"
												/>
												<span class="text-slate-400">:</span>
												<!-- Value Input -->
												<input 
													type="text" 
													value={value}
													oninput={(e) => updateHeaderValue(key, e.currentTarget.value)}
													class="grow text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
													placeholder="Value"
												/>
												<!-- Remove Button -->
												<button 
													onclick={() => removeHeader(key)}
													class="text-slate-400 hover:text-red-500 px-1"
													title="Remove Header"
												>
													&times;
												</button>
											</div>
										{/each}
									</div>
								{:else}
									<div class="text-xs text-slate-400 italic p-2 border border-dashed border-slate-200 rounded">
										No headers configured.
									</div>
								{/if}
							</div>

							<!-- JSON Body -->
							<div class="flex flex-col gap-2 h-full">
								<div class="flex justify-between items-center">
									<label for="body" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
										JSON Body
									</label>
									<span class="text-[10px] text-muted-foreground bg-accent px-1 rounded">Optional</span>
								</div>
								<textarea
									id="body"
									value={typeof selectedNode.data.body === 'string' 
										? selectedNode.data.body 
										: (selectedNode.data.body ? JSON.stringify(selectedNode.data.body, null, 2) : '')}
									oninput={(e) => updateNodeData('body', e.currentTarget.value)}
									class="border border-slate-300 p-2 rounded-md text-xs font-mono grow min-h-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
									placeholder={'{"key": "{{node_1.body.value}}", "secret": "{{$env.API_KEY}}"}'}
								></textarea>
							</div>
						{/if}

						{#if selectedNode.type === 'code-execution'}
							<!-- Javascript Code Editor -->
							<div class="flex flex-col gap-2 h-64">
								<label for="code" class="text-xs font-bold uppercase text-slate-500 tracking-wider">JavaScript Code</label>
								<textarea
									id="code"
									value={selectedNode.data.code}
									oninput={(e) => updateNodeData('code', e.currentTarget.value)}
									class="border border-slate-300 bg-slate-900 text-green-400 p-3 rounded-md text-xs font-mono grow focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
									placeholder={'return { value: 123 };'}
									spellcheck="false"
								></textarea>
								<div class="text-[10px] text-slate-400">
									Available: <code class="bg-slate-100 px-1">INPUT</code> variable contains mapped data.
								</div>
							</div>
					
							<!-- Inputs Mapping -->
							<div class="flex flex-col gap-2">
								<label for="inputs" class="text-xs font-bold uppercase text-slate-500 tracking-wider">Input Mapping (JSON)</label>
								<textarea
									id="inputs"
									value={typeof selectedNode.data.inputs === 'string' ? selectedNode.data.inputs : JSON.stringify(selectedNode.data.inputs, null, 2)}
									oninput={(e) => updateNodeData('inputs', e.currentTarget.value)}
									class="border border-slate-300 p-2 rounded-md text-xs font-mono h-24 focus:outline-none focus:ring-2 focus:ring-purple-500"
									placeholder={'{"arg1": "{{node_1.body.value}}"}'}
								></textarea>
							</div>
						{/if}

					{/if}

					<!-- VIEW: SECRETS -->
					{#if activeTab === 'secrets'}
					<div class="flex flex-col gap-4">
						<div class="bg-blue-50 text-blue-800 p-3 rounded-md text-xs border border-blue-100">
							<strong>Secrets Vault</strong><br/>
							Store API keys securely here. They are encrypted in the database and never shown in the browser.
						</div>
						
						<!-- Add Secret Form -->
						<div class="flex flex-col gap-2 border-b pb-4 border-sidebar-border">
							<label for="secret-key" class="text-xs font-bold uppercase text-muted-foreground">Key Name</label>
							<input 
								id="secret-key" 
								type="text" 
								bind:value={secretKeyInput}
								placeholder="OPENAI_API_KEY" 
								class="border p-2 rounded text-xs font-mono uppercase" 
							/>
							
							<label for="secret-value" class="text-xs font-bold uppercase text-muted-foreground mt-2">Value</label>
							<input 
								id="secret-value" 
								type="password" 
								bind:value={secretValueInput}
								placeholder="sk-..." 
								class="border p-2 rounded text-xs" 
							/>
							
							<button 
								onclick={saveSecret}
								class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
							>
								Save Secret
							</button>
						</div>

						<!-- Available Secrets List -->
						<div class="flex flex-col gap-2">
							<span class="text-xs font-bold uppercase text-muted-foreground">Available Secrets</span>
							
							{#each availableSecrets as secret}
								<div class="flex items-center justify-between p-2 bg-sidebar-accent rounded border border-sidebar-border">
									<code class="text-xs font-mono text-foreground">$env.{secret.key}</code>
									<button 
										onclick={() => copyToClipboard(`{{$env.${secret.key}}}`)}
										class="text-[10px] bg-accent border border-border px-2 py-1 rounded hover:bg-accent-foreground text-accent-foreground"
									>
										Copy
									</button>
								</div>
							{:else}
								<div class="text-xs text-muted-foreground italic">No secrets saved yet.</div>
							{/each}
						</div>
					</div>
					{/if}

					<!-- VIEW: RESULTS -->
					{#if activeTab === 'test'}
						<div class="flex flex-col gap-3">
							<div class="flex justify-between items-center">
								<h3 class="text-xs font-bold uppercase text-slate-500 tracking-wider">
									Last Execution
								</h3>
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

							{#if selectedNode.data.result}
								<pre class="bg-slate-950 text-slate-50 dark:bg-black dark:text-green-400 p-3 rounded-md text-xs font-mono overflow-x-auto shadow-inner custom-scrollbar">{JSON.stringify(selectedNode.data.result, null, 2)}</pre>
							{:else}
								<div class="p-8 border border-dashed border-slate-200 rounded-md text-center flex flex-col items-center gap-2">
									<span class="text-2xl">🧪</span>
									<span class="text-xs text-slate-400">No results yet.<br/>Run the flow to see data here.</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- FIXED FOOTER -->
				<div class="p-4 border-t border-sidebar-border bg-sidebar-accent text-center">
					<div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
						{#if selectedNode.data.status === 'running'}
							<span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
							Running...
						{:else}
							<span class="w-2 h-2 rounded-full bg-green-500"></span>
							Auto-saved
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>