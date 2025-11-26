<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { sseService, type StreamChunk } from '$lib/services/sseService';
	import { onMount, onDestroy } from 'svelte';

	// Streaming output state - keyed by node ID so we can show history
	let chunksByNode = $state<Map<string, StreamChunk[]>>(new Map());
	let streamingNodeId = $state<string | null>(null);

	// Get chunks for the currently selected node
	let currentChunks = $derived(
		flowStore.selectedNode ? (chunksByNode.get(flowStore.selectedNode.id) ?? []) : []
	);
	let isStreaming = $derived(
		flowStore.selectedNode?.id === streamingNodeId
	);

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
		<div class="flex gap-2">
			<button class="flex-1 bg-sidebar-accent hover:bg-sidebar-accent/80 text-foreground px-3 py-2 rounded-none text-xs font-medium transition-colors">
				Run Flow
			</button>
			<button class="flex-1 bg-sidebar-accent/50 hover:bg-sidebar-accent text-muted-foreground hover:text-foreground px-3 py-2 rounded-none text-xs font-medium transition-colors">
				Load Previous Run
			</button>
		</div>

		<!-- Options collapsible -->
		<div class="border border-input rounded-none overflow-hidden">
			<button class="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-foreground hover:bg-sidebar-accent/30 transition-colors">
				<span>Options</span>
				<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="m9 18 6-6-6-6"/>
				</svg>
			</button>
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
				<pre class="bg-[#0d1117] text-emerald-400 p-3 rounded-none text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto">{JSON.stringify(flowStore.selectedNode.data.result, null, 2)}</pre>
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

