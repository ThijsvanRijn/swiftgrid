<script lang="ts">
	interface Props {
		isOpen: boolean;
		onClose: () => void;
		schedule: ScheduleConfig;
		onSave: (schedule: ScheduleConfig) => void;
		workflowName: string | null;
		workflowId: number | null;
	}

	interface ScheduleConfig {
		enabled: boolean;
		cron: string;
		timezone: string;
		inputData: string;
		overlapMode: 'skip' | 'queue_one' | 'parallel';
		nextRun?: string;
	}

	let { isOpen, onClose, schedule, onSave, workflowName, workflowId }: Props = $props();

	// Local state for editing
	let enabled = $state(schedule.enabled);
	let cron = $state(schedule.cron);
	let timezone = $state(schedule.timezone);
	let inputData = $state(schedule.inputData);
	let overlapMode = $state(schedule.overlapMode);
	let cronError = $state('');

	// Common cron presets
	const CRON_PRESETS = [
		{ label: 'Every minute', value: '* * * * *' },
		{ label: 'Every 5 min', value: '*/5 * * * *' },
		{ label: 'Every 15 min', value: '*/15 * * * *' },
		{ label: 'Every hour', value: '0 * * * *' },
		{ label: 'Daily midnight', value: '0 0 * * *' },
		{ label: 'Daily 9am', value: '0 9 * * *' },
		{ label: 'Weekdays 9am', value: '0 9 * * 1-5' },
		{ label: 'Monday 9am', value: '0 9 * * 1' },
	];

	// Common timezones
	const TIMEZONES = [
		{ label: 'UTC', value: 'UTC' },
		{ label: 'New York', value: 'America/New_York' },
		{ label: 'Los Angeles', value: 'America/Los_Angeles' },
		{ label: 'London', value: 'Europe/London' },
		{ label: 'Amsterdam', value: 'Europe/Amsterdam' },
		{ label: 'Tokyo', value: 'Asia/Tokyo' },
		{ label: 'Sydney', value: 'Australia/Sydney' },
	];

	// Validate cron expression
	$effect(() => {
		if (cron && enabled) {
			validateCron();
		} else {
			cronError = '';
		}
	});

	function validateCron() {
		const parts = cron.split(' ');
		if (parts.length !== 5) {
			cronError = 'Expected 5 fields: minute hour day month weekday';
			return;
		}
		cronError = '';
	}

	function handleSave() {
		onSave({
			enabled,
			cron,
			timezone,
			inputData,
			overlapMode,
		});
		onClose();
	}

	function handlePresetClick(preset: string) {
		cron = preset;
	}

	let cleaningUp = $state(false);
	
	async function handleCleanup() {
		if (!confirm('This will delete all pending/running cron runs. Continue?')) {
			return;
		}
		cleaningUp = true;
		try {
			const res = await fetch('/api/flows/schedule/cleanup', { method: 'POST' });
			const data = await res.json();
			if (res.ok) {
				alert(data.message);
			} else {
				alert(data.error || 'Failed to cleanup');
			}
		} catch {
			alert('Failed to cleanup');
		} finally {
			cleaningUp = false;
		}
	}

	// Reset local state when schedule prop changes
	$effect(() => {
		enabled = schedule.enabled;
		cron = schedule.cron;
		timezone = schedule.timezone;
		inputData = schedule.inputData;
		overlapMode = schedule.overlapMode;
	});
</script>

