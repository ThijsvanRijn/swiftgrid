<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;

    // Format timeout to human-readable string
    function formatTimeout(ms: number | undefined): string {
        if (!ms) return '7 days';
        const days = ms / (24 * 60 * 60 * 1000);
        if (days >= 1) return `${days.toFixed(0)}d`;
        const hours = ms / (60 * 60 * 1000);
        if (hours >= 1) return `${hours.toFixed(0)}h`;
        const mins = ms / (60 * 1000);
        return `${mins.toFixed(0)}m`;
    }
</script>
  
<div class={`
    min-w-[200px] bg-panel text-card-foreground rounded-none border transition-colors
    ${selected ? 'border-primary/60' : 'border-panel-border'}
    ${data.status === 'running' ? 'border-purple-500!' : ''}
    ${data.status === 'success' ? 'border-emerald-500!' : ''}
    ${data.status === 'error' ? 'border-red-500!' : ''}
  `}
  style={`box-shadow: ${
    data.status === 'running' ? '0 0 0 1px rgba(168,85,247,0.3), 0 4px 12px -2px rgba(168,85,247,0.15)' :
    data.status === 'success' ? '0 0 0 1px rgba(16,185,129,0.3), 0 4px 12px -2px rgba(16,185,129,0.15)' :
    data.status === 'error' ? '0 0 0 1px rgba(239,68,68,0.3), 0 4px 12px -2px rgba(239,68,68,0.15)' :
    selected ? '0 0 0 1px var(--primary), 0 4px 16px -4px rgba(0,0,0,0.1)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon (webhook/pause) -->
        <div class="h-6 w-6 bg-purple-500/10 flex items-center justify-center">
          <svg class="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
            <path d="m6 17 3.13-5.78c.53-.97.43-2.22-.26-3.07a4 4 0 0 1 6.92-4.01"/>
            <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
          </svg>
        </div>
        
        <!-- Type Badge -->
        <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide bg-purple-500/15 text-purple-600 dark:text-purple-400">
          WEBHOOK
        </div>
      </div>
      
      <!-- Status indicator -->
      {#if data.status === 'running'}
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-purple-500 font-medium">Waiting...</span>
          <span class="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
        </div>
      {:else if data.status === 'success'}
        <svg class="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      {:else if data.status === 'error'}
        <svg class="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="m15 9-6 6M9 9l6 6"/>
        </svg>
      {:else}
        <span class="text-[10px] text-muted-foreground">⏸ Suspends</span>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-2.5">
      <div class="text-xs text-foreground font-medium">
        {data.webhookDescription || 'Wait for external webhook'}
      </div>
      
      <div class="flex items-center gap-2 mt-1.5">
        <span class="text-[10px] text-muted-foreground">Timeout:</span>
        <span class="text-[10px] text-purple-500 font-mono">{formatTimeout(data.webhookTimeoutMs)}</span>
      </div>
      
      {#if data.label && data.label !== 'Webhook Wait'}
        <div class="text-[10px] text-muted-foreground/60 mt-1 font-medium">
          {data.label}
        </div>
      {/if}
    </div>
  
    <!-- Handles -->
    <Handle type="target" position={Position.Top} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -top-1!" />
    <Handle type="source" position={Position.Bottom} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -bottom-1!" />
</div>

