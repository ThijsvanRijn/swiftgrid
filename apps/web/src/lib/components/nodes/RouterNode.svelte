<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';
    
    // Get conditions with a default output
    $: conditions = data.conditions || [];
    $: hasDefault = !!data.defaultOutput;
    
    // Calculate output handles (conditions + optional default)
    $: outputs = [
        ...conditions.map((c, i) => ({ id: c.id, label: c.label, index: i })),
        ...(hasDefault ? [{ id: data.defaultOutput!, label: 'Default', index: conditions.length }] : [])
    ];
    
    // Calculate handle positions (evenly spaced across bottom)
    function getHandlePosition(index: number, total: number): number {
        if (total === 1) return 50;
        const minPos = 15;
        const maxPos = 86;
        const spacing = (maxPos - minPos) / (total - 1);
        return minPos + spacing * index;
    }

    const outputLabelClass = 'text-slate-600';
</script>
  
<!-- 
  Router Node: Conditional branching with multiple outputs
  Selection = subtle border highlight
  Running = colored border
-->
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label}
    <div class={`
      absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 border border-b-0 text-[10px] font-medium rounded-t-sm
      ${data.routerMode === 'broadcast' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-purple-50 border-purple-300 text-purple-700'}
    `}>
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 3v12"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="18" cy="18" r="3"/>
        <path d="M6 15a6 6 0 0 0 6-6 6 6 0 0 1 6-6"/>
        <path d="M6 15a6 6 0 0 1 6 6 6 6 0 0 0 6 6" transform="translate(0, -3)"/>
      </svg>
      <span>{data.routerMode === 'broadcast' ? 'Broadcast' : 'Router'}</span>
    </div>
  {/if}

  <div class={`
      relative min-w-[260px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-purple-500' : selected ? 'border-purple-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(168,85,247,0.45)'
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
          <!-- Node icon - branching symbol -->
          <div class="h-6 w-6 border border-purple-200/60 bg-purple-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 3v12"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="18" cy="18" r="3"/>
              <path d="M6 15a6 6 0 0 0 6-6 6 6 0 0 1 6-6"/>
              <path d="M6 15a6 6 0 0 1 6 6 6 6 0 0 0 6 6" transform="translate(0, -3)"/>
            </svg>
          </div>
          <!-- Mode Badge -->
          <div class={`
            h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border shrink-0
            ${data.routerMode === 'broadcast' ? 'border-amber-200/70 text-amber-600 bg-amber-50/70' : 'border-purple-200/60 text-purple-600 bg-purple-50/60'}
          `}>
            {data.routerMode === 'broadcast' ? 'Broadcast' : 'Router'}
          </div>
        {/if}
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-purple-500/10 border border-purple-200 h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-purple-500 leading-none">Running</span>
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
      {:else if data.status === 'cancelled'}
        <div class="flex items-center gap-1 px-1.5 bg-amber-500/10 border border-amber-200 h-5" title="Cancelled">
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
      <!-- Primary expression block -->
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="flex items-center justify-between mb-1">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">
            Route By
          </div>
          <span class="text-[10px] text-muted-foreground/60">source</span>
        </div>
        <div class="text-xs font-mono text-card-foreground bg-foreground/5 px-2 py-1 rounded-none inline-flex items-center gap-1">
          <span class="text-muted-foreground/70">=</span>
          <span class="tracking-tight">{data.routeBy || '{{prev.status}}'}</span>
        </div>
      </div>
      
      <!-- Condition count + default indicator -->
      <div class="flex items-center justify-between text-[10px] text-muted-foreground/70">
        <div class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22,4 12,14.01 9,11.01"/>
        </svg>
        {conditions.length} condition{conditions.length !== 1 ? 's' : ''}
        </div>
        {#if hasDefault}
          <span class="px-2 py-0.5 border border-muted-foreground/30 text-[10px] uppercase tracking-wide">Default path</span>
        {/if}
      </div>
    </div>
    
    <!-- Output labels row -->
    {#if outputs.length > 0}
      <div class="relative px-3 pt-8 pb-5 border-t border-border/60 bg-muted/20">
        {#each outputs as output, i}
          <div
            class={`absolute text-[10px] font-medium tracking-tight truncate max-w-[80px] text-center ${outputLabelClass}`}
            style={`left: ${getHandlePosition(i, outputs.length)}%; transform: translateX(-50%); bottom: 18px;`}
            title={output.label}
          >
            {output.label}
          </div>
        {/each}
      </div>
    {/if}
  
    <!-- Input Handle (top) -->
    <Handle 
      type="target" 
      position={Position.Top} 
      class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, -50%);"
    />
    
    <!-- Dynamic Output Handles (bottom) -->
    {#each outputs as output, i}
      <Handle 
        type="source" 
        position={Position.Bottom}
        id={output.id}
        style={`left: ${getHandlePosition(i, outputs.length)}%; transform: translate(-50%, 50%);`}
        class="w-2.5! h-2.5! bg-purple-500! border-2! border-card!"
      />
    {/each}
    
    <!-- Fallback single output if no conditions -->
    {#if outputs.length === 0}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!" 
        style="left: 50%; transform: translate(-50%, 50%);" 
      />
    {/if}
  </div>
</div>

