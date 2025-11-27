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
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label}
    <div class={`
      absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 border border-b-0 text-[10px] font-medium rounded-t-sm
      ${data.method === 'GET' ? 'bg-blue-50 border-blue-300 text-blue-700' : ''}
      ${data.method === 'POST' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : ''}
      ${data.method === 'PUT' ? 'bg-amber-50 border-amber-300 text-amber-700' : ''}
      ${data.method === 'DELETE' ? 'bg-red-50 border-red-300 text-red-700' : ''}
      ${data.method === 'PATCH' ? 'bg-orange-50 border-orange-300 text-orange-700' : ''}
      ${!data.method ? 'bg-slate-50 border-slate-300 text-slate-700' : ''}
    `}>
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9"/>
      </svg>
      <span>{data.method || 'HTTP'}</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[220px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-blue-500' : selected ? 'border-blue-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(59,130,246,0.45)'
        : '0 10px 18px -14px rgba(15,23,42,0.25)'
    }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2 min-w-0">
        {#if data.label}
          <!-- Custom label (icon shown in tab above) -->
          <span class="text-xs font-medium text-foreground truncate" title={data.label}>
            {data.label}
          </span>
        {:else}
          <!-- Node icon -->
          <div class="h-6 w-6 border border-blue-200/70 bg-blue-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9"/>
            </svg>
          </div>
          <!-- Method Badge -->
          <div class={`
            h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border shrink-0
            ${data.method === 'GET' ? 'border-blue-200/70 text-blue-600 bg-blue-50/80' : ''}
            ${data.method === 'POST' ? 'border-emerald-200/70 text-emerald-600 bg-emerald-50/80' : ''}
            ${data.method === 'PUT' ? 'border-amber-200/70 text-amber-600 bg-amber-50/80' : ''}
            ${data.method === 'DELETE' ? 'border-red-200/70 text-red-600 bg-red-50/80' : ''}
            ${data.method === 'PATCH' ? 'border-orange-200/70 text-orange-600 bg-orange-50/80' : ''}
            ${!data.method ? 'border-border/60 text-muted-foreground bg-muted/40' : ''}
          `}>
            {data.method || 'HTTP'}
          </div>
        {/if}
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
    <div class="px-3 py-3 space-y-2.5">
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">URL</span>
          <span class="text-[10px] text-muted-foreground/60">{data.method || 'HTTP'}</span>
        </div>
        <div class="text-xs text-foreground font-mono truncate max-w-[190px]" title={data.url}>
        {data.url || 'No URL configured'}
        </div>
      </div>
      
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground/60">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19a7 7 0 0 0 7-7"/>
          <path d="M5 12a7 7 0 0 1 7-7"/>
          <path d="M5 12h14"/>
        </svg>
        {data.description || 'Request'}
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