<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';
    $: isSuspended = data.status === 'suspended';
    
    // Progress calculation
    $: progress = data.mapProgress ?? 0;  // 0-1
    $: progressPercent = Math.round(progress * 100);
    $: completedCount = data.mapCompletedCount ?? 0;
    $: totalCount = data.mapTotalCount ?? 0;
</script>
  
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label}
    <div class="absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 border border-b-0 text-[10px] font-medium rounded-t-sm bg-orange-50 border-orange-300 text-orange-700">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
        <path d="M15 5l4 4"/>
        <path d="M2 12h6"/>
        <path d="M2 16h4"/>
        <path d="M2 20h2"/>
      </svg>
      <span>Map</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[240px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-orange-500' : isSuspended ? 'border-amber-500' : selected ? 'border-orange-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(249,115,22,0.45)'
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
          <div class="h-6 w-6 border border-orange-200/70 bg-orange-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
              <path d="M15 5l4 4"/>
            </svg>
          </div>
          <!-- Badge -->
          <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border border-orange-200/70 text-orange-600 bg-orange-50/80 shrink-0">
            Map
          </div>
        {/if}
      </div>
      
      <!-- Status badge (always present to prevent layout shift) -->
      <div class="h-5 min-w-[42px]">
      {#if isRunning || isSuspended}
        <div class="flex items-center gap-1 px-1.5 bg-orange-500/15 rounded-sm h-5" title={`${completedCount}/${totalCount} completed`}>
          <span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-orange-500 leading-none">{completedCount}/{totalCount}</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/15 rounded-sm h-5" title="All iterations completed">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/15 rounded-sm h-5" title="Some iterations failed">
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
        {:else}
          <!-- Idle state - show ready indicator -->
          <div class="flex items-center gap-1 px-1.5 bg-muted/50 rounded-sm h-5" title="Ready to run">
            <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0"></span>
            <span class="text-[9px] font-medium text-muted-foreground/50 leading-none">Ready</span>
          </div>
      {/if}
      </div>
    </div>
  
    <!-- Progress bar (styled like a border, same height as panel border) -->
    <div class="h-px bg-border/50">
        <div 
          class="h-full bg-orange-500 transition-all duration-300"
        style="width: {isRunning || isSuspended ? progressPercent : (data.status === 'success' ? 100 : 0)}%"
        ></div>
      </div>
  
    <!-- Body -->
    <div class="px-3 py-3 space-y-2.5">
      <!-- Workflow Selection -->
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Iterate With</span>
          {#if data.mapVersionNumber}
            <span class="text-[10px] text-orange-500 font-medium">v{data.mapVersionNumber}</span>
          {/if}
        </div>
        <div class="text-xs text-foreground font-medium truncate max-w-[200px]" title={data.mapWorkflowName}>
          {data.mapWorkflowName || 'Select a workflow...'}
        </div>
      </div>
      
      <!-- Input Array Preview -->
      {#if data.mapInputArray}
        <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">Input Array</div>
          <div class="text-[10px] text-muted-foreground font-mono truncate">
            {data.mapInputArray.slice(0, 40)}{data.mapInputArray.length > 40 ? '...' : ''}
          </div>
        </div>
      {/if}
      
      <!-- Options Row -->
      <div class="flex items-center gap-3 text-[10px] text-muted-foreground/60">
        <!-- Concurrency -->
        <div class="flex items-center gap-1" title={`Max ${data.mapConcurrency || 5} parallel executions`}>
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1"/>
          </svg>
          <span>{data.mapConcurrency || 5}x</span>
        </div>
        
        {#if data.mapFailFast}
          <div class="flex items-center gap-1" title="Stops on first failure">
            <svg class="w-3 h-3 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>Fail fast</span>
          </div>
        {/if}
        
        <div class="flex items-center gap-1">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19a7 7 0 0 0 7-7"/>
            <path d="M5 12a7 7 0 0 1 7-7"/>
            <path d="M5 12h14"/>
          </svg>
          {data.description || 'Iterate over array'}
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

