<script lang="ts">
	interface WorkflowItem {
		id: number;
		name: string;
		activeVersionId: string | null;
		activeVersionNumber: number | null;
		createdAt: string;
		updatedAt: string;
	}

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		onSelect: (workflowId: number) => void;
		currentWorkflowId: number | null;
	}

	let { isOpen, onClose, onSelect, currentWorkflowId }: Props = $props();

	let workflows = $state<WorkflowItem[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return workflows;
		return workflows.filter((w) =>
			w.name.toLowerCase().includes(q) ||
			w.id.toString().includes(q)
		);
	});

	async function loadWorkflows() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/workflows');
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || 'Failed to load workflows');
			}
			workflows = (data.workflows || []) as WorkflowItem[];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	function formatTime(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	function handleSelect(id: number) {
		onSelect(id);
		onClose();
	}

	$effect(() => {
		if (isOpen) {
			loadWorkflows();
		}
	});
</script>

{#if isOpen}
	<div class="w-[360px] bg-panel border border-panel-border rounded-none shadow-float pointer-events-auto flex flex-col h-full">
		<!-- Header -->
		<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M3 7h18"/>
					<path d="M5 7l1 12h12l1-12"/>
					<path d="M10 11v6"/>
					<path d="M14 11v6"/>
					<path d="M9 7V5a3 3 0 0 1 6 0v2"/>
				</svg>
				<div class="flex flex-col">
					<span class="text-sm font-medium">Workflows</span>
					<span class="text-[10px] text-muted-foreground">Select to load into editor</span>
				</div>
			</div>
			<button
				onclick={onClose}
				class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
				title="Close"
			>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6 6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<!-- Search -->
		<div class="px-3 py-2 border-b border-sidebar-border">
			<div class="relative">
				<svg class="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="8"/>
					<path d="m21 21-4.3-4.3"/>
				</svg>
				<input
					type="text"
					bind:value={query}
					placeholder="Search by name or ID"
					class="w-full pl-8 pr-2 py-1.5 text-sm bg-sidebar-accent/30 border border-sidebar-border rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
				/>
			</div>
		</div>

		<!-- Body -->
		<div class="flex-1 overflow-y-auto">
			{#if loading}
				<div class="flex flex-col items-center justify-center h-32 text-muted-foreground">
					<svg class="w-5 h-5 mb-2 animate-spin opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
					</svg>
					<p class="text-xs">Loading workflows...</p>
				</div>
			{:else if error}
				<div class="p-3 text-red-500 text-xs">
					Error: {error}
				</div>
			{:else if filtered.length === 0}
				<div class="flex flex-col items-center justify-center h-32 text-muted-foreground">
					<svg class="w-5 h-5 mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M3 7h18"/>
						<path d="M5 7l1 12h12l1-12"/>
					</svg>
					<p class="text-xs">No workflows found</p>
					<p class="text-[10px] text-muted-foreground/70 mt-1">
						Try a different search
					</p>
				</div>
			{:else}
				{#each filtered as workflow (workflow.id)}
					{@const isCurrent = workflow.id === currentWorkflowId}
					<div class="border-b border-sidebar-border hover:bg-sidebar-accent/30 transition-colors">
						<button
							class="w-full text-left px-3 py-2.5 flex items-start gap-2"
							onclick={() => handleSelect(workflow.id)}
						>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-0.5">
									<span class="text-sm font-medium truncate">{workflow.name}</span>
									{#if isCurrent}
										<span class="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-500 rounded-sm">
											Open
										</span>
									{/if}
								</div>
								<div class="flex items-center gap-2 text-[10px] text-muted-foreground">
									<span class="px-1.5 py-0.5 bg-sidebar-accent/50 rounded-sm">
										ID {workflow.id}
									</span>
									{#if workflow.activeVersionNumber}
										<span class="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-500 rounded-sm font-medium">
											v{workflow.activeVersionNumber}
										</span>
									{:else}
										<span class="px-1.5 py-0.5 bg-amber-500/20 text-amber-500 rounded-sm font-medium">
											Draft
										</span>
									{/if}
									<span>
										Updated {formatTime(workflow.updatedAt || workflow.createdAt)}
									</span>
								</div>
							</div>
						</button>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Footer -->
		<div class="px-3 py-2 border-t border-sidebar-border bg-sidebar-accent/30 text-[10px] text-muted-foreground">
			{workflows.length} workflow{workflows.length === 1 ? '' : 's'}
		</div>
	</div>
{/if}


