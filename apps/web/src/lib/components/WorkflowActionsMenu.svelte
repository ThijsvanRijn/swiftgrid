<script lang="ts">
	import { animate } from 'motion';
	import { onMount } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { toastStore } from '$lib/stores/toastStore.svelte';
	import { flowStore } from '$lib/stores/flowStore.svelte';
	import { Share2, Download, Upload, ShieldX, Check, X } from '@lucide/svelte';
	import ImportModal from './ImportModal.svelte';

	interface Props {
		workflowId: number | null;
		workflowName: string | null;
	}

	let { workflowId, workflowName }: Props = $props();

	// State machine
	type MenuState = 'IDLE' | 'FEEDBACK';
	type FeedbackData = {
		message: string;
		direction: 'down' | 'right';
		type: 'success' | 'error';
	};

	let menuOpen = $state(false);
	let menuState = $state<MenuState>('IDLE');
	let feedback = $state<FeedbackData | null>(null);
	let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
	let importModalOpen = $state(false);

	// Refs for animations
	let feedbackEl = $state<HTMLDivElement | null>(null);
	let shareIconEl = $state<HTMLButtonElement | null>(null);
	let exportIconEl = $state<HTMLButtonElement | null>(null);

	// Revoke confirmation state (double-click pattern)
	let revokeClickCount = $state(0);
	let revokeResetTimeout: ReturnType<typeof setTimeout> | null = null;

	function showFeedback(data: FeedbackData) {
		if (feedbackTimeout) clearTimeout(feedbackTimeout);
		feedback = data;
		menuState = 'FEEDBACK';

		feedbackTimeout = setTimeout(() => {
			menuState = 'IDLE';
			feedback = null;
		}, 2000);
	}

	function pulseIcon(el: HTMLElement | null) {
		if (!el) return;
		animate(el, { scale: [1, 1.2, 1] }, { duration: 0.3, type: 'spring', stiffness: 300, damping: 15 });
	}

	// ============================================
	// SHARE
	// ============================================
	async function handleShare() {
		if (!workflowId) {
			toastStore.error('Save the workflow first');
			return;
		}

		pulseIcon(shareIconEl);

		try {
			const shareRes = await fetch(`/api/workflows/${workflowId}/share`, { method: 'POST' });
			const shareData = await shareRes.json();
			if (!shareRes.ok) throw new Error(shareData.error || 'Share failed');

			const shareLink = new URL(shareData.shareUrl, window.location.origin).toString();
			await navigator.clipboard?.writeText(shareLink);

			showFeedback({
				message: 'Link copied',
				direction: 'down',
				type: 'success'
			});
		} catch (e) {
			showFeedback({
				message: e instanceof Error ? e.message : 'Share failed',
				direction: 'down',
				type: 'error'
			});
		}
	}

	// ============================================
	// EXPORT
	// ============================================
	async function handleExport() {
		pulseIcon(exportIconEl);

		try {
			let exportJson: string;

			if (!workflowId) {
				// Export current in-memory draft
				exportJson = JSON.stringify({
					workflow: {
						id: null,
						name: workflowName ?? 'Draft workflow',
						graph: {
							nodes: flowStore.nodes,
							edges: flowStore.edges,
							viewport: flowStore.viewport
						},
						activeVersionId: null
					},
					versions: []
				}, null, 2);
			} else {
				const res = await fetch(`/api/workflows/${workflowId}/export`);
				const data = await res.json();
				if (!res.ok) throw new Error(data.error || 'Export failed');
				exportJson = JSON.stringify(data, null, 2);
			}

			await navigator.clipboard?.writeText(exportJson);

			showFeedback({
				message: 'JSON copied',
				direction: 'right',
				type: 'success'
			});
		} catch (e) {
			showFeedback({
				message: e instanceof Error ? e.message : 'Export failed',
				direction: 'right',
				type: 'error'
			});
		}
	}

	// ============================================
	// IMPORT
	// ============================================
	function handleImportClick() {
		menuOpen = false;
		importModalOpen = true;
	}

	// ============================================
	// REVOKE (double-click to confirm)
	// ============================================
	async function handleRevoke() {
		if (!workflowId) {
			toastStore.error('No workflow to revoke links for');
			return;
		}

		// First click: show warning, wait for second click
		if (revokeClickCount === 0) {
			revokeClickCount = 1;
			toastStore.warning('Click again to confirm revoke');
			
			// Reset after 3 seconds if no second click
			revokeResetTimeout = setTimeout(() => {
				revokeClickCount = 0;
			}, 3000);
			return;
		}

		// Second click: actually revoke
		if (revokeResetTimeout) {
			clearTimeout(revokeResetTimeout);
			revokeResetTimeout = null;
		}
		revokeClickCount = 0;

		try {
			const res = await fetch(`/api/workflows/${workflowId}/share/revoke`, { method: 'POST' });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to revoke');
			toastStore.success('All share links revoked');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to revoke');
		}
	}

	// Animate feedback bar on state change
	$effect(() => {
		if (menuState === 'FEEDBACK' && feedbackEl && feedback) {
			const initialX = feedback.direction === 'right' ? -20 : 0;
			const initialY = feedback.direction === 'down' ? -10 : 0;

			animate(
				feedbackEl,
				{ opacity: [0, 1], x: [initialX, 0], y: [initialY, 0] },
				{ duration: 0.2, type: 'spring', stiffness: 400, damping: 25 }
			);
		}
	});

	// Cleanup on unmount
	onMount(() => {
		return () => {
			if (feedbackTimeout) clearTimeout(feedbackTimeout);
			if (revokeResetTimeout) clearTimeout(revokeResetTimeout);
		};
	});
