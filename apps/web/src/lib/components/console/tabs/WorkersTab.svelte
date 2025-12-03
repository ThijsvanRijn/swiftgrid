<script lang="ts">
	import { onMount } from 'svelte';
	
	interface WorkerStatus {
		worker_id: string;
		status: 'healthy' | 'unhealthy' | 'dead';
		memory_mb: number;
		jobs_processed: number;
		current_jobs: number;
		uptime_secs: number;
		last_seen: string;
	}
	
	interface WorkersResponse {
		workers: WorkerStatus[];
		queue: {
			pending: number;
			stream_length: number;
		};
		totals: {
			jobs_processed: number;
			active_jobs: number;
			throughput_per_min: number;
		};
	}
	
	let data = $state<WorkersResponse | null>(null);
	let prevData = $state<WorkersResponse | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	
	// Track which values changed for flash effect
	let changedFields = $state<Set<string>>(new Set());
	
	async function fetchWorkers() {
		try {
			const res = await fetch('/api/workers');
			if (res.ok) {
				const newData = await res.json() as WorkersResponse;
				
				// Detect changes for flash effect
				if (data) {
					const changed = new Set<string>();
					
					// Check global totals
					if (data.totals.jobs_processed !== newData.totals.jobs_processed) changed.add('total_processed');
					if (data.totals.active_jobs !== newData.totals.active_jobs) changed.add('total_active');
					if (data.queue.stream_length !== newData.queue.stream_length) changed.add('queue');
					
					// Check per-worker stats
					for (const worker of newData.workers) {
						const prev = data.workers.find(w => w.worker_id === worker.worker_id);
						if (prev) {
							if (prev.jobs_processed !== worker.jobs_processed) changed.add(`${worker.worker_id}_proc`);
							if (prev.current_jobs !== worker.current_jobs) changed.add(`${worker.worker_id}_active`);
							if (prev.memory_mb !== worker.memory_mb) changed.add(`${worker.worker_id}_mem`);
						}
					}
					
					if (changed.size > 0) {
						changedFields = changed;
						// Clear flash after animation
						setTimeout(() => { changedFields = new Set(); }, 300);
					}
				}
				
				prevData = data;
				data = newData;
				error = null;
			} else if (res.status === 404) {
				data = null;
				error = null;
			} else {
				error = 'Failed to fetch workers';
			}
		} catch (e) {
			data = null;
			error = null;
		} finally {
			loading = false;
		}
	}
	
	function isChanged(field: string): boolean {
		return changedFields.has(field);
	}
	
	function formatUptime(secs: number): string {
		if (secs < 60) return `${secs}s`;
		if (secs < 3600) return `${Math.floor(secs / 60)}m`;
		if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
		return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
	}
	
	function formatLastSeen(timestamp: string): string {
		const diff = Date.now() - new Date(timestamp).getTime();
		if (diff < 5000) return 'now';
		if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
		return new Date(timestamp).toLocaleTimeString();
	}
	
	onMount(() => {
		fetchWorkers();
		pollInterval = setInterval(fetchWorkers, 1000); // 1s polling for real-time updates
		
		return () => {
			if (pollInterval) clearInterval(pollInterval);
		};
	});
</script>

