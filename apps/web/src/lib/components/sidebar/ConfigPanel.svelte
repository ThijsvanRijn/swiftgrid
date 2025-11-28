<script lang="ts">
	import { flowStore } from '$lib/stores/flowStore.svelte';
	
	// Node-specific config components
	import HttpConfig from './config/HttpConfig.svelte';
	import CodeConfig from './config/CodeConfig.svelte';
	import DelayConfig from './config/DelayConfig.svelte';
	import WebhookConfig from './config/WebhookConfig.svelte';
	import LlmConfig from './config/LlmConfig.svelte';
	import RouterConfig from './config/RouterConfig.svelte';
</script>

{#if flowStore.selectedNode}
	<div class="p-4 flex flex-col gap-4">
		{#if flowStore.selectedNode.type === 'http-request'}
			<HttpConfig />
		{:else if flowStore.selectedNode.type === 'code-execution'}
			<CodeConfig />
		{:else if flowStore.selectedNode.type === 'delay'}
			<DelayConfig />
		{:else if flowStore.selectedNode.type === 'webhook-wait'}
			<WebhookConfig />
		{:else if flowStore.selectedNode.type === 'llm'}
			<LlmConfig />
		{:else if flowStore.selectedNode.type === 'router'}
			<RouterConfig />
		{/if}
	</div>
{/if}
