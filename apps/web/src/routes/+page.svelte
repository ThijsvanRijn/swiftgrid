<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type XYPosition
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';

	// Shared app + worker types so the UI matches the backend shapes.
	import type { AppNode } from '$lib/types/app';
	import type { ExecutionResult } from '$lib/types/worker';

	// Stores
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { themeStore } from '$lib/stores/themeStore.svelte';
	import { secretsStore } from '$lib/stores/secretsStore.svelte';

	// Services
	import { runFlow, handleExecutionResult } from '$lib/services/executionService';
	import { saveFlow, loadLatestFlow } from '$lib/services/flowPersistence';

	// Custom node components rendered inside SvelteFlow.
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';

	// Tell SvelteFlow which component goes with each node type.
	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent
	};

	// Local UI state
	let flowWrapper: HTMLDivElement | null = null;
	let activeTab = $state<'config' | 'secrets' | 'test'>('config');

	// Clicking a node should focus the config tab for quick edits.
	const onNodeClick = ({ node }: { node: AppNode }) => {
		flowStore.selectNode(node.id);
		activeTab = 'config';
	};

	const onPaneClick = () => {
		flowStore.selectNode(null);
	};

	// =================================================
	// LIFECYCLE
	// =================================================

	onMount(() => {
		themeStore.init();

		// Load data
		loadLatestFlow();
		secretsStore.load();

		// SSE: Stream node results from the Rust worker
		const eventSource = new EventSource('/api/stream');

		eventSource.onmessage = (event) => {
			const result: ExecutionResult = JSON.parse(event.data);
			const isSuccess = result.status_code >= 200 && result.status_code < 300;
			handleExecutionResult(result.node_id, isSuccess, result.body);
		};

		return () => eventSource.close();
	});

	// =================================================
	// CANVAS HELPERS
	// =================================================

	function screenPointToFlowPosition(point: { x: number; y: number }): XYPosition {
		if (!flowWrapper) {
			return { x: point.x, y: point.y };
		}

		const bounds = flowWrapper.getBoundingClientRect();
		return {
			x: (point.x - bounds.left - flowStore.viewport.x) / flowStore.viewport.zoom,
			y: (point.y - bounds.top - flowStore.viewport.y) / flowStore.viewport.zoom
		};
	}

	function getCanvasCenterPosition(): XYPosition | null {
		if (!flowWrapper) return null;

		const bounds = flowWrapper.getBoundingClientRect();
		const centerScreenPoint = {
			x: bounds.left + bounds.width / 2,
			y: bounds.top + bounds.height / 2
		};

		return screenPointToFlowPosition(centerScreenPoint);
	}

	function handleAddNode(type: 'http' | 'code') {
		const position = getCanvasCenterPosition() ?? undefined;
		flowStore.addNode(type, position);
	}

	// =================================================
	// HEADER HELPERS
	// =================================================

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		alert("Copied to clipboard");
	}

	function updateHeaderKey(oldKey: string, newKey: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		const value = headers[oldKey];
		delete headers[oldKey];
		headers[newKey] = value;
		flowStore.updateNodeData('headers', headers);
	}

	function updateHeaderValue(key: string, newValue: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		headers[key] = newValue;
		flowStore.updateNodeData('headers', headers);
	}

	function removeHeader(key: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		delete headers[key];
		flowStore.updateNodeData('headers', headers);
	}
</script>

