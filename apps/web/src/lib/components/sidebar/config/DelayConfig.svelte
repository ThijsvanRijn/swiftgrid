<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-amber-500/5 border border-amber-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-amber-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="12" cy="12" r="10"/>
			<polyline points="12 6 12 12 16 14"/>
		</svg>
		<div>
			<span class="font-medium">Delay Node</span>
			<p class="text-muted-foreground mt-0.5">Pause workflow execution for a specified duration before continuing to the next step.</p>
		</div>
	</div>

	<!-- Delay Duration -->
	<div class="flex flex-col gap-1.5">
		<label for="delayStr" class="text-[11px] font-medium text-muted-foreground">
			Wait Duration
		</label>
		<input
			id="delayStr"
			type="text"
			value={flowStore.selectedNode.data.delayStr || '5s'}
			oninput={(e) => {
				const str = e.currentTarget.value;
				flowStore.updateNodeData('delayStr', str);
				// Parse to ms
				const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
				if (match) {
					const num = parseFloat(match[1]);
					const unit = (match[2] || 's').toLowerCase();
					const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
					flowStore.updateNodeData('delayMs', num * (multipliers[unit] || 1000));
				}
			}}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground"
			placeholder="5s"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Examples: 30s, 5m, 2h, 1d
		</span>
	</div>

	<!-- Computed display -->
	{#if (flowStore.selectedNode.data.delayMs || 0) > 60000}
		<div class="bg-sidebar-accent/30 border border-input p-3 rounded-none text-xs flex items-start gap-2.5">
			<svg class="w-4 h-4 text-amber-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 9v4"/>
				<path d="M12 17h.01"/>
				<path d="M3.6 9h16.8a1 1 0 0 1 .9 1.45l-8.4 14.48a1 1 0 0 1-1.8 0L2.7 10.45A1 1 0 0 1 3.6 9z"/>
			</svg>
			<div>
				<span class="font-medium text-foreground">Scheduled Resume</span>
				<p class="text-muted-foreground mt-0.5">Delays over 60 seconds are scheduled via the database. The worker is released immediately and the workflow resumes automatically.</p>
			</div>
		</div>
	{/if}

	<!-- Node label -->
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
			placeholder="Wait 5 minutes"
		/>
	</div>
{/if}

