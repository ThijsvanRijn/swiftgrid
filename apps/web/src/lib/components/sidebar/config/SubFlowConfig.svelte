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
		const selectedId = flowStore.selectedNode?.data.subflowWorkflowId;
		if (selectedId && workflows.length > 0) {
			const workflow = workflows.find(w => w.id === selectedId);
			if (workflow && !flowStore.selectedNode?.data.subflowName) {
				// Auto-populate name if not set
				flowStore.updateNodeData('subflowName', workflow.name);
			}
		}
	});

	function selectWorkflow(workflow: WorkflowOption) {
		flowStore.updateNodeData('subflowWorkflowId', workflow.id);
		flowStore.updateNodeData('subflowName', workflow.name);
		// Default to active version
		if (workflow.activeVersionId) {
			flowStore.updateNodeData('subflowVersionId', workflow.activeVersionId);
			flowStore.updateNodeData('subflowVersionNumber', workflow.activeVersionNumber);
		} else {
			flowStore.updateNodeData('subflowVersionId', null);
			flowStore.updateNodeData('subflowVersionNumber', null);
		}
	}

	function selectVersion(versionId: string | null, versionNumber: number | null) {
		flowStore.updateNodeData('subflowVersionId', versionId);
		flowStore.updateNodeData('subflowVersionNumber', versionNumber);
		showVersionDropdown = false;
	}

	// Get versions for selected workflow
	function getSelectedWorkflow(): WorkflowOption | undefined {
		return workflows.find(w => w.id === flowStore.selectedNode?.data.subflowWorkflowId);
	}
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-violet-500/5 border border-violet-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-violet-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<rect x="3" y="3" width="7" height="7" rx="1"/>
			<rect x="14" y="3" width="7" height="7" rx="1"/>
			<rect x="3" y="14" width="7" height="7" rx="1"/>
			<rect x="14" y="14" width="7" height="7" rx="1"/>
		</svg>
		<div>
			<span class="font-medium">Sub-Flow Node</span>
			<p class="text-muted-foreground mt-0.5">Execute another workflow as a step. The parent workflow will wait for the sub-flow to complete before continuing.</p>
		</div>
	</div>

	<!-- Workflow Selection -->
	<div class="flex flex-col gap-1.5">
		<label for="workflowSelect" class="text-[11px] font-medium text-muted-foreground">
			Workflow to Execute
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
				value={flowStore.selectedNode.data.subflowWorkflowId || ''}
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
	{#if flowStore.selectedNode.data.subflowWorkflowId}
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
							{#if flowStore.selectedNode.data.subflowVersionNumber}
								v{flowStore.selectedNode.data.subflowVersionNumber}
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
								class="w-full px-3 py-2 text-sm text-left hover:bg-sidebar-accent/50 flex items-center justify-between {!flowStore.selectedNode.data.subflowVersionId ? 'bg-violet-500/10' : ''}"
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
									class="w-full px-3 py-2 text-sm text-left hover:bg-sidebar-accent/50 flex items-center justify-between {flowStore.selectedNode.data.subflowVersionId === version.id ? 'bg-violet-500/10' : ''}"
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

	<!-- Input Data -->
	<div class="flex flex-col gap-1.5">
		<label for="subflowInput" class="text-[11px] font-medium text-muted-foreground">
			Input Data
		</label>
		<textarea
			id="subflowInput"
			value={flowStore.selectedNode.data.subflowInput || '{{prev}}'}
			oninput={(e) => flowStore.updateNodeData('subflowInput', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground min-h-[80px] resize-y"
			placeholder="&#123;&#123;prev&#125;&#125;"
		></textarea>
		<span class="text-[10px] text-muted-foreground/60">
			JSON or template. Use &#123;&#123;prev&#125;&#125; for previous node output.
		</span>
	</div>

	<!-- Output Mapping -->
	<div class="flex flex-col gap-1.5">
		<label for="subflowOutputPath" class="text-[11px] font-medium text-muted-foreground">
			Output Path (optional)
		</label>
		<input
			id="subflowOutputPath"
			type="text"
			value={flowStore.selectedNode.data.subflowOutputPath || ''}
			oninput={(e) => flowStore.updateNodeData('subflowOutputPath', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			placeholder="result.data"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Extract a specific field from the output (e.g., "result.items")
		</span>
	</div>

	<!-- Timeout -->
	<div class="flex flex-col gap-1.5">
		<label for="subflowTimeout" class="text-[11px] font-medium text-muted-foreground">
			Timeout (seconds)
		</label>
		<input
			id="subflowTimeout"
			type="number"
			min="0"
			step="1"
			value={Math.floor((Number(flowStore.selectedNode.data.subflowTimeoutMs) || 0) / 1000)}
			oninput={(e) => flowStore.updateNodeData('subflowTimeoutMs', parseInt(e.currentTarget.value || '0') * 1000)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/50"
			placeholder="0 (no timeout)"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			0 = no timeout. If set, sub-flow will fail after this duration.
		</span>
	</div>

	<!-- Retry on Failure -->
	<div class="flex flex-col gap-1.5">
		<label for="subflowMaxRetries" class="text-[11px] font-medium text-muted-foreground">
			Max Retries
		</label>
		<input
			id="subflowMaxRetries"
			type="number"
			min="0"
			max="10"
			step="1"
			value={flowStore.selectedNode.data.subflowMaxRetries || 0}
			oninput={(e) => flowStore.updateNodeData('subflowMaxRetries', parseInt(e.currentTarget.value || '0'))}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/50"
			placeholder="0 (no retries)"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Number of times to retry if sub-flow fails (0-10)
		</span>
	</div>

	<!-- Error Handling -->
	<div class="flex flex-col gap-2">
		<span class="text-[11px] font-medium text-muted-foreground">
			Error Handling
		</span>
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				checked={flowStore.selectedNode.data.subflowFailOnError || false}
				onchange={(e) => flowStore.updateNodeData('subflowFailOnError', e.currentTarget.checked)}
				class="w-4 h-4 rounded-none border-input bg-sidebar-accent/50 text-violet-500 focus:ring-violet-500/50"
			/>
			<span class="text-sm text-foreground">Fail parent if sub-flow fails</span>
		</label>
		<span class="text-[10px] text-muted-foreground/60">
			When unchecked, errors route to the red output handle instead
		</span>
	</div>

	<!-- Output Handles Info -->
	<div class="bg-sidebar-accent/30 border border-input p-3 rounded-none text-xs">
		<div class="font-medium text-foreground mb-2">Output Handles</div>
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
				<span class="text-muted-foreground">Success - Sub-flow completed</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-red-500"></span>
				<span class="text-muted-foreground">Error - Sub-flow failed (if not failing parent)</span>
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
			placeholder="Process Payment"
		/>
	</div>
{/if}

