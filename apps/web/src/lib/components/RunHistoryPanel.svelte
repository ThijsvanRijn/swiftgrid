<script lang="ts">
  import { onMount } from 'svelte';

  interface Run {
    id: string;
    workflowId: number;
    status: string;
    trigger: string;
    pinned: boolean;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    error: string | null;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onViewRun: (runId: string) => void;
  }

  let { isOpen, onClose, onViewRun }: Props = $props();

  let runs = $state<Run[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let nextCursor = $state<string | null>(null);
  let hasMore = $state(false);

  // Filters
  let statusFilter = $state<string>('');
  let triggerFilter = $state<string>('');

  async function loadRuns(append = false) {
    loading = true;
    error = null;

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (triggerFilter) params.set('trigger', triggerFilter);
      if (append && nextCursor) params.set('cursor', nextCursor);
      params.set('limit', '20');

      const res = await fetch(`/api/runs?${params}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load runs');
      }

      if (append) {
        runs = [...runs, ...data.runs];
      } else {
        runs = data.runs;
      }
      nextCursor = data.nextCursor;
      hasMore = data.hasMore;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  async function deleteRun(runId: string) {
    if (!confirm('Are you sure you want to delete this run? This cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      runs = runs.filter(r => r.id !== runId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete run');
    }
  }

  async function togglePin(run: Run) {
    try {
      const res = await fetch(`/api/runs/${run.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !run.pinned }),
      });
      if (!res.ok) {
        throw new Error('Failed to update');
      }
      runs = runs.map(r => r.id === run.id ? { ...r, pinned: !r.pinned } : r);
    } catch (e) {
      alert('Failed to update run');
    }
  }

  async function replayRun(runId: string) {
    try {
      const res = await fetch(`/api/runs/${runId}/replay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to replay');
      }
      // Refresh the list to show new run
      await loadRuns();
      // Optionally view the new run
      onViewRun(data.runId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to replay run');
    }
  }

  async function cancelRun(runId: string) {
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to cancel');
      }
      // Refresh to show updated status
      await loadRuns();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to cancel run');
    }
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
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

  function getStatusColor(status: string): string {
    switch (status) {
      case 'completed': return 'text-emerald-500';
      case 'failed': return 'text-red-500';
      case 'running': return 'text-blue-500';
      case 'pending': return 'text-amber-500';
      case 'cancelled': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'running': return '◐';
      case 'pending': return '○';
      case 'cancelled': return '⊘';
      default: return '?';
    }
  }

  function getTriggerLabel(trigger: string): string {
    switch (trigger) {
      case 'manual': return 'Manual';
      case 'webhook': return 'Webhook';
      case 'cron': return 'Scheduled';
      case 'replay': return 'Replay';
      default: return trigger;
    }
  }

  // Load runs when panel opens
  $effect(() => {
    if (isOpen) {
      loadRuns();
    }
  });

  // Reload when filters change
  $effect(() => {
    if (isOpen) {
      // Use a small timeout to batch filter changes
      const timer = setTimeout(() => loadRuns(), 100);
      return () => clearTimeout(timer);
    }
  });
</script>

<!-- Backdrop -->
{#if isOpen}
  <div 
    class="fixed inset-0 bg-black/50 z-40"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
    role="button"
    tabindex="-1"
  ></div>
{/if}

<!-- Panel -->
<div 
  class={`
    fixed top-0 right-0 h-full w-[480px] bg-panel border-l border-panel-border shadow-2xl z-50
    transform transition-transform duration-300 ease-out
    ${isOpen ? 'translate-x-0' : 'translate-x-full'}
  `}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-panel-border">
    <div class="flex items-center gap-2">
      <svg class="w-5 h-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 8v4l3 3"/>
        <circle cx="12" cy="12" r="10"/>
      </svg>
      <h2 class="font-semibold">Run History</h2>
    </div>
    <button
      onclick={onClose}
      class="p-1.5 rounded-none text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
      title="Close"
      aria-label="Close history panel"
    >
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </button>
  </div>

  <!-- Filters -->
  <div class="flex items-center gap-2 px-4 py-2 border-b border-panel-border bg-muted/30">
    <select 
      bind:value={statusFilter}
      class="text-xs bg-transparent border border-panel-border rounded-none px-2 py-1 text-foreground"
    >
      <option value="">All Status</option>
      <option value="completed">Completed</option>
      <option value="failed">Failed</option>
      <option value="running">Running</option>
      <option value="pending">Pending</option>
      <option value="cancelled">Cancelled</option>
    </select>
    <select 
      bind:value={triggerFilter}
      class="text-xs bg-transparent border border-panel-border rounded-none px-2 py-1 text-foreground"
    >
      <option value="">All Triggers</option>
      <option value="manual">Manual</option>
      <option value="webhook">Webhook</option>
      <option value="cron">Scheduled</option>
    </select>
    <button
      onclick={() => loadRuns()}
      class="ml-auto p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      title="Refresh"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
      </svg>
    </button>
  </div>

  <!-- Run list -->
  <div class="flex-1 overflow-y-auto" style="height: calc(100vh - 120px);">
    {#if loading && runs.length === 0}
      <div class="flex items-center justify-center h-32 text-muted-foreground">
        <svg class="w-5 h-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        Loading...
      </div>
    {:else if error}
      <div class="p-4 text-red-500 text-sm">
        Error: {error}
      </div>
    {:else if runs.length === 0}
      <div class="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <svg class="w-8 h-8 mb-2 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 8v4l3 3"/>
          <circle cx="12" cy="12" r="10"/>
        </svg>
        <p class="text-sm">No runs found</p>
      </div>
    {:else}
      {#each runs as run (run.id)}
        <div class="border-b border-panel-border hover:bg-muted/30 transition-colors">
          <div class="px-4 py-3">
            <!-- Top row: Status, ID, Time -->
            <div class="flex items-center justify-between mb-1.5">
              <div class="flex items-center gap-2">
                <span class={`text-sm font-medium ${getStatusColor(run.status)}`}>
                  {getStatusIcon(run.status)}
                </span>
                <code class="text-xs font-mono text-muted-foreground">
                  {run.id.slice(0, 8)}
                </code>
                {#if run.pinned}
                  <svg class="w-3 h-3 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                {/if}
              </div>
              <span class="text-xs text-muted-foreground">
                {formatTime(run.createdAt)}
              </span>
            </div>

            <!-- Middle row: Trigger, Duration -->
            <div class="flex items-center gap-3 text-xs text-muted-foreground mb-2">
              <span class="px-1.5 py-0.5 bg-muted/50 rounded-sm">
                {getTriggerLabel(run.trigger)}
              </span>
              <span>
                Duration: {formatDuration(run.durationMs)}
              </span>
              {#if run.status === 'running'}
                <span class="flex items-center gap-1 text-blue-500">
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                  Running...
                </span>
              {/if}
            </div>

            <!-- Error message if failed -->
            {#if run.error}
              <div class="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded-sm mb-2 truncate">
                {run.error}
              </div>
            {/if}

            <!-- Actions -->
            <div class="flex items-center gap-1">
              <button
                onclick={() => onViewRun(run.id)}
                class="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
              >
                View
              </button>
              {#if run.status === 'running' || run.status === 'pending'}
                <button
                  onclick={() => cancelRun(run.id)}
                  class="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm transition-colors"
                >
                  Cancel
                </button>
              {:else}
                <button
                  onclick={() => replayRun(run.id)}
                  class="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
                >
                  Re-run
                </button>
              {/if}
              <button
                onclick={() => togglePin(run)}
                class="px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors"
                title={run.pinned ? 'Unpin' : 'Pin'}
              >
                {run.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onclick={() => deleteRun(run.id)}
                class="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-sm transition-colors ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      {/each}

      <!-- Load more -->
      {#if hasMore}
        <div class="p-4 flex justify-center">
          <button
            onclick={() => loadRuns(true)}
            disabled={loading}
            class="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 rounded-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