<div class="h-screen w-full flex flex-col text-foreground font-sans bg-background">
	<!-- Top nav -->
	<div class="px-6 py-3 border-b border-border flex justify-between items-center bg-card z-10 shadow-xs">
		<div class="flex items-center gap-4">
			<h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
			<!-- Quick theme toggle -->
			<button
				onclick={themeStore.toggle}
				class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
			>
				{#if themeStore.isDark} 🌙 {:else} ☀️ {/if}
			</button>
		</div>
		<div class="flex gap-2">
			<button
				onclick={() => handleAddNode('http')}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				+ Add HTTP Node
			</button>
			<button
				onclick={() => handleAddNode('code')}
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
			<!-- Icon toggle -->
			<button
				onclick={themeStore.toggle}
				class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors border border-border bg-background text-foreground"
				title="Toggle Theme"
			>
				{#if themeStore.isDark}
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
				{/if}
			</button>
		</div>
	</div>

	<!-- Main layout -->
	<div class="grow flex overflow-hidden relative">

		<!-- Canvas -->
		<div class="grow h-full bg-background relative" bind:this={flowWrapper}>
			<SvelteFlow
				bind:nodes={flowStore.nodes}
				bind:edges={flowStore.edges}
				bind:viewport={flowStore.viewport}
				nodeTypes={nodeTypes}
				colorMode={themeStore.isDark ? 'dark' : 'light'}
				onnodeclick={onNodeClick}
				onpaneclick={onPaneClick}
				fitView
				class="bg-muted/20"
			>
				<Background patternColor={themeStore.isDark ? '#334155' : '#cbd5e1'} gap={20} />
				<Controls />
			</SvelteFlow>
		</div>

		<!-- Node sidebar -->
		{#if flowStore.selectedNode}
			<div class="w-96 border-l border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col shadow-xl z-20 h-full transition-all">

				<!-- Node header -->
				<div class="px-4 py-2 border-b border-sidebar-border bg-sidebar-accent/50 flex justify-between items-center">
					<div class="flex items-center gap-2">
						<span class="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Node ID</span>
						<code class="text-xs font-mono bg-background px-1.5 py-0.5 rounded border border-border text-muted-foreground select-all">
							{flowStore.selectedNode.id}
						</code>
					</div>
					<button onclick={() => flowStore.selectNode(null)} class="text-muted-foreground hover:text-foreground">
						×
					</button>
				</div>

				<!-- Sidebar tabs -->
				<div class="flex border-b border-sidebar-border p-2 gap-1 bg-sidebar">

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

				<!-- Sidebar content -->
				<div class="p-5 flex flex-col gap-6 overflow-y-auto grow bg-sidebar relative">

					<!-- Config view -->
					{#if activeTab === 'config'}

						{#if flowStore.selectedNode.type === 'http-request'}
							<!-- HTTP form -->
							<div class="flex flex-col gap-2">
								<label for="url" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
									Target URL
								</label>
								<input
									id="url"
									type="text"
									value={flowStore.selectedNode.data.url}
									oninput={(e) => flowStore.updateNodeData('url', e.currentTarget.value)}
									class="border border-input bg-background p-2.5 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow font-mono text-foreground"
									placeholder="https://api.example.com"
								/>
							</div>

							<div class="flex flex-col gap-2">
								<label for="method" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
									HTTP Method
								</label>
								<select
									id="method"
									value={flowStore.selectedNode.data.method}
									onchange={(e) => flowStore.updateNodeData('method', e.currentTarget.value)}
									class="w-full border border-input bg-background p-2 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all text-foreground"
								>
									<option value="GET">GET</option>
									<option value="POST">POST</option>
									<option value="PUT">PUT</option>
									<option value="DELETE">DELETE</option>
									<option value="PATCH">PATCH</option>
								</select>
							</div>

							<!-- Headers list -->
							<div class="flex flex-col gap-2">
								<div class="flex justify-between items-center">
									<span class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
										Headers
									</span>
									<button
										onclick={() => {
											const key = `New-Header-${Math.floor(Math.random() * 100)}`;
											updateHeaderValue(key, '');
										}}
										class="text-[10px] bg-accent hover:bg-accent-foreground text-accent-foreground px-2 py-1 rounded transition-colors"
									>
										+ Add
									</button>
								</div>

								{#if flowStore.selectedNode.data.headers && Object.keys(flowStore.selectedNode.data.headers).length > 0}
									<div class="flex flex-col gap-2 border border-sidebar-border rounded p-2 bg-sidebar-accent">
										{#each Object.entries(flowStore.selectedNode.data.headers) as [key, value]}
											<div class="flex gap-1 items-center">
												<input
													type="text"
													value={key}
													onchange={(e) => updateHeaderKey(key, e.currentTarget.value)}
													class="w-1/3 text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
													placeholder="Key"
												/>
												<span class="text-slate-400">:</span>
												<input
													type="text"
													value={value}
													oninput={(e) => updateHeaderValue(key, e.currentTarget.value)}
													class="grow text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
													placeholder="Value"
												/>
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

							<!-- JSON body -->
							<div class="flex flex-col gap-2 h-full">
								<div class="flex justify-between items-center">
									<label for="body" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
										JSON Body
									</label>
									<span class="text-[10px] text-muted-foreground bg-accent px-1 rounded">Optional</span>
								</div>
								<textarea
									id="body"
									value={typeof flowStore.selectedNode.data.body === 'string'
										? flowStore.selectedNode.data.body
										: (flowStore.selectedNode.data.body ? JSON.stringify(flowStore.selectedNode.data.body, null, 2) : '')}
									oninput={(e) => flowStore.updateNodeData('body', e.currentTarget.value)}
									class="border border-slate-300 p-2 rounded-md text-xs font-mono grow min-h-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
									placeholder={'{"key": "{{node_1.body.value}}", "secret": "{{$env.API_KEY}}"}'}
								></textarea>
							</div>
						{/if}

						{#if flowStore.selectedNode.type === 'code-execution'}
							<!-- Code node editor -->
							<div class="flex flex-col gap-2 h-64">
								<label for="code" class="text-xs font-bold uppercase text-slate-500 tracking-wider">JavaScript Code</label>
								<textarea
									id="code"
									value={flowStore.selectedNode.data.code}
									oninput={(e) => flowStore.updateNodeData('code', e.currentTarget.value)}
									class="border border-slate-300 bg-slate-900 text-green-400 p-3 rounded-md text-xs font-mono grow focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
									placeholder={'return { value: 123 };'}
									spellcheck="false"
								></textarea>
								<div class="text-[10px] text-slate-400">
									Available: <code class="bg-slate-100 px-1">INPUT</code> variable contains mapped data.
								</div>
							</div>

							<!-- Inputs mapping -->
							<div class="flex flex-col gap-2">
								<label for="inputs" class="text-xs font-bold uppercase text-slate-500 tracking-wider">Input Mapping (JSON)</label>
								<textarea
									id="inputs"
									value={typeof flowStore.selectedNode.data.inputs === 'string' ? flowStore.selectedNode.data.inputs : JSON.stringify(flowStore.selectedNode.data.inputs, null, 2)}
									oninput={(e) => flowStore.updateNodeData('inputs', e.currentTarget.value)}
									class="border border-slate-300 p-2 rounded-md text-xs font-mono h-24 focus:outline-none focus:ring-2 focus:ring-purple-500"
									placeholder={'{"arg1": "{{node_1.body.value}}"}'}
								></textarea>
							</div>
						{/if}

					{/if}

					<!-- Secrets view -->
					{#if activeTab === 'secrets'}
					<div class="flex flex-col gap-4">
						<div class="bg-blue-50 text-blue-800 p-3 rounded-md text-xs border border-blue-100">
							<strong>Secrets Vault</strong><br/>
							Store API keys securely here. They are encrypted in the database and never shown in the browser.
						</div>

						<!-- Secret form -->
						<div class="flex flex-col gap-2 border-b pb-4 border-sidebar-border">
							<label for="secret-key" class="text-xs font-bold uppercase text-muted-foreground">Key Name</label>
							<input
								id="secret-key"
								type="text"
								bind:value={secretsStore.keyInput}
								placeholder="OPENAI_API_KEY"
								class="border p-2 rounded text-xs font-mono uppercase"
							/>

							<label for="secret-value" class="text-xs font-bold uppercase text-muted-foreground mt-2">Value</label>
							<input
								id="secret-value"
								type="password"
								bind:value={secretsStore.valueInput}
								placeholder="sk-..."
								class="border p-2 rounded text-xs"
							/>

							<button
								onclick={secretsStore.save}
								class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
							>
								Save Secret
							</button>
						</div>

						<!-- Saved secrets -->
						<div class="flex flex-col gap-2">
							<span class="text-xs font-bold uppercase text-muted-foreground">Available Secrets</span>

							{#each secretsStore.secrets as secret}
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

					<!-- Results view -->
					{#if activeTab === 'test'}
						<div class="flex flex-col gap-3">
							<div class="flex justify-between items-center">
								<h3 class="text-xs font-bold uppercase text-slate-500 tracking-wider">
									Last Execution
								</h3>
								{#if flowStore.selectedNode.data.status}
									<span class={
										`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide
										${flowStore.selectedNode.data.status === 'success' ? 'bg-green-100 text-green-700' : ''}
										${flowStore.selectedNode.data.status === 'error' ? 'bg-red-100 text-red-700' : ''}
										${flowStore.selectedNode.data.status === 'running' ? 'bg-blue-100 text-blue-700' : ''}
									`}>
										{flowStore.selectedNode.data.status}
									</span>
								{/if}
							</div>

							{#if flowStore.selectedNode.data.result}
								<pre class="bg-slate-950 text-slate-50 dark:bg-black dark:text-green-400 p-3 rounded-md text-xs font-mono overflow-x-auto shadow-inner custom-scrollbar">{JSON.stringify(flowStore.selectedNode.data.result, null, 2)}</pre>
							{:else}
								<div class="p-8 border border-dashed border-slate-200 rounded-md text-center flex flex-col items-center gap-2">
									<span class="text-2xl">🧪</span>
									<span class="text-xs text-slate-400">No results yet.<br/>Run the flow to see data here.</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Sticky footer -->
				<div class="p-4 border-t border-sidebar-border bg-sidebar-accent text-center">
					<div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
						{#if flowStore.selectedNode.data.status === 'running'}
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