<div class="h-full flex flex-col text-[11px]">
	{#if loading}
		<!-- Loading state -->
		<div class="flex-1 flex items-center justify-center" style="color: var(--tui-text-dim);">
			<div class="text-center">
				<div class="mb-2 animate-pulse">[ ... ]</div>
				<p>Connecting to workers</p>
			</div>
		</div>
	{:else if !data || data.workers.length === 0}
		<!-- No workers -->
		<div class="flex-1 flex flex-col">
			<div class="px-3 py-1.5" style="border-bottom: 1px solid var(--tui-border);">
				<span style="color: var(--tui-text-dim);">WORKERS</span>
			</div>
			
			<div class="flex-1 flex items-center justify-center" style="color: var(--tui-text-dim);">
				<div class="text-center max-w-[280px]">
					<div class="mb-3 text-lg">○</div>
					<p class="mb-2">No workers connected</p>
					<p class="text-[10px] opacity-60">
						Run <code class="px-1" style="background: var(--tui-accent);">cargo run --release</code> in worker/
					</p>
				</div>
			</div>
		</div>
	{:else}
		<!-- Global Stats Bar -->
		<div class="px-3 py-2 grid grid-cols-5 gap-4" style="border-bottom: 1px solid var(--tui-border); background: var(--tui-bg-elevated);">
			<div>
				<div class="flex items-center gap-1">
					<span style="color: #10b981;">●</span>
					<span class="font-bold" style="color: #10b981;">{data.workers.filter(w => w.status === 'healthy').length}</span>
				</div>
				<div style="color: var(--tui-text-dim);">WORKERS</div>
			</div>
			<div>
				<div class="flex items-center gap-1">
					<span style="color: {data.queue.stream_length > 0 ? '#f59e0b' : 'var(--tui-text-dim)'};">◉</span>
					<span class="font-bold flash-value" class:flash={isChanged('queue')} style="color: {data.queue.stream_length > 0 ? '#f59e0b' : 'var(--tui-text)'};">{data.queue.stream_length}</span>
				</div>
				<div style="color: var(--tui-text-dim);">QUEUE</div>
			</div>
			<div>
				<div class="flex items-center gap-1">
					<span style="color: #3b82f6;">▲</span>
					<span class="font-bold flash-value" class:flash={isChanged('total_active')} style="color: #3b82f6;">{data.totals.active_jobs}</span>
				</div>
				<div style="color: var(--tui-text-dim);">ACTIVE</div>
			</div>
			<div>
				<div class="flex items-center gap-1">
					<span style="color: var(--tui-text-dim);">◆</span>
					<span class="font-bold flash-value" class:flash={isChanged('total_processed')}>{data.totals.jobs_processed.toLocaleString()}</span>
				</div>
				<div style="color: var(--tui-text-dim);">PROCESSED</div>
			</div>
			<div>
				<div class="flex items-center gap-1">
					<span style="color: #a855f7;">▸</span>
					<span class="font-bold" style="color: #a855f7;">{data.totals.throughput_per_min}</span>
				</div>
				<div style="color: var(--tui-text-dim);">JOBS/MIN</div>
			</div>
		</div>
		
		<!-- Workers List -->
		<div class="flex-1 overflow-auto">
			{#each data.workers as worker, i}
				<div 
					class="px-3 py-2"
					style="border-bottom: 1px solid var(--tui-border);"
				>
					<!-- Header row -->
					<div class="flex items-center justify-between mb-1.5">
						<div class="flex items-center gap-2">
							<span style="color: {worker.status === 'healthy' ? '#10b981' : '#ef4444'};">●</span>
							<span class="font-bold">{worker.worker_id}</span>
						</div>
						<span style="color: var(--tui-text-dim);">{formatLastSeen(worker.last_seen)}</span>
					</div>
					
					<!-- Stats row - terminal style -->
					<div class="flex gap-6" style="color: var(--tui-text-dim);">
						<div>
							<span>ACTIVE</span>
							<span class="ml-2 font-bold flash-value" class:flash={isChanged(`${worker.worker_id}_active`)} style="color: {worker.current_jobs > 0 ? '#3b82f6' : 'var(--tui-text)'};">{worker.current_jobs}</span>
						</div>
						<div>
							<span>PROC</span>
							<span class="ml-2 font-bold flash-value" class:flash={isChanged(`${worker.worker_id}_proc`)} style="color: var(--tui-text);">{worker.jobs_processed.toLocaleString()}</span>
						</div>
						<div>
							<span>MEM</span>
							<span class="ml-2 font-bold flash-value" class:flash={isChanged(`${worker.worker_id}_mem`)} style="color: var(--tui-text);">{worker.memory_mb}MB</span>
						</div>
						<div>
							<span>UP</span>
							<span class="ml-2 font-bold" style="color: var(--tui-text);">{formatUptime(worker.uptime_secs)}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.flash-value {
		transition: background-color 0.3s ease-out;
		padding: 0 2px;
		border-radius: 2px;
	}
	
	.flash {
		background-color: rgba(59, 130, 246, 0.4); /* blue flash */
		animation: flash-out 0.3s ease-out forwards;
	}
	
	@keyframes flash-out {
		0% {
			background-color: rgba(59, 130, 246, 0.4);
		}
		100% {
			background-color: transparent;
		}
	}
</style>
