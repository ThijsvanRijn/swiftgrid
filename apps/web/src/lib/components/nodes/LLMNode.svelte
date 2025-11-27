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
<div class="relative">
  <!-- Type tab (only shown when custom label is set) -->
  {#if data.label}
    <div class="absolute -top-5 left-3 flex items-center gap-1.5 px-2 py-0.5 bg-cyan-50 border border-cyan-300 border-b-0 text-[10px] font-medium text-cyan-700 rounded-t-sm">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
      <span>{displayProvider}</span>
    </div>
  {/if}
  
  <div class={`
      relative w-[260px] max-w-[260px] min-w-[260px] bg-card text-card-foreground rounded-none border transition-all duration-300 overflow-visible
      ${isRunning ? 'border-cyan-500' : selected ? 'border-cyan-500/50' : 'border-border/80'}
    `}
    style={`box-shadow: ${
      isRunning
        ? '0 8px 16px -12px rgba(6,182,212,0.45)'
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
          <!-- Node icon - AI brain/sparkle -->
          <div class="h-6 w-6 border border-cyan-200/70 bg-cyan-500/10 flex items-center justify-center shrink-0">
            <svg class="w-3.5 h-3.5 text-cyan-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
            </svg>
          </div>
          <!-- Provider Badge -->
          <div class="h-6 px-2 flex items-center text-[10px] font-semibold uppercase tracking-wide border border-cyan-200/70 bg-cyan-50/80 text-cyan-600 shrink-0">
            {displayProvider}
          </div>
        {/if}
      </div>
      
      <!-- Status badge -->
      {#if isRunning}
        <div class="flex items-center gap-1 px-1.5 bg-cyan-500/10 border border-cyan-200 h-5">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shrink-0"></span>
          <span class="text-[9px] font-medium text-cyan-500 leading-none">Generating</span>
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
      <!-- Model -->
      <div class="border border-border/70 bg-muted/40 px-3 py-2 rounded-none">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Model</span>
          <span class="text-[10px] text-muted-foreground/60">{displayProvider}</span>
        </div>
        <div class="text-xs font-mono text-card-foreground truncate" title={displayModel}>
          {displayModel}
        </div>
      </div>
      
      <!-- System prompt preview -->
      {#if data.systemPrompt}
        <div class="border border-border/60 bg-muted/20 px-3 py-2 rounded-none">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold mb-1">
            System Prompt
          </div>
          <div class="text-[11px] text-foreground/80 leading-snug line-clamp-2">
            {data.systemPrompt}
          </div>
        </div>
      {/if}
      
      <!-- Settings summary -->
      <div class="flex flex-wrap gap-1.5 text-[10px]">
        {#if data.temperature !== undefined}
          <span class="px-2 py-0.5 border border-muted-foreground/30 text-muted-foreground/80" title="Temperature">
            t={data.temperature}
          </span>
        {/if}
        {#if data.maxTokens}
          <span class="px-2 py-0.5 border border-muted-foreground/30 text-muted-foreground/80" title="Max tokens">
            max={data.maxTokens}
          </span>
        {/if}
        {#if data.stream}
          <span class="px-2 py-0.5 border border-cyan-300 text-cyan-600" title="Streaming enabled">
            stream
          </span>
        {/if}
      </div>
      
      <!-- Token usage (after completion) -->
      {#if totalTokens > 0}
        <div class="flex items-center gap-1 text-[10px] text-muted-foreground/70">
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          {totalTokens.toLocaleString()} tokens
        </div>
      {/if}
    </div>
  
    <!-- Input Handle (top) -->
    <Handle 
      type="target" 
      position={Position.Top} 
      class="w-2.5! h-2.5! bg-muted-foreground! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, -50%);"
    />
    
    <!-- Output Handle (bottom) -->
    <Handle 
      type="source" 
      position={Position.Bottom} 
      class="w-2.5! h-2.5! bg-cyan-500! border-2! border-card!"
      style="left: 50%; transform: translate(-50%, 50%);"
    />
  </div>
</div>

