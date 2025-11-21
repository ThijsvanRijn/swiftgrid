<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
</script>
  
    <!-- The Container -->
    <div class={`
        min-w-[200px] bg-card text-card-foreground rounded-lg shadow-xs border-2 transition-all
        ${selected ? 'border-ring ring-1 ring-ring' : 'border-border'}
        ${data.status === 'running' ? 'border-blue-500! shadow-blue-500/20!' : ''}
        ${data.status === 'success' ? 'border-green-500! shadow-green-500/20!' : ''}
        ${data.status === 'error' ? 'border-destructive! shadow-destructive/20!' : ''}
      `}>
    
    <!-- Header: Method & Status -->
    <div class="flex items-center justify-between p-2 border-b border-border bg-muted/50 rounded-t-md">
      <div class="flex items-center gap-2">
        <!-- Method Badge -->
        <span class={`
          text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide
          ${data.method === 'GET' ? 'bg-blue-100 text-blue-700' : ''}
          ${data.method === 'POST' ? 'bg-green-100 text-green-700' : ''}
          ${data.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' : ''}
          ${data.method === 'DELETE' ? 'bg-red-100 text-red-700' : ''}
          ${data.method === 'PATCH' ? 'bg-yellow-100 text-yellow-700' : ''}
          ${!data.method ? 'bg-gray-100 text-gray-500' : ''}
        `}>
          {data.method || 'HTTP'}
        </span>
        
        <!-- Status Light (Pulse) -->
        {#if data.status === 'running'}
          <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
        {/if}
      </div>
    </div>
  
    <!-- Body: URL -->
    <div class="p-3">
      <div class="text-xs text-muted-foreground font-mono truncate max-w-[180px]" title={data.url}>
        {data.url || 'No URL configured'}
      </div>
      
      <!-- Helper text for label -->
      {#if data.label}
        <div class="text-[10px] text-slate-400 mt-1 font-medium uppercase tracking-wider">
          {data.label}
        </div>
      {/if}
    </div>
  
    <!-- Handles -->
    <Handle type="target" position={Position.Top} class="w-3! h-3! bg-muted-foreground" />
    <Handle type="source" position={Position.Bottom} class="w-3! h-3! bg-muted-foreground" />
</div>