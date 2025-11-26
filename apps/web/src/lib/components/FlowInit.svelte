<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import { setFitViewCallback } from '$lib/services/flowPersistence';

	const { fitView } = useSvelteFlow();

	onMount(() => {
		// Register the fitView callback so flowPersistence can trigger it
		setFitViewCallback(() => {
			fitView({ padding: 0.2, duration: 200 });
		});
	});
</script>

