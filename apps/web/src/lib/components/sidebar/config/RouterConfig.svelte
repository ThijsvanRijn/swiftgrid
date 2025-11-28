<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import type { RouterCondition } from '@swiftgrid/shared';

	// Router condition helpers
	function addCondition() {
		if (!flowStore.selectedNode) return;
		const conditions = [...(flowStore.selectedNode.data.conditions || [])];
		const id = `cond_${Math.random().toString(36).substr(2, 6)}`;
		conditions.push({ id, label: 'New Condition', expression: 'value === true' });
		flowStore.updateNodeData('conditions', conditions);
	}

	function updateCondition(index: number, field: keyof RouterCondition, value: string) {
		if (!flowStore.selectedNode) return;
		const conditions = [...(flowStore.selectedNode.data.conditions || [])];
		conditions[index] = { ...conditions[index], [field]: value };
		flowStore.updateNodeData('conditions', conditions);
	}

	function removeCondition(index: number) {
		if (!flowStore.selectedNode) return;
		const conditions = [...(flowStore.selectedNode.data.conditions || [])];
		conditions.splice(index, 1);
		flowStore.updateNodeData('conditions', conditions);
	}

	function moveCondition(index: number, direction: 'up' | 'down') {
		if (!flowStore.selectedNode) return;
		const conditions = [...(flowStore.selectedNode.data.conditions || [])];
		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= conditions.length) return;
		[conditions[index], conditions[newIndex]] = [conditions[newIndex], conditions[index]];
		flowStore.updateNodeData('conditions', conditions);
	}
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-purple-500/5 border border-purple-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-purple-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M6 3v12"/>
			<circle cx="18" cy="6" r="3"/>
			<circle cx="18" cy="18" r="3"/>
			<path d="M6 15a6 6 0 0 0 6-6 6 6 0 0 1 6-6"/>
		</svg>
		<div>
			<span class="font-medium">Router Node</span>
			<p class="text-muted-foreground mt-0.5">Conditional branching based on data. Evaluates conditions in order and routes to the first match (or broadcasts to all matching).</p>
		</div>
	</div>

	<!-- Route By expression -->
	<div class="flex flex-col gap-1.5">
		<label for="routeBy" class="text-[11px] font-medium text-muted-foreground">
			Route By
		</label>
		<input
			id="routeBy"
			type="text"
			value={flowStore.selectedNode.data.routeBy || ''}
			oninput={(e) => flowStore.updateNodeData('routeBy', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			placeholder={'{{prev.status}}'}
		/>
		<span class="text-[10px] text-muted-foreground/60">
			The value to evaluate. Use <code class="bg-sidebar-accent px-1 py-0.5 rounded">{'{{node_id.field}}'}</code> syntax.
		</span>
	</div>

	<!-- Mode select -->
	<div class="flex flex-col gap-1.5">
		<label for="routerMode" class="text-[11px] font-medium text-muted-foreground">
			Evaluation Mode
		</label>
		<select
			id="routerMode"
			value={flowStore.selectedNode.data.routerMode || 'first_match'}
			onchange={(e) => flowStore.updateNodeData('routerMode', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground"
		>
			<option value="first_match">First Match — Stop at first true condition</option>
			<option value="broadcast">Broadcast — Fire all matching branches</option>
		</select>
	</div>

	<!-- Conditions list -->
	<div class="flex flex-col gap-2">
		<div class="flex justify-between items-center">
			<span class="text-[11px] font-medium text-muted-foreground">
				Conditions
			</span>
			<button
				onclick={addCondition}
				class="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
			>
				+ Add condition
			</button>
		</div>

		{#if (flowStore.selectedNode.data.conditions || []).length > 0}
			<div class="flex flex-col gap-2">
				{#each flowStore.selectedNode.data.conditions as condition, i}
					<div class="border border-input rounded-none p-3 bg-sidebar-accent/30 flex flex-col gap-2">
						<div class="flex items-center gap-2">
							<!-- Reorder buttons -->
							<div class="flex flex-col gap-0.5">
								<button
									onclick={() => moveCondition(i, 'up')}
									disabled={i === 0}
									class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
									title="Move up"
								>
									<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="m18 15-6-6-6 6"/>
									</svg>
								</button>
								<button
									onclick={() => moveCondition(i, 'down')}
									disabled={i === (flowStore.selectedNode?.data.conditions?.length || 0) - 1}
									class="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
									title="Move down"
								>
									<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="m6 9 6 6 6-6"/>
									</svg>
								</button>
							</div>

							<!-- Label input -->
							<input
								type="text"
								value={condition.label}
								oninput={(e) => updateCondition(i, 'label', e.currentTarget.value)}
								class="grow text-xs px-2 py-1.5 rounded-none border border-input bg-sidebar-accent/50 focus:ring-2 focus:ring-ring/50 outline-none text-foreground font-medium"
								placeholder="Label"
							/>

							<!-- Output handle ID (read-only) -->
							<code class="text-[9px] text-muted-foreground/60 bg-sidebar-accent px-1.5 py-0.5 rounded font-mono">
								{condition.id}
							</code>

							<!-- Remove button -->
							<button
								onclick={() => removeCondition(i)}
								class="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
								title="Remove condition"
							>
								<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M18 6L6 18M6 6l12 12"/>
								</svg>
							</button>
						</div>

						<!-- Expression input -->
						<div class="flex items-center gap-2 pl-6">
							<span class="text-[10px] text-muted-foreground/60 shrink-0">when</span>
							<input
								type="text"
								value={condition.expression}
								oninput={(e) => updateCondition(i, 'expression', e.currentTarget.value)}
								class="grow text-xs px-2 py-1.5 rounded-none border border-input bg-sidebar-accent/50 focus:ring-2 focus:ring-ring/50 outline-none font-mono text-foreground"
								placeholder="value >= 200 && value < 300"
							/>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="text-xs text-muted-foreground/60 py-3 px-3 border border-dashed border-input rounded-none text-center">
				No conditions configured
			</div>
		{/if}
	</div>

	<!-- Default output -->
	<div class="flex flex-col gap-1.5">
		<label for="defaultOutput" class="text-[11px] font-medium text-muted-foreground">
			Default Output Handle
		</label>
		<input
			id="defaultOutput"
			type="text"
			value={flowStore.selectedNode.data.defaultOutput || 'default'}
			oninput={(e) => flowStore.updateNodeData('defaultOutput', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground"
			placeholder="default"
		/>
		<span class="text-[10px] text-muted-foreground/60">
			Output handle used when no conditions match. Leave empty to skip (no output).
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
			placeholder="Status Router"
		/>
	</div>

	<!-- Expression help -->
	<div class="flex flex-col gap-3 border-t border-sidebar-border pt-4">
		<span class="text-[11px] font-medium text-muted-foreground">Expression Reference</span>
		
		<div class="flex flex-col gap-2 text-[10px] text-muted-foreground/80">
			<p>Conditions are JavaScript expressions. The <code class="bg-sidebar-accent px-1 py-0.5 rounded text-foreground/80">value</code> variable contains the resolved "Route By" value.</p>
			
			<div class="bg-sidebar-accent/50 rounded-none border border-input p-2 font-mono text-[9px] flex flex-col gap-1">
				<div><span class="text-purple-400">// Numeric comparisons</span></div>
				<div>value &gt;= 200 && value &lt; 300</div>
				<div>value === 404</div>
				<div><span class="text-purple-400">// String matching</span></div>
				<div>value === 'approved'</div>
				<div>value.includes('error')</div>
				<div><span class="text-purple-400">// Boolean</span></div>
				<div>value === true</div>
			</div>
		</div>
	</div>
{/if}

