<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type XYPosition
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';

	// Shared app + worker types so the UI matches the backend shapes.
	import type { AppNode } from '$lib/types/app';

	// Stores
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { themeStore } from '$lib/stores/themeStore.svelte';
	import { secretsStore } from '$lib/stores/secretsStore.svelte';

	// Services
	import { runFlow } from '$lib/services/executionService';
	import { saveFlow, loadLatestFlow } from '$lib/services/flowPersistence';
	import { sseService } from '$lib/services/sseService';

	// Custom node components rendered inside SvelteFlow.
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';

	// Sidebar panels
	import ConfigPanel from '$lib/components/sidebar/ConfigPanel.svelte';
	import SecretsPanel from '$lib/components/sidebar/SecretsPanel.svelte';
	import ResultsPanel from '$lib/components/sidebar/ResultsPanel.svelte';

	// Tell SvelteFlow which component goes with each node type.
	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent
	};

	// Local UI state
	let flowWrapper: HTMLDivElement | null = null;
	let activeTab = $state<'config' | 'secrets' | 'test'>('config');
	let sseConnected = $state(false);

	// Clicking a node should focus the config tab for quick edits.
	const onNodeClick = ({ node }: { node: AppNode }) => {
		flowStore.selectNode(node.id);
		activeTab = 'config';
	};

	const onPaneClick = () => {
		flowStore.selectNode(null);
	};

	// =================================================
	// LIFECYCLE
	// =================================================

	onMount(() => {
		themeStore.init();

		// Load data
		loadLatestFlow();
		secretsStore.load();

		// SSE: Connect with auto-reconnect
		sseService.setConnectionCallback((connected) => {
			sseConnected = connected;
		});
		sseService.connect();

		return () => sseService.disconnect();
	});

	// =================================================
	// CANVAS HELPERS
	// =================================================

	function screenPointToFlowPosition(point: { x: number; y: number }): XYPosition {
		if (!flowWrapper) {
			return { x: point.x, y: point.y };
		}

		const bounds = flowWrapper.getBoundingClientRect();
		return {
			x: (point.x - bounds.left - flowStore.viewport.x) / flowStore.viewport.zoom,
			y: (point.y - bounds.top - flowStore.viewport.y) / flowStore.viewport.zoom
		};
	}

	function getCanvasCenterPosition(): XYPosition | null {
		if (!flowWrapper) return null;

		const bounds = flowWrapper.getBoundingClientRect();
		const centerScreenPoint = {
			x: bounds.left + bounds.width / 2,
			y: bounds.top + bounds.height / 2
		};

		return screenPointToFlowPosition(centerScreenPoint);
	}

	function handleAddNode(type: 'http' | 'code') {
		const position = getCanvasCenterPosition() ?? undefined;
		flowStore.addNode(type, position);
	}

</script>

<div class="h-screen w-full flex flex-col text-foreground font-sans bg-background">
	<!-- Top nav -->
	<div class="px-6 py-3 border-b border-border flex justify-between items-center bg-card z-10 shadow-xs">
		<div class="flex items-center gap-4">
			<h1 class="font-bold text-xl tracking-tight">SwiftGrid</h1>
			<!-- Connection status -->
			<div class="flex items-center gap-1.5 text-xs text-muted-foreground" title={sseConnected ? 'Connected to worker' : 'Disconnected'}>
				<span class={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></span>
				{sseConnected ? 'Live' : 'Offline'}
			</div>
			<!-- Quick theme toggle -->
			<button
				onclick={themeStore.toggle}
				class="p-2 rounded-md hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors"
			>
				{#if themeStore.isDark} 🌙 {:else} ☀️ {/if}
			</button>
		</div>
		<div class="flex gap-2">
			<button
				onclick={() => handleAddNode('http')}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				+ Add HTTP Node
			</button>
			<button
				onclick={() => handleAddNode('code')}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				+ Add Code Node
			</button>
			<button
				id="saveBtn"
				onclick={saveFlow}
				class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
			>
				Save
			</button>
			<button
				onclick={runFlow}
				class="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 font-medium text-sm transition-colors"
			>
				Run Flow
			</button>
			<!-- Icon toggle -->
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

	<!-- Main layout -->
	<div class="grow flex overflow-hidden relative">

		<!-- Canvas -->
		<div class="grow h-full bg-background relative" bind:this={flowWrapper}>
			<SvelteFlow
				bind:nodes={flowStore.nodes}
				bind:edges={flowStore.edges}
				bind:viewport={flowStore.viewport}
				nodeTypes={nodeTypes}
				colorMode={themeStore.isDark ? 'dark' : 'light'}
				onnodeclick={onNodeClick}
				onpaneclick={onPaneClick}
				fitView
				class="bg-muted/20"
			>
				<Background patternColor={themeStore.isDark ? '#334155' : '#cbd5e1'} gap={20} />
				<Controls />
			</SvelteFlow>
		</div>

		<!-- Node sidebar -->
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

				<!-- Sidebar tabs -->
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
						onclick={() => activeTab = 'test'}
						class={`
							px-3 py-2 text-xs font-bold uppercase tracking-wide rounded-md transition-all border
							${activeTab === 'test'
								? 'bg-background border-sidebar-border text-purple-600 shadow-sm'
								: 'border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'}
						`}
					>
						Results
					</button>
				</div>

				<!-- Sidebar content -->
				<div class="p-5 flex flex-col gap-6 overflow-y-auto grow bg-sidebar relative">
					{#if activeTab === 'config'}
						<ConfigPanel />
					{/if}

					{#if activeTab === 'secrets'}
						<SecretsPanel />
					{/if}

					{#if activeTab === 'test'}
						<ResultsPanel />
					{/if}
				</div>

				<!-- Sticky footer -->
				<div class="p-4 border-t border-sidebar-border bg-sidebar-accent text-center">
					<div class="flex items-center justify-center gap-2 text-xs text-muted-foreground">
						{#if flowStore.selectedNode.data.status === 'running'}
							<span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
							Running...
						{:else}
							<span class="w-2 h-2 rounded-full bg-green-500"></span>
							Auto-saved
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
