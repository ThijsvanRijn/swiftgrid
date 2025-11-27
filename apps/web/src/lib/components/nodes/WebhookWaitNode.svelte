<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';

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
  
<!-- 
  Selection = subtle border highlight (always visible when selected)
  Running = colored border (temporary during execution)
-->
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label && data.label !== 'Webhook Wait'}
    <div class="absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 bg-purple-50 border border-purple-300 border-b-0 text-[10px] font-medium text-purple-700 rounded-t-sm">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
        <path d="m6 17 3.13-5.78c.53-.97.43-2.22-.26-3.07a4 4 0 0 1 6.92-4.01"/>
        <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
      </svg>
      <span>Webhook</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[220px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-purple-500' : selected ? 'border-purple-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(168,85,247,0.45)'
        : '0 10px 18px -14px rgba(15,23,42,0.25)'
    }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2 min-w-0">
        {#if data.label && data.label !== 'Webhook Wait'}
          <!-- Custom label (icon shown in tab above) -->
          <span class="text-xs font-medium text-foreground truncate" title={data.label}>
            {data.label}
          </span>
        {:else}
          <!-- Node icon (webhook/pause) -->
          <div class="h-6 w-6 border border-purple-200/70 bg-purple-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
              <path d="m6 17 3.13-5.78c.53-.97.43-2.22-.26-3.07a4 4 0 0 1 6.92-4.01"/>
              <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
            </svg>
          </div>
          <!-- Type Badge -->
          <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border border-purple-200/70 bg-purple-50/80 text-purple-600 shrink-0">
            WEBHOOK
          </div>
        {/if}
      </div>
      
      <!-- Status badge - consistent style across all states -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-purple-500/10 border border-purple-200 h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-purple-500 leading-none">Waiting</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/10 border border-emerald-200 h-5" title="Resumed">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/10 border border-red-200 h-5" title="Timed out">
          <svg class="w-2.5 h-2.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
          <span class="text-[9px] font-medium text-red-500 leading-none">Error</span>
        </div>
      {:else}
        <div class="flex items-center gap-1 px-1.5 bg-muted/20 border border-border/40 h-5">
          <svg class="w-2.5 h-2.5 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
          <span class="text-[9px] font-medium text-muted-foreground leading-none">Pauses</span>
        </div>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-3 space-y-2.5">
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">
          Await
        </div>
      <div class="text-xs text-foreground font-medium">
        {data.description || 'Wait for external webhook'}
        </div>
      </div>
      
      <div class="border border-border/70 bg-muted/20 px-3 py-2 rounded-none flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Timeout</span>
        <span class="text-purple-500 font-mono">{data.timeoutStr || formatTimeout(data.timeoutMs)}</span>
      </div>
      
    </div>
  
    <!-- Handles -->
    <Handle 
      type="target" 
      position={Position.Top} 
      class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, -50%);" 
    />
    <Handle 
      type="source" 
      position={Position.Bottom} 
      class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, 50%);" 
    />
  </div>
</div>

