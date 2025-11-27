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
        const spacing = 80 / (total - 1);
        return 10 + (spacing * index);
    }
</script>
  
<!-- 
  Router Node: Conditional branching with multiple outputs
  Selection = subtle border highlight
  Running = colored border
-->
<div class={`
    relative min-w-[260px] bg-card text-card-foreground rounded-[8px] border transition-all duration-300 overflow-hidden
    ${isRunning ? 'border-purple-500' : selected ? 'border-purple-500/50' : 'border-border/80'}
  `}
  style={`box-shadow: ${
    isRunning
      ? '0 12px 24px -18px rgba(168,85,247,0.45)'
      : '0 18px 30px -22px rgba(15,23,42,0.35)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-border/70 bg-gradient-to-r from-muted/40 to-card">
      <div class="flex items-center gap-2">
        <!-- Node icon - branching symbol -->
        <div class="h-7 w-7 rounded-full border border-purple-200/70 bg-purple-500/10 flex items-center justify-center">
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
          h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full border
          ${data.routerMode === 'broadcast' ? 'border-amber-200 text-amber-600 bg-amber-50/80' : 'border-purple-200 text-purple-600 bg-purple-50/80'}
        `}>
          {data.routerMode === 'broadcast' ? 'Broadcast' : 'Router'}
        </div>
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-purple-500/10 border border-purple-200 rounded-full h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-purple-500 leading-none">Running</span>
        </div>
      {:else if data.status === 'success'}
        <div class="flex items-center gap-1 px-1.5 bg-emerald-500/10 border border-emerald-200 rounded-full h-5" title="Completed successfully">
          <svg class="w-2.5 h-2.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="text-[9px] font-medium text-emerald-500 leading-none">Done</span>
        </div>
      {:else if data.status === 'error'}
        <div class="flex items-center gap-1 px-1.5 bg-red-500/10 border border-red-200 rounded-full h-5" title="Failed">
          <svg class="w-2.5 h-2.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
          <span class="text-[9px] font-medium text-red-500 leading-none">Error</span>
        </div>
      {/if}
    </div>
  
    <!-- Body -->
    <div class="px-3 py-3 space-y-2.5">
      <!-- Primary expression block -->
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-[6px]">
        <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">
          Route By
        </div>
        <div class="text-xs text-muted-foreground font-mono truncate" title={data.routeBy}>
          {data.routeBy || 'No route expression'}
        </div>
      </div>
      
      {#if data.label}
        <div class="text-[11px] text-muted-foreground/80 border border-dashed border-border/60 rounded-[6px] px-3 py-1.5 bg-card/80">
          {data.label}
        </div>
      {/if}
      
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
          <span class="px-2 py-0.5 rounded-full border border-muted-foreground/30 text-[10px] uppercase tracking-wide">Default path</span>
        {/if}
      </div>
    </div>
    
    <!-- Output labels row -->
    {#if outputs.length > 0}
      <div class="px-3 pb-3 pt-2 border-t border-border/60 bg-muted/20 flex gap-2">
        {#each outputs as output}
          <div class="text-[9px] text-muted-foreground/70 font-medium px-2 py-1 rounded-[4px] border border-border/70 bg-card/90 truncate" title={output.label}>
            {output.label}
          </div>
        {/each}
      </div>
    {/if}
  
    <!-- Input Handle (top) -->
    <Handle type="target" position={Position.Top} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -top-1!" />
    
    <!-- Dynamic Output Handles (bottom) -->
    {#each outputs as output, i}
      <Handle 
        type="source" 
        position={Position.Bottom}
        id={output.id}
        style={`left: ${getHandlePosition(i, outputs.length)}%; transform: translateX(-50%);`}
        class="w-2.5! h-2.5! bg-purple-500! border-2! border-panel! -bottom-1!"
      />
    {/each}
    
    <!-- Fallback single output if no conditions -->
    {#if outputs.length === 0}
      <Handle type="source" position={Position.Bottom} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -bottom-1!" />
    {/if}
</div>

