<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
</script>
  
<div class={`
    min-w-[220px] bg-panel text-card-foreground rounded-none border transition-colors
    ${selected ? 'border-primary/60' : 'border-panel-border'}
    ${data.status === 'running' ? 'border-blue-500!' : ''}
    ${data.status === 'success' ? 'border-emerald-500!' : ''}
    ${data.status === 'error' ? 'border-red-500!' : ''}
  `}
  style={`box-shadow: ${
    data.status === 'running' ? '0 0 0 1px rgba(59,130,246,0.3), 0 4px 12px -2px rgba(59,130,246,0.15)' :
    data.status === 'success' ? '0 0 0 1px rgba(16,185,129,0.3), 0 4px 12px -2px rgba(16,185,129,0.15)' :
    data.status === 'error' ? '0 0 0 1px rgba(239,68,68,0.3), 0 4px 12px -2px rgba(239,68,68,0.15)' :
    selected ? '0 0 0 1px var(--primary), 0 4px 16px -4px rgba(0,0,0,0.1)' :
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
      
      <!-- Status indicator -->
      {#if data.status === 'running'}
        <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
      {:else if data.status === 'success'}
        <svg class="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      {:else if data.status === 'error'}
        <svg class="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="m15 9-6 6M9 9l6 6"/>
        </svg>
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