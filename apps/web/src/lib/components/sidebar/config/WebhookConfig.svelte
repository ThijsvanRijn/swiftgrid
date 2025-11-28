<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-purple-500/5 border border-purple-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-purple-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
			<path d="m6 17 3.13-5.78c.53-.97.43-2.22-.26-3.07a4 4 0 0 1 6.92-4.01"/>
			<path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
		</svg>
		<div>
			<span class="font-medium">Webhook Wait</span>
			<p class="text-muted-foreground mt-0.5">Suspends workflow execution until an external system sends a POST request to resume. No compute resources are consumed while waiting.</p>
		</div>
	</div>

	<!-- Description -->
	<div class="flex flex-col gap-1.5">
		<label for="description" class="text-[11px] font-medium text-muted-foreground">
			Description
		</label>
		<input
			id="description"
			type="text"
			value={flowStore.selectedNode.data.description || ''}
			oninput={(e) => flowStore.updateNodeData('description', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/50"
			placeholder="Wait for manager approval"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Describe what this step is waiting for
		</span>
	</div>

	<!-- Timeout -->
	<div class="flex flex-col gap-1.5">
		<label for="timeoutStr" class="text-[11px] font-medium text-muted-foreground">
			Timeout Duration
		</label>
		<input
			id="timeoutStr"
			type="text"
			value={flowStore.selectedNode.data.timeoutStr || '7d'}
			oninput={(e) => {
				const str = e.currentTarget.value;
				flowStore.updateNodeData('timeoutStr', str);
				// Parse to ms
				const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
				if (match) {
					const num = parseFloat(match[1]);
					const unit = (match[2] || 'd').toLowerCase();
					const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
					flowStore.updateNodeData('timeoutMs', num * (multipliers[unit] || 86400000));
				}
			}}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground"
			placeholder="7d"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Examples: 5m, 1h, 7d — Workflow fails if not resumed within this time
		</span>
	</div>

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
			placeholder="Await Approval"
		/>
	</div>

	<!-- Resume instructions -->
	<div class="flex flex-col gap-3 border-t border-sidebar-border pt-4">
		<span class="text-[11px] font-medium text-muted-foreground">How to Resume</span>
		
		<div class="flex flex-col gap-2">
			<p class="text-[10px] text-muted-foreground/80">
				When this node executes, a unique resume token is generated. Send a POST request to continue the workflow:
			</p>
			
			<div class="flex items-center justify-between px-3 py-2 bg-sidebar-accent/50 rounded-none border border-input group">
				<code class="text-[10px] font-mono text-foreground">POST /api/hooks/resume/[token]</code>
			</div>
			
			<p class="text-[10px] text-muted-foreground/80">
				The JSON payload you send will be available in subsequent nodes as:
			</p>
			
			<div class="flex items-center justify-between px-3 py-2 bg-sidebar-accent/50 rounded-none border border-input group">
				<code class="text-[10px] font-mono text-purple-500">{'{{'}node_id.webhook_payload{'}}'}</code>
			</div>
		</div>
	</div>
{/if}

