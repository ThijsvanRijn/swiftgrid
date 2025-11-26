<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { autoSaveService } from '$lib/services/autoSaveService.svelte';
	import ConfigPanel from './sidebar/ConfigPanel.svelte';
	import SecretsPanel from './sidebar/SecretsPanel.svelte';
	import ResultsPanel from './sidebar/ResultsPanel.svelte';

	let activeTab = $state<'config' | 'connections' | 'test'>('config');
	let lastSelectedNodeId = $state<string | null>(null);

	// Reset to config tab only when selecting a DIFFERENT node
	$effect(() => {
		const currentNodeId = flowStore.selectedNode?.id ?? null;
		if (currentNodeId && currentNodeId !== lastSelectedNodeId) {
			lastSelectedNodeId = currentNodeId;
			activeTab = 'config';
		} else if (!currentNodeId) {
			lastSelectedNodeId = null;
		}
	});
</script>

{#if flowStore.selectedNode}
	<div class="w-[500px] bg-panel border border-panel-border rounded-none text-sidebar-foreground flex flex-col shadow-float pointer-events-auto h-full overflow-hidden">

		<!-- Tabs header -->
		<div class="flex items-center gap-1 px-3 py-2.5 border-b border-sidebar-border">
			<button
				onclick={() => activeTab = 'config'}
				class={`
					flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none transition-all
					${activeTab === 'config'
						? 'bg-sidebar-accent text-foreground'
						: 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}
				`}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
					<circle cx="12" cy="12" r="3"/>
				</svg>
				Configure
			</button>

			<button
				onclick={() => activeTab = 'connections'}
				class={`
					flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none transition-all
					${activeTab === 'connections'
						? 'bg-sidebar-accent text-foreground'
						: 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}
				`}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
					<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
				</svg>
				Connections
			</button>

			<button
				onclick={() => activeTab = 'test'}
				class={`
					flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none transition-all
					${activeTab === 'test'
						? 'bg-sidebar-accent text-foreground'
						: 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}
				`}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
					<circle cx="9" cy="7" r="4"/>
					<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
					<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
				</svg>
				Test
			</button>
		</div>

		<!-- Panel content -->
		<div class="flex-1 overflow-y-auto">
			{#if activeTab === 'config'}
				<ConfigPanel />
			{/if}

			{#if activeTab === 'connections'}
				<SecretsPanel />
			{/if}

			{#if activeTab === 'test'}
				<ResultsPanel />
			{/if}
		</div>

		<!-- Footer status -->
		<div class="px-4 py-2.5 border-t border-sidebar-border bg-sidebar-accent/30">
			<div class="flex items-center justify-between text-[11px] text-muted-foreground">
				<div class="flex items-center gap-1.5">
					{#if flowStore.selectedNode.data.status === 'running'}
						<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
						<span>Running...</span>
					{:else if autoSaveService.status === 'saving'}
						<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
						<span>Saving...</span>
					{:else if autoSaveService.status === 'saved'}
						<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
						<span>Saved</span>
					{:else if autoSaveService.status === 'error'}
						<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
						<span>Save failed</span>
					{:else}
						<span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"></span>
						<span>Ready</span>
					{/if}
				</div>
				<code class="font-mono text-[10px] text-muted-foreground/70">
					{flowStore.selectedNode.id}
				</code>
			</div>
		</div>
	</div>
{/if}

