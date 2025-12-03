<script lang="ts">
	import type { AppNode } from '$lib/types/app';
	
	interface Props {
		selectedNode: AppNode | undefined;
	}
	
	let { selectedNode }: Props = $props();
	
	type ViewMode = 'split' | 'output';
	let viewMode = $state<ViewMode>('split');
	let copyState = $state<'idle' | 'copied'>('idle');
	
	// Output data
	const outputData = $derived(selectedNode?.data?.result?.body);
	
	// Extract input info based on node type
	const inputInfo = $derived(() => {
		if (!selectedNode) return null;
		const { type, data } = selectedNode;
		
		switch (type) {
			case 'code-execution':
				return {
					inputLabel: 'INPUT',
					outputLabel: 'OUTPUT',
					data: data.inputs || {}
				};
			case 'http-request':
				return {
					inputLabel: 'REQUEST',
					outputLabel: 'RESPONSE',
					data: {
						method: data.method || 'GET',
						url: data.url || '(not configured)',
						headers: data.headers || {},
						body: data.body || null
					}
				};
			case 'map':
				return {
					inputLabel: 'CONFIG',
					outputLabel: 'RESULTS',
					data: {
						inputArray: data.mapInputArray || '{{prev}}',
						concurrency: data.mapConcurrency || 5,
						workflow: data.mapWorkflowName || '(not selected)',
						failFast: data.mapFailFast || false
					}
				};
			case 'llm':
				return {
					inputLabel: 'PROMPT',
					outputLabel: 'COMPLETION',
					data: {
						model: data.model || 'gpt-4',
						systemPrompt: data.systemPrompt || '(none)',
						userPrompt: data.userPrompt || '(none)',
						temperature: data.temperature ?? 1
					}
				};
			case 'delay':
				return {
					inputLabel: 'CONFIG',
					outputLabel: 'OUTPUT',
					data: {
						delay: data.delayStr || `${data.delayMs}ms`
					}
				};
			case 'router':
				return {
					inputLabel: 'ROUTING',
					outputLabel: 'MATCHED',
					data: {
						routeBy: data.routeBy || '{{prev}}',
						mode: data.routerMode || 'first_match',
						conditions: data.conditions || []
					}
				};
			case 'subflow':
				return {
					inputLabel: 'SUBFLOW IN',
					outputLabel: 'SUBFLOW OUT',
					data: {
						workflow: data.subflowName || '(not selected)',
						input: data.subflowInput || '{{prev}}'
					}
				};
			default:
				return {
					inputLabel: 'INPUT',
					outputLabel: 'OUTPUT',
					data: {}
				};
		}
	});
	
	// Check if output has table-able data
	const hasMapResults = $derived(outputData?.results && Array.isArray(outputData.results));
	const mapStats = $derived(outputData?.stats);
	
	function formatJson(data: any): string {
		return JSON.stringify(data, null, 2);
	}
	
	function copyToClipboard() {
		if (outputData) {
			navigator.clipboard.writeText(JSON.stringify(outputData, null, 2));
			copyState = 'copied';
			setTimeout(() => {
				copyState = 'idle';
			}, 2000);
		}
	}
	
	// Get status color
	function getStatusStyle(status: string): { bg: string; color: string } {
		switch (status) {
			case 'success': return { bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981' };
			case 'error': return { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' };
			case 'running': return { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' };
			case 'suspended': return { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' };
			default: return { bg: 'var(--tui-accent)', color: 'var(--tui-text-dim)' };
		}
	}
</script>

<div class="h-full flex flex-col text-[11px]">
	{#if !selectedNode}
		<!-- No node selected -->
		<div class="flex-1 flex items-center justify-center" style="color: var(--tui-text-dim);">
			<div class="text-center">
				<div class="text-lg mb-2">▸</div>
				<p>Select a node to view output</p>
			</div>
		</div>
	{:else if !selectedNode.data.result}
		<!-- Node selected but no result yet -->
		<div class="flex-1 flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between px-3 py-1.5" style="border-bottom: 1px solid var(--tui-border);">
				<div class="flex items-center gap-2">
					<span class="font-bold">{selectedNode.data.label || selectedNode.type}</span>
					<span class="px-1" style="background: var(--tui-accent); color: var(--tui-text-dim);">
						{selectedNode.data.status || 'idle'}
					</span>
				</div>
			</div>
			
			<!-- Split view even without result - show input config -->
			<div class="flex-1 flex overflow-hidden">
				<!-- Input side -->
				<div class="w-1/2 flex flex-col" style="border-right: 1px solid var(--tui-border);">
					<div class="px-3 py-1" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
						<span style="color: var(--tui-text-dim);">{inputInfo()?.inputLabel || 'INPUT'}</span>
					</div>
					<div class="flex-1 overflow-auto">
						<pre class="p-3 whitespace-pre-wrap break-all" style="color: var(--tui-text-dim);">{formatJson(inputInfo()?.data || {})}</pre>
					</div>
				</div>
				
				<!-- Output side (placeholder) -->
				<div class="w-1/2 flex flex-col">
					<div class="px-3 py-1" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
						<span style="color: var(--tui-text-dim);">OUTPUT</span>
					</div>
					<div class="flex-1 flex items-center justify-center" style="color: var(--tui-text-dim);">
						<div class="text-center">
							<div class="mb-2 opacity-40">○</div>
							<p class="text-[10px]">Run workflow</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Node with result -->
		{@const statusStyle = getStatusStyle(selectedNode.data.status || 'idle')}
		<div class="flex-1 flex flex-col overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between px-3 py-1.5 shrink-0" style="border-bottom: 1px solid var(--tui-border);">
				<div class="flex items-center gap-2">
					<span class="font-bold">{selectedNode.data.label || selectedNode.type}</span>
					<span class="px-1" style="background: {statusStyle.bg}; color: {statusStyle.color};">
						{selectedNode.data.status}
					</span>
					
					<!-- Map stats -->
					{#if mapStats}
						<span style="color: var(--tui-text-dim);">
							{mapStats.completed}/{mapStats.total}
							{#if mapStats.failed > 0}
								<span style="color: #ef4444;">({mapStats.failed} err)</span>
							{/if}
						</span>
					{/if}
				</div>
				
				<div class="flex items-center gap-2">
					<!-- View mode toggle -->
					<div class="flex" style="background: var(--tui-accent);">
						<button
							onclick={() => viewMode = 'split'}
							class="px-2 py-0.5 transition-colors"
							style="background: {viewMode === 'split' ? 'var(--tui-border-bright)' : 'transparent'}; color: {viewMode === 'split' ? 'var(--tui-text)' : 'var(--tui-text-dim)'};"
						>
							SPLIT
						</button>
						<button
							onclick={() => viewMode = 'output'}
							class="px-2 py-0.5 transition-colors"
							style="background: {viewMode === 'output' ? 'var(--tui-border-bright)' : 'transparent'}; color: {viewMode === 'output' ? 'var(--tui-text)' : 'var(--tui-text-dim)'};"
						>
							OUTPUT
						</button>
					</div>
					
					<button
						onclick={copyToClipboard}
						class="px-2 py-0.5 transition-colors"
						style="background: {copyState === 'copied' ? 'rgba(16, 185, 129, 0.15)' : 'var(--tui-accent)'}; color: {copyState === 'copied' ? '#10b981' : 'var(--tui-text-dim)'};"
					>
						{copyState === 'copied' ? 'COPIED' : 'COPY'}
					</button>
				</div>
			</div>
			
			<!-- Content -->
			{#if viewMode === 'split'}
				<!-- Split view -->
				<div class="flex-1 flex overflow-hidden">
					<!-- Input side -->
					<div class="w-1/2 flex flex-col min-w-0" style="border-right: 1px solid var(--tui-border);">
						<div class="px-3 py-1 shrink-0" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
							<span style="color: var(--tui-text-dim);">{inputInfo()?.inputLabel || 'INPUT'}</span>
						</div>
						<div class="flex-1 overflow-auto">
							<pre class="p-3 whitespace-pre-wrap break-all">{formatJson(inputInfo()?.data || {})}</pre>
						</div>
					</div>
					
					<!-- Output side -->
					<div class="w-1/2 flex flex-col min-w-0">
						<div class="px-3 py-1 shrink-0" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
							<span style="color: var(--tui-text-dim);">{inputInfo()?.outputLabel || 'OUTPUT'}</span>
						</div>
						<div class="flex-1 overflow-auto">
							{#if hasMapResults && mapStats}
								<!-- Map results - STATS FIRST -->
								<div class="p-3 space-y-3">
									<!-- Stats Grid - Always visible at top -->
									<div class="grid grid-cols-4 gap-2 p-2" style="background: var(--tui-bg-elevated); border: 1px solid var(--tui-border);">
										<div class="text-center">
											<div class="text-lg font-bold" style="color: #10b981;">{mapStats.items_per_sec || Math.round(mapStats.completed / (mapStats.duration_secs || 1))}</div>
											<div class="text-[9px]" style="color: var(--tui-text-dim);">ITEMS/SEC</div>
										</div>
										<div class="text-center">
											<div class="text-lg font-bold">{mapStats.duration_secs?.toFixed(1) || '—'}s</div>
											<div class="text-[9px]" style="color: var(--tui-text-dim);">DURATION</div>
										</div>
										<div class="text-center">
											<div class="text-lg font-bold">{mapStats.avg_latency_ms || '—'}ms</div>
											<div class="text-[9px]" style="color: var(--tui-text-dim);">AVG LATENCY</div>
										</div>
										<div class="text-center">
											<div class="text-lg font-bold">{mapStats.concurrency_used || '—'}</div>
											<div class="text-[9px]" style="color: var(--tui-text-dim);">CONCURRENCY</div>
										</div>
									</div>
									
									<!-- Progress bar -->
									<div class="space-y-1">
										<div class="flex justify-between text-[10px]" style="color: var(--tui-text-dim);">
											<span>{mapStats.completed}/{mapStats.total} completed</span>
											{#if mapStats.failed > 0}
												<span style="color: #ef4444;">{mapStats.failed} failed</span>
											{/if}
										</div>
										<div class="h-1 overflow-hidden" style="background: var(--tui-accent);">
											<div 
												class="h-full transition-all"
												style="width: {(mapStats.completed / mapStats.total) * 100}%; background: #10b981;"
											></div>
										</div>
									</div>
									
									<!-- Results preview (first 3 only) -->
									<div>
										<div class="text-[10px] mb-1" style="color: var(--tui-text-dim);">
											RESULTS PREVIEW ({outputData.results.length} total)
										</div>
										<pre class="whitespace-pre-wrap break-all text-[10px] max-h-[150px] overflow-auto p-2" style="background: var(--tui-bg-elevated);">{formatJson(outputData.results.slice(0, 3))}</pre>
										{#if outputData.results.length > 3}
											<div class="text-[10px] mt-1" style="color: var(--tui-text-dim);">
												... +{outputData.results.length - 3} more (switch to OUTPUT view for full data)
											</div>
										{/if}
									</div>
								</div>
							{:else}
								<pre class="p-3 whitespace-pre-wrap break-all">{formatJson(outputData)}</pre>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<!-- Full output view -->
				<div class="flex-1 overflow-auto">
					<pre class="p-3 whitespace-pre-wrap break-all">{formatJson(outputData)}</pre>
				</div>
			{/if}
		</div>
	{/if}
</div>
