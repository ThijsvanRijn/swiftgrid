<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type XYPosition
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';

	// Shared app types
	import type { AppNode } from '$lib/types/app';

	// Stores
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { themeStore } from '$lib/stores/themeStore.svelte';
	import { secretsStore } from '$lib/stores/secretsStore.svelte';

	// Services
	import { runFlow } from '$lib/services/executionService';
	import { saveFlow, loadLatestFlow } from '$lib/services/flowPersistence';
	import { sseService } from '$lib/services/sseService';

	// Layout components
	import Navbar from '$lib/components/Navbar.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';

	// Node components for SvelteFlow
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';

	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent
	};

	// Local UI state
	let flowWrapper: HTMLDivElement | null = null;
	let sseStatus = $state<'connecting' | 'connected' | 'disconnected'>('connecting');

	// =================================================
	// EVENT HANDLERS
	// =================================================

	const onNodeClick = ({ node }: { node: AppNode }) => {
		flowStore.selectNode(node.id);
	};

	const onPaneClick = () => {
		flowStore.selectNode(null);
	};

	// =================================================
	// LIFECYCLE
	// =================================================

	onMount(() => {
		themeStore.init();
		loadLatestFlow();
		secretsStore.load();

		sseService.setStatusCallback((status) => {
			sseStatus = status;
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
	<Navbar
		{sseStatus}
		onAddHttpNode={() => handleAddNode('http')}
		onAddCodeNode={() => handleAddNode('code')}
		onSave={saveFlow}
		onRun={runFlow}
	/>

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

		<Sidebar />
	</div>
</div>
