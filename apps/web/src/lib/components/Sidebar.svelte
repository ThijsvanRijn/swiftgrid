<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { autoSaveService } from '$lib/services/autoSaveService.svelte';
	import ConfigPanel from './sidebar/ConfigPanel.svelte';
	import SecretsPanel from './sidebar/SecretsPanel.svelte';
	import ResultsPanel from './sidebar/ResultsPanel.svelte';

	let activeTab = $state<'config' | 'secrets' | 'results'>('config');

	// Reset to config tab when a new node is selected
	$effect(() => {
		if (flowStore.selectedNode) {
			activeTab = 'config';
		}
	});
</script>

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

		<!-- Tabs -->
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
				onclick={() => activeTab = 'results'}
				class={`
					px-3 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all border
					${activeTab === 'results'
						? 'bg-background border-sidebar-border text-purple-600 shadow-sm'
						: 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}
				`}
			>
				Results
			</button>
		</div>

		<!-- Panel content -->
		<div class="p-5 flex flex-col gap-6 overflow-y-auto grow bg-sidebar relative">
			{#if activeTab === 'config'}
				<ConfigPanel />
			{/if}

			{#if activeTab === 'secrets'}
				<SecretsPanel />
			{/if}

			{#if activeTab === 'results'}
				<ResultsPanel />
			{/if}
		</div>

		<!-- Footer -->
		<div class="p-4 border-t border-sidebar-border bg-sidebar-accent text-center">
			<div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
				{#if flowStore.selectedNode.data.status === 'running'}
					<span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
					Running...
				{:else if autoSaveService.status === 'saving'}
					<span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
					Saving...
				{:else if autoSaveService.status === 'saved'}
					<span class="w-2 h-2 rounded-full bg-green-500"></span>
					Saved
				{:else if autoSaveService.status === 'error'}
					<span class="w-2 h-2 rounded-full bg-red-500"></span>
					Save failed
				{:else}
					<span class="w-2 h-2 rounded-full bg-slate-400"></span>
					Idle
				{/if}
			</div>
		</div>
	</div>
{/if}

