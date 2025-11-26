<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
</script>
  
<div class={`
    min-w-[220px] bg-panel text-card-foreground rounded-none border transition-colors
    ${selected ? 'border-primary/60' : 'border-panel-border'}
    ${data.status === 'running' ? 'border-violet-500!' : ''}
    ${data.status === 'success' ? 'border-emerald-500!' : ''}
    ${data.status === 'error' ? 'border-red-500!' : ''}
`}
  style={`box-shadow: ${
    data.status === 'running' ? '0 0 0 1px rgba(139,92,246,0.3), 0 4px 12px -2px rgba(139,92,246,0.15)' :
    data.status === 'success' ? '0 0 0 1px rgba(16,185,129,0.3), 0 4px 12px -2px rgba(16,185,129,0.15)' :
    data.status === 'error' ? '0 0 0 1px rgba(239,68,68,0.3), 0 4px 12px -2px rgba(239,68,68,0.15)' :
    selected ? '0 0 0 1px var(--primary), 0 4px 16px -4px rgba(0,0,0,0.1)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon -->
        <div class="h-6 w-6 bg-violet-500/10 flex items-center justify-center">
          <svg class="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
        </div>
        
        <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide bg-violet-500/15 text-violet-600 dark:text-violet-400">
          JS
        </div>
      </div>
      
      <!-- Status indicator -->
      {#if data.status === 'running'}
        <span class="w-2 h-2 rounded-full bg-violet-500 animate-pulse"></span>
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
  
    <!-- Body: Code Preview -->
    <div class="px-3 py-2.5 font-mono text-[10px] text-muted-foreground bg-sidebar-accent/30">
      <div class="truncate max-w-[190px]">
        {data.code ? data.code.substring(0, 35) + '...' : '// Enter code...'}
      </div>
    </div>
  
    <Handle type="target" position={Position.Top} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -top-1!" />
    <Handle type="source" position={Position.Bottom} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -bottom-1!" />
</div>