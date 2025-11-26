<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
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

			{#if flowStore.selectedNode.data.result}
				<pre class="bg-[#0d1117] text-emerald-400 p-3 rounded-none text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto">{JSON.stringify(flowStore.selectedNode.data.result, null, 2)}</pre>
			{:else}
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

