<script lang="ts">
	interface Run {
		id: string;
		workflowId: number;
		workflowName?: string;
		status: string;
		trigger: string;
		pinned: boolean;
		createdAt: string;
		startedAt: string | null;
		completedAt: string | null;
		durationMs: number | null;
		error: string | null;
	}

	interface RunDetails {
		run: Run & { workflowName: string };
		events: Array<{ id: number; nodeId: string | null; eventType: string; payload: unknown; createdAt: string }>;
		nodeResults: Record<string, { status: string; result?: unknown; error?: string }>;
	}

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		onViewRun: (runId: string) => void;
		workflowId: number | null;
		workflowName: string | null;
	}

	let { isOpen, onClose, onViewRun, workflowId, workflowName }: Props = $props();

	let runs = $state<Run[]>([]);
	let loading = $state(false);
	let initialLoading = $state(true);
	let error = $state<string | null>(null);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let totalCount = $state(0);

	// Run detail view
	let selectedRunId = $state<string | null>(null);
	let runDetails = $state<RunDetails | null>(null);
	let loadingDetails = $state(false);

	// Filters - default to current workflow if available
	let statusFilter = $state<string>('');
	let triggerFilter = $state<string>('');
	let workflowScope = $state<'current' | 'all'>(workflowId ? 'current' : 'all');

	// Sort runs with pinned at top
	let sortedRuns = $derived(() => {
		const pinned = runs.filter(r => r.pinned);
		const unpinned = runs.filter(r => !r.pinned);
		return [...pinned, ...unpinned];
	});

	async function loadRuns(append = false) {
		loading = true;
		error = null;

		try {
			const params = new URLSearchParams();
			// Filter by workflow if scope is 'current' and we have a workflowId
			if (workflowScope === 'current' && workflowId) {
				params.set('workflowId', workflowId.toString());
			}
			if (statusFilter) params.set('status', statusFilter);
			if (triggerFilter) params.set('trigger', triggerFilter);
			if (append && nextCursor) params.set('cursor', nextCursor);
			params.set('limit', '20');

			const res = await fetch(`/api/runs?${params}`);
			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || 'Failed to load runs');
			}

			if (append) {
				runs = [...runs, ...data.runs];
			} else {
				runs = data.runs;
			}
			nextCursor = data.nextCursor;
			hasMore = data.hasMore;
			totalCount = data.totalCount ?? runs.length;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
			initialLoading = false;
		}
	}

	async function deleteRun(runId: string) {
		if (!confirm('Are you sure you want to delete this run? This cannot be undone.')) {
			return;
		}

		try {
			const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Failed to delete');
			}
			runs = runs.filter(r => r.id !== runId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete run');
		}
	}

	async function togglePin(run: Run) {
		try {
			const res = await fetch(`/api/runs/${run.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pinned: !run.pinned }),
			});
			if (!res.ok) {
				throw new Error('Failed to update');
			}
			runs = runs.map(r => r.id === run.id ? { ...r, pinned: !r.pinned } : r);
		} catch (e) {
			alert('Failed to update run');
		}
	}

	async function replayRun(runId: string) {
		try {
			const res = await fetch(`/api/runs/${runId}/replay`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || 'Failed to replay');
			}
			await loadRuns();
			onViewRun(data.runId);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to replay run');
		}
	}

	async function cancelRun(runId: string) {
		try {
			const res = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Failed to cancel');
			}
			await loadRuns();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to cancel run');
		}
	}

	async function viewRunDetails(runId: string) {
		selectedRunId = runId;
		loadingDetails = true;
		runDetails = null;
		
		try {
			const res = await fetch(`/api/runs/${runId}`);
			if (!res.ok) {
				throw new Error('Failed to load run details');
			}
			runDetails = await res.json();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to load run details');
			selectedRunId = null;
		} finally {
			loadingDetails = false;
		}
	}

	function closeDetails() {
		selectedRunId = null;
		runDetails = null;
	}

	function formatDuration(ms: number | null): string {
		if (ms === null) return '-';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
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

	function getStatusColor(status: string): string {
		switch (status) {
			case 'completed': return 'text-emerald-500';
			case 'failed': return 'text-red-500';
			case 'running': return 'text-blue-500';
			case 'pending': return 'text-amber-500';
			case 'cancelled': return 'text-muted-foreground';
			default: return 'text-muted-foreground';
		}
	}

	function getTriggerLabel(trigger: string): string {
		switch (trigger) {
			case 'manual': return 'Manual';
			case 'webhook': return 'Webhook';
			case 'cron': return 'Scheduled';
			case 'replay': return 'Replay';
			default: return trigger;
		}
	}

	// Track previous filter values to detect changes
	let prevFilters = { status: '', trigger: '', scope: 'current' as 'current' | 'all' };
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	// Single effect to handle all loading logic
	$effect(() => {
		if (isOpen) {
			// Check if filters changed
			const filtersChanged = 
				prevFilters.status !== statusFilter || 
				prevFilters.trigger !== triggerFilter || 
				prevFilters.scope !== workflowScope;
			
			if (filtersChanged) {
				prevFilters = { status: statusFilter, trigger: triggerFilter, scope: workflowScope };
				loadRuns();
			}
			
			// Set up auto-refresh (only once)
			if (!refreshInterval) {
				refreshInterval = setInterval(() => {
					if (!loading) loadRuns();
				}, 2000);
			}
			
			return () => {
				if (refreshInterval) {
					clearInterval(refreshInterval);
					refreshInterval = null;
				}
			};
		} else {
			// Reset when panel closes
			prevFilters = { status: '', trigger: '', scope: 'current' };
			initialLoading = true;
			if (refreshInterval) {
				clearInterval(refreshInterval);
				refreshInterval = null;
			}
		}
	});
</script>

{#if isOpen}
	<div class="w-[400px] bg-panel border border-panel-border rounded-none text-sidebar-foreground flex flex-col shadow-float pointer-events-auto h-full overflow-hidden">
		{#if selectedRunId && runDetails}
			<!-- Run Detail View -->
			<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
				<div class="flex items-center gap-2">
					<button
						onclick={closeDetails}
						class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
						title="Back to list"
					>
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M19 12H5M12 19l-7-7 7-7"/>
						</svg>
					</button>
					<span class="text-sm font-medium">Run Details</span>
				</div>
				<code class="text-[10px] font-mono text-muted-foreground">{selectedRunId.slice(0, 8)}</code>
			</div>

			<div class="flex-1 overflow-y-auto p-3 space-y-3">
				{#if loadingDetails}
					<div class="flex items-center justify-center h-32 text-muted-foreground text-sm">
						<svg class="w-4 h-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
						</svg>
						Loading...
					</div>
				{:else}
					<!-- Run info -->
					<div class="p-2.5 bg-sidebar-accent/30 rounded-sm border border-sidebar-border">
						<div class="flex items-center justify-between mb-2">
							<span class={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
								runDetails.run.status === 'completed' ? 'bg-emerald-500/20 text-emerald-500' :
								runDetails.run.status === 'failed' ? 'bg-red-500/20 text-red-500' :
								runDetails.run.status === 'running' ? 'bg-blue-500/20 text-blue-500' :
								runDetails.run.status === 'pending' ? 'bg-amber-500/20 text-amber-500' :
								'bg-muted/50 text-muted-foreground'
							}`}>
								{runDetails.run.status}
							</span>
							<span class="text-[10px] text-muted-foreground">
								{getTriggerLabel(runDetails.run.trigger)}
							</span>
						</div>
						<div class="text-xs text-muted-foreground space-y-1">
							<div>Workflow: <span class="text-foreground">{runDetails.run.workflowName}</span></div>
							<div>Started: <span class="text-foreground">{runDetails.run.startedAt ? new Date(runDetails.run.startedAt).toLocaleString() : '-'}</span></div>
							<div>Duration: <span class="text-foreground">{formatDuration(runDetails.run.durationMs)}</span></div>
						</div>
					</div>

					<!-- Node Results -->
					<div>
						<span class="text-xs font-medium text-muted-foreground block mb-2">Node Results</span>
						<div class="space-y-1.5">
							{#each Object.entries(runDetails.nodeResults) as [nodeId, result]}
								<div class="p-2 bg-sidebar-accent/20 rounded-sm border border-sidebar-border">
									<div class="flex items-center justify-between mb-1">
										<code class="text-[10px] font-mono">{nodeId}</code>
										<span class={`text-[10px] ${
											result.status === 'success' ? 'text-emerald-500' :
											result.status === 'error' ? 'text-red-500' :
											result.status === 'running' ? 'text-blue-500' :
											'text-muted-foreground'
										}`}>
											{result.status}
										</span>
									</div>
									{#if result.error}
										<div class="text-[10px] text-red-400 truncate">{result.error}</div>
									{:else if result.result}
										<pre class="text-[9px] text-muted-foreground bg-background/50 p-1.5 rounded-sm overflow-x-auto max-h-20">{JSON.stringify(result.result, null, 2)}</pre>
									{/if}
								</div>
							{/each}
							{#if Object.keys(runDetails.nodeResults).length === 0}
								<div class="text-[10px] text-muted-foreground text-center py-4">No node results yet</div>
							{/if}
						</div>
					</div>

					<!-- Events Timeline -->
					<div>
						<span class="text-xs font-medium text-muted-foreground block mb-2">Events ({runDetails.events.length})</span>
						<div class="space-y-1 max-h-40 overflow-y-auto">
							{#each runDetails.events.slice(-20) as event}
								<div class="flex items-start gap-2 text-[10px]">
									<span class="text-muted-foreground shrink-0">{new Date(event.createdAt).toLocaleTimeString()}</span>
									<span class={
										event.eventType.includes('COMPLETED') ? 'text-emerald-500' :
										event.eventType.includes('FAILED') ? 'text-red-500' :
										event.eventType.includes('STARTED') ? 'text-blue-500' :
										'text-foreground'
									}>
										{event.eventType}
									</span>
									{#if event.nodeId}
										<code class="text-muted-foreground">{event.nodeId}</code>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Run List View -->
			<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
				<div class="flex items-center gap-2">
					<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 8v4l3 3"/>
						<circle cx="12" cy="12" r="10"/>
					</svg>
					<div class="flex flex-col">
						<span class="text-sm font-medium">Run History</span>
						{#if workflowScope === 'current' && workflowName}
							<span class="text-[10px] text-muted-foreground truncate max-w-[200px]">{workflowName}</span>
						{/if}
					</div>
				</div>
				<button
					onclick={onClose}
					class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
					title="Close"
					aria-label="Close history panel"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6 6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<!-- Filters -->
			<div class="px-3 py-2 border-b border-sidebar-border space-y-2">
				<!-- Workflow scope toggle - always show row for consistent height -->
				<div class="flex items-center gap-2 h-6">
					{#if workflowId}
						<div class="flex items-center bg-sidebar-accent/50 rounded-sm p-0.5">
							<button
								onclick={() => workflowScope = 'current'}
								class="px-2.5 py-1 text-[10px] font-medium rounded-sm transition-all {workflowScope === 'current' 
									? 'bg-primary text-primary-foreground shadow-sm' 
									: 'text-muted-foreground hover:text-foreground'}"
							>
								This Workflow
							</button>
							<button
								onclick={() => workflowScope = 'all'}
								class="px-2.5 py-1 text-[10px] font-medium rounded-sm transition-all {workflowScope === 'all' 
									? 'bg-primary text-primary-foreground shadow-sm' 
									: 'text-muted-foreground hover:text-foreground'}"
							>
								All Workflows
							</button>
						</div>
					{:else}
						<span class="text-[10px] text-muted-foreground">All Workflows</span>
					{/if}
					
					<!-- Loading/refresh indicator -->
					<div class="ml-auto flex items-center gap-1.5">
						{#if loading}
							<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
						{/if}
						<button
							onclick={() => loadRuns()}
							class="p-1 text-muted-foreground hover:text-foreground transition-colors"
							title="Refresh"
							disabled={loading}
						>
							<svg class="w-3.5 h-3.5 {loading ? 'animate-spin opacity-50' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
								<path d="M21 3v5h-5"/>
							</svg>
						</button>
					</div>
				</div>
				
				<!-- Status and trigger filters -->
				<div class="flex items-center gap-2">
					<select 
						bind:value={statusFilter}
						class="flex-1 text-[11px] bg-sidebar-accent/30 border border-sidebar-border rounded-sm px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value="">All Status</option>
						<option value="completed">Completed</option>
						<option value="failed">Failed</option>
						<option value="running">Running</option>
						<option value="pending">Pending</option>
						<option value="cancelled">Cancelled</option>
					</select>
					<select 
						bind:value={triggerFilter}
						class="flex-1 text-[11px] bg-sidebar-accent/30 border border-sidebar-border rounded-sm px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value="">All Triggers</option>
						<option value="manual">Manual</option>
						<option value="webhook">Webhook</option>
						<option value="cron">Scheduled</option>
					</select>
				</div>
			</div>

			<!-- Run list -->
			<div class="flex-1 overflow-y-auto">
				{#if error}
					<div class="p-3 text-red-500 text-xs">
						Error: {error}
					</div>
				{:else if initialLoading}
					<div class="flex flex-col items-center justify-center h-48 text-muted-foreground">
						<svg class="w-5 h-5 mb-2 animate-spin opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
						</svg>
						<p class="text-xs">Loading runs...</p>
					</div>
				{:else if runs.length === 0}
					<!-- Empty state -->
					<div class="flex flex-col items-center justify-center h-48 text-muted-foreground">
						<svg class="w-5 h-5 mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M12 8v4l3 3"/>
							<circle cx="12" cy="12" r="10"/>
						</svg>
						<p class="text-xs">No runs found</p>
						<p class="text-[10px] text-muted-foreground/70 mt-1">
							{workflowScope === 'current' ? 'Run this workflow or try "All Workflows"' : 'Run a workflow to see history'}
						</p>
					</div>
				{:else}
					{#each sortedRuns() as run (run.id)}
						<div class="border-b border-sidebar-border hover:bg-sidebar-accent/30 transition-colors {run.pinned ? 'bg-amber-500/5' : ''}">
							<div class="px-3 py-2.5">
								<!-- Top row: Status badge, ID, Time -->
								<div class="flex items-center justify-between mb-1.5">
									<div class="flex items-center gap-2">
										<span class={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
											run.status === 'completed' ? 'bg-emerald-500/20 text-emerald-500' :
											run.status === 'failed' ? 'bg-red-500/20 text-red-500' :
											run.status === 'running' ? 'bg-blue-500/20 text-blue-500' :
											run.status === 'pending' ? 'bg-amber-500/20 text-amber-500' :
											'bg-muted/50 text-muted-foreground'
										}`}>
											{run.status}
										</span>
										<code class="text-[10px] font-mono text-muted-foreground">
											{run.id.slice(0, 8)}
										</code>
										{#if run.pinned}
											<svg class="w-3 h-3 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
												<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
											</svg>
										{/if}
									</div>
									<span class="text-[10px] text-muted-foreground">
										{formatTime(run.createdAt)}
									</span>
								</div>

								<!-- Workflow name (when showing all workflows) -->
								{#if workflowScope === 'all' && run.workflowName}
									<div class="text-[10px] text-muted-foreground mb-1 truncate">
										<span class="text-foreground">{run.workflowName}</span>
									</div>
								{/if}

								<!-- Middle row: Trigger, Duration -->
								<div class="flex items-center gap-2 text-[10px] text-muted-foreground mb-2">
									<span class="px-1.5 py-0.5 bg-sidebar-accent/50 rounded-sm">
										{getTriggerLabel(run.trigger)}
									</span>
									<span>
										{formatDuration(run.durationMs)}
									</span>
									{#if run.status === 'running'}
										<span class="flex items-center gap-1 text-blue-500">
											<span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
											Running
										</span>
									{/if}
								</div>

								<!-- Error message if failed -->
								{#if run.error}
									<div class="text-[10px] text-red-400 bg-red-500/10 px-2 py-1 rounded-sm mb-2 truncate">
										{run.error}
									</div>
								{/if}

								<!-- Actions -->
								<div class="flex items-center gap-1">
									<button
										onclick={() => viewRunDetails(run.id)}
										class="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
									>
										View
									</button>
									{#if run.status === 'running' || run.status === 'pending'}
										<button
											onclick={() => cancelRun(run.id)}
											class="px-2 py-0.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm transition-colors"
										>
											Cancel
										</button>
									{:else}
										<button
											onclick={() => replayRun(run.id)}
											class="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
										>
											Re-run
										</button>
									{/if}
									<button
										onclick={() => togglePin(run)}
										class="px-2 py-0.5 text-[10px] {run.pinned ? 'text-amber-500' : 'text-muted-foreground'} hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
									>
										{run.pinned ? 'Unpin' : 'Pin'}
									</button>
									<button
										onclick={() => deleteRun(run.id)}
										class="px-2 py-0.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm transition-colors ml-auto"
									>
										Delete
									</button>
								</div>
							</div>
						</div>
					{/each}

					<!-- Load more -->
					{#if hasMore}
						<div class="p-3 flex justify-center">
							<button
								onclick={() => loadRuns(true)}
								disabled={loading}
								class="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors disabled:opacity-50"
							>
								{loading ? 'Loading...' : 'Load More'}
							</button>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-3 py-2 border-t border-sidebar-border bg-sidebar-accent/30">
				<div class="flex items-center justify-between text-[10px] text-muted-foreground">
					<span>{totalCount} total run{totalCount !== 1 ? 's' : ''}{runs.length < totalCount ? ` (${runs.length} loaded)` : ''}</span>
					<span>Auto-refresh: 3s</span>
				</div>
			</div>
		{/if}
	</div>
{/if}
