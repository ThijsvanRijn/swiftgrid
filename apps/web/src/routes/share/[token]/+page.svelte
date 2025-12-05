<script lang="ts">
	import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { goto } from '$app/navigation';
	import { themeStore } from '$lib/stores/themeStore.svelte';
	import { Copy, Download, GitBranch, Calendar, Clock, ArrowRight, Check, Loader2 } from '@lucide/svelte';

	// Node components (read-only versions)
	import HttpRequestNodeComponent from '$lib/components/nodes/HttpRequestNode.svelte';
	import CodeExecutionNodeComponent from '$lib/components/nodes/CodeExecutionNode.svelte';
	import DelayNodeComponent from '$lib/components/nodes/DelayNode.svelte';
	import WebhookWaitNodeComponent from '$lib/components/nodes/WebhookWaitNode.svelte';
	import RouterNodeComponent from '$lib/components/nodes/RouterNode.svelte';
	import LLMNodeComponent from '$lib/components/nodes/LLMNode.svelte';
	import SubFlowNodeComponent from '$lib/components/nodes/SubFlowNode.svelte';
	import MapNodeComponent from '$lib/components/nodes/MapNode.svelte';

	const nodeTypes = {
		'http-request': HttpRequestNodeComponent,
		'code-execution': CodeExecutionNodeComponent,
		'delay': DelayNodeComponent,
		'webhook-wait': WebhookWaitNodeComponent,
		'router': RouterNodeComponent,
		'llm': LLMNodeComponent,
		'subflow': SubFlowNodeComponent,
		'map': MapNodeComponent
	};

	interface PageData {
		token: string;
		workflow: {
			id: number;
			name: string;
			updatedAt: string;
		};
		version: {
			id: string;
			versionNumber: number;
			changeSummary: string | null;
			createdAt: string;
		};
		graph: {
			nodes: any[];
			edges: any[];
		};
	}

	let { data }: { data: PageData } = $props();

	// Flow state
	let nodes = $state(data.graph?.nodes || []);
	let edges = $state(data.graph?.edges || []);

	// UI state
	let cloning = $state(false);
	let cloneSuccess = $state(false);
	let cloneError = $state<string | null>(null);
	let copied = $state(false);

	// Format date
	function formatDate(dateStr: string) {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Copy link to clipboard
	async function copyLink() {
		await navigator.clipboard.writeText(window.location.href);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	// Clone workflow
	async function cloneWorkflow() {
		cloning = true;
		cloneError = null;

		try {
			const res = await fetch(`/api/workflows/share/${data.token}/clone`, {
				method: 'POST'
			});

			const result = await res.json();

			if (!res.ok) {
				throw new Error(result.error || 'Failed to clone workflow');
			}

			cloneSuccess = true;

			// Redirect to the new workflow after a short delay
			setTimeout(() => {
				goto(`/?workflowId=${result.workflowId}`);
			}, 1500);
		} catch (e) {
			cloneError = e instanceof Error ? e.message : 'Failed to clone workflow';
		} finally {
			cloning = false;
		}
	}

	// Export as JSON
	function exportJson() {
		const exportData = {
			name: data.workflow.name,
			version: data.version.versionNumber,
			graph: data.graph
		};
		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${data.workflow.name.replace(/[^a-z0-9]/gi, '_')}_v${data.version.versionNumber}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

</script>

<svelte:head>
	<title>{data.workflow.name} - Shared Workflow | SwiftGrid</title>
</svelte:head>

<div class="h-screen w-screen flex flex-col bg-background" data-theme={themeStore.isDark ? 'dark' : 'light'}>
	<!-- Header -->
	<header class="h-14 border-b border-panel-border bg-panel flex items-center justify-between px-6 shrink-0">
		<div class="flex items-center gap-4">
			<a href="/" class="text-lg font-semibold text-foreground hover:text-foreground/80 transition-colors">
				SwiftGrid
			</a>
			<div class="w-px h-6 bg-border"></div>
			<div class="flex items-center gap-2 text-muted-foreground">
				<span class="text-xs uppercase tracking-wider">Shared Workflow</span>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				onclick={copyLink}
				class="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors flex items-center gap-2"
			>
				{#if copied}
					<Check class="w-3.5 h-3.5 text-emerald-500" />
					<span class="text-emerald-500">Copied!</span>
				{:else}
					<Copy class="w-3.5 h-3.5" />
					<span>Copy Link</span>
				{/if}
			</button>
			<button
				onclick={exportJson}
				class="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors flex items-center gap-2"
			>
				<Download class="w-3.5 h-3.5" />
				<span>Export JSON</span>
			</button>
		</div>
	</header>

	<!-- Main Content -->
	<div class="flex-1 flex">
		<!-- Left Info Panel -->
		<aside class="w-80 border-r border-panel-border bg-panel p-6 flex flex-col shrink-0">
			<!-- Workflow Info -->
			<div class="space-y-6">
				<div>
					<h1 class="text-xl font-semibold text-foreground mb-1">{data.workflow.name}</h1>
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<GitBranch class="w-3.5 h-3.5" />
						<span>Version {data.version.versionNumber}</span>
					</div>
				</div>

				{#if data.version.changeSummary}
					<div class="space-y-1">
						<span class="text-xs text-muted-foreground uppercase tracking-wider">Change Summary</span>
						<p class="text-sm text-foreground/80">{data.version.changeSummary}</p>
					</div>
				{/if}

				<div class="space-y-2">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Calendar class="w-3.5 h-3.5" />
						<span>Published {formatDate(data.version.createdAt)}</span>
					</div>
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Clock class="w-3.5 h-3.5" />
						<span>Last updated {formatDate(data.workflow.updatedAt)}</span>
					</div>
				</div>

				<!-- Stats -->
				<div class="grid grid-cols-2 gap-3">
					<div class="bg-sidebar-accent/30 rounded px-3 py-2">
						<div class="text-lg font-semibold text-foreground">{nodes.length}</div>
						<div class="text-xs text-muted-foreground">Nodes</div>
					</div>
					<div class="bg-sidebar-accent/30 rounded px-3 py-2">
						<div class="text-lg font-semibold text-foreground">{edges.length}</div>
						<div class="text-xs text-muted-foreground">Connections</div>
					</div>
				</div>
			</div>

			<!-- Spacer -->
			<div class="flex-1"></div>

			<!-- Clone CTA -->
			<div class="space-y-3">
				{#if cloneError}
					<div class="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded">
						{cloneError}
					</div>
				{/if}

				{#if cloneSuccess}
					<div class="text-xs text-emerald-500 bg-emerald-500/10 px-3 py-2 rounded flex items-center gap-2">
						<Check class="w-4 h-4" />
						<span>Workflow cloned! Redirecting...</span>
					</div>
				{:else}
					<button
						onclick={cloneWorkflow}
						disabled={cloning}
						class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white font-medium rounded transition-colors flex items-center justify-center gap-2"
					>
						{#if cloning}
							<Loader2 class="w-4 h-4 animate-spin" />
							<span>Cloning...</span>
						{:else}
							<span>Clone to My Workspace</span>
							<ArrowRight class="w-4 h-4" />
						{/if}
					</button>
					<p class="text-xs text-muted-foreground text-center">
						Creates a copy you can edit and run
					</p>
				{/if}
			</div>
		</aside>

		<!-- Flow Preview -->
		<main class="flex-1 relative">
			<SvelteFlow
				{nodes}
				{edges}
				{nodeTypes}
				fitView
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={false}
				panOnDrag={true}
				zoomOnScroll={true}
				colorMode={themeStore.isDark ? 'dark' : 'light'}
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls />
			</SvelteFlow>

			<!-- Read-only Badge -->
			<div class="absolute top-4 left-4 bg-panel/90 backdrop-blur border border-panel-border px-3 py-1.5 rounded text-xs text-muted-foreground flex items-center gap-2">
				<div class="w-2 h-2 rounded-full bg-amber-500"></div>
				Read-only preview
			</div>
		</main>
	</div>
</div>

