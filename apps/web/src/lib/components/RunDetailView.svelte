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
		runId: string;
		runDetails: RunDetails | null;
		loading: boolean;
		onBack: () => void;
	}

	let { runId, runDetails, loading, onBack }: Props = $props();

	function formatDuration(ms: number | null): string {
		if (ms === null) return '-';
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
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
</script>

<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
	<div class="flex items-center gap-2">
		<button
			onclick={onBack}
			class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
			title="Back to list"
		>
			<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
		</button>
		<span class="text-sm font-medium">Run Details</span>
	</div>
	<code class="text-[10px] font-mono text-muted-foreground">{runId.slice(0, 8)}</code>
</div>

<div class="flex-1 overflow-y-auto p-3 space-y-3">
	{#if loading}
		<div class="flex items-center justify-center h-32 text-muted-foreground text-sm">
			<svg class="w-4 h-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
			</svg>
			Loading...
		</div>
	{:else if runDetails}
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

