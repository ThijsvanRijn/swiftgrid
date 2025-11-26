<script lang="ts">
	import { secretsStore } from '$lib/stores/secretsStore.svelte';

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		alert('Copied to clipboard');
	}
</script>

<div class="p-4 flex flex-col gap-4">
	<!-- Info banner -->
	<div class="bg-primary/5 border border-primary/10 text-foreground p-3 rounded-none text-xs flex items-start gap-2.5">
		<svg class="w-4 h-4 text-primary mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
			<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
		</svg>
		<div>
			<span class="font-medium">Secrets Vault</span>
			<p class="text-muted-foreground mt-0.5">Store API keys securely. They are encrypted and never exposed in the browser.</p>
		</div>
	</div>

	<!-- Secret form -->
	<div class="flex flex-col gap-3 border-b pb-4 border-sidebar-border">
		<div class="flex flex-col gap-1.5">
			<label for="secret-key" class="text-[11px] font-medium text-muted-foreground">Key Name</label>
			<input
				id="secret-key"
				type="text"
				bind:value={secretsStore.keyInput}
				placeholder="OPENAI_API_KEY"
				class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono uppercase text-foreground placeholder:text-muted-foreground/50 placeholder:normal-case"
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="secret-value" class="text-[11px] font-medium text-muted-foreground">Value</label>
			<input
				id="secret-value"
				type="password"
				bind:value={secretsStore.valueInput}
				placeholder="sk-..."
				class="w-full border border-input bg-sidebar-accent/50 px-3 py-2 rounded-none text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring transition-all font-mono text-foreground placeholder:text-muted-foreground/50"
			/>
		</div>

		<button
			onclick={secretsStore.save}
			class="w-full bg-primary text-primary-foreground px-4 py-2 rounded-none font-medium text-xs hover:opacity-90 transition-all mt-1"
		>
			Save Secret
		</button>
	</div>

	<!-- Saved secrets -->
	<div class="flex flex-col gap-2">
		<span class="text-[11px] font-medium text-muted-foreground">Available Secrets</span>

		{#each secretsStore.secrets as secret}
			<div class="flex items-center justify-between px-3 py-2 bg-sidebar-accent/50 rounded-none border border-input group">
				<code class="text-xs font-mono text-foreground">$env.{secret.key}</code>
				<button
					onclick={() => copyToClipboard(`{{$env.${secret.key}}}`)}
					class="text-[10px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity"
				>
					Copy
				</button>
			</div>
		{:else}
			<div class="text-xs text-muted-foreground/60 py-4 text-center">No secrets saved yet</div>
		{/each}
	</div>
</div>

