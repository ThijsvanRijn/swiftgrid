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
	{#if flowStore.selectedNode.type === 'http-request'}
		<!-- HTTP form -->
		<div class="flex flex-col gap-2">
			<label for="url" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
				Target URL
			</label>
			<input
				id="url"
				type="text"
				value={flowStore.selectedNode.data.url}
				oninput={(e) => flowStore.updateNodeData('url', e.currentTarget.value)}
				class="border border-input bg-background p-2.5 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow font-mono text-foreground"
				placeholder="https://api.example.com"
			/>
		</div>

		<div class="flex flex-col gap-2">
			<label for="method" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
				HTTP Method
			</label>
			<select
				id="method"
				value={flowStore.selectedNode.data.method}
				onchange={(e) => flowStore.updateNodeData('method', e.currentTarget.value)}
				class="w-full border border-input bg-background p-2 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all text-foreground"
			>
				<option value="GET">GET</option>
				<option value="POST">POST</option>
				<option value="PUT">PUT</option>
				<option value="DELETE">DELETE</option>
				<option value="PATCH">PATCH</option>
			</select>
		</div>

		<!-- Headers list -->
		<div class="flex flex-col gap-2">
			<div class="flex justify-between items-center">
				<span class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
					Headers
				</span>
				<button
					onclick={() => {
						const key = `New-Header-${Math.floor(Math.random() * 100)}`;
						updateHeaderValue(key, '');
					}}
					class="text-[10px] bg-accent hover:bg-accent-foreground text-accent-foreground px-2 py-1 rounded transition-colors"
				>
					+ Add
				</button>
			</div>

			{#if flowStore.selectedNode.data.headers && Object.keys(flowStore.selectedNode.data.headers).length > 0}
				<div class="flex flex-col gap-2 border border-sidebar-border rounded p-2 bg-sidebar-accent">
					{#each Object.entries(flowStore.selectedNode.data.headers) as [key, value]}
						<div class="flex gap-1 items-center">
							<input
								type="text"
								value={key}
								onchange={(e) => updateHeaderKey(key, e.currentTarget.value)}
								class="w-1/3 text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
								placeholder="Key"
							/>
							<span class="text-slate-400">:</span>
							<input
								type="text"
								value={value}
								oninput={(e) => updateHeaderValue(key, e.currentTarget.value)}
								class="grow text-xs p-1.5 rounded border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
								placeholder="Value"
							/>
							<button
								onclick={() => removeHeader(key)}
								class="text-slate-400 hover:text-red-500 px-1"
								title="Remove Header"
							>
								&times;
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<div class="text-xs text-slate-400 italic p-2 border border-dashed border-slate-200 rounded">
					No headers configured.
				</div>
			{/if}
		</div>

		<!-- JSON body -->
		<div class="flex flex-col gap-2 h-full">
			<div class="flex justify-between items-center">
				<label for="body" class="text-xs font-bold uppercase text-muted-foreground tracking-wider">
					JSON Body
				</label>
				<span class="text-[10px] text-muted-foreground bg-accent px-1 rounded">Optional</span>
			</div>
			<textarea
				id="body"
				value={typeof flowStore.selectedNode.data.body === 'string'
					? flowStore.selectedNode.data.body
					: (flowStore.selectedNode.data.body ? JSON.stringify(flowStore.selectedNode.data.body, null, 2) : '')}
				oninput={(e) => flowStore.updateNodeData('body', e.currentTarget.value)}
				class="border border-slate-300 p-2 rounded-md text-xs font-mono grow min-h-[150px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
				placeholder={'{"key": "{{node_1.body.value}}", "secret": "{{$env.API_KEY}}"}'}
			></textarea>
		</div>
	{/if}

	{#if flowStore.selectedNode.type === 'code-execution'}
		<!-- Code node editor -->
		<div class="flex flex-col gap-2 h-64">
			<label for="code" class="text-xs font-bold uppercase text-slate-500 tracking-wider">JavaScript Code</label>
			<textarea
				id="code"
				value={flowStore.selectedNode.data.code}
				oninput={(e) => flowStore.updateNodeData('code', e.currentTarget.value)}
				class="border border-slate-300 bg-slate-900 text-green-400 p-3 rounded-md text-xs font-mono grow focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
				placeholder={'return { value: 123 };'}
				spellcheck="false"
			></textarea>
			<div class="text-[10px] text-slate-400">
				Available: <code class="bg-slate-100 px-1">INPUT</code> variable contains mapped data.
			</div>
		</div>

		<!-- Inputs mapping -->
		<div class="flex flex-col gap-2">
			<label for="inputs" class="text-xs font-bold uppercase text-slate-500 tracking-wider">Input Mapping (JSON)</label>
			<textarea
				id="inputs"
				value={typeof flowStore.selectedNode.data.inputs === 'string' ? flowStore.selectedNode.data.inputs : JSON.stringify(flowStore.selectedNode.data.inputs, null, 2)}
				oninput={(e) => flowStore.updateNodeData('inputs', e.currentTarget.value)}
				class="border border-slate-300 p-2 rounded-md text-xs font-mono h-24 focus:outline-none focus:ring-2 focus:ring-purple-500"
				placeholder={'{"arg1": "{{node_1.body.value}}"}'}
			></textarea>
		</div>
	{/if}
{/if}

