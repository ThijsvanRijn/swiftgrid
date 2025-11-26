<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Only show colored border while actively running
    $: isRunning = data.status === 'running';

    // Format milliseconds to human-readable string
    function formatDelay(ms: number | undefined): string {
        if (!ms) return 'No delay set';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
        return `${(ms / 3600000).toFixed(1)}h`;
    }
</script>
  
<div class={`
    min-w-[180px] bg-panel text-card-foreground rounded-none border transition-all duration-300
    ${selected ? 'border-primary/60' : 'border-panel-border'}
    ${isRunning ? 'border-amber-500!' : ''}
  `}
  style={`box-shadow: ${
    isRunning ? '0 0 0 1px rgba(245,158,11,0.3), 0 4px 12px -2px rgba(245,158,11,0.15)' :
    selected ? '0 0 0 1px var(--primary), 0 4px 16px -4px rgba(0,0,0,0.1)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon (clock) -->
        <div class="h-6 w-6 bg-amber-500/10 flex items-center justify-center">
          <svg class="w-3.5 h-3.5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
        </div>
        
        <!-- Type Badge -->
        <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400">
          DELAY
        </div>
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1.5 px-1.5 py-0.5 bg-amber-500/15 rounded-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          <span class="text-[9px] font-medium text-amber-500">Waiting</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 rounded-sm" title="Completed">
          <svg class="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/10 rounded-sm" title="Failed">
          <svg class="w-3 h-3 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="m15 9-6 6M9 9l6 6"/>
          </svg>
        </div>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-2.5">
      <div class="text-sm font-mono text-foreground">
        {formatDelay(data.delayMs)}
      </div>
      
      {#if data.label}
        <div class="text-[10px] text-muted-foreground/60 mt-1 font-medium">
          {data.label}
        </div>
      {/if}
    </div>
  
    <!-- Handles -->
    <Handle type="target" position={Position.Top} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -top-1!" />
    <Handle type="source" position={Position.Bottom} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -bottom-1!" />
</div>

