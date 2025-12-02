<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { onMount } from 'svelte';

	interface WorkflowOption {
		id: number;
		name: string;
		activeVersionId: string | null;
		activeVersionNumber: number | null;
		versions: Array<{
			id: string;
			versionNumber: number;
			changeSummary: string | null;
			createdAt: string;
		}>;
	}

	let workflows = $state<WorkflowOption[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showVersionDropdown = $state(false);

	// Load available workflows
	async function loadWorkflows() {
		try {
			loading = true;
			const res = await fetch('/api/workflows');
			if (!res.ok) throw new Error('Failed to load workflows');
			const data = await res.json();
			// Filter out current workflow to prevent self-reference
			workflows = (data.workflows || []).filter((w: WorkflowOption) => w.id !== flowStore.workflowId);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadWorkflows();
	});

	// Get selected workflow details
	$effect(() => {
		const selectedId = flowStore.selectedNode?.data.mapWorkflowId;
		if (selectedId && workflows.length > 0) {
			const workflow = workflows.find(w => w.id === selectedId);
			if (workflow && !flowStore.selectedNode?.data.mapWorkflowName) {
				// Auto-populate name if not set
				flowStore.updateNodeData('mapWorkflowName', workflow.name);
			}
		}
	});

	function selectWorkflow(workflow: WorkflowOption) {
		flowStore.updateNodeData('mapWorkflowId', workflow.id);
		flowStore.updateNodeData('mapWorkflowName', workflow.name);
		// Default to active version
		if (workflow.activeVersionId) {
			flowStore.updateNodeData('mapVersionId', workflow.activeVersionId);
			flowStore.updateNodeData('mapVersionNumber', workflow.activeVersionNumber);
		} else {
			flowStore.updateNodeData('mapVersionId', null);
			flowStore.updateNodeData('mapVersionNumber', null);
		}
	}

	function selectVersion(versionId: string | null, versionNumber: number | null) {
		flowStore.updateNodeData('mapVersionId', versionId);
		flowStore.updateNodeData('mapVersionNumber', versionNumber);
		showVersionDropdown = false;
	}

	// Get versions for selected workflow
	function getSelectedWorkflow(): WorkflowOption | undefined {
		return workflows.find(w => w.id === flowStore.selectedNode?.data.mapWorkflowId);
	}
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-orange-500/5 border border-orange-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-orange-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
			<path d="M15 5l4 4"/>
		</svg>
		<div>
			<span class="font-medium">Map/Iterator Node</span>
			<p class="text-muted-foreground mt-0.5">Execute a workflow for each item in an array. Results are collected in order.</p>
		</div>
	</div>

	<!-- Workflow Selection -->
	<div class="flex flex-col gap-1.5">
		<label for="workflowSelect" class="text-[11px] font-medium text-muted-foreground">
			Workflow to Execute (per item)
		</label>
		{#if loading}
			<div class="border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm text-muted-foreground">
				Loading workflows...
			</div>
		{:else if error}
			<div class="border border-red-500/30 bg-red-500/5 px-3 py-2 rounded-none text-sm text-red-500">
				{error}
			</div>
		{:else if workflows.length === 0}
			<div class="border border-amber-500/30 bg-amber-500/5 px-3 py-2 rounded-none text-sm text-amber-600">
				No other workflows available. Create another workflow first.
			</div>
		{:else}
			<select
				id="workflowSelect"
				value={flowStore.selectedNode.data.mapWorkflowId || ''}
				onchange={(e) => {
					const id = parseInt(e.currentTarget.value);
					const workflow = workflows.find(w => w.id === id);
					if (workflow) selectWorkflow(workflow);
				}}
				class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground"
			>
				<option value="">Select a workflow...</option>
				{#each workflows as workflow}
					<option value={workflow.id}>
						{workflow.name} {workflow.activeVersionNumber ? `(v${workflow.activeVersionNumber})` : '(draft)'}
					</option>
				{/each}
			</select>
		{/if}
	</div>

	<!-- Version Selection (only if workflow selected) -->
	{#if flowStore.selectedNode.data.mapWorkflowId}
		{@const selectedWorkflow = getSelectedWorkflow()}
		{#if selectedWorkflow && selectedWorkflow.versions && selectedWorkflow.versions.length > 0}
			<div class="flex flex-col gap-1.5">
				<label for="versionSelect" class="text-[11px] font-medium text-muted-foreground">
					Version
				</label>
				<div class="relative">
					<button
						id="versionSelect"
						type="button"
						onclick={() => showVersionDropdown = !showVersionDropdown}
						class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm text-left focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground flex items-center justify-between"
					>
						<span>
							{#if flowStore.selectedNode.data.mapVersionNumber}
								v{flowStore.selectedNode.data.mapVersionNumber}
							{:else}
								Latest Published
							{/if}
						</span>
						<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="m6 9 6 6 6-6"/>
						</svg>
					</button>
					
					{#if showVersionDropdown}
						<div class="absolute top-full left-0 right-0 mt-1 bg-panel border border-panel-border shadow-float z-50 max-h-48 overflow-y-auto">
							<button
								type="button"
								onclick={() => selectVersion(selectedWorkflow.activeVersionId, selectedWorkflow.activeVersionNumber)}
								class="w-full px-3 py-2 text-sm text-left hover:bg-sidebar-accent/50 flex items-center justify-between {!flowStore.selectedNode.data.mapVersionId ? 'bg-orange-500/10' : ''}"
							>
								<span>Latest Published</span>
								{#if selectedWorkflow.activeVersionNumber}
									<span class="text-xs text-muted-foreground">v{selectedWorkflow.activeVersionNumber}</span>
								{/if}
							</button>
							{#each selectedWorkflow.versions as version}
								<button
									type="button"
									onclick={() => selectVersion(version.id, version.versionNumber)}
									class="w-full px-3 py-2 text-sm text-left hover:bg-sidebar-accent/50 flex items-center justify-between {flowStore.selectedNode.data.mapVersionId === version.id ? 'bg-orange-500/10' : ''}"
								>
									<span>v{version.versionNumber}</span>
									<span class="text-xs text-muted-foreground truncate max-w-[150px]">
										{version.changeSummary || 'No description'}
									</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<span class="text-[10px] text-muted-foreground/60">
					Pin a specific version for deterministic behavior
				</span>
			</div>
		{/if}
	{/if}

	<!-- Input Array -->
	<div class="flex flex-col gap-1.5">
		<label for="mapInputArray" class="text-[11px] font-medium text-muted-foreground">
			Input Array
		</label>
		<textarea
			id="mapInputArray"
			value={flowStore.selectedNode.data.mapInputArray || '{{prev.items}}'}
			oninput={(e) => flowStore.updateNodeData('mapInputArray', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground min-h-[60px] resize-y"
			placeholder="&#123;&#123;prev.items&#125;&#125;"
		></textarea>
		<span class="text-[10px] text-muted-foreground/60">
			Template or JSON array. Each item becomes the child workflow's input.
		</span>
	</div>

	<!-- Concurrency -->
	<div class="flex flex-col gap-1.5">
		<label for="mapConcurrency" class="text-[11px] font-medium text-muted-foreground">
			Concurrency
		</label>
		<div class="flex items-center gap-3">
			<input
				id="mapConcurrency"
				type="range"
				min="1"
				max="50"
				step="1"
				value={flowStore.selectedNode.data.mapConcurrency || 5}
				oninput={(e) => flowStore.updateNodeData('mapConcurrency', parseInt(e.currentTarget.value))}
				class="flex-1 h-2 bg-sidebar-accent/50 rounded-none appearance-none cursor-pointer accent-orange-500"
			/>
			<span class="w-8 text-sm font-mono text-foreground text-right">
				{flowStore.selectedNode.data.mapConcurrency || 5}
			</span>
		</div>
		<span class="text-[10px] text-muted-foreground/60">
			Maximum parallel executions (1-50). Higher = faster but more resource intensive.
		</span>
	</div>

	<!-- Fail Fast -->
	<div class="flex flex-col gap-2">
		<span class="text-[11px] font-medium text-muted-foreground">
			Error Handling
		</span>
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				checked={flowStore.selectedNode.data.mapFailFast || false}
				onchange={(e) => flowStore.updateNodeData('mapFailFast', e.currentTarget.checked)}
				class="w-4 h-4 rounded-none border-input bg-sidebar-accent/50 text-orange-500 focus:ring-orange-500/50"
			/>
			<span class="text-sm text-foreground">Fail fast (stop on first error)</span>
		</label>
		<span class="text-[10px] text-muted-foreground/60">
			When unchecked, all iterations run and errors are collected in the results.
		</span>
	</div>

	<!-- Timeout -->
	<div class="flex flex-col gap-1.5">
		<label for="mapTimeoutMs" class="text-[11px] font-medium text-muted-foreground">
			Timeout (seconds)
		</label>
		<input
			id="mapTimeoutMs"
			type="number"
			min="0"
			step="1"
			value={Number(flowStore.selectedNode.data.mapTimeoutMs || 0) / 1000}
			oninput={(e) => {
				const seconds = parseInt(e.currentTarget.value) || 0;
				flowStore.updateNodeData('mapTimeoutMs', seconds > 0 ? seconds * 1000 : null);
			}}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground"
			placeholder="0 (no timeout)"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Max duration for entire batch. 0 = no timeout.
		</span>
	</div>

	<!-- Depth Limit -->
	<div class="flex flex-col gap-1.5">
		<label for="mapDepthLimit" class="text-[11px] font-medium text-muted-foreground">
			Nesting Depth Limit
		</label>
		<input
			id="mapDepthLimit"
			type="number"
			min="1"
			max="50"
			step="1"
			value={flowStore.selectedNode.data.mapDepthLimit || 10}
			oninput={(e) => flowStore.updateNodeData('mapDepthLimit', parseInt(e.currentTarget.value) || 10)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Max nested Map/SubFlow depth (prevents infinite recursion).
		</span>
	</div>

	<!-- Output Info -->
	<div class="bg-sidebar-accent/30 border border-input p-3 rounded-none text-xs">
		<div class="font-medium text-foreground mb-2">Output Format</div>
		<div class="text-muted-foreground space-y-1 font-mono text-[10px]">
			<div>&#123;</div>
			<div class="pl-3">results: [...],  <span class="text-orange-500">// Ordered outputs</span></div>
			<div class="pl-3">errors: [...],   <span class="text-orange-500">// Failed items</span></div>
			<div class="pl-3">stats: &#123; total, completed, failed &#125;</div>
			<div>&#125;</div>
		</div>
	</div>

	<!-- Output Handles Info -->
	<div class="bg-sidebar-accent/30 border border-input p-3 rounded-none text-xs">
		<div class="font-medium text-foreground mb-2">Output Handles</div>
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
				<span class="text-muted-foreground">Success - All iterations completed (or some failed if not fail-fast)</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>
				<span class="text-muted-foreground">Error - Fail-fast triggered or all iterations failed</span>
			</div>
		</div>
	</div>

	<!-- Node Label -->
	<div class="flex flex-col gap-1.5">
		<label for="label" class="text-[11px] font-medium text-muted-foreground">
			Node Label
		</label>
		<input
			id="label"
			type="text"
			value={flowStore.selectedNode.data.label || ''}
			oninput={(e) => flowStore.updateNodeData('label', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/50"
			placeholder="Process Users"
		/>
	</div>
{/if}

