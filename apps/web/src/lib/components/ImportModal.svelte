<script lang="ts">
	import { onMount } from 'svelte';
	import { animate } from 'motion';
	import MonacoLazy from '$lib/components/MonacoLazy.svelte';
	import { toastStore } from '$lib/stores/toastStore.svelte';
	import { X } from '@lucide/svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	let importJson = $state('{\n  \n}');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let backdropEl = $state<HTMLDivElement | null>(null);
	let modalEl = $state<HTMLDivElement | null>(null);

	// Validate JSON and check structure
	function validateJson(): { valid: boolean; error?: string } {
		if (!importJson.trim()) {
			return { valid: false, error: 'Please paste workflow JSON' };
		}

		try {
			const parsed = JSON.parse(importJson);
			
			// Check for expected structure
			if (!parsed.workflow && !parsed.graph) {
				return { valid: false, error: 'Invalid format: missing workflow or graph' };
			}

			return { valid: true };
		} catch (e) {
			return { valid: false, error: 'Invalid JSON syntax' };
		}
	}

	const validation = $derived(validateJson());

	async function handleImport() {
		if (!validation.valid) return;

		loading = true;
		error = null;

		try {
			const parsed = JSON.parse(importJson);
			const res = await fetch('/api/workflows/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(parsed)
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Import failed');

			toastStore.success('Workflow imported successfully');
			onClose();

			// Redirect to the new workflow
			if (data.workflowId) {
				window.location.href = `/?workflowId=${data.workflowId}`;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Import failed';
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	// Entry animation
	onMount(() => {
		if (backdropEl) {
			animate(backdropEl, { opacity: [0, 1] }, { duration: 0.15 });
		}
		if (modalEl) {
			animate(
				modalEl,
				{ opacity: [0, 1], scale: [0.95, 1], y: [10, 0] },
				{ duration: 0.2, type: 'spring', stiffness: 400, damping: 30 }
			);
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	bind:this={backdropEl}
	class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
	onclick={(e) => e.target === e.currentTarget && onClose()}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="import-modal-title"
	tabindex="-1"
>
	<div
		bind:this={modalEl}
		class="w-[500px] max-w-full bg-panel border border-panel-border shadow-float"
		role="document"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-panel-border">
			<h2 id="import-modal-title" class="text-sm font-medium">Import Workflow</h2>
			<button
				onclick={onClose}
				class="p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
				title="Close"
			>
				<X class="w-4 h-4" />
			</button>
		</div>

		<!-- Content -->
		<div class="p-4 space-y-3">
			<p class="text-[11px] text-muted-foreground">
				Paste exported workflow JSON below to create a new workflow.
			</p>

			<div class="border border-panel-border bg-sidebar-accent/20">
				<MonacoLazy
					value={importJson}
					language="json"
					readOnly={false}
					height="280px"
					onChange={(val) => importJson = val}
				/>
			</div>

			{#if error}
				<p class="text-[11px] text-red-500">{error}</p>
			{:else if !validation.valid && importJson.trim().length > 5}
				<p class="text-[11px] text-amber-500">{validation.error}</p>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-panel-border">
			<button
				onclick={onClose}
				class="px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
			>
				Cancel
			</button>
			<button
				onclick={handleImport}
				disabled={!validation.valid || loading}
				class="px-3 py-1.5 text-[12px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{loading ? 'Creating...' : 'Create Workflow'}
			</button>
		</div>
	</div>
</div>

