<script lang="ts">
	import { themeStore } from '$lib/stores/themeStore.svelte';

	type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

	interface ActiveSchedule {
		workflowId: number;
		workflowName: string;
		cron: string;
		timezone: string;
		nextRun: string | null;
	}

	interface Props {
		sseStatus: ConnectionStatus;
		onAddHttpNode: () => void;
		onAddCodeNode: () => void;
		onAddDelayNode: () => void;
		onAddWebhookWaitNode: () => void;
		onAddRouterNode: () => void;
		onAddLlmNode: () => void;
		onSave: () => void;
		onRun: () => void;
		onOpenHistory: () => void;
		onOpenSchedule: () => void;
		onOpenVersions: () => void;
		onPublish: () => void;
		scheduleEnabled?: boolean;
		activeVersionNumber?: number | null;
		hasUnpublishedChanges?: boolean;
	}

	let { 
		sseStatus, 
		onAddHttpNode, 
		onAddCodeNode, 
		onAddDelayNode, 
		onAddWebhookWaitNode, 
		onAddRouterNode, 
		onAddLlmNode, 
		onSave, 
		onRun, 
		onOpenHistory, 
		onOpenSchedule,
		onOpenVersions,
		onPublish,
		scheduleEnabled = false,
		activeVersionNumber = null,
		hasUnpublishedChanges = false
	}: Props = $props();

	// Active schedules state
	let activeSchedules = $state<ActiveSchedule[]>([]);
	let showScheduleDropdown = $state(false);

	// Load active schedules
	async function loadActiveSchedules() {
		try {
			const res = await fetch('/api/schedules/active');
			const data = await res.json();
			if (res.ok) {
				activeSchedules = data.schedules || [];
			}
		} catch (e) {
			console.error('Failed to load active schedules:', e);
		}
	}

	// Load on mount and refresh periodically
	$effect(() => {
		loadActiveSchedules();
		const interval = setInterval(loadActiveSchedules, 10000); // Refresh every 10s
		return () => clearInterval(interval);
	});

	// Format next run time
	function formatNextRun(nextRun: string | null): string {
		if (!nextRun) return 'Unknown';
		const date = new Date(nextRun);
		const now = new Date();
		const diff = date.getTime() - now.getTime();
		
		if (diff < 0) return 'Overdue';
		if (diff < 60000) return 'In < 1 min';
		if (diff < 3600000) return `In ${Math.round(diff / 60000)} min`;
		if (diff < 86400000) return `In ${Math.round(diff / 3600000)}h`;
		return date.toLocaleDateString();
	}
</script>

