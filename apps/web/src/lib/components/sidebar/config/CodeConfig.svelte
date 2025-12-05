<script lang="ts">
	import MonacoLazy from '$lib/components/MonacoLazy.svelte';
	import { flowStore } from '$lib/stores/flowStore.svelte';
</script>

{#if flowStore.selectedNode}
	<!-- Code editor -->
	<div class="flex flex-col gap-1.5">
		<label for="code" class="text-[11px] font-medium text-muted-foreground">JavaScript Code</label>
		<div class="border border-input bg-sidebar-accent/30">
			<MonacoLazy
				value={flowStore.selectedNode.data.code || ''}
				language="javascript"
				readOnly={false}
				height="220px"
				onChange={(val) => flowStore.updateNodeData('code', val)}
			/>
		</div>
		<div class="text-[10px] text-muted-foreground/60">
			Available: <code class="bg-sidebar-accent px-1 py-0.5 rounded text-foreground/80">INPUT</code> variable contains mapped data.
		</div>
	</div>

	<!-- Input mapping -->
	<div class="flex flex-col gap-1.5">
		<label for="inputs" class="text-[11px] font-medium text-muted-foreground">Input Mapping</label>
		<textarea
			id="inputs"
			value={typeof flowStore.selectedNode.data.inputs === 'string' ? flowStore.selectedNode.data.inputs : JSON.stringify(flowStore.selectedNode.data.inputs, null, 2)}
			oninput={(e) => flowStore.updateNodeData('inputs', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-xs font-mono h-20 focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all text-foreground placeholder:text-muted-foreground/40 resize-none"
			placeholder={'{"arg1": "{{node_1.body.value}}"}'}
		></textarea>
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
			placeholder="Transform Data"
		/>
	</div>
{/if}