</script>

<!-- Tooltip Provider wraps all tooltips -->
<Tooltip.Provider delayDuration={400} skipDelayDuration={0}>
	<!-- Dropdown Menu -->
	<DropdownMenu.Root bind:open={menuOpen}>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					class="px-3 py-1.5 text-xs font-medium rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
					title="Share / Export / Import"
				>
					<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M4 12v8"/>
						<path d="M4 20h16"/>
						<path d="M20 12v8"/>
						<path d="M12 4v12"/>
						<path d="m8 8 4-4 4 4"/>
					</svg>
				</button>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content
			class="w-auto min-w-0 p-2 bg-panel border-panel-border shadow-float rounded-none"
			align="end"
			sideOffset={8}
		>
			<!-- Icon Row -->
			<div class="flex items-center gap-1">
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								bind:this={shareIconEl}
								onclick={handleShare}
								disabled={!workflowId}
								class="p-2 rounded-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<Share2 class="w-4 h-4" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
                    <Tooltip.Content 
						side="top" 
						sideOffset={6} 
						arrowClasses="hidden"
						avoidCollisions={false}
						class="bg-neutral-800 text-neutral-200 rounded px-2 py-1 text-[11px] shadow-md border-none animate-none"
					>
						{workflowId ? 'Share workflow' : 'Save first to share'}
					</Tooltip.Content>
				</Tooltip.Root>

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								bind:this={exportIconEl}
								onclick={handleExport}
								class="p-2 rounded-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
							>
								<Download class="w-4 h-4" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
                    <Tooltip.Content 
						side="top" 
						sideOffset={6} 
						arrowClasses="hidden"
						avoidCollisions={false}
						class="bg-neutral-800 text-neutral-200 rounded px-2 py-1 text-[11px] shadow-md border-none animate-none"
					>
						Export as JSON
					</Tooltip.Content>
				</Tooltip.Root>

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								onclick={handleImportClick}
								class="p-2 rounded-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
							>
								<Upload class="w-4 h-4" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
                    <Tooltip.Content        
						side="top" 
						sideOffset={6} 
						arrowClasses="hidden"
						avoidCollisions={false}
						class="bg-neutral-800 text-neutral-200 rounded px-2 py-1 text-[11px] shadow-md border-none animate-none"
					>
						Import workflow
					</Tooltip.Content>
				</Tooltip.Root>

				<div class="w-px h-5 bg-border mx-1"></div>

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								onclick={handleRevoke}
								disabled={!workflowId}
								class="p-2 rounded-sm text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<ShieldX class="w-4 h-4" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
                    <Tooltip.Content 
						side="top" 
						sideOffset={6} 
						arrowClasses="hidden"
						avoidCollisions={false}
						class="bg-neutral-800 text-neutral-200 rounded px-2 py-1 text-[11px] shadow-md border-none animate-none"
					>
						{workflowId ? 'Revoke all share links' : 'No workflow selected'}
					</Tooltip.Content>
				</Tooltip.Root>
			</div>

			<!-- Feedback Bar -->
			{#if menuState === 'FEEDBACK' && feedback}
				<div
					bind:this={feedbackEl}
					class="mt-2 px-3 py-1.5 flex items-center gap-2 text-[11px] font-medium rounded-sm {feedback.type === 'success' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}"
				>
					{#if feedback.type === 'success'}
						<Check class="w-3 h-3" />
					{:else}
						<X class="w-3 h-3" />
					{/if}
					{feedback.message}
				</div>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</Tooltip.Provider>

<!-- Import Modal -->
{#if importModalOpen}
	<ImportModal onClose={() => importModalOpen = false} />
{/if}

