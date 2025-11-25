<script lang="ts">
	import { secretsStore } from '$lib/stores/secretsStore.svelte';

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
		alert('Copied to clipboard');
	}
</script>

<div class="flex flex-col gap-4">
	<div class="bg-blue-50 text-blue-800 p-3 rounded-md text-xs border border-blue-100">
		<strong>Secrets Vault</strong><br/>
		Store API keys securely here. They are encrypted in the database and never shown in the browser.
	</div>

	<!-- Secret form -->
	<div class="flex flex-col gap-2 border-b pb-4 border-sidebar-border">
		<label for="secret-key" class="text-xs font-bold uppercase text-muted-foreground">Key Name</label>
		<input
			id="secret-key"
			type="text"
			bind:value={secretsStore.keyInput}
			placeholder="OPENAI_API_KEY"
			class="border p-2 rounded text-xs font-mono uppercase"
		/>

		<label for="secret-value" class="text-xs font-bold uppercase text-muted-foreground mt-2">Value</label>
		<input
			id="secret-value"
			type="password"
			bind:value={secretsStore.valueInput}
			placeholder="sk-..."
			class="border p-2 rounded text-xs"
		/>

		<button
			onclick={secretsStore.save}
			class="bg-card border border-border text-foreground px-4 py-2 rounded hover:bg-accent font-medium text-sm transition-colors"
		>
			Save Secret
		</button>
	</div>

	<!-- Saved secrets -->
	<div class="flex flex-col gap-2">
		<span class="text-xs font-bold uppercase text-muted-foreground">Available Secrets</span>

		{#each secretsStore.secrets as secret}
			<div class="flex items-center justify-between p-2 bg-sidebar-accent rounded border border-sidebar-border">
				<code class="text-xs font-mono text-foreground">$env.{secret.key}</code>
				<button
					onclick={() => copyToClipboard(`{{$env.${secret.key}}}`)}
					class="text-[10px] bg-accent border border-border px-2 py-1 rounded hover:bg-accent-foreground text-accent-foreground"
				>
					Copy
				</button>
			</div>
		{:else}
			<div class="text-xs text-muted-foreground italic">No secrets saved yet.</div>
		{/each}
	</div>
</div>