<div class="bg-panel border border-panel-border rounded-none shadow-float pointer-events-auto px-4 py-2 flex items-center justify-between">
	<!-- Left: Logo -->
	<div class="flex items-center gap-3">
		<h1 class="font-semibold text-base tracking-tight">SwiftGrid</h1>
		
		<!-- Connection status -->
		<div class="flex items-center gap-1.5" title={
			sseStatus === 'connected' ? 'Receiving results from worker' :
			sseStatus === 'connecting' ? 'Connecting to stream...' : 'Connection lost'
		}>
			<span class={`w-1.5 h-1.5 rounded-full ${
				sseStatus === 'connected' ? 'bg-emerald-500' :
				sseStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500 animate-pulse'
			}`}></span>
			<span class="text-xs text-muted-foreground">
				{sseStatus === 'connected' ? 'Live' : sseStatus === 'connecting' ? 'Connecting...' : 'Offline'}
			</span>
		</div>
	</div>

	<!-- Right: Actions -->
	<div class="flex items-center gap-2">
		<!-- Add node buttons -->
		<button
			onclick={onAddHttpNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ HTTP
		</button>
		<button
			onclick={onAddCodeNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Code
		</button>
		<button
			onclick={onAddDelayNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Delay
		</button>
		<button
			onclick={onAddWebhookWaitNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Webhook
		</button>
		<button
			onclick={onAddRouterNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			+ Router
		</button>
		<button
			onclick={onAddLlmNode}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-cyan-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
		>
			+ LLM
		</button>

		<div class="w-px h-5 bg-border mx-1"></div>

		<!-- Schedule button with global indicator -->
		<div class="relative">
			<button
				onclick={onOpenSchedule}
				onmouseenter={() => showScheduleDropdown = true}
				onmouseleave={() => showScheduleDropdown = false}
				class="px-3 py-1.5 text-xs font-medium rounded-none transition-colors flex items-center gap-1.5 {scheduleEnabled ? 'text-amber-500 hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}"
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/>
					<path d="M12 6v6l4 2"/>
				</svg>
				Schedule
				{#if activeSchedules.length > 0}
					<span class="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold bg-amber-500 text-amber-950 rounded-full px-1">
						{activeSchedules.length}
					</span>
				{:else if scheduleEnabled}
					<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
				{/if}
			</button>

			<!-- Dropdown showing active schedules -->
			{#if showScheduleDropdown && activeSchedules.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div 
					class="absolute top-full right-0 mt-1 w-72 bg-panel border border-panel-border shadow-float z-50"
					onmouseenter={() => showScheduleDropdown = true}
					onmouseleave={() => showScheduleDropdown = false}
				>
					<div class="px-3 py-2 border-b border-panel-border">
						<span class="text-xs font-medium">Active Schedules ({activeSchedules.length})</span>
					</div>
					<div class="max-h-64 overflow-y-auto">
						{#each activeSchedules as schedule}
							<div class="px-3 py-2 border-b border-panel-border/50 last:border-b-0 hover:bg-sidebar-accent/30">
								<div class="flex items-center justify-between">
									<span class="text-xs font-medium truncate max-w-[180px]">{schedule.workflowName}</span>
									<span class="text-[10px] text-muted-foreground">#{schedule.workflowId}</span>
								</div>
								<div class="flex items-center gap-2 mt-1">
									<code class="text-[10px] text-muted-foreground bg-sidebar-accent/50 px-1 py-0.5 rounded-sm">
										{schedule.cron}
									</code>
									<span class="text-[10px] text-amber-500">
										{formatNextRun(schedule.nextRun)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- History button -->
		<button
			onclick={onOpenHistory}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors flex items-center gap-1.5"
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 8v4l3 3"/>
				<circle cx="12" cy="12" r="10"/>
			</svg>
			History
		</button>

		<!-- Version indicator + Versions button -->
		<button
			onclick={onOpenVersions}
			class="px-3 py-1.5 text-xs font-medium rounded-none transition-colors flex items-center gap-1.5 {hasUnpublishedChanges ? 'text-amber-500 hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}"
			title={activeVersionNumber ? `Version ${activeVersionNumber}${hasUnpublishedChanges ? ' (modified)' : ''}` : 'No published version'}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 3v18"/>
				<path d="M18 9l-6-6-6 6"/>
				<path d="M6 15l6 6 6-6"/>
			</svg>
			{#if activeVersionNumber}
				v{activeVersionNumber}
				{#if hasUnpublishedChanges}
					<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
				{/if}
			{:else}
				Draft
			{/if}
		</button>

		<!-- Publish button -->
		<button
			onclick={onPublish}
			class="px-3 py-1.5 text-xs font-medium rounded-none transition-colors {hasUnpublishedChanges || !activeVersionNumber ? 'text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'}"
			title={hasUnpublishedChanges ? 'Publish changes' : (activeVersionNumber ? 'No changes to publish' : 'Publish first version')}
		>
			<svg class="w-3.5 h-3.5 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 19V5"/>
				<path d="M5 12l7-7 7 7"/>
			</svg>
			Publish
		</button>

		<!-- Save button -->
		<button
			id="saveBtn"
			onclick={onSave}
			class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
		>
			Save
		</button>

		<!-- Run button -->
		<button
			onclick={onRun}
			class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-none text-xs font-medium transition-colors"
		>
			Run Flow
		</button>

		<div class="w-px h-5 bg-border mx-1"></div>

		<!-- Theme toggle -->
		<button
			onclick={themeStore.toggle}
			class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
			title="Toggle Theme"
		>
			{#if themeStore.isDark}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
			{/if}
		</button>
	</div>
</div>

