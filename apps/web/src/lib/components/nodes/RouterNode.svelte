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
    min-w-[240px] bg-panel text-card-foreground rounded-none border-2 transition-all duration-300
    ${isRunning ? 'border-purple-500' : selected ? 'border-purple-500/50' : 'border-transparent'}
  `}
  style={`box-shadow: ${
    isRunning ? '0 0 0 1px rgba(168,85,247,0.3), 0 4px 12px -2px rgba(168,85,247,0.15)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon - branching symbol -->
        <div class="h-6 w-6 bg-purple-500/10 flex items-center justify-center">
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
          h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide
          ${data.routerMode === 'broadcast' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'}
        `}>
          {data.routerMode === 'broadcast' ? 'Broadcast' : 'Router'}
        </div>
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-purple-500/15 rounded-sm h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-purple-500 leading-none">Running</span>
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
      <!-- Route By expression -->
      <div class="text-xs text-muted-foreground font-mono truncate max-w-[210px]" title={data.routeBy}>
        {data.routeBy || 'No route expression'}
      </div>
      
      {#if data.label}
        <div class="text-[10px] text-muted-foreground/60 mt-1 font-medium">
          {data.label}
        </div>
      {/if}
      
      <!-- Condition count -->
      <div class="text-[10px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22,4 12,14.01 9,11.01"/>
        </svg>
        {conditions.length} condition{conditions.length !== 1 ? 's' : ''}
        {#if hasDefault}
          <span class="text-muted-foreground/40">+ default</span>
        {/if}
      </div>
    </div>
    
    <!-- Output labels row -->
    {#if outputs.length > 0}
      <div class="px-2 pb-2 flex justify-around">
        {#each outputs as output}
          <div class="text-[8px] text-muted-foreground/70 font-medium px-1 truncate max-w-[60px]" title={output.label}>
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

