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
	import { saveFlow, loadLatestFlow, setFitViewCallback, publishFlow } from '$lib/services/flowPersistence';
	import { sseService } from '$lib/services/sseService';

	// Layout components
	import Navbar from '$lib/components/Navbar.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CanvasToolbar from '$lib/components/CanvasToolbar.svelte';
	import RunHistoryPanel from '$lib/components/RunHistoryPanel.svelte';
	import SchedulePanel from '$lib/components/SchedulePanel.svelte';
	import VersionHistoryPanel from '$lib/components/VersionHistoryPanel.svelte';

	// Node components for SvelteFlow
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';
	import DelayNodeComponent from '$lib/components/nodes/DelayNode.svelte';
	import WebhookWaitNodeComponent from '$lib/components/nodes/WebhookWaitNode.svelte';
	import RouterNodeComponent from '$lib/components/nodes/RouterNode.svelte';
	import LLMNodeComponent from '$lib/components/nodes/LLMNode.svelte';
	import SubFlowNodeComponent from '$lib/components/nodes/SubFlowNode.svelte';
	import MapNodeComponent from '$lib/components/nodes/MapNode.svelte';
	import FlowInit from '$lib/components/FlowInit.svelte';

	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent,
		'delay': DelayNodeComponent,
		'webhook-wait': WebhookWaitNodeComponent,
		'router': RouterNodeComponent,
		'llm': LLMNodeComponent,
		'subflow': SubFlowNodeComponent,
		'map': MapNodeComponent
	};

	// Local UI state
	let flowWrapper: HTMLDivElement | null = null;
	let sseStatus = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
	let historyPanelOpen = $state(false);
	let schedulePanelOpen = $state(false);
	let versionsPanelOpen = $state(false);
	let publishDialogOpen = $state(false);
	let publishChangeSummary = $state('');
	let versionRefreshTrigger = $state(0);

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

	function handleAddNode(type: 'http' | 'code' | 'delay' | 'webhook-wait' | 'router' | 'llm' | 'subflow' | 'map') {
		const position = getCanvasCenterPosition() ?? undefined;
		flowStore.addNode(type, position);
	}

	// =================================================
	// VERSIONING
	// =================================================

	function handleOpenPublishDialog() {
		publishChangeSummary = '';
		publishDialogOpen = true;
	}

	async function handlePublish() {
		if (!flowStore.workflowId) {
			alert('Please save the workflow first');
			return;
		}
		
		if (!publishChangeSummary.trim()) {
			alert('Please provide a change summary');
			return;
		}
		
		const result = await publishFlow(publishChangeSummary.trim());
		if (result) {
			publishDialogOpen = false;
			// Trigger version history refresh
			versionRefreshTrigger++;
		} else {
			alert('Failed to publish');
		}
	}

	async function handleRollback(versionNumber: number) {
		if (!flowStore.workflowId) return;
		
		try {
			const response = await fetch(`/api/flows/${flowStore.workflowId}/rollback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ versionNumber })
			});
			
			if (response.ok) {
				const data = await response.json();
				flowStore.setVersionInfo(data.activeVersionId, data.versionNumber);
			} else {
				const error = await response.json();
				alert(error.error || 'Failed to set active version');
			}
		} catch (e) {
			console.error('Rollback failed:', e);
			alert('Failed to set active version');
		}
	}

	async function handleRestoreDraft(versionNumber: number) {
		if (!flowStore.workflowId) return;
		
		try {
			const response = await fetch(`/api/flows/${flowStore.workflowId}/restore`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ versionNumber })
			});
			
			if (response.ok) {
				const data = await response.json();
				// Reload the flow with the restored graph
				const graph = data.graph as { nodes: any[]; edges: any[]; viewport?: any };
				flowStore.setFlow(
					graph.nodes || [],
					graph.edges || [],
					graph.viewport,
					flowStore.workflowId!,
					flowStore.workflowName!,
					flowStore.activeVersionId,
					flowStore.activeVersionNumber
				);
			} else {
				const error = await response.json();
				alert(error.error || 'Failed to restore draft');
			}
		} catch (e) {
			console.error('Restore draft failed:', e);
			alert('Failed to restore draft');
		}
	}

	async function handleDiscardDraft() {
		if (!flowStore.workflowId) return;
		
		try {
			const response = await fetch(`/api/flows/${flowStore.workflowId}/discard`, {
				method: 'POST'
			});
			
			if (response.ok) {
				const data = await response.json();
				// Reload the flow with the published graph
				const graph = data.graph as { nodes: any[]; edges: any[]; viewport?: any };
				flowStore.setFlow(
					graph.nodes || [],
					graph.edges || [],
					graph.viewport,
					flowStore.workflowId!,
					flowStore.workflowName!,
					flowStore.activeVersionId,
					flowStore.activeVersionNumber
				);
			} else {
				const error = await response.json();
				alert(error.error || 'Failed to discard draft');
			}
		} catch (e) {
			console.error('Discard draft failed:', e);
			alert('Failed to discard draft');
		}
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
			onAddSubFlowNode={() => handleAddNode('subflow')}
			onAddMapNode={() => handleAddNode('map')}
			onSave={saveFlow}
			onRun={runFlow}
			onOpenHistory={() => historyPanelOpen = true}
			onOpenSchedule={() => schedulePanelOpen = true}
			onOpenVersions={() => versionsPanelOpen = true}
			onPublish={handleOpenPublishDialog}
			scheduleEnabled={scheduleConfig.enabled}
			activeVersionNumber={flowStore.activeVersionNumber}
			hasUnpublishedChanges={flowStore.hasUnpublishedChanges}
		/>

		<!-- Main content area with toolbar and sidebar -->
		<div class="grow flex gap-3 overflow-hidden">
			<!-- Left: Canvas toolbar -->
			<CanvasToolbar />
			
			<!-- Spacer to push panels right -->
			<div class="grow"></div>
			
			<!-- Right side panels -->
			<div class="flex gap-3 h-full">
				<!-- Version History Panel -->
				<VersionHistoryPanel
					isOpen={versionsPanelOpen}
					onClose={() => versionsPanelOpen = false}
					workflowId={flowStore.workflowId}
					activeVersionId={flowStore.activeVersionId}
					hasUnpublishedChanges={flowStore.hasUnpublishedChanges}
					onRollback={handleRollback}
					onRestoreDraft={handleRestoreDraft}
					onDiscardDraft={handleDiscardDraft}
					refreshTrigger={versionRefreshTrigger}
				/>

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

	<!-- Publish Dialog -->
	{#if publishDialogOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div 
			class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 pointer-events-auto"
			onclick={() => publishDialogOpen = false}
			onkeydown={(e) => e.key === 'Escape' && (publishDialogOpen = false)}
		>
			<div 
				class="bg-panel border border-panel-border shadow-float w-[400px] max-w-[90vw]"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabindex="-1"
			>
				<div class="px-4 py-3 border-b border-panel-border">
					<h2 class="text-sm font-medium">Publish New Version</h2>
					<p class="text-xs text-muted-foreground mt-1">
						Create an immutable snapshot of the current workflow.
						{#if flowStore.activeVersionNumber}
							Current version: v{flowStore.activeVersionNumber}
						{:else}
							This will be version 1.
						{/if}
					</p>
				</div>
				
				<div class="px-4 py-3">
					<!-- svelte-ignore a11y_label_has_associated_control -->
					<label class="block text-xs font-medium mb-1.5">
						Change Summary <span class="text-red-500">*</span>
					</label>
					<textarea
						bind:value={publishChangeSummary}
						placeholder="What changed in this version? (required)"
						class="w-full h-20 px-2 py-1.5 text-xs bg-sidebar-accent/30 border border-sidebar-border rounded-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring {!publishChangeSummary.trim() ? 'border-red-500/50' : ''}"
					></textarea>
					{#if !publishChangeSummary.trim()}
						<p class="text-[10px] text-red-500 mt-1">Please describe what changed in this version</p>
					{/if}
				</div>
				
				<div class="px-4 py-3 border-t border-panel-border flex justify-end gap-2">
					<button
						onclick={() => publishDialogOpen = false}
						class="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
					>
						Cancel
					</button>
					<button
						onclick={handlePublish}
						disabled={!publishChangeSummary.trim()}
						class="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Publish v{(flowStore.activeVersionNumber ?? 0) + 1}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
