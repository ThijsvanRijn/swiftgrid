<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
</script>

{#if flowStore.selectedNode}
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

