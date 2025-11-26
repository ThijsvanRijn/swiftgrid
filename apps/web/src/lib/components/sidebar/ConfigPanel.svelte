<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { secretsStore } from '$lib/stores/secretsStore.svelte';
	import type { RouterCondition } from '@swiftgrid/shared';
	
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
	<div class="p-4 flex flex-col gap-4">
		{#if flowStore.selectedNode.type === 'http-request'}
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
		{/if}

		{#if flowStore.selectedNode.type === 'code-execution'}
			<!-- Code editor -->
			<div class="flex flex-col gap-1.5">
				<label for="code" class="text-[11px] font-medium text-muted-foreground">JavaScript Code</label>
				<textarea
					id="code"
					value={flowStore.selectedNode.data.code}
					oninput={(e) => flowStore.updateNodeData('code', e.currentTarget.value)}
					class="w-full border border-input bg-[#0d1117] text-emerald-400 px-3 py-2.5 rounded-none text-xs font-mono min-h-[180px] focus:outline-none focus:ring-2 focus:ring-ring/50 transition-all resize-none"
					placeholder={'return { value: 123 };'}
					spellcheck="false"
				></textarea>
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
		{/if}

		{#if flowStore.selectedNode.type === 'delay'}
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
		{/if}

		{#if flowStore.selectedNode.type === 'webhook-wait'}
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

		{#if flowStore.selectedNode.type === 'llm'}
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

		{#if flowStore.selectedNode.type === 'router'}
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
	</div>
{/if}

