<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	
	// Get nodes sorted by a heuristic order (topological if possible, or by position)
	const sortedNodes = $derived(() => {
		const nodes = flowStore.nodes;
		const edges = flowStore.edges;
		
		// Build adjacency for simple topological hint
		const inDegree = new Map<string, number>();
		const outgoing = new Map<string, string[]>();
		
		nodes.forEach(n => {
			inDegree.set(n.id, 0);
			outgoing.set(n.id, []);
		});
		
		edges.forEach(e => {
			inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
			const out = outgoing.get(e.source) || [];
			out.push(e.target);
			outgoing.set(e.source, out);
		});
		
		// Simple topological sort (Kahn's algorithm)
		const result: typeof nodes = [];
		const queue = nodes.filter(n => (inDegree.get(n.id) || 0) === 0);
		const visited = new Set<string>();
		
		while (queue.length > 0) {
			const node = queue.shift()!;
			if (visited.has(node.id)) continue;
			visited.add(node.id);
			result.push(node);
			
			(outgoing.get(node.id) || []).forEach(targetId => {
				inDegree.set(targetId, (inDegree.get(targetId) || 1) - 1);
				if (inDegree.get(targetId) === 0) {
					const targetNode = nodes.find(n => n.id === targetId);
					if (targetNode) queue.push(targetNode);
				}
			});
		}
		
		// Add any remaining nodes (disconnected)
		nodes.forEach(n => {
			if (!visited.has(n.id)) result.push(n);
		});
		
		return result;
	});
	
	// Count stats
	const stats = $derived(() => {
		const nodes = flowStore.nodes;
		return {
			total: nodes.length,
			completed: nodes.filter(n => n.data.status === 'success').length,
			failed: nodes.filter(n => n.data.status === 'error').length,
			running: nodes.filter(n => n.data.status === 'running').length,
			suspended: nodes.filter(n => n.data.status === 'suspended').length,
			pending: nodes.filter(n => n.data.status === 'idle').length,
		};
	});
	
	// Get node type badge
	function getNodeBadge(type: string): { text: string; color: string } {
		switch (type) {
			case 'http-request': return { text: 'HTTP', color: '#3b82f6' };
			case 'code-execution': return { text: 'JS', color: '#f59e0b' };
			case 'delay': return { text: 'WAIT', color: '#8b5cf6' };
			case 'router': return { text: 'RTR', color: '#06b6d4' };
			case 'llm': return { text: 'LLM', color: '#ec4899' };
			case 'subflow': return { text: 'SUB', color: '#10b981' };
			case 'map': return { text: 'MAP', color: '#f97316' };
			case 'webhook-wait': return { text: 'HOOK', color: '#a855f7' };
			default: return { text: '???', color: 'var(--tui-text-dim)' };
		}
	}
	
	// Get status indicator
	function getStatusIndicator(status: string): { symbol: string; color: string } {
		switch (status) {
			case 'success': return { symbol: '●', color: '#10b981' };
			case 'error': return { symbol: '●', color: '#ef4444' };
			case 'running': return { symbol: '◐', color: '#3b82f6' };
			case 'suspended': return { symbol: '◑', color: '#f59e0b' };
			case 'cancelled': return { symbol: '○', color: '#71717a' };
			default: return { symbol: '○', color: 'var(--tui-text-dim)' };
		}
	}
</script>

<div class="h-full flex flex-col text-[11px]">
	{#if flowStore.nodes.length === 0}
		<!-- No nodes -->
		<div class="flex-1 flex items-center justify-center" style="color: var(--tui-text-dim);">
			<div class="text-center">
				<div class="text-lg mb-2">│</div>
				<p>Add nodes to see timeline</p>
			</div>
		</div>
	{:else}
		<!-- Stats header -->
		<div class="px-3 py-2 flex items-center gap-4 shrink-0" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
			<div class="flex items-center gap-1">
				<span style="color: #10b981;">●</span>
				<span style="color: var(--tui-text-dim);">{stats().completed}</span>
			</div>
			{#if stats().running > 0}
				<div class="flex items-center gap-1">
					<span class="animate-pulse" style="color: #3b82f6;">◐</span>
					<span style="color: #3b82f6;">{stats().running}</span>
				</div>
			{/if}
			{#if stats().suspended > 0}
				<div class="flex items-center gap-1">
					<span style="color: #f59e0b;">◑</span>
					<span style="color: #f59e0b;">{stats().suspended}</span>
				</div>
			{/if}
			{#if stats().failed > 0}
				<div class="flex items-center gap-1">
					<span style="color: #ef4444;">●</span>
					<span style="color: #ef4444;">{stats().failed}</span>
				</div>
			{/if}
			<div class="flex-1"></div>
			<span style="color: var(--tui-text-dim);">
				{stats().completed + stats().failed}/{stats().total}
			</span>
		</div>
		
		<!-- Timeline list -->
		<div class="flex-1 overflow-auto">
			{#each sortedNodes() as node, index}
				{@const isLast = index === sortedNodes().length - 1}
				{@const status = getStatusIndicator(node.data.status || 'idle')}
				{@const badge = getNodeBadge(node.type || '')}
				<div 
					class="px-3 py-1.5 flex items-start gap-3"
					style="border-bottom: 1px solid var(--tui-border);"
				>
					<!-- Status indicator + line -->
					<div class="flex flex-col items-center w-4 pt-0.5">
						<span class="{node.data.status === 'running' ? 'animate-pulse' : ''}" style="color: {status.color};">{status.symbol}</span>
						{#if !isLast}
							<div class="w-px flex-1 min-h-[16px] mt-1" style="background: var(--tui-border);"></div>
						{/if}
					</div>
					
					<!-- Node info -->
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<!-- Node type badge -->
							<span class="px-1 text-[9px] font-bold" style="color: {badge.color}; background: {badge.color}15;">
								{badge.text}
							</span>
							
							<!-- Node name -->
							<span class="truncate font-medium">
								{node.data.label || node.id}
							</span>
							
							<!-- Status text -->
							<span style="color: {status.color};">
								{node.data.status || 'idle'}
							</span>
						</div>
						
						<!-- Map progress -->
						{#if node.type === 'map' && node.data.mapTotalCount}
							{@const completed = node.data.status === 'success' ? node.data.mapTotalCount : (node.data.mapCompletedCount || 0)}
							{@const pct = (completed / node.data.mapTotalCount) * 100}
							{@const mapStats = node.data.result?.body?.stats}
							<div class="mt-1 flex items-center gap-2">
								<div class="flex-1 h-1 max-w-[100px] overflow-hidden" style="background: var(--tui-accent);">
									<div 
										class="h-full transition-all"
										style="width: {pct}%; background: #10b981;"
									></div>
								</div>
								<span style="color: var(--tui-text-dim);">
									{completed}/{node.data.mapTotalCount}
								</span>
								<!-- Show throughput when complete -->
								{#if mapStats && node.data.status === 'success'}
									<span style="color: #10b981;" class="font-bold">{mapStats.items_per_sec}/s</span>
									<span style="color: var(--tui-text-dim);">{mapStats.duration_secs?.toFixed(1)}s</span>
								{/if}
							</div>
						{/if}
						
						<!-- Error message -->
						{#if node.data.status === 'error' && node.data.result?.body?.error}
							<p class="mt-1 truncate" style="color: #ef4444;">
								{node.data.result.body.error}
							</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
