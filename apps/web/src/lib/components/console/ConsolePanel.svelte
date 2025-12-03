<script lang="ts">
	import { consoleStore, type ConsoleTab } from '$lib/stores/consoleStore.svelte';
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import OutputTab from './tabs/OutputTab.svelte';
	import TimelineTab from './tabs/TimelineTab.svelte';
	import WorkersTab from './tabs/WorkersTab.svelte';
	
	let startY = 0;
	let startHeight = 0;
	
	function handleMouseDown(e: MouseEvent) {
		e.preventDefault();
		startY = e.clientY;
		startHeight = consoleStore.panelHeight;
		consoleStore.startResize();
		
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}
	
	function handleMouseMove(e: MouseEvent) {
		const delta = startY - e.clientY;
		consoleStore.setHeight(startHeight + delta);
	}
	
	function handleMouseUp() {
		consoleStore.stopResize();
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	}
	
	const tabs: { id: ConsoleTab; label: string }[] = [
		{ id: 'output', label: 'Output' },
		{ id: 'timeline', label: 'Timeline' },
		{ id: 'workers', label: 'Workers' },
	];
</script>

<div 
	class="flex flex-col overflow-hidden font-mono"
	style="height: {consoleStore.panelHeight}px; background: var(--tui-bg);"
>
	<!-- Resize handle -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div 
		class="h-px cursor-ns-resize transition-colors shrink-0"
		style="background: {consoleStore.isResizing ? 'var(--tui-border-bright)' : 'var(--tui-border)'};"
		onmousedown={handleMouseDown}
		role="separator"
		aria-orientation="horizontal"
	></div>
	
	<!-- Top bar: Collapse + ⌘J | Tabs -->
	<div 
		class="h-8 flex items-center px-2 gap-1 shrink-0 text-[11px] leading-none"
		style="border-bottom: 1px solid var(--tui-border);"
	>
		<!-- Collapse button + keyboard hint (always together) -->
		<button
			onclick={() => consoleStore.togglePanel()}
			class="h-6 px-2 flex items-center gap-1.5 transition-colors leading-none"
			style="color: var(--tui-text-dim);"
			title="Collapse panel (⌘J)"
		>
			<span class="text-[10px]">▼</span>
			<span class="opacity-60">⌘J</span>
		</button>
		
		<div class="w-px h-4 mx-1" style="background: var(--tui-border);"></div>
		
		<!-- Tabs -->
		{#each tabs as tab}
			{@const isActive = consoleStore.activeTab === tab.id}
			<button
				onclick={() => consoleStore.setTab(tab.id)}
				class="h-6 px-3 flex items-center transition-colors uppercase tracking-wide"
				style="color: {isActive ? 'var(--tui-text)' : 'var(--tui-text-dim)'}; background: {isActive ? 'var(--tui-accent)' : 'transparent'};"
			>
				<span class="translate-y-[1px]">{tab.label}</span>
			</button>
		{/each}
	</div>
	
	<!-- Tab content -->
	<div class="flex-1 overflow-hidden" style="color: var(--tui-text);">
		{#if consoleStore.activeTab === 'output'}
			<OutputTab selectedNode={flowStore.selectedNode} />
		{:else if consoleStore.activeTab === 'timeline'}
			<TimelineTab />
		{:else if consoleStore.activeTab === 'workers'}
			<WorkersTab />
		{/if}
	</div>
	
	<!-- Bottom bar (for future features + fullscreen) -->
	<div 
		class="h-6 flex items-center px-2 shrink-0 text-[10px]"
		style="border-top: 1px solid var(--tui-border); background: var(--tui-bg-elevated);"
	>
		<!-- Future: status info, search, etc. -->
		<div class="flex-1"></div>
		
		<!-- Reset height -->
		<button
			onclick={() => consoleStore.resetHeight()}
			class="h-5 px-2 flex items-center transition-colors"
			style="color: var(--tui-text-dim);"
			title="Reset height"
		>
			Reset
		</button>
	</div>
</div>
