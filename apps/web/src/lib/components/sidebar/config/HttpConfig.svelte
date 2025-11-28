<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';

	// Header helpers
	function updateHeaderKey(oldKey: string, newKey: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		const value = headers[oldKey];
		delete headers[oldKey];
		headers[newKey] = value;
		flowStore.updateNodeData('headers', headers);
	}

	function updateHeaderValue(key: string, newValue: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		headers[key] = newValue;
		flowStore.updateNodeData('headers', headers);
	}

	function removeHeader(key: string) {
		if (!flowStore.selectedNode) return;
		const headers = { ...flowStore.selectedNode.data.headers };
		delete headers[key];
		flowStore.updateNodeData('headers', headers);
	}
</script>

{#if flowStore.selectedNode}
	<!-- URL field -->
	<div class="flex flex-col gap-1.5">
		<label for="url" class="text-[11px] font-medium text-muted-foreground">
			Target URL
		</label>
		<input
			id="url"
			type="text"
			value={flowStore.selectedNode.data.url}
			oninput={(e) => flowStore.updateNodeData('url', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			placeholder="https://api.example.com"
		/>
	</div>

	<!-- Method select -->
	<div class="flex flex-col gap-1.5">
		<label for="method" class="text-[11px] font-medium text-muted-foreground">
			HTTP Method
		</label>
		<select
			id="method"
			value={flowStore.selectedNode.data.method}
			onchange={(e) => flowStore.updateNodeData('method', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground"
		>
			<option value="GET">GET</option>
			<option value="POST">POST</option>
			<option value="PUT">PUT</option>
			<option value="DELETE">DELETE</option>
			<option value="PATCH">PATCH</option>
		</select>
	</div>

	<!-- Headers section -->
	<div class="flex flex-col gap-2">
		<div class="flex justify-between items-center">
			<span class="text-[11px] font-medium text-muted-foreground">
				Headers
			</span>
			<button
				onclick={() => {
					const key = `Header-${Math.floor(Math.random() * 100)}`;
					updateHeaderValue(key, '');
				}}
				class="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
			>
				+ Add header
			</button>
		</div>

		{#if flowStore.selectedNode.data.headers && Object.keys(flowStore.selectedNode.data.headers).length > 0}
			<div class="flex flex-col gap-1.5 border border-input rounded-none p-2 bg-sidebar-accent/30">
				{#each Object.entries(flowStore.selectedNode.data.headers) as [key, value]}
					<div class="flex gap-1.5 items-center">
						<input
							type="text"
							value={key}
							onchange={(e) => updateHeaderKey(key, e.currentTarget.value)}
							class="w-1/3 text-xs px-2 py-1.5 rounded-none border border-input bg-sidebar-accent/50 focus:ring-2 focus:ring-ring/50 outline-none font-mono text-foreground placeholder:text-muted-foreground/50"
							placeholder="Key"
						/>
						<span class="text-muted-foreground/50">:</span>
						<input
							type="text"
							value={value}
							oninput={(e) => updateHeaderValue(key, e.currentTarget.value)}
							class="grow text-xs px-2 py-1.5 rounded-none border border-input bg-sidebar-accent/50 focus:ring-2 focus:ring-ring/50 outline-none font-mono text-foreground placeholder:text-muted-foreground/50"
							placeholder="Value"
						/>
						<button
							onclick={() => removeHeader(key)}
							class="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
							title="Remove Header"
						>
							<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="text-xs text-muted-foreground/60 py-3 px-3 border border-dashed border-input rounded-none text-center">
				No headers configured
			</div>
		{/if}
	</div>

	<!-- JSON body -->
	<div class="flex flex-col gap-1.5">
		<div class="flex justify-between items-center">
			<label for="body" class="text-[11px] font-medium text-muted-foreground">
				Request Body
			</label>
			<span class="text-[10px] text-muted-foreground/60 bg-sidebar-accent px-1.5 py-0.5 rounded">Optional</span>
		</div>
		<textarea
			id="body"
			value={typeof flowStore.selectedNode.data.body === 'string'
				? flowStore.selectedNode.data.body
				: (flowStore.selectedNode.data.body ? JSON.stringify(flowStore.selectedNode.data.body, null, 2) : '')}
			oninput={(e) => flowStore.updateNodeData('body', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-xs font-mono min-h-[120px] focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/40 resize-none"
			placeholder={'{\n  "key": "{{node_1.body.value}}",\n  "secret": "{{$env.API_KEY}}"\n}'}
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
			placeholder="Fetch User Data"
		/>
	</div>
{/if}

