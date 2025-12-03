<script lang="ts">
	import { consoleStore } from '$lib/stores/consoleStore.svelte';
	
	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
			e.preventDefault();
			consoleStore.togglePanel();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Bottom bar - only shows when panel is collapsed -->
{#if !consoleStore.isPanelOpen}
	<div 
		class="h-8 flex items-center px-2 gap-1 pointer-events-auto font-mono text-[11px] leading-none"
		style="background: var(--tui-bg); border-top: 1px solid var(--tui-border);"
	>
		<!-- Expand button with arrow + ⌘J together (matches expanded state) -->
		<button
			onclick={() => consoleStore.togglePanel()}
			class="h-6 px-2 flex items-center gap-1.5 transition-colors leading-none"
			style="color: var(--tui-text-dim);"
			title="Expand panel (⌘J)"
		>
			<span class="text-[10px]">▲</span>
			<span class="opacity-60">⌘J</span>
		</button>
		
		<div class="w-px h-4 mx-1" style="background: var(--tui-border);"></div>
		
		<span class="uppercase tracking-wide" style="color: var(--tui-text-dim);">Console</span>
	</div>
{/if}
