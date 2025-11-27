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
    <div class="absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 bg-violet-50 border border-violet-300 border-b-0 text-[10px] font-medium text-violet-700 rounded-t-sm">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
      <span>JS</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[220px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-violet-500' : selected ? 'border-violet-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(139,92,246,0.45)'
        : '0 10px 18px -14px rgba(15,23,42,0.25)'
    }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-border/70 bg-linear-to-r from-muted/40 to-card">
      <div class="flex items-center gap-2 min-w-0">
        {#if data.label}
          <!-- Custom label (icon shown in tab above) -->
          <span class="text-xs font-medium text-foreground truncate" title={data.label}>
            {data.label}
          </span>
        {:else}
          <!-- Node icon -->
          <div class="h-6 w-6 border border-violet-200/70 bg-violet-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </div>
          <!-- Type badge -->
          <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border border-violet-200/70 bg-violet-50/80 text-violet-600 shrink-0">
            JS
          </div>
        {/if}
      </div>
      
      <!-- Status badge - consistent style across all states -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-violet-500/10 border border-violet-200 h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-violet-500 leading-none">Running</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/10 border border-emerald-200 h-5" title="Completed successfully">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/10 border border-red-200 h-5" title="Failed">
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
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Code</span>
          <span class="text-[10px] text-muted-foreground/60 font-medium">preview</span>
        </div>
        <div class="font-mono text-[10px] text-foreground bg-foreground/5 px-2 py-1 rounded-none truncate max-w-[190px]" title={data.code}>
          {data.code ? data.code.substring(0, 45) + (data.code.length > 45 ? '…' : '') : '// Enter code...'}
        </div>
      </div>
      
    </div>
  
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