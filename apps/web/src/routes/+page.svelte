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
	import { saveFlow, loadLatestFlow, setFitViewCallback } from '$lib/services/flowPersistence';
	import { sseService } from '$lib/services/sseService';

	// Layout components
	import Navbar from '$lib/components/Navbar.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CanvasToolbar from '$lib/components/CanvasToolbar.svelte';
	import RunHistoryPanel from '$lib/components/RunHistoryPanel.svelte';
	import SchedulePanel from '$lib/components/SchedulePanel.svelte';

	// Node components for SvelteFlow
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';
	import DelayNodeComponent from '$lib/components/nodes/DelayNode.svelte';
	import WebhookWaitNodeComponent from '$lib/components/nodes/WebhookWaitNode.svelte';
	import RouterNodeComponent from '$lib/components/nodes/RouterNode.svelte';
	import LLMNodeComponent from '$lib/components/nodes/LLMNode.svelte';
	import FlowInit from '$lib/components/FlowInit.svelte';

	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent,
		'delay': DelayNodeComponent,
		'webhook-wait': WebhookWaitNodeComponent,
		'router': RouterNodeComponent,
		'llm': LLMNodeComponent
	};

	// Local UI state
	let flowWrapper: HTMLDivElement | null = null;
	let sseStatus = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
	let historyPanelOpen = $state(false);
	let schedulePanelOpen = $state(false);

	// Schedule configuration (loaded from flowStore)
	let scheduleConfig = $state({
		enabled: false,
		cron: '0 9 * * 1-5',
		timezone: 'UTC',
		inputData: '{}',
		overlapMode: 'skip' as 'skip' | 'queue_one' | 'parallel',
		nextRun: undefined as string | undefined
	});

	function handleViewRun(runId: string) {
		// TODO: Navigate to run detail view
		console.log('View run:', runId);
		historyPanelOpen = false;
	}

	async function handleSaveSchedule(newSchedule: { enabled: boolean; cron: string; timezone: string; inputData: string; overlapMode: 'skip' | 'queue_one' | 'parallel'; nextRun?: string }) {
		scheduleConfig = { ...newSchedule, nextRun: newSchedule.nextRun };
		
		// Save to backend
		try {
			const response = await fetch('/api/flows/schedule', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					workflowId: flowStore.workflowId,
					enabled: newSchedule.enabled,
					cron: newSchedule.cron,
					timezone: newSchedule.timezone,
					inputData: newSchedule.inputData,
					overlapMode: newSchedule.overlapMode
				})
			});
			
			if (response.ok) {
				const data = await response.json();
				if (data.nextRun) {
					scheduleConfig.nextRun = data.nextRun;
				}
			}
		} catch (error) {
			console.error('Failed to save schedule:', error);
		}
	}

	async function loadSchedule() {
		if (!flowStore.workflowId) return;
		
		try {
			const response = await fetch(`/api/flows/schedule?workflowId=${flowStore.workflowId}`);
			if (response.ok) {
				const data = await response.json();
				scheduleConfig = {
					enabled: data.enabled ?? false,
					cron: data.cron ?? '0 9 * * 1-5',
					timezone: data.timezone ?? 'UTC',
					inputData: data.inputData ?? '{}',
					overlapMode: data.overlapMode ?? 'skip',
					nextRun: data.nextRun
				};
			}
		} catch (error) {
			console.error('Failed to load schedule:', error);
		}
	}

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
		loadLatestFlow().then(() => loadSchedule());
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

	function handleAddNode(type: 'http' | 'code' | 'delay' | 'webhook-wait' | 'router' | 'llm') {
		const position = getCanvasCenterPosition() ?? undefined;
		flowStore.addNode(type, position);
	}
</script>

<div class="h-screen w-full flex flex-col text-foreground font-sans bg-canvas">
	<!-- Flow canvas as base layer -->
	<div class="absolute inset-0" bind:this={flowWrapper}>
		<SvelteFlow
			bind:nodes={flowStore.nodes}
			bind:edges={flowStore.edges}
			bind:viewport={flowStore.viewport}
			nodeTypes={nodeTypes}
			colorMode={themeStore.isDark ? 'dark' : 'light'}
			onnodeclick={onNodeClick}
			onpaneclick={onPaneClick}
			class="bg-canvas"
		>
			<FlowInit />
			<Background patternColor="var(--pattern-dots)" gap={16} size={1.5} />
			<Controls class="bg-panel! border-panel-border! rounded-none! shadow-float! m-3!" />
		</SvelteFlow>
	</div>

	<!-- Floating UI layer -->
	<div class="absolute inset-0 pointer-events-none p-3 flex flex-col gap-3">
		<!-- Top navbar -->
		<Navbar
			{sseStatus}
			onAddHttpNode={() => handleAddNode('http')}
			onAddCodeNode={() => handleAddNode('code')}
			onAddDelayNode={() => handleAddNode('delay')}
			onAddWebhookWaitNode={() => handleAddNode('webhook-wait')}
			onAddRouterNode={() => handleAddNode('router')}
			onAddLlmNode={() => handleAddNode('llm')}
			onSave={saveFlow}
			onRun={runFlow}
			onOpenHistory={() => historyPanelOpen = true}
			onOpenSchedule={() => schedulePanelOpen = true}
			scheduleEnabled={scheduleConfig.enabled}
		/>

		<!-- Main content area with toolbar and sidebar -->
		<div class="grow flex gap-3 overflow-hidden">
			<!-- Left: Canvas toolbar -->
			<CanvasToolbar />
			
			<!-- Spacer to push panels right -->
			<div class="grow"></div>
			
			<!-- Right side panels -->
			<div class="flex gap-3 h-full">
				<!-- Schedule Panel -->
				<SchedulePanel
					isOpen={schedulePanelOpen}
					onClose={() => schedulePanelOpen = false}
					schedule={scheduleConfig}
					onSave={handleSaveSchedule}
					workflowId={flowStore.workflowId}
					workflowName={flowStore.workflowName}
				/>

				<!-- Run History Panel -->
				<RunHistoryPanel 
					isOpen={historyPanelOpen}
					onClose={() => historyPanelOpen = false}
					onViewRun={handleViewRun}
					workflowId={flowStore.workflowId}
					workflowName={flowStore.workflowName}
				/>

				<!-- Node Config Sidebar (shows when node selected) -->
				<Sidebar />
			</div>
		</div>
	</div>
</div>
