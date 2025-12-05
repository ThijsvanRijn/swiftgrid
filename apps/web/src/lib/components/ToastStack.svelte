<script lang="ts">
	import { toastStore, type Toast } from '$lib/stores/toastStore.svelte';

	let toasts = $derived(toastStore.toasts);

	const typeStyles: Record<Toast['type'], string> = {
		success: 'bg-emerald-600 text-white',
		error: 'bg-red-600 text-white',
		info: 'bg-slate-800 text-slate-50',
		warning: 'bg-amber-500 text-amber-950'
	};
</script>

<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
	{#each toasts as toast (toast.id)}
		<div
			class={`shadow-lg rounded-md px-3 py-2 w-64 text-sm pointer-events-auto flex items-start gap-2 ${typeStyles[toast.type]}`}
			role="status"
			aria-live="polite"
		>
			<div class="flex-1">{toast.message}</div>
			<button
				onclick={() => toastStore.remove(toast.id)}
				class="text-white/80 hover:text-white text-xs"
				title="Dismiss"
			>
				×
			</button>
		</div>
	{/each}
</div>


