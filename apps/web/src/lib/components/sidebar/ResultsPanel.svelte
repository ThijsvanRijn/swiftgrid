<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { sseService, type StreamChunk } from '$lib/services/sseService';
	import { runFlow, executeNode, runFromNode, getStartingNodes } from '$lib/services/executionService';
	import { onMount, onDestroy } from 'svelte';

	// Streaming output state - keyed by node ID so we can show history
	let chunksByNode = $state<Map<string, StreamChunk[]>>(new Map());
	let streamingNodeId = $state<string | null>(null);
	let isRunning = $state(false);

	// Get chunks for the currently selected node
	let currentChunks = $derived(
		flowStore.selectedNode ? (chunksByNode.get(flowStore.selectedNode.id) ?? []) : []
	);
	let isStreaming = $derived(
		flowStore.selectedNode?.id === streamingNodeId
	);

	// Check if selected node is a starting node
	let isStartingNode = $derived(() => {
		if (!flowStore.selectedNode) return false;
		return getStartingNodes().includes(flowStore.selectedNode.id);
	});

	// Run the entire flow from the beginning
	async function handleRunFlow() {
		if (isRunning) return;
		isRunning = true;
		
		// Clear all previous chunks when starting a new run
		chunksByNode = new Map();
		
		try {
			await runFlow();
		} finally {
			isRunning = false;
		}
	}

	// Run from this node (this node + all downstream)
	async function handleRunFromHere() {
		if (!flowStore.selectedNode || isRunning) return;
		isRunning = true;
		
		// Clear chunks for this node and downstream
		chunksByNode = new Map();
		
		try {
			await runFromNode(flowStore.selectedNode.id);
		} finally {
			isRunning = false;
		}
	}

	// Run ONLY this node (isolated, no downstream)
	async function handleRunNodeIsolated() {
		if (!flowStore.selectedNode || isRunning) return;
		isRunning = true;
		
		// Clear chunks for this node
		chunksByNode.delete(flowStore.selectedNode.id);
		chunksByNode = new Map(chunksByNode);
		
		try {
			await executeNode(flowStore.selectedNode.id, true); // isolated = true
		} finally {
			isRunning = false;
		}
	}

	// Subscribe to chunk events
	onMount(() => {
		sseService.setChunkCallback((chunk) => {
			// Store chunks by node ID (so we keep history)
			const existing = chunksByNode.get(chunk.node_id) ?? [];
			
			// If this is the first chunk for this node, clear old chunks
			if (chunk.chunk_index === 0) {
				chunksByNode.set(chunk.node_id, [chunk]);
			} else {
				chunksByNode.set(chunk.node_id, [...existing, chunk]);
			}
			
			// Update streaming state
			if (chunk.chunk_type === 'complete') {
				streamingNodeId = null;
			} else {
				streamingNodeId = chunk.node_id;
			}
			
			// Force reactivity
			chunksByNode = new Map(chunksByNode);
			
			// Auto-scroll if viewing this node
			if (flowStore.selectedNode?.id === chunk.node_id) {
				setTimeout(() => {
					const el = document.getElementById('streaming-output');
					if (el) el.scrollTop = el.scrollHeight;
				}, 10);
			}
		});
	});

	onDestroy(() => {
		sseService.setChunkCallback(null);
	});
</script>

