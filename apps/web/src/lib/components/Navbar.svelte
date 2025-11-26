<script lang="ts">
	import { themeStore } from '$lib/stores/themeStore.svelte';

	type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

	interface Props {
		sseStatus: ConnectionStatus;
		onAddHttpNode: () => void;
		onAddCodeNode: () => void;
		onAddDelayNode: () => void;
		onAddWebhookWaitNode: () => void;
		onSave: () => void;
		onRun: () => void;
		onOpenHistory: () => void;
	}

	let { sseStatus, onAddHttpNode, onAddCodeNode, onAddDelayNode, onAddWebhookWaitNode, onSave, onRun, onOpenHistory }: Props = $props();
</script>

<div class="bg-panel border border-panel-border rounded-none shadow-float pointer-events-auto px-4 py-2 flex items-center justify-between">
	<!-- Left: Logo -->
	<div class="flex items-center gap-3">
		<h1 class="font-semibold text-base tracking-tight">SwiftGrid</h1>
		
		<!-- Connection status -->
		<div class="flex items-center gap-1.5" title={
			sseStatus === 'connected' ? 'Receiving results from worker' :
			sseStatus === 'connecting' ? 'Connecting to stream...' : 'Connection lost'
		}>
			<span class={`w-1.5 h-1.5 rounded-full ${
				sseStatus === 'connected' ? 'bg-emerald-500' :
				sseStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500 animate-pulse'
			}`}></span>
			<span class="text-xs text-muted-foreground">
				{sseStatus === 'connected' ? 'Live' : sseStatus === 'connecting' ? 'Connecting...' : 'Offline'}
			</span>
		</div>
	</div>

	<!-- Right: Actions -->
	<div class="flex items-center gap-2">
		<!-- Add node buttons -->
		<button
			onclick={onAddHttpNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ HTTP
		</button>
		<button
			onclick={onAddCodeNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Code
		</button>
		<button
			onclick={onAddDelayNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Delay
		</button>
		<button
			onclick={onAddWebhookWaitNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Webhook
		</button>

		<div class="w-px h-5 bg-border mx-1"></div>

		<!-- History button -->
		<button
			onclick={onOpenHistory}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors flex items-center gap-1.5"
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 8v4l3 3"/>
				<circle cx="12" cy="12" r="10"/>
			</svg>
			History
		</button>

		<!-- Save button -->
		<button
			id="saveBtn"
			onclick={onSave}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			Save
		</button>

		<!-- Run button -->
		<button
			onclick={onRun}
			class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-none text-xs font-medium transition-colors"
		>
			Run Flow
		</button>

		<div class="w-px h-5 bg-border mx-1"></div>

		<!-- Theme toggle -->
		<button
			onclick={themeStore.toggle}
			class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
			title="Toggle Theme"
		>
			{#if themeStore.isDark}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
			{/if}
		</button>
	</div>
</div>

