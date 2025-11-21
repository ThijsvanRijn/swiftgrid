<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
</script>
  
<div class={`
    min-w-[200px] bg-card text-card-foreground rounded-lg shadow-md border-2 transition-all
    ${selected ? 'border-slate-300 dark:border-slate-500 bg-slate-50/40 dark:bg-slate-900/40 shadow-[0_0_0_1px_rgba(148,163,184,0.4)] dark:shadow-[0_0_0_1px_rgba(100,116,139,0.5)]' : 'border-border'}
    ${data.status === 'running' ? 'border-purple-500! shadow-purple-500/20!' : ''}
    ${data.status === 'success' ? 'border-green-500! shadow-green-500/20!' : ''}
    ${data.status === 'error' ? 'border-destructive! shadow-destructive/20!' : ''}
`}>
    
    <!-- Header: Code Icon & Status -->
    <div class="flex items-center justify-between p-2 border-b border-border bg-muted/50 rounded-t-md">
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-purple-100 text-purple-700">
            JS
        </span>
        <span class="text-xs font-bold text-muted-foreground">Logic</span>
        
        {#if data.status === 'running'}
          <span class="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
        {/if}
      </div>
    </div>
  
    <!-- Body: Code Preview -->
    <div class="p-3 font-mono text-[10px] text-muted-foreground bg-muted/20">
      <div class="truncate max-w-[180px] opacity-70">
        {data.code ? data.code.substring(0, 30) + '...' : '// Enter code...'}
      </div>
    </div>
  
    <Handle type="target" position={Position.Top} class="w-3! h-3! bg-muted-foreground!" />
    <Handle type="source" position={Position.Bottom} class="w-3! h-3! bg-muted-foreground!" />
</div>