{#if isOpen}
	<div class="w-[360px] bg-panel border border-panel-border rounded-none text-sidebar-foreground flex flex-col shadow-float pointer-events-auto h-full overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/>
					<path d="M12 6v6l4 2"/>
				</svg>
				<div class="flex flex-col">
					<span class="text-sm font-medium">Schedule</span>
					{#if workflowName}
						<span class="text-[10px] text-muted-foreground truncate max-w-[200px]">
							{workflowName} {workflowId ? `(#${workflowId})` : ''}
						</span>
					{/if}
				</div>
				{#if enabled}
					<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
				{/if}
			</div>
			<button
				onclick={onClose}
				class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
				title="Close"
			>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-3 space-y-4">
			<!-- Enable toggle -->
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium">Enable scheduled runs</span>
				<label class="relative cursor-pointer">
					<input
						type="checkbox"
						bind:checked={enabled}
						class="sr-only peer"
					/>
					<div class="w-9 h-5 bg-muted rounded-full peer-checked:bg-amber-500 transition-colors"></div>
					<div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform"></div>
				</label>
			</div>

			{#if enabled}
				<!-- Cron expression -->
				<div>
					<span class="block text-xs font-medium mb-1.5">Cron Expression</span>
					<input
						type="text"
						bind:value={cron}
						placeholder="0 9 * * 1-5"
						class="w-full bg-input border border-input-border rounded-none px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
					/>
					{#if cronError}
						<p class="text-[10px] text-red-500 mt-1">{cronError}</p>
					{/if}
					<p class="text-[10px] text-muted-foreground mt-1">
						minute hour day month weekday
					</p>
				</div>

				<!-- Quick presets -->
				<div>
					<span class="block text-xs font-medium mb-1.5">Quick Presets</span>
					<div class="flex flex-wrap gap-1">
						{#each CRON_PRESETS as preset}
							<button
								onclick={() => handlePresetClick(preset.value)}
								class="px-2 py-1 text-[10px] rounded-none border transition-colors {cron === preset.value 
									? 'bg-amber-500/20 border-amber-500 text-amber-500' 
									: 'border-border hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground'}"
							>
								{preset.label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Timezone -->
				<div>
					<span class="block text-xs font-medium mb-1.5">Timezone</span>
					<select
						bind:value={timezone}
						class="w-full bg-input border border-input-border rounded-none px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
					>
						{#each TIMEZONES as tz}
							<option value={tz.value}>{tz.label}</option>
						{/each}
					</select>
				</div>

				<!-- Overlap mode -->
				<div>
					<span class="block text-xs font-medium mb-1.5">If previous run is active</span>
					<select
						bind:value={overlapMode}
						class="w-full bg-input border border-input-border rounded-none px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
					>
						<option value="skip">Skip this run</option>
						<option value="queue_one">Queue one run</option>
						<option value="parallel">Run in parallel</option>
					</select>
					<p class="text-[10px] text-muted-foreground mt-1">
						{#if overlapMode === 'skip'}
							Skip if previous scheduled run is still running
						{:else if overlapMode === 'queue_one'}
							Queue at most one pending run
						{:else}
							Run multiple instances in parallel
						{/if}
					</p>
				</div>

				<!-- Input data -->
				<div>
					<span class="block text-xs font-medium mb-1.5">Input Data (JSON)</span>
					<textarea
						bind:value={inputData}
						placeholder={'{\n  "source": "cron"\n}'}
						rows="3"
						class="w-full bg-input border border-input-border rounded-none px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-none"
					></textarea>
					<p class="text-[10px] text-muted-foreground mt-1">
						Static input for every scheduled run
					</p>
				</div>

				<!-- Cron syntax help -->
				<div class="p-2.5 bg-sidebar-accent/30 rounded-none border border-sidebar-border">
					<span class="text-[10px] font-semibold text-muted-foreground block mb-1.5">Cron Syntax</span>
					<div class="text-[9px] font-mono text-muted-foreground leading-relaxed">
						<div>┌─ minute (0-59)</div>
						<div>│ ┌─ hour (0-23)</div>
						<div>│ │ ┌─ day (1-31)</div>
						<div>│ │ │ ┌─ month (1-12)</div>
						<div>│ │ │ │ ┌─ weekday (0-6)</div>
						<div>* * * * *</div>
					</div>
					<p class="text-[9px] text-muted-foreground mt-1.5">
						* any, */n every n, n-m range, n,m list
					</p>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="px-3 py-2.5 border-t border-sidebar-border bg-sidebar-accent/30 space-y-2">
			<button
				onclick={handleSave}
				class="w-full py-1.5 text-xs font-medium rounded-none transition-colors {enabled 
					? 'bg-amber-600 hover:bg-amber-700 text-white' 
					: 'bg-muted hover:bg-muted/80 text-muted-foreground'}"
			>
				{enabled ? 'Save Schedule' : 'Save (Disabled)'}
			</button>
			{#if schedule.nextRun}
				<p class="text-[10px] text-center text-muted-foreground">
					Next: {new Date(schedule.nextRun).toLocaleString()}
				</p>
			{/if}
			<button
				onclick={handleCleanup}
				disabled={cleaningUp}
				class="w-full py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-none transition-colors disabled:opacity-50"
			>
				{cleaningUp ? 'Cleaning...' : 'Cleanup Stuck Cron Runs'}
			</button>
		</div>
	</div>
{/if}
