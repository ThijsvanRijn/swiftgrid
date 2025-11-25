<script lang="ts">
	import { themeStore } from '$lib/stores/themeStore.svelte';

	type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

	interface Props {
		sseStatus: ConnectionStatus;
		onAddHttpNode: () => void;
		onAddCodeNode: () => void;
		onSave: () => void;
		onRun: () => void;
	}

	let { sseStatus, onAddHttpNode, onAddCodeNode, onSave, onRun }: Props = $props();
</script>

<div class="px-6 py-3 border-b border-border flex justify-between items-center bg-card z-10 shadow-xs">
	<div class="flex items-center gap-4">
		<h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
		<!-- Connection status -->
		<div class="flex items-center gap-1.5 text-xs text-muted-foreground" title={
			sseStatus === 'connected' ? 'Receiving results from worker' :
			sseStatus === 'connecting' ? 'Connecting to stream...' : 'Connection lost'
		}>
			<span class={`w-2 h-2 rounded-full ${
				sseStatus === 'connected' ? 'bg-green-500' :
				sseStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 animate-pulse'
			}`}></span>
			{sseStatus === 'connected' ? 'Live' : sseStatus === 'connecting' ? 'Connecting...' : 'Offline'}
		</div>
	</div>
	<div class="flex gap-2">
		<button
			onclick={onAddHttpNode}
			class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
		>
			+ Add HTTP Node
		</button>
		<button
			onclick={onAddCodeNode}
			class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
		>
			+ Add Code Node
		</button>
		<button
			id="saveBtn"
			onclick={onSave}
			class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
		>
			Save
		</button>
		<button
			onclick={onRun}
			class="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-colors"
		>
			Run Flow
		</button>
		<!-- Theme toggle -->
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