{#if flowStore.selectedNode}
	<div class="p-4 flex flex-col gap-4">
		<!-- Run controls -->
		<div class="flex flex-col gap-2">
			<!-- Primary action: depends on whether this is a starting node -->
			{#if isStartingNode()}
				<!-- Starting node: Run entire flow -->
				<button 
					onclick={handleRunFlow}
					disabled={isRunning}
					class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white px-3 py-2.5 rounded-none text-xs font-medium transition-colors flex items-center justify-center gap-2"
				>
					{#if isRunning}
						<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
						</svg>
						Running...
					{:else}
						<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="5 3 19 12 5 21 5 3"/>
						</svg>
						Run Flow
					{/if}
				</button>
			{:else}
				<!-- Non-starting node: Run from here -->
				<button 
					onclick={handleRunFromHere}
					disabled={isRunning}
					class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white px-3 py-2.5 rounded-none text-xs font-medium transition-colors flex items-center justify-center gap-2"
				>
					{#if isRunning}
						<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
						</svg>
						Running...
					{:else}
						<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="5 3 19 12 5 21 5 3"/>
						</svg>
						Run From Here
					{/if}
				</button>
			{/if}
			
			<!-- Secondary actions -->
			<div class="flex gap-2">
				<button 
					onclick={handleRunNodeIsolated}
					disabled={isRunning}
					class="flex-1 bg-sidebar-accent hover:bg-sidebar-accent/80 disabled:opacity-50 text-foreground px-3 py-2 rounded-none text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
					title="Run only this node without triggering downstream nodes"
				>
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<rect x="3" y="3" width="18" height="18" rx="2"/>
						<polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/>
					</svg>
					Test Node
				</button>
				<button 
					class="flex-1 bg-sidebar-accent/50 hover:bg-sidebar-accent text-muted-foreground hover:text-foreground px-3 py-2 rounded-none text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
					title="Coming soon: Load results from previous runs"
				>
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10"/>
						<polyline points="12 6 12 12 16 14"/>
					</svg>
					History
				</button>
			</div>
		</div>

		<!-- Results section -->
		<div class="flex flex-col gap-3">
			<h3 class="text-[11px] font-semibold text-foreground">
				Results
			</h3>

			<!-- Status indicator -->
			{#if flowStore.selectedNode.data.status}
				<div class="flex items-center gap-2 px-3 py-2 rounded-none {
					flowStore.selectedNode.data.status === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20' :
					flowStore.selectedNode.data.status === 'error' ? 'bg-red-500/10 border border-red-500/20' :
					flowStore.selectedNode.data.status === 'running' ? 'bg-blue-500/10 border border-blue-500/20' : 'bg-sidebar-accent'
				}">
					<span class="w-2 h-2 rounded-full {
						flowStore.selectedNode.data.status === 'success' ? 'bg-emerald-500' :
						flowStore.selectedNode.data.status === 'error' ? 'bg-red-500' :
						flowStore.selectedNode.data.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground'
					}"></span>
					<span class="text-xs font-medium {
						flowStore.selectedNode.data.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
						flowStore.selectedNode.data.status === 'error' ? 'text-red-600 dark:text-red-400' :
						flowStore.selectedNode.data.status === 'running' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
					}">
						{flowStore.selectedNode.data.status === 'success' ? 'Completed successfully' :
						 flowStore.selectedNode.data.status === 'error' ? 'Failed with error' :
						 flowStore.selectedNode.data.status === 'running' ? 'Running...' : flowStore.selectedNode.data.status}
					</span>
				</div>
			{/if}

			<!-- Streaming output (shows during and after execution) -->
			{#if currentChunks.length > 0}
				<div class="flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<span class="text-[10px] font-medium text-muted-foreground">Live Output</span>
						{#if isStreaming}
							<span class="flex items-center gap-1 text-[10px] text-blue-500">
								<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
								Streaming
							</span>
						{:else}
							<span class="text-[10px] text-muted-foreground/50">
								{currentChunks.length} events
							</span>
						{/if}
					</div>
					<div 
						id="streaming-output"
						class="bg-[#0d1117] p-2 rounded-none text-[10px] font-mono max-h-[120px] overflow-y-auto border border-input"
					>
						{#each currentChunks as chunk}
							<div class="flex items-start gap-2 py-0.5 {
								chunk.chunk_type === 'error' ? 'text-red-400' :
								chunk.chunk_type === 'progress' ? 'text-blue-400' :
								chunk.chunk_type === 'complete' ? 'text-emerald-400' : 'text-gray-400'
							}">
								<span class="text-muted-foreground/50 select-none w-4 text-right shrink-0">{chunk.chunk_index}</span>
								<span class="break-all">
									{#if chunk.chunk_type === 'progress' && isStreaming && chunk === currentChunks[currentChunks.length - 1]}
										<svg class="w-3 h-3 inline mr-1 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
										</svg>
									{/if}
									{chunk.content || (chunk.chunk_type === 'complete' ? '✓ Done' : '')}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if flowStore.selectedNode.data.result}
				{@const result = flowStore.selectedNode.data.result}
				{@const body = result?.body}
				{@const mapStats = body?.stats}
				{@const hasMapResults = body?.results && Array.isArray(body.results)}
				
				{#if hasMapResults && mapStats}
					<!-- Map node: Show stats prominently first -->
					<div class="bg-sidebar-accent/50 border border-input p-3 space-y-3">
						<!-- Stats Grid -->
						<div class="grid grid-cols-2 gap-3">
							<div class="bg-sidebar-accent p-2 text-center">
								<div class="text-xl font-bold text-emerald-500">{mapStats.items_per_sec || '—'}</div>
								<div class="text-[10px] text-muted-foreground">ITEMS/SEC</div>
							</div>
							<div class="bg-sidebar-accent p-2 text-center">
								<div class="text-xl font-bold text-foreground">{mapStats.duration_secs?.toFixed(1) || '—'}s</div>
								<div class="text-[10px] text-muted-foreground">DURATION</div>
							</div>
							<div class="bg-sidebar-accent p-2 text-center">
								<div class="text-xl font-bold text-foreground">{mapStats.avg_latency_ms || '—'}ms</div>
								<div class="text-[10px] text-muted-foreground">AVG LATENCY</div>
							</div>
							<div class="bg-sidebar-accent p-2 text-center">
								<div class="text-xl font-bold text-foreground">{mapStats.concurrency_used || '—'}</div>
								<div class="text-[10px] text-muted-foreground">CONCURRENCY</div>
							</div>
						</div>
						
						<!-- Progress summary -->
						<div class="flex items-center justify-between text-xs">
							<span class="text-emerald-500">{mapStats.completed} completed</span>
							{#if mapStats.failed > 0}
								<span class="text-red-500">{mapStats.failed} failed</span>
							{/if}
							<span class="text-muted-foreground">{mapStats.total} total</span>
						</div>
						
						<!-- Suggestion -->
						{#if mapStats.suggested_concurrency && mapStats.suggested_concurrency > mapStats.concurrency_used}
							<div class="bg-amber-500/10 border border-amber-500/20 p-2 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
								<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
								Try concurrency {mapStats.suggested_concurrency} for better throughput
							</div>
						{/if}
					</div>
					
					<!-- Results preview -->
					<div class="text-[10px] text-muted-foreground mt-2">
						Results Preview (first 3 of {body.results.length})
					</div>
					<pre class="bg-[#0d1117] text-emerald-400 p-3 rounded-none text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">{JSON.stringify(body.results.slice(0, 3), null, 2)}</pre>
				{:else}
					<!-- Regular result display -->
					<pre class="bg-[#0d1117] text-emerald-400 p-3 rounded-none text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto">{JSON.stringify(result, null, 2)}</pre>
				{/if}
			{:else if !isStreaming && currentChunks.length === 0}
				<div class="py-8 px-4 border border-dashed border-input rounded-none text-center flex flex-col items-center gap-2">
					<div class="w-10 h-10 rounded-full bg-sidebar-accent flex items-center justify-center">
						<svg class="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
							<polyline points="14,2 14,8 20,8"/>
						</svg>
					</div>
					<span class="text-xs text-muted-foreground">Run the step to see results</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

