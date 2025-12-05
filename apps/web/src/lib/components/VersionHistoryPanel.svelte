<script lang="ts">
	interface Version {
		id: string;
		versionNumber: number;
		changeSummary: string | null;
		createdBy: string | null;
		createdAt: string;
	}

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		workflowId: number | null;
		activeVersionId: string | null;
		hasUnpublishedChanges: boolean;
		onRollback: (versionNumber: number) => void;
		onRestoreDraft: (versionNumber: number) => void;
		onDiscardDraft: () => void;
		refreshTrigger?: number; // Increment to trigger refresh
	}

	let { isOpen, onClose, workflowId, activeVersionId, hasUnpublishedChanges, onRollback, onRestoreDraft, onDiscardDraft, refreshTrigger = 0 }: Props = $props();

	let versions = $state<Version[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let lastLoadedAt = $state<Date | null>(null);

	// Simple cache keyed by workflowId to avoid refetch on every open
	let cache = $state<Record<number, Version[]>>({});
	let cacheTimestamps = $state<Record<number, Date>>({});
	
	// Expanded version state (inline, no modal)
	let expandedVersionId = $state<string | null>(null);
	let loadToEditor = $state(true);
	let deployToProduction = $state(true);
	let restoreInProgress = $state(false);
	
	// Toast notification state
	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);

	function showToast(message: string, type: 'success' | 'error' = 'success') {
		toast = { message, type };
		setTimeout(() => toast = null, 3000);
	}

	function formatLastLoaded(): string {
		if (!lastLoadedAt) return '';
		const diffMs = Date.now() - lastLoadedAt.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Updated just now';
		if (diffMins < 60) return `Updated ${diffMins}m ago`;
		if (diffHours < 24) return `Updated ${diffHours}h ago`;
		return `Updated ${diffDays}d ago`;
	}

	async function loadVersions(force = false) {
		if (!workflowId) return;
		
		// Serve from cache when possible unless forced
		if (!force && cache[workflowId]) {
			versions = cache[workflowId];
			lastLoadedAt = cacheTimestamps[workflowId] ?? null;
			return;
		}
		
		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/flows/${workflowId}/versions`);
			const data = await res.json();
			
			if (!res.ok) {
				throw new Error(data.error || 'Failed to load versions');
			}
			
			versions = data.versions || [];
			cache = { ...cache, [workflowId]: versions };
			const now = new Date();
			lastLoadedAt = now;
			cacheTimestamps = { ...cacheTimestamps, [workflowId]: now };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			loading = false;
		}
	}

	function toggleVersion(version: Version) {
		if (expandedVersionId === version.id) {
			// Collapse
			expandedVersionId = null;
		} else {
			// Expand and set defaults
			expandedVersionId = version.id;
			loadToEditor = true;
			deployToProduction = version.id !== activeVersionId;
		}
	}

	async function handleRestore(version: Version) {
		if (!loadToEditor && !deployToProduction) return;
		
		restoreInProgress = true;
		const versionNum = version.versionNumber;
		
		try {
			// Deploy to production if checked
			if (deployToProduction) {
				onRollback(versionNum);
			}
			
			// Load to editor if checked
			if (loadToEditor) {
				onRestoreDraft(versionNum);
			}
			
			// Show success toast
			if (loadToEditor && deployToProduction) {
				showToast(`v${versionNum} loaded and deployed`);
			} else if (loadToEditor) {
				showToast(`v${versionNum} loaded into editor`);
			} else {
				showToast(`v${versionNum} deployed to production`);
			}
			
			expandedVersionId = null;
		} catch (e) {
			showToast('Failed to restore version', 'error');
		} finally {
			restoreInProgress = false;
		}
	}

	async function handleDiscardDraft() {
		if (!confirm('Discard all draft changes and reset to the published version?')) {
			return;
		}
		
		onDiscardDraft();
		showToast('Draft reset to published version');
	}

	function formatTime(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	// Load versions when panel opens or refreshTrigger changes
	$effect(() => {
		if (isOpen && workflowId) {
			// Track refreshTrigger to reload when it changes
			const _ = refreshTrigger;
			loadVersions(true);
		}
	});

	// Invalidate cache when workflow changes
	$effect(() => {
		if (!isOpen && workflowId) {
			expandedVersionId = null;
		}
		// If workflowId changed, clear cached expanded state
		if (workflowId && !cache[workflowId]) {
			expandedVersionId = null;
		}
	});
	
	// Collapse when panel closes
	$effect(() => {
		if (!isOpen) {
			expandedVersionId = null;
		}
	});
</script>

{#if isOpen}
	<div class="relative w-[320px] bg-panel border border-panel-border rounded-none text-sidebar-foreground flex flex-col shadow-float pointer-events-auto h-full overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between px-3 py-2.5 border-b border-sidebar-border">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 3v18"/>
					<path d="M18 9l-6-6-6 6"/>
					<path d="M6 15l6 6 6-6"/>
				</svg>
				<span class="text-sm font-medium">Version History</span>
				{#if lastLoadedAt}
					<span class="text-[10px] text-muted-foreground">{formatLastLoaded()}</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<button
					onclick={() => loadVersions(true)}
					class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors text-[10px]"
					title="Refresh versions"
					aria-label="Refresh versions"
				>
					<svg class="w-4 h-4 {loading ? 'animate-spin opacity-60' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
						<path d="M21 3v5h-5"/>
					</svg>
				</button>
				<button
					onclick={onClose}
					class="p-1 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
					title="Close"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6 6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>
		</div>

		<!-- Version list -->
		<div class="flex-1 overflow-y-auto">
			{#if loading}
				<div class="flex flex-col items-center justify-center h-32 text-muted-foreground">
					<svg class="w-5 h-5 mb-2 animate-spin opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 12a9 9 0 1 1-6.219-8.56"/>
					</svg>
					<p class="text-xs">Loading versions...</p>
				</div>
			{:else if error}
				<div class="p-3 text-red-500 text-xs">
					Error: {error}
				</div>
			{:else if versions.length === 0}
				<div class="flex flex-col items-center justify-center h-32 text-muted-foreground">
					<svg class="w-5 h-5 mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M12 3v18"/>
						<path d="M18 9l-6-6-6 6"/>
					</svg>
					<p class="text-xs">No published versions</p>
					<p class="text-[10px] text-muted-foreground/70 mt-1">
						Click "Publish" to create your first version
					</p>
				</div>
			{:else}
				{#each versions as version (version.id)}
					{@const isExpanded = expandedVersionId === version.id}
					{@const isActive = version.id === activeVersionId}
					<div class="border-b border-sidebar-border {isActive ? 'bg-emerald-500/10' : ''} {isExpanded ? 'bg-sidebar-accent/40' : ''}">
						<!-- Version header (clickable) -->
						<button
							onclick={() => toggleVersion(version)}
							class="w-full text-left px-3 py-2.5 hover:bg-sidebar-accent/30 transition-colors"
						>
							<div class="flex items-center justify-between mb-1">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium">
										v{version.versionNumber}
									</span>
									{#if isActive}
										<span class="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-500 rounded-sm">
											Live
										</span>
									{/if}
								</div>
								<div class="flex items-center gap-2">
									<span class="text-[10px] text-muted-foreground">
										{formatTime(version.createdAt)}
									</span>
									<svg 
										class="w-3 h-3 text-muted-foreground transition-transform {isExpanded ? 'rotate-180' : ''}" 
										viewBox="0 0 24 24" 
										fill="none" 
										stroke="currentColor" 
										stroke-width="2"
									>
										<path d="m6 9 6 6 6-6"/>
									</svg>
								</div>
							</div>

							{#if version.changeSummary}
								<p class="text-xs text-muted-foreground {isExpanded ? '' : 'line-clamp-1'}">
									{version.changeSummary}
								</p>
							{/if}
						</button>

						<!-- Expanded options -->
						{#if isExpanded}
							<div class="px-3 pb-3 space-y-2">
								<!-- Checkboxes -->
								<div class="space-y-1.5 py-2 border-t border-sidebar-border/50">
									<label class="flex items-center gap-2 cursor-pointer text-xs">
										<input 
											type="checkbox" 
											bind:checked={loadToEditor}
											class="w-3.5 h-3.5 rounded border-sidebar-border bg-sidebar-accent/30 text-emerald-500"
										/>
										<span class="text-muted-foreground">Load into editor</span>
									</label>
									
									<label class="flex items-center gap-2 cursor-pointer text-xs {isActive ? 'opacity-40' : ''}">
										<input 
											type="checkbox" 
											bind:checked={deployToProduction}
											disabled={isActive}
											class="w-3.5 h-3.5 rounded border-sidebar-border bg-sidebar-accent/30 text-emerald-500 disabled:opacity-50"
										/>
										<span class="text-muted-foreground">
											{isActive ? 'Already live' : 'Deploy to production'}
										</span>
									</label>
								</div>

								<!-- Action buttons -->
								<div class="flex gap-2">
									<button
										onclick={() => expandedVersionId = null}
										class="flex-1 px-2 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors border border-sidebar-border"
									>
										Cancel
									</button>
									<button
										onclick={() => handleRestore(version)}
										disabled={(!loadToEditor && !deployToProduction) || restoreInProgress}
										class="flex-1 px-2 py-1.5 text-[10px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{#if restoreInProgress}
											...
										{:else if loadToEditor && deployToProduction}
											Restore & Deploy
										{:else if loadToEditor}
											Load
										{:else if deployToProduction}
											Deploy
										{:else}
											Select option
										{/if}
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<!-- Toast Notification (inside panel) -->
		{#if toast}
			<div 
				class="mx-3 mb-2 px-3 py-2 rounded-sm shadow-lg {toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}"
			>
				<span class="text-xs font-medium">{toast.message}</span>
			</div>
		{/if}

		<!-- Footer -->
		<div class="px-3 py-2 border-t border-sidebar-border bg-sidebar-accent/30">
			{#if hasUnpublishedChanges && activeVersionId}
				<button
					onclick={handleDiscardDraft}
					class="w-full mb-2 px-2 py-1.5 text-[10px] font-medium text-amber-500 hover:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-sm transition-colors"
				>
					Reset Draft to Live Version
				</button>
			{/if}
			<div class="text-[10px] text-muted-foreground">
				{versions.length} version{versions.length !== 1 ? 's' : ''}
			</div>
		</div>
	</div>
{/if}
