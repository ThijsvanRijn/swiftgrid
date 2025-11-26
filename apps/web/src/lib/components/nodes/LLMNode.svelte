<script lang="ts">
    import { Handle, Position } from '@xyflow/svelte';
    import type { AppNodeData } from '$lib/types/app';

    export let data: AppNodeData;
    export let selected: boolean = false;
    
    // Status states
    $: isRunning = data.status === 'running';
    
    // Display model info
    $: displayModel = data.model || 'No model selected';
    $: displayProvider = getProviderFromUrl(data.baseUrl);
    
    function getProviderFromUrl(url?: string): string {
        if (!url) return 'OpenAI';
        if (url.includes('openai.com')) return 'OpenAI';
        if (url.includes('groq.com')) return 'Groq';
        if (url.includes('together.xyz')) return 'Together';
        if (url.includes('localhost') || url.includes('127.0.0.1')) return 'Local';
        if (url.includes('openrouter.ai')) return 'OpenRouter';
        return 'Custom';
    }
    
    // Token usage from result
    $: usage = data.result?.usage;
    $: totalTokens = usage?.total_tokens || 0;
</script>
  
<!-- 
  LLM Node: AI/Chat completion node
  Selection = subtle border highlight
  Running = colored border with pulse
-->
<div class={`
    min-w-[220px] bg-panel text-card-foreground rounded-none border-2 transition-all duration-300
    ${isRunning ? 'border-cyan-500' : selected ? 'border-cyan-500/50' : 'border-transparent'}
  `}
  style={`box-shadow: ${
    isRunning ? '0 0 0 1px rgba(6,182,212,0.3), 0 4px 12px -2px rgba(6,182,212,0.15)' :
    'var(--shadow-float)'
  }`}>
    
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-panel-border">
      <div class="flex items-center gap-2">
        <!-- Node icon - AI brain/sparkle -->
        <div class="h-6 w-6 bg-cyan-500/10 flex items-center justify-center">
          <svg class="w-3.5 h-3.5 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
        </div>
        
        <!-- Provider Badge -->
        <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
          {displayProvider}
        </div>
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-cyan-500/15 rounded-sm h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-cyan-500 leading-none">Generating</span>
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
      <!-- Model name -->
      <div class="text-xs text-foreground font-mono truncate max-w-[200px]" title={displayModel}>
        {displayModel}
      </div>
      
      {#if data.label}
        <div class="text-[10px] text-muted-foreground/60 mt-1 font-medium">
          {data.label}
        </div>
      {/if}
      
      <!-- System prompt preview -->
      {#if data.systemPrompt}
        <div class="text-[10px] text-muted-foreground/60 mt-1.5 truncate max-w-[200px]" title={data.systemPrompt}>
          System: {data.systemPrompt.slice(0, 40)}{data.systemPrompt.length > 40 ? '...' : ''}
        </div>
      {/if}
      
      <!-- Settings summary -->
      <div class="text-[10px] text-muted-foreground/40 mt-1.5 flex items-center gap-2">
        {#if data.temperature !== undefined}
          <span title="Temperature">t={data.temperature}</span>
        {/if}
        {#if data.maxTokens}
          <span title="Max tokens">max={data.maxTokens}</span>
        {/if}
        {#if data.stream}
          <span class="text-cyan-500/70" title="Streaming enabled">stream</span>
        {/if}
      </div>
      
      <!-- Token usage (after completion) -->
      {#if totalTokens > 0}
        <div class="text-[10px] text-muted-foreground/50 mt-1.5 flex items-center gap-1">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          {totalTokens.toLocaleString()} tokens
        </div>
      {/if}
    </div>
  
    <!-- Input Handle (top) -->
    <Handle type="target" position={Position.Top} class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-panel! -top-1!" />
    
    <!-- Output Handle (bottom) -->
    <Handle type="source" position={Position.Bottom} class="w-2.5! h-2.5! bg-cyan-500! border-2! border-panel! -bottom-1!" />
</div>

