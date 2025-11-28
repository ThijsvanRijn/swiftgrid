<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { secretsStore } from '$lib/stores/secretsStore.svelte';
	
	// Check if a value is using a secret reference
	function isSecretRef(value: string | undefined): boolean {
		return !!value?.startsWith('{{$env.');
	}
	
	// Extract secret name from reference
	function getSecretName(value: string | undefined): string {
		if (!value) return '';
		const match = value.match(/\{\{\$env\.(.+?)\}\}/);
		return match ? match[1] : '';
	}
</script>

{#if flowStore.selectedNode}
	<!-- Info banner -->
	<div class="bg-cyan-500/5 border border-cyan-500/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
		</svg>
		<div>
			<span class="font-medium">LLM Chat Node</span>
			<p class="text-muted-foreground mt-0.5">Call any OpenAI-compatible API (OpenAI, Groq, Together, Ollama). Supports streaming for real-time token display.</p>
		</div>
	</div>

	<!-- Provider Presets -->
	<div class="flex flex-col gap-1.5">
		<span class="text-[11px] font-medium text-muted-foreground">Quick Setup</span>
		<div class="flex gap-1.5 flex-wrap">
			<button
				onclick={() => {
					flowStore.updateNodeData('baseUrl', 'https://api.openai.com/v1');
					flowStore.updateNodeData('model', 'gpt-4o');
				}}
				class="text-[10px] px-2 py-1 border border-input bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors text-foreground"
			>
				OpenAI
			</button>
			<button
				onclick={() => {
					flowStore.updateNodeData('baseUrl', 'https://api.groq.com/openai/v1');
					flowStore.updateNodeData('model', 'llama-3.1-8b-instant');
				}}
				class="text-[10px] px-2 py-1 border border-input bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors text-foreground"
			>
				Groq
			</button>
			<button
				onclick={() => {
					flowStore.updateNodeData('baseUrl', 'https://api.together.xyz/v1');
					flowStore.updateNodeData('model', 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
				}}
				class="text-[10px] px-2 py-1 border border-input bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors text-foreground"
			>
				Together
			</button>
			<button
				onclick={() => {
					flowStore.updateNodeData('baseUrl', 'http://localhost:11434/v1');
					flowStore.updateNodeData('model', 'llama3.2');
				}}
				class="text-[10px] px-2 py-1 border border-input bg-sidebar-accent/50 hover:bg-sidebar-accent transition-colors text-foreground"
			>
				Ollama
			</button>
		</div>
	</div>

	<!-- Base URL -->
	<div class="flex flex-col gap-1.5">
		<label for="baseUrl" class="text-[11px] font-medium text-muted-foreground">
			API Base URL
		</label>
		<input
			id="baseUrl"
			type="text"
			value={flowStore.selectedNode.data.baseUrl || 'https://api.openai.com/v1'}
			oninput={(e) => flowStore.updateNodeData('baseUrl', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			placeholder="https://api.openai.com/v1"
		/>
	</div>

	<!-- API Key -->
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center justify-between">
			<label for="apiKey" class="text-[11px] font-medium text-muted-foreground">
				API Key
			</label>
			<!-- Toggle between secret and manual -->
			<div class="flex gap-1 text-[10px]">
				<button
					onclick={() => {
						if (!isSecretRef(flowStore.selectedNode?.data.apiKey)) return;
						flowStore.updateNodeData('apiKey', '');
					}}
					class={`px-1.5 py-0.5 rounded-sm transition-colors ${
						!isSecretRef(flowStore.selectedNode?.data.apiKey)
							? 'bg-cyan-500/20 text-cyan-500'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Manual
				</button>
				<button
					onclick={() => {
						if (isSecretRef(flowStore.selectedNode?.data.apiKey)) return;
						// Default to first secret if available
						const firstSecret = secretsStore.secrets[0]?.key;
						if (firstSecret) {
							flowStore.updateNodeData('apiKey', `{{$env.${firstSecret}}}`);
						}
					}}
					class={`px-1.5 py-0.5 rounded-sm transition-colors ${
						isSecretRef(flowStore.selectedNode?.data.apiKey)
							? 'bg-cyan-500/20 text-cyan-500'
							: 'text-muted-foreground hover:text-foreground'
					}`}
				>
					Secret
				</button>
			</div>
		</div>
		
		{#if isSecretRef(flowStore.selectedNode?.data.apiKey)}
			<!-- Secret dropdown -->
			<select
				id="apiKey"
				value={getSecretName(flowStore.selectedNode?.data.apiKey)}
				onchange={(e) => flowStore.updateNodeData('apiKey', `{{$env.${e.currentTarget.value}}}`)}
				class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground"
			>
				<option value="" disabled>Select a secret...</option>
				{#each secretsStore.secrets as secret}
					<option value={secret.key}>{secret.key}</option>
				{/each}
			</select>
			{#if secretsStore.secrets.length === 0}
				<span class="text-[10px] text-amber-500/80">
					No secrets found. Add one in the Secrets Vault below.
				</span>
			{:else}
				<span class="text-[10px] text-muted-foreground/60">
					Using secret from vault (value hidden)
				</span>
			{/if}
		{:else}
			<!-- Manual input -->
			<input
				id="apiKey"
				type="password"
				value={flowStore.selectedNode?.data.apiKey || ''}
				oninput={(e) => flowStore.updateNodeData('apiKey', e.currentTarget.value)}
				class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
				placeholder="sk-..."
			/>
			<span class="text-[10px] text-muted-foreground/60">
				⚠️ Stored in flow JSON. Use Secret mode for production.
			</span>
		{/if}
	</div>

	<!-- Model -->
	<div class="flex flex-col gap-1.5">
		<label for="model" class="text-[11px] font-medium text-muted-foreground">
			Model
		</label>
		<input
			id="model"
			type="text"
			value={flowStore.selectedNode.data.model || 'gpt-4o'}
			oninput={(e) => flowStore.updateNodeData('model', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			placeholder="gpt-4o"
		/>
	</div>

	<!-- System Prompt -->
	<div class="flex flex-col gap-1.5">
		<label for="systemPrompt" class="text-[11px] font-medium text-muted-foreground">
			System Prompt
		</label>
		<textarea
			id="systemPrompt"
			value={flowStore.selectedNode.data.systemPrompt || ''}
			oninput={(e) => flowStore.updateNodeData('systemPrompt', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-xs font-mono min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/40 resize-none"
			placeholder="You are a helpful assistant..."
		></textarea>
	</div>

	<!-- User Prompt -->
	<div class="flex flex-col gap-1.5">
		<label for="userPrompt" class="text-[11px] font-medium text-muted-foreground">
			User Prompt
		</label>
		<textarea
			id="userPrompt"
			value={flowStore.selectedNode.data.userPrompt || ''}
			oninput={(e) => flowStore.updateNodeData('userPrompt', e.currentTarget.value)}
			class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-xs font-mono min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all text-foreground placeholder:text-muted-foreground/40 resize-none"
			placeholder={'Summarize this data: {{prev_node.content}}'}
		></textarea>
		<span class="text-[10px] text-muted-foreground/60">
			Use <code class="bg-sidebar-accent px-1 py-0.5 rounded">{'{{node_id.field}}'}</code> to inject data from previous nodes
		</span>
	</div>

	<!-- Advanced Settings -->
	<div class="flex flex-col gap-3 border-t border-sidebar-border pt-4">
		<span class="text-[11px] font-medium text-muted-foreground">Advanced Settings</span>
		
		<div class="grid grid-cols-2 gap-3">
			<!-- Temperature -->
			<div class="flex flex-col gap-1">
				<label for="temperature" class="text-[10px] text-muted-foreground/80">Temperature</label>
				<input
					id="temperature"
					type="number"
					min="0"
					max="2"
					step="0.1"
					value={flowStore.selectedNode.data.temperature ?? 1}
					oninput={(e) => flowStore.updateNodeData('temperature', parseFloat(e.currentTarget.value))}
					class="w-full border border-input bg-sidebar-accent/50 px-2 py-1.5 rounded-none text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all font-mono text-foreground"
				/>
			</div>

			<!-- Max Tokens -->
			<div class="flex flex-col gap-1">
				<label for="maxTokens" class="text-[10px] text-muted-foreground/80">Max Tokens</label>
				<input
					id="maxTokens"
					type="number"
					min="1"
					max="128000"
					value={flowStore.selectedNode.data.maxTokens || ''}
					oninput={(e) => flowStore.updateNodeData('maxTokens', e.currentTarget.value ? parseInt(e.currentTarget.value) : undefined)}
					class="w-full border border-input bg-sidebar-accent/50 px-2 py-1.5 rounded-none text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all font-mono text-foreground"
					placeholder="auto"
				/>
			</div>
		</div>

		<!-- Stream toggle -->
		<label class="flex items-center gap-2 cursor-pointer">
			<input
				type="checkbox"
				checked={flowStore.selectedNode.data.stream || false}
				onchange={(e) => flowStore.updateNodeData('stream', e.currentTarget.checked)}
				class="w-4 h-4 rounded border-input bg-sidebar-accent/50 text-cyan-500 focus:ring-cyan-500/50"
			/>
			<span class="text-xs text-foreground">Enable streaming</span>
			<span class="text-[10px] text-muted-foreground/60">(real-time token display)</span>
		</label>
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
			placeholder="Summarize Content"
		/>
	</div>
{/if}

