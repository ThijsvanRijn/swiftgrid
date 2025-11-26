<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';
</script>
  
<!-- 
  Selection = subtle border highlight (always visible when selected)
  Running = colored border (temporary during execution)
-->
<div class={`
    min-w-[220px] bg-panel text-card-foreground rounded-none border-2 transition-all duration-300
    ${isRunning ? 'border-blue-500' : selected ? 'border-blue-500/50' : 'border-transparent'}
  `}
  style={`box-shadow: ${
    isRunning ? '0 0 0 1px rgba(59,130,246,0.3), 0 4px 12px -2px rgba(59,130,246,0.15)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon -->
        <div class="h-6 w-6 bg-blue-500/10 flex items-center justify-center">
          <svg class="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9"/>
          </svg>
        </div>
        
        <!-- Method Badge -->
        <div class={`
          h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide
          ${data.method === 'GET' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : ''}
          ${data.method === 'POST' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : ''}
          ${data.method === 'PUT' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : ''}
          ${data.method === 'DELETE' ? 'bg-red-500/15 text-red-600 dark:text-red-400' : ''}
          ${data.method === 'PATCH' ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : ''}
          ${!data.method ? 'bg-muted text-muted-foreground' : ''}
        `}>
          {data.method || 'HTTP'}
        </div>
      </div>
      
      <!-- Status badge - consistent style across all states -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-blue-500/15 rounded-sm h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-blue-500 leading-none">Running</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/15 rounded-sm h-5" title="Completed successfully">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/15 rounded-sm h-5" title="Failed">
          <svg class="w-2.5 h-2.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
          <span class="text-[9px] font-medium text-red-500 leading-none">Error</span>
        </div>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-2.5">
      <div class="text-xs text-muted-foreground font-mono truncate max-w-[190px]" title={data.url}>
        {data.url || 'No URL configured'}
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