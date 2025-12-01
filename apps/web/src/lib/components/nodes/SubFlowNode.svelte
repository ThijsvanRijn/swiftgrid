<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';
    $: isSuspended = data.status === 'suspended';
</script>
  
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label}
    <div class="absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 border border-b-0 text-[10px] font-medium rounded-t-sm bg-violet-50 border-violet-300 text-violet-700">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <span>Sub-Flow</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[240px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-violet-500' : isSuspended ? 'border-amber-500' : selected ? 'border-violet-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(139,92,246,0.45)'
        : isSuspended
        ? '0 8px 16px -12px rgba(245,158,11,0.45)'
        : '0 10px 18px -14px rgba(15,23,42,0.25)'
    }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2 min-w-0">
        {#if data.label}
          <span class="text-xs font-medium text-foreground truncate" title={data.label}>
            {data.label}
          </span>
        {:else}
          <!-- Node icon -->
          <div class="h-6 w-6 border border-violet-200/70 bg-violet-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <!-- Badge -->
          <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border border-violet-200/70 text-violet-600 bg-violet-50/80 shrink-0">
            Sub-Flow
          </div>
        {/if}
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-violet-500/15 rounded-sm h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-violet-500 leading-none">Running</span>
        </div>
      {:else if isSuspended}
        <div class="flex items-center gap-1 px-1.5 bg-amber-500/15 rounded-sm h-5" title="Waiting for sub-flow to complete">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-amber-500 leading-none">Waiting</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/15 rounded-sm h-5" title="Completed successfully">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/15 rounded-sm h-5" title="Sub-flow failed">
          <svg class="w-2.5 h-2.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
          <span class="text-[9px] font-medium text-red-500 leading-none">Error</span>
        </div>
      {:else if data.status === 'cancelled'}
        <div class="flex items-center gap-1 px-1.5 bg-amber-500/15 rounded-sm h-5" title="Cancelled">
          <svg class="w-2.5 h-2.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12h8"/>
          </svg>
          <span class="text-[9px] font-medium text-amber-500 leading-none">Cancelled</span>
        </div>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-3 space-y-2.5">
      <!-- Workflow Selection -->
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Workflow</span>
          {#if data.subflowVersionNumber}
            <span class="text-[10px] text-violet-500 font-medium">v{data.subflowVersionNumber}</span>
          {/if}
        </div>
        <div class="text-xs text-foreground font-medium truncate max-w-[200px]" title={data.subflowName}>
          {data.subflowName || 'Select a workflow...'}
        </div>
      </div>
      
      <!-- Input Mapping Preview -->
      {#if data.subflowInput}
        <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">Input</div>
          <div class="text-[10px] text-muted-foreground font-mono truncate">
            {typeof data.subflowInput === 'string' ? data.subflowInput : JSON.stringify(data.subflowInput).slice(0, 40)}...
          </div>
        </div>
      {/if}
      
      <!-- Options Row -->
      <div class="flex items-center gap-3 text-[10px] text-muted-foreground/60">
        {#if data.subflowFailOnError}
          <div class="flex items-center gap-1" title="Parent fails if sub-flow fails">
            <svg class="w-3 h-3 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Fail on error</span>
          </div>
        {/if}
        <div class="flex items-center gap-1">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19a7 7 0 0 0 7-7"/>
            <path d="M5 12a7 7 0 0 1 7-7"/>
            <path d="M5 12h14"/>
          </svg>
          {data.description || 'Execute sub-flow'}
        </div>
      </div>
    </div>
  
    <!-- Handles -->
    <!-- Input handle (top) -->
    <Handle 
      type="target" 
      position={Position.Top} 
      class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, -50%);"
    />
    
    <!-- Success output (bottom) -->
    <Handle 
      type="source" 
      position={Position.Bottom}
      id="success"
      class="w-2.5! h-2.5! bg-emerald-500! border-2! border-card!"
      style="left: 35%; transform: translate(-50%, 50%);"
    />
    
    <!-- Error output (bottom-right, red) -->
    <Handle 
      type="source" 
      position={Position.Bottom}
      id="error"
      class="w-2.5! h-2.5! bg-red-500! border-2! border-card!"
      style="left: 65%; transform: translate(-50%, 50%);"
    />
  </div>
</div>

