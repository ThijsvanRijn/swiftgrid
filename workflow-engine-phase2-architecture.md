# SwiftGrid Phase 2: Advanced Features Architecture

> **Document Purpose**: Architecture design for Run History UI, Conditional Branching, LLM Nodes, Sub-Flows, Cron Scheduling, and Map/Iterator patterns.

---

## Table of Contents

1. [Feature Priority & Dependencies](#1-feature-priority--dependencies)
2. [Run History UI](#2-run-history-ui)
3. [Conditional Branching (Router Node)](#3-conditional-branching-router-node)
4. [LLM Chat Node](#4-llm-chat-node)
5. [Sub-Flows (Reusable Workflows)](#5-sub-flows-reusable-workflows)
6. [Cron Scheduling](#6-cron-scheduling)
7. [Map/Iterator Node](#7-mapiterator-node)
8. [Database Schema Additions](#8-database-schema-additions)
9. [Critical Questions](#9-critical-questions)

---

## 1. Feature Priority & Dependencies

### Implementation Order

| Order | Feature | Effort | Value | Dependencies |
|-------|---------|--------|-------|--------------|
| 1 | **Run History UI** | Low | High | None (event log exists) |
| 2 | **Conditional Branching** | Medium | High | None |
| 3 | **LLM Chat Node** | Medium | Very High | Streaming infrastructure (done) |
| 4 | **Sub-Flows** | Medium-High | High | None |
| 5 | **Cron Scheduling** | Low | Medium | None |
| 6 | **Map/Iterator** | High | High | Parallel execution (implicit) |

### Dependency Graph

```
┌─────────────────┐
│ Run History UI  │ ◀── No deps, start here
└─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Router Node     │     │ LLM Chat Node   │ ◀── Uses existing streaming
└─────────────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ Sub-Flows       │     │ Cron Scheduling │
└─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Map/Iterator    │ ◀── Needs sub-flow patterns
└─────────────────┘
```

---

## 2. Run History UI

### 2.1 Overview

**Goal**: Browse past runs, view their status, replay events, and re-run with same inputs.

**Why it's almost free**: Your event log already contains everything. This is purely UI work.

### 2.2 UI Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Run History                                          [Filter ▼] │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ● Run #a1b2c3d4                                             │ │
│ │   Status: ✓ Completed    Duration: 2.3s                     │ │
│ │   Trigger: Manual        Started: 2 hours ago               │ │
│ │   [View] [Re-run] [Delete]                                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ● Run #e5f6g7h8                                             │ │
│ │   Status: ✗ Failed       Duration: 0.8s                     │ │
│ │   Trigger: Webhook       Started: 5 hours ago               │ │
│ │   Error: "Connection timeout at node HTTP-1"                │ │
│ │   [View] [Re-run] [Delete]                                  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ○ Run #i9j0k1l2                                             │ │
│ │   Status: ◐ Running      Duration: 45s (ongoing)            │ │
│ │   Trigger: Cron          Started: 1 min ago                 │ │
│ │   Current: "Waiting at WebhookWait-1"                       │ │
│ │   [View] [Cancel]                                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Run Detail View

When clicking "View", show the canvas with:
- **Historical node status** (badges showing success/error from that run)
- **Event timeline** (sidebar showing all events in order)
- **Time-travel slider** (scrub through events to see state at any point)

```
┌─────────────────────────────────────────────────────────────────┐
│ Run #a1b2c3d4                                    [← Back] [Re-run]│
├───────────────────────────────────┬─────────────────────────────┤
│                                   │ Event Timeline              │
│   ┌─────────┐    ┌─────────┐     │ ─────────────────────────── │
│   │ HTTP ✓  │───▶│ Code ✓  │     │ 10:00:00 RUN_CREATED        │
│   └─────────┘    └─────────┘     │ 10:00:00 NODE_SCHEDULED (A) │
│        │              │          │ 10:00:01 NODE_STARTED (A)   │
│        ▼              ▼          │ 10:00:02 NODE_COMPLETED (A) │
│   ┌─────────────────────┐        │ 10:00:02 NODE_SCHEDULED (B) │
│   │     Router ✓        │        │ 10:00:02 NODE_STARTED (B)   │
│   └─────────────────────┘        │ 10:00:03 NODE_COMPLETED (B) │
│                                   │ 10:00:03 RUN_COMPLETED      │
│   ──────────────────────────     │                             │
│   [|◀] [◀] ────●───────── [▶]   │ Duration: 3.2s              │
│   Time: 10:00:02                  │ Nodes: 3/3 completed        │
├───────────────────────────────────┴─────────────────────────────┤
│ Selected: HTTP Node                                              │
│ Input: { "url": "https://api.example.com" }                     │
│ Output: { "status": 200, "body": {...} }                        │
│ Duration: 1.2s                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 API Endpoints

```typescript
// List runs for a workflow
GET /api/flows/[flowId]/runs
  ?status=completed|failed|running
  ?trigger=manual|webhook|cron
  ?limit=20
  ?cursor=<last_run_id>

// Get run details
GET /api/runs/[runId]
  → { run, events, nodeResults }

// Get events for a run (paginated)
GET /api/runs/[runId]/events
  ?after=<event_id>
  ?limit=100

// Re-run with same inputs
POST /api/runs/[runId]/replay
  → Creates new run with same inputData

// Cancel a running workflow
POST /api/runs/[runId]/cancel
```

### 2.5 Implementation Checklist

- [ ] Create `RunHistoryPanel.svelte` component
- [ ] Create `RunDetailView.svelte` with historical canvas
- [ ] Add API endpoints for listing/viewing runs
- [ ] Implement time-travel slider (filter events by timestamp)
- [ ] Add "Re-run" functionality
- [ ] Add "Cancel" functionality for running workflows
- [ ] Add filters (status, trigger, date range)
- [ ] Add pagination with cursor-based loading

---

## 3. Conditional Branching (Router Node)

### 3.1 Overview

**Goal**: Route execution to different branches based on data conditions.

**Model**: Switch/Case with multiple outputs (not binary if/else).

### 3.2 Router Node Design

```
┌─────────────────────────────────────────┐
│ ○ Input                                 │
├─────────────────────────────────────────┤
│  🔀  ROUTER                             │
│                                         │
│  Route by: {{previous.status}}          │
├─────────────────────────────────────────┤
│  ● 2xx    ● 4xx    ● 5xx    ● default  │
└─────────────────────────────────────────┘
     │         │        │          │
     ▼         ▼        ▼          ▼
  Success   NotFound  Error    Fallback
```

### 3.3 Node Data Structure

```typescript
interface RouterNodeData {
  type: 'router';
  label: string;
  
  // What field to evaluate
  routeBy: string;  // e.g., "{{previous.status}}" or "{{node_abc.body.type}}"
  
  // Conditions (evaluated in order, first match wins)
  conditions: RouterCondition[];
  
  // What happens if nothing matches
  defaultOutput: string;  // output handle ID
  
  // Evaluation mode
  mode: 'first_match' | 'all_matches';  // usually first_match
}

interface RouterCondition {
  id: string;           // unique ID, used as output handle
  label: string;        // display name (e.g., "Success", "Not Found")
  expression: string;   // JS expression: "value >= 200 && value < 300"
  color: string;        // handle color: "green", "orange", "red"
}
```

### 3.4 Example Configurations

**HTTP Status Router:**
```json
{
  "routeBy": "{{http_node.body.status}}",
  "conditions": [
    { "id": "success", "label": "2xx", "expression": "value >= 200 && value < 300", "color": "green" },
    { "id": "client_error", "label": "4xx", "expression": "value >= 400 && value < 500", "color": "orange" },
    { "id": "server_error", "label": "5xx", "expression": "value >= 500", "color": "red" }
  ],
  "defaultOutput": "unknown",
  "mode": "first_match"
}
```

**Content Type Router:**
```json
{
  "routeBy": "{{webhook.body.event_type}}",
  "conditions": [
    { "id": "created", "label": "Created", "expression": "value === 'user.created'" },
    { "id": "updated", "label": "Updated", "expression": "value === 'user.updated'" },
    { "id": "deleted", "label": "Deleted", "expression": "value === 'user.deleted'" }
  ],
  "defaultOutput": "other"
}
```

### 3.5 Rust Worker Implementation

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RouterNodeData {
    pub route_by: String,
    pub conditions: Vec<RouterCondition>,
    pub default_output: String,
    pub mode: String,  // "first_match" or "all_matches"
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RouterCondition {
    pub id: String,
    pub label: String,
    pub expression: String,
}

// In process_job:
NodeType::Router(data) => {
    // 1. Resolve the routeBy value from context
    let value = resolve_variable(&data.route_by, &job.context)?;
    
    // 2. Evaluate conditions
    let mut matched_outputs: Vec<String> = Vec::new();
    
    for condition in &data.conditions {
        // Use QuickJS to evaluate the expression
        let result = evaluate_condition(&condition.expression, &value)?;
        
        if result {
            matched_outputs.push(condition.id.clone());
            if data.mode == "first_match" {
                break;
            }
        }
    }
    
    // 3. Use default if no matches
    if matched_outputs.is_empty() {
        matched_outputs.push(data.default_output.clone());
    }
    
    // 4. Return result with matched outputs
    ExecutionResult {
        status: 200,
        result: json!({
            "matched_outputs": matched_outputs,
            "evaluated_value": value,
        }),
        // ... other fields
    }
}
```

### 3.6 Orchestrator Changes

The orchestrator needs to understand that Router nodes have **conditional edges**:

```typescript
// In orchestrate/+server.ts

// When scheduling next nodes after a Router completes:
if (completedNode.type === 'router') {
  const matchedOutputs = result.matched_outputs;
  
  // Only schedule nodes connected to matched output handles
  const nextNodes = edges
    .filter(e => e.source === completedNode.id)
    .filter(e => matchedOutputs.includes(e.sourceHandle))  // ← KEY CHANGE
    .map(e => nodes.find(n => n.id === e.target));
    
  for (const node of nextNodes) {
    await scheduleNode(node, context);
  }
}
```

### 3.7 SvelteFlow Component

The Router node needs **dynamic handles** based on conditions:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  
  export let data: RouterNodeData;
  
  // Dynamic output handles based on conditions
  $: outputs = [
    ...data.conditions.map(c => ({ id: c.id, label: c.label, color: c.color })),
    { id: data.defaultOutput, label: 'Default', color: 'gray' }
  ];
</script>

<div class="router-node">
  <Handle type="target" position={Position.Top} />
  
  <div class="header">🔀 ROUTER</div>
  <div class="route-by">Route: {data.routeBy}</div>
  
  <div class="outputs">
    {#each outputs as output, i}
      <div class="output-row">
        <span class="output-label">{output.label}</span>
        <Handle 
          type="source" 
          position={Position.Bottom}
          id={output.id}
          style="left: {(i + 1) * (100 / (outputs.length + 1))}%; background: {output.color};"
        />
      </div>
    {/each}
  </div>
</div>
```

### 3.8 Config Panel

```svelte
<!-- In ConfigPanel.svelte for router nodes -->
<div class="router-config">
  <label>Route By</label>
  <input bind:value={data.routeBy} placeholder="{{node.field}}" />
  
  <label>Conditions</label>
  {#each data.conditions as condition, i}
    <div class="condition-row">
      <input bind:value={condition.label} placeholder="Label" />
      <input bind:value={condition.expression} placeholder="value === 'x'" />
      <select bind:value={condition.color}>
        <option value="green">Green</option>
        <option value="orange">Orange</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
      </select>
      <button on:click={() => removeCondition(i)}>×</button>
    </div>
  {/each}
  <button on:click={addCondition}>+ Add Condition</button>
  
  <label>Default Output</label>
  <input bind:value={data.defaultOutput} placeholder="fallback" />
</div>
```

### 3.9 Implementation Checklist

- [ ] Add `RouterNodeData` to shared types
- [ ] Add `ROUTER` to `NodeType` enum in Rust
- [ ] Implement condition evaluation in worker (QuickJS)
- [ ] Create `RouterNode.svelte` component with dynamic handles
- [ ] Update orchestrator to handle conditional edges
- [ ] Add router config section to `ConfigPanel.svelte`
- [ ] Add "+ Router" button to Navbar
- [ ] Update `flowStore` to support router node creation

---

## 4. LLM Chat Node

### 4.1 Overview

**Goal**: Universal LLM node supporting any OpenAI-compatible API.

**Key Insight**: Almost every LLM provider supports the OpenAI spec (Groq, Together, OpenRouter, Ollama, etc.)

### 4.2 Node Design

```
┌─────────────────────────────────────────┐
│ ○ Input                                 │
├─────────────────────────────────────────┤
│  🤖  LLM CHAT                           │
│                                         │
│  Model: gpt-4o                          │
│  Tokens: ~500 est.                      │
├─────────────────────────────────────────┤
│  "Analyze the data and..."              │
│  ─────────────────────────              │
│  ▌ Streaming response...                │
└─────────────────────────────────────────┘
     │
     ○ Output
```

### 4.3 Node Data Structure

```typescript
interface LLMChatNodeData {
  type: 'llm-chat';
  label: string;
  
  // Connection (all support variable interpolation)
  baseUrl: string;      // "https://api.openai.com/v1" or "{{$env.LLM_BASE_URL}}"
  apiKey: string;       // "{{$env.OPENAI_API_KEY}}"
  model: string;        // "gpt-4o" or "{{$env.LLM_MODEL}}"
  
  // Prompt
  systemPrompt: string; // "You are a helpful assistant..."
  userPrompt: string;   // "{{previous_node.output}}" - supports interpolation
  
  // Options
  temperature: number;  // 0.0 - 2.0
  maxTokens: number;    // max output tokens
  stream: boolean;      // use streaming (recommended)
  
  // Optional: JSON mode
  jsonMode: boolean;    // force JSON output
  jsonSchema?: object;  // optional schema for structured output
}
```

### 4.4 Rust Worker Implementation

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LLMChatNodeData {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub stream: bool,
    pub json_mode: bool,
}

async fn execute_llm_chat(
    data: &LLMChatNodeData,
    context: &JobContext,
    stream_ctx: &StreamContext,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    // Resolve variables
    let base_url = resolve_variable(&data.base_url, context)?;
    let api_key = resolve_variable(&data.api_key, context)?;
    let system_prompt = resolve_variable(&data.system_prompt, context)?;
    let user_prompt = resolve_variable(&data.user_prompt, context)?;
    
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    
    let mut body = json!({
        "model": data.model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": data.temperature,
        "max_tokens": data.max_tokens,
        "stream": data.stream,
    });
    
    if data.json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    
    if data.stream {
        // Streaming response
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        let mut full_content = String::new();
        let mut stream = response.bytes_stream();
        let mut chunk_index = 0;
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&chunk);
            
            // Parse SSE format: "data: {...}"
            for line in text.lines() {
                if line.starts_with("data: ") && line != "data: [DONE]" {
                    let json_str = &line[6..];
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                        if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                            full_content.push_str(content);
                            
                            // Stream token to UI
                            stream_ctx.token(content, chunk_index).await;
                            chunk_index += 1;
                        }
                    }
                }
            }
        }
        
        stream_ctx.complete().await;
        
        Ok(json!({
            "content": full_content,
            "model": data.model,
            "tokens_used": chunk_index,  // approximate
        }))
    } else {
        // Non-streaming response
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        
        let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        
        Ok(json!({
            "content": result["choices"][0]["message"]["content"],
            "model": data.model,
            "usage": result["usage"],
        }))
    }
}
```

### 4.5 StreamContext Token Method

Add to existing `StreamContext`:

```rust
impl StreamContext {
    // Existing methods: progress, data, error, complete
    
    /// Stream an LLM token (special chunk type for UI rendering)
    pub async fn token(&self, content: &str, index: u32) {
        self.publish_chunk(StreamChunk {
            chunk_type: StreamChunkType::Token,
            content: content.to_string(),
            chunk_index: index,
            // ... other fields
        }).await;
    }
}
```

### 4.6 Frontend: Live Token Display

Update `ResultsPanel.svelte` to handle token streaming:

```svelte
<script>
  // ... existing code
  
  // Accumulate tokens for display
  let streamedContent = '';
  
  $effect(() => {
    const chunks = chunksByNode.get(selectedNodeId) || [];
    
    // Rebuild content from token chunks
    streamedContent = chunks
      .filter(c => c.chunk_type === 'token')
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map(c => c.content)
      .join('');
  });
</script>

{#if streamedContent}
  <div class="llm-output">
    <div class="prose">
      {streamedContent}
      {#if isStreaming}
        <span class="cursor">▌</span>
      {/if}
    </div>
  </div>
{/if}
```

### 4.7 Config Panel

```svelte
<!-- LLM Chat configuration -->
<div class="llm-config">
  <div class="section">
    <h4>Connection</h4>
    
    <label>Base URL</label>
    <input bind:value={data.baseUrl} placeholder="https://api.openai.com/v1" />
    <span class="hint">Or use {{$env.LLM_BASE_URL}}</span>
    
    <label>API Key</label>
    <input bind:value={data.apiKey} placeholder="{{$env.OPENAI_API_KEY}}" type="password" />
    
    <label>Model</label>
    <input bind:value={data.model} placeholder="gpt-4o" />
  </div>
  
  <div class="section">
    <h4>Prompt</h4>
    
    <label>System Prompt</label>
    <textarea bind:value={data.systemPrompt} rows="3" placeholder="You are a helpful assistant..." />
    
    <label>User Prompt</label>
    <textarea bind:value={data.userPrompt} rows="5" placeholder="{{previous_node.output}}" />
    <span class="hint">Use {{nodeId.field}} to reference other nodes</span>
  </div>
  
  <div class="section">
    <h4>Options</h4>
    
    <label>Temperature: {data.temperature}</label>
    <input type="range" bind:value={data.temperature} min="0" max="2" step="0.1" />
    
    <label>Max Tokens</label>
    <input type="number" bind:value={data.maxTokens} min="1" max="128000" />
    
    <label class="checkbox">
      <input type="checkbox" bind:checked={data.stream} />
      Stream response (recommended)
    </label>
    
    <label class="checkbox">
      <input type="checkbox" bind:checked={data.jsonMode} />
      JSON mode (force valid JSON output)
    </label>
  </div>
</div>
```

### 4.8 Preset Configurations

Provide quick-start presets (all OpenAI-compatible):

```typescript
const LLM_PRESETS = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '{{$env.OPENAI_API_KEY}}',
    model: 'gpt-4o',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '{{$env.GROQ_API_KEY}}',
    model: 'llama-3.1-70b-versatile',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',  // Ollama doesn't need a real key
    model: 'llama3.2',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '{{$env.OPENROUTER_API_KEY}}',
    model: 'openai/gpt-4o',
  },
  // Claude via OpenRouter (Anthropic native API not supported)
  claude_openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '{{$env.OPENROUTER_API_KEY}}',
    model: 'anthropic/claude-3.5-sonnet',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '{{$env.TOGETHER_API_KEY}}',
    model: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
  },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKey: '{{$env.FIREWORKS_API_KEY}}',
    model: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  },
};
```

> **Note:** Anthropic's native API uses a different format. Use Claude via OpenRouter for OpenAI-compatible access.

### 4.9 Implementation Checklist

- [ ] Add `LLMChatNodeData` to shared types
- [ ] Add `LLMCHAT` to `NodeType` enum in Rust
- [ ] Implement `execute_llm_chat` with streaming support
- [ ] Add `token()` method to `StreamContext`
- [ ] Create `LLMChatNode.svelte` component
- [ ] Add LLM config section to `ConfigPanel.svelte`
- [ ] Update `ResultsPanel.svelte` for token display
- [ ] Add "+ LLM Chat" button to Navbar
- [ ] Add preset selector in config panel

---

## 5. Sub-Flows (Reusable Workflows)

### 5.1 Overview

**Goal**: Call one workflow from another, like calling a function.

**Model**: 
- Define inputs/outputs for workflows
- SubFlow node references another workflow by ID
- Parent waits for child to complete
- Child returns result to parent

### 5.2 Workflow Input/Output Schema

Add to workflows table:

```sql
ALTER TABLE workflows ADD COLUMN input_schema JSONB;
ALTER TABLE workflows ADD COLUMN output_schema JSONB;
```

```typescript
interface WorkflowSchema {
  // Input schema - what the workflow expects
  inputSchema?: {
    type: 'object';
    properties: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
      required?: boolean;
      default?: any;
    }>;
  };
  
  // Output schema - what the workflow returns
  outputSchema?: {
    type: 'object';
    properties: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
    }>;
  };
}
```

### 5.3 SubFlow Node Design

```
┌─────────────────────────────────────────┐
│ ○ Input                                 │
├─────────────────────────────────────────┤
│  📦  SUB-FLOW                           │
│                                         │
│  Workflow: "Error Handler"              │
│  Version: Latest                        │
├─────────────────────────────────────────┤
│  Inputs:                                │
│    error_message: {{prev.error}}        │
│    severity: "high"                     │
└─────────────────────────────────────────┘
     │
     ○ Output (child workflow result)
```

### 5.4 Node Data Structure

```typescript
interface SubFlowNodeData {
  type: 'sub-flow';
  label: string;
  
  // Which workflow to call
  workflowId: string;
  
  // Version control
  version: 'latest' | 'snapshot' | string;  // 'latest', 'snapshot', or specific version ID
  
  // Input mapping (parent context → child inputs)
  inputMapping: Record<string, string>;  // { "error_message": "{{prev.error}}" }
  
  // Timeout for child workflow
  timeoutMs: number;
  
  // Error handling
  onError: 'fail' | 'continue';  // Should parent fail if child fails?
}
```

### 5.5 Database Schema Additions

```sql
-- Track parent-child relationships
ALTER TABLE workflow_runs ADD COLUMN parent_run_id UUID REFERENCES workflow_runs(id);
ALTER TABLE workflow_runs ADD COLUMN depth INTEGER DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN calling_node_id TEXT;  -- Which node in parent triggered this

-- Index for finding child runs
CREATE INDEX idx_workflow_runs_parent ON workflow_runs(parent_run_id);
```

### 5.6 Rust Worker Implementation

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubFlowNodeData {
    pub workflow_id: String,
    pub version: String,
    pub input_mapping: HashMap<String, String>,
    pub timeout_ms: u64,
    pub on_error: String,
}

// In process_job:
NodeType::SubFlow(data) => {
    // 1. Resolve input mapping
    let mut child_inputs = HashMap::new();
    for (key, template) in &data.input_mapping {
        let value = resolve_variable(template, &job.context)?;
        child_inputs.insert(key.clone(), value);
    }
    
    // 2. Create child workflow run via API
    let response = client
        .post(&format!("{}/api/run", API_BASE_URL))
        .json(&json!({
            "workflowId": data.workflow_id,
            "inputData": child_inputs,
            "parentRunId": job.run_id,
            "callingNodeId": job.node_id,
            "depth": job.depth.unwrap_or(0) + 1,
        }))
        .send()
        .await?;
    
    let child_run: serde_json::Value = response.json().await?;
    let child_run_id = child_run["runId"].as_str().unwrap();
    
    // 3. Create suspension to wait for child completion
    // (Similar to WebhookWait, but triggered by child RUN_COMPLETED event)
    
    // Return 202 to indicate suspension
    ExecutionResult {
        status: 202,
        result: json!({
            "child_run_id": child_run_id,
            "status": "waiting_for_child",
        }),
        // ...
    }
}
```

### 5.7 Orchestrator Changes

When a child workflow completes, resume the parent:

```typescript
// In orchestrate/+server.ts

// After marking a run as completed:
if (run.parent_run_id) {
  // This was a child run - resume parent
  const parentRun = await db.query(
    'SELECT * FROM workflow_runs WHERE id = $1',
    [run.parent_run_id]
  );
  
  const callingNodeId = run.calling_node_id;
  
  // Log NODE_RESUMED event for the SubFlow node in parent
  await db.query(
    `INSERT INTO run_events (run_id, node_id, event_type, payload)
     VALUES ($1, $2, 'NODE_RESUMED', $3)`,
    [
      run.parent_run_id,
      callingNodeId,
      JSON.stringify({
        child_run_id: run.id,
        child_status: run.status,
        child_output: run.output_data,
      })
    ]
  );
  
  // Schedule SubFlow node continuation
  await scheduleNodeContinuation(parentRun, callingNodeId);
}
```

### 5.8 Recursion Protection

```typescript
// In /api/run when creating a child run:
const MAX_DEPTH = 10;

if (depth >= MAX_DEPTH) {
  return json({
    error: `Maximum sub-flow depth (${MAX_DEPTH}) exceeded. Possible infinite recursion.`
  }, { status: 400 });
}
```

### 5.9 Implementation Checklist

- [ ] Add `input_schema` and `output_schema` to workflows table
- [ ] Add `parent_run_id`, `depth`, `calling_node_id` to workflow_runs table
- [ ] Add `SubFlowNodeData` to shared types
- [ ] Add `SUBFLOW` to `NodeType` enum in Rust
- [ ] Implement sub-flow execution in worker
- [ ] Update orchestrator to handle child completion → parent resume
- [ ] Add recursion depth check
- [ ] Create `SubFlowNode.svelte` component
- [ ] Add workflow picker in config panel
- [ ] Add input mapping UI
- [ ] Add "+ Sub-Flow" button to Navbar

---

## 6. Cron Scheduling

### 6.1 Overview

**Goal**: Run workflows on a schedule (hourly, daily, weekly, etc.)

**Model**: Workflow-level setting (not a node type).

### 6.2 Database Schema

```sql
-- Add schedule columns to workflows
ALTER TABLE workflows ADD COLUMN schedule_enabled BOOLEAN DEFAULT false;
ALTER TABLE workflows ADD COLUMN schedule_cron TEXT;  -- "0 9 * * 1-5"
ALTER TABLE workflows ADD COLUMN schedule_timezone TEXT DEFAULT 'UTC';
ALTER TABLE workflows ADD COLUMN schedule_input_data JSONB;  -- Static input for scheduled runs
ALTER TABLE workflows ADD COLUMN schedule_next_run TIMESTAMPTZ;  -- Pre-computed next run time

-- Index for scheduler queries
CREATE INDEX idx_workflows_schedule ON workflows(schedule_next_run) 
  WHERE schedule_enabled = true;
```

### 6.3 Cron Expression Examples

| Expression | Description |
|------------|-------------|
| `0 * * * *` | Every hour |
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 0 1 * *` | First day of each month |
| `*/15 * * * *` | Every 15 minutes |

### 6.4 Scheduler Service

Add to existing scheduler loop in Rust worker:

```rust
async fn check_scheduled_workflows(pool: &PgPool, redis_con: &mut Connection) {
    // Find workflows due to run
    let due_workflows = sqlx::query!(
        r#"
        SELECT id, graph, schedule_cron, schedule_timezone, schedule_input_data
        FROM workflows
        WHERE schedule_enabled = true
          AND schedule_next_run <= NOW()
        FOR UPDATE SKIP LOCKED
        LIMIT 10
        "#
    ).fetch_all(pool).await.unwrap();
    
    for workflow in due_workflows {
        // 1. Create a new run
        let run_id = Uuid::new_v4();
        
        sqlx::query!(
            r#"
            INSERT INTO workflow_runs (id, workflow_id, snapshot_graph, status, trigger, input_data)
            VALUES ($1, $2, $3, 'pending', 'cron', $4)
            "#,
            run_id,
            workflow.id,
            workflow.graph,
            workflow.schedule_input_data,
        ).execute(pool).await.unwrap();
        
        // 2. Log RUN_CREATED event
        sqlx::query!(
            r#"
            INSERT INTO run_events (run_id, event_type, payload)
            VALUES ($1, 'RUN_CREATED', $2)
            "#,
            run_id,
            json!({ "trigger": "cron", "schedule": workflow.schedule_cron }),
        ).execute(pool).await.unwrap();
        
        // 3. Schedule initial nodes to Redis
        // ... (same as manual run)
        
        // 4. Calculate and update next run time
        let next_run = calculate_next_cron_run(
            &workflow.schedule_cron,
            &workflow.schedule_timezone,
        );
        
        sqlx::query!(
            "UPDATE workflows SET schedule_next_run = $1 WHERE id = $2",
            next_run,
            workflow.id,
        ).execute(pool).await.unwrap();
    }
}

fn calculate_next_cron_run(cron_expr: &str, timezone: &str) -> DateTime<Utc> {
    // Use cron crate to parse and calculate next occurrence
    use cron::Schedule;
    use chrono_tz::Tz;
    
    let schedule = Schedule::from_str(cron_expr).unwrap();
    let tz: Tz = timezone.parse().unwrap_or(chrono_tz::UTC);
    
    let now = Utc::now().with_timezone(&tz);
    schedule.upcoming(tz).next().unwrap().with_timezone(&Utc)
}
```

### 6.5 Cargo.toml Addition

```toml
[dependencies]
cron = "0.12"
chrono-tz = "0.8"
```

### 6.6 UI: Schedule Configuration

Add to workflow settings (not node config):

```svelte
<!-- WorkflowSettings.svelte or similar -->
<div class="schedule-config">
  <h3>Schedule</h3>
  
  <label class="checkbox">
    <input type="checkbox" bind:checked={workflow.scheduleEnabled} />
    Enable scheduled runs
  </label>
  
  {#if workflow.scheduleEnabled}
    <label>Cron Expression</label>
    <input bind:value={workflow.scheduleCron} placeholder="0 9 * * 1-5" />
    <span class="hint">Next run: {nextRunPreview}</span>
    
    <label>Timezone</label>
    <select bind:value={workflow.scheduleTimezone}>
      <option value="UTC">UTC</option>
      <option value="America/New_York">Eastern Time</option>
      <option value="America/Los_Angeles">Pacific Time</option>
      <option value="Europe/London">London</option>
      <option value="Europe/Amsterdam">Amsterdam</option>
      <!-- ... more timezones -->
    </select>
    
    <label>Input Data (JSON)</label>
    <textarea bind:value={workflow.scheduleInputData} placeholder='{"source": "cron"}' />
  {/if}
</div>
```

### 6.7 Implementation Checklist

- [ ] Add schedule columns to workflows table
- [ ] Add `cron` and `chrono-tz` to Cargo.toml
- [ ] Add `check_scheduled_workflows` to scheduler loop
- [ ] Implement `calculate_next_cron_run`
- [ ] Create schedule configuration UI
- [ ] Add cron expression validator
- [ ] Show "Next run" preview in UI
- [ ] Add schedule info to Run History (trigger: "cron")

---

## 7. Map/Iterator Node

### 7.1 Overview

**Goal**: Run a sub-flow or node sequence for each item in an array.

**Model**: Fan-out to N parallel executions, fan-in to collect results.

### 7.2 Node Design

```
┌─────────────────────────────────────────┐
│ ○ Input (array)                         │
├─────────────────────────────────────────┤
│  🔄  MAP / ITERATOR                     │
│                                         │
│  Input Array: {{prev.users}}            │
│  Concurrency: 5                         │
│  On Error: Continue                     │
├─────────────────────────────────────────┤
│  Progress: 45/100 (3 failed)            │
└─────────────────────────────────────────┘
     │
     ○ Output (array of results)
```

### 7.3 Node Data Structure

```typescript
interface MapNodeData {
  type: 'map';
  label: string;
  
  // What to iterate over
  inputArray: string;  // "{{prev.users}}" - must resolve to array
  
  // What to run for each item
  iteratorType: 'inline' | 'subflow';
  
  // If inline: which nodes to run (contained within this node as a sub-graph)
  inlineNodes?: Node[];
  inlineEdges?: Edge[];
  
  // If subflow: which workflow to call
  subflowId?: string;
  
  // How the current item is exposed to the iterator
  itemVariable: string;  // default: "item" → accessible as {{map.item}}
  indexVariable: string; // default: "index" → accessible as {{map.index}}
  
  // Concurrency control
  maxConcurrent: number;  // default: 10
  
  // Error handling
  onItemError: 'fail_all' | 'continue' | 'retry';
  maxRetries: number;
  
  // Result aggregation
  collectResults: boolean;  // default: true
}
```

### 7.4 Execution Model

```
Input: [user1, user2, user3, user4, user5]
Max Concurrent: 2

Time 0:  [user1 🔵] [user2 🔵] [user3 ⏳] [user4 ⏳] [user5 ⏳]
Time 1:  [user1 ✓ ] [user2 🔵] [user3 🔵] [user4 ⏳] [user5 ⏳]
Time 2:  [user1 ✓ ] [user2 ✓ ] [user3 🔵] [user4 🔵] [user5 ⏳]
Time 3:  [user1 ✓ ] [user2 ✓ ] [user3 ✓ ] [user4 🔵] [user5 🔵]
Time 4:  [user1 ✓ ] [user2 ✓ ] [user3 ✓ ] [user4 ✓ ] [user5 ✓ ]

Output: [result1, result2, result3, result4, result5]
```

### 7.5 Database Schema

```sql
-- Track map iteration state
CREATE TABLE map_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES workflow_runs(id),
  node_id TEXT NOT NULL,
  
  -- Iteration tracking
  total_items INTEGER NOT NULL,
  completed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  
  -- Item-level tracking
  items JSONB NOT NULL,  -- Array of { index, status, result, error }
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  UNIQUE(run_id, node_id)
);
```

### 7.6 Rust Worker Implementation (Simplified)

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MapNodeData {
    pub input_array: String,
    pub iterator_type: String,  // "inline" or "subflow"
    pub subflow_id: Option<String>,
    pub item_variable: String,
    pub index_variable: String,
    pub max_concurrent: u32,
    pub on_item_error: String,
    pub collect_results: bool,
}

// In process_job:
NodeType::Map(data) => {
    // 1. Resolve input array
    let items: Vec<serde_json::Value> = resolve_variable(&data.input_array, &job.context)?
        .as_array()
        .ok_or("Input must be an array")?
        .clone();
    
    let total = items.len();
    
    // 2. Create map_iterations record
    sqlx::query!(
        r#"
        INSERT INTO map_iterations (run_id, node_id, total_items, items)
        VALUES ($1, $2, $3, $4)
        "#,
        job.run_id,
        job.node_id,
        total as i32,
        json!(items.iter().enumerate().map(|(i, _)| {
            json!({ "index": i, "status": "pending" })
        }).collect::<Vec<_>>()),
    ).execute(&pool).await?;
    
    // 3. Schedule first batch of items
    let batch_size = std::cmp::min(data.max_concurrent as usize, total);
    
    for i in 0..batch_size {
        let item_job = WorkerJob {
            node_id: format!("{}:item:{}", job.node_id, i),
            node: if data.iterator_type == "subflow" {
                NodeType::SubFlow(SubFlowNodeData {
                    workflow_id: data.subflow_id.clone().unwrap(),
                    input_mapping: hashmap! {
                        data.item_variable.clone() => items[i].clone(),
                        data.index_variable.clone() => json!(i),
                    },
                    // ...
                })
            } else {
                // Inline execution - more complex, involves sub-graph
                todo!()
            },
            context: job.context.clone(),
            run_id: job.run_id.clone(),
            // ...
        };
        
        schedule_job(&item_job, redis_con).await?;
    }
    
    // 4. Return 202 - map is now waiting for all items
    ExecutionResult {
        status: 202,
        result: json!({
            "status": "iterating",
            "total": total,
            "in_progress": batch_size,
        }),
    }
}
```

### 7.7 Orchestrator: Handling Item Completion

```typescript
// When a map item completes:
if (nodeId.includes(':item:')) {
  const [mapNodeId, , indexStr] = nodeId.split(':');
  const index = parseInt(indexStr);
  
  // Update map_iterations
  await db.query(
    `UPDATE map_iterations 
     SET items = jsonb_set(items, $1, $2),
         completed_items = completed_items + 1
     WHERE run_id = $3 AND node_id = $4`,
    [
      `{${index}}`,
      JSON.stringify({ index, status: 'completed', result }),
      runId,
      mapNodeId,
    ]
  );
  
  // Check if we should schedule more items
  const mapState = await db.query(
    'SELECT * FROM map_iterations WHERE run_id = $1 AND node_id = $2',
    [runId, mapNodeId]
  );
  
  const completed = mapState.rows[0].completed_items + mapState.rows[0].failed_items;
  const total = mapState.rows[0].total_items;
  const inProgress = mapState.rows[0].items.filter(i => i.status === 'running').length;
  
  // Schedule next item if there are pending items and we have capacity
  const nextIndex = mapState.rows[0].items.findIndex(i => i.status === 'pending');
  if (nextIndex !== -1 && inProgress < maxConcurrent) {
    // Schedule next item...
  }
  
  // Check if all items are done
  if (completed === total) {
    // Aggregate results and complete the map node
    const results = mapState.rows[0].items
      .sort((a, b) => a.index - b.index)
      .map(i => i.result);
    
    // Log NODE_COMPLETED for the map node
    await logEvent(runId, mapNodeId, 'NODE_COMPLETED', { results });
  }
}
```

### 7.8 Implementation Checklist

- [ ] Create `map_iterations` table
- [ ] Add `MapNodeData` to shared types
- [ ] Add `MAP` to `NodeType` enum in Rust
- [ ] Implement map initialization in worker
- [ ] Implement item scheduling with concurrency control
- [ ] Update orchestrator to handle item completions
- [ ] Implement result aggregation
- [ ] Create `MapNode.svelte` component with progress display
- [ ] Add map config section to `ConfigPanel.svelte`
- [ ] Add "+ Map" button to Navbar

---

## 8. Database Schema Additions

### Complete Migration

```sql
-- Run History improvements
ALTER TABLE workflow_runs ADD COLUMN trigger TEXT DEFAULT 'manual';  -- 'manual', 'webhook', 'cron', 'subflow'
ALTER TABLE workflow_runs ADD COLUMN parent_run_id UUID REFERENCES workflow_runs(id);
ALTER TABLE workflow_runs ADD COLUMN depth INTEGER DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN calling_node_id TEXT;
CREATE INDEX idx_workflow_runs_parent ON workflow_runs(parent_run_id);
CREATE INDEX idx_workflow_runs_workflow_status ON workflow_runs(workflow_id, status);

-- Workflow input/output schemas
ALTER TABLE workflows ADD COLUMN input_schema JSONB;
ALTER TABLE workflows ADD COLUMN output_schema JSONB;

-- Cron scheduling
ALTER TABLE workflows ADD COLUMN schedule_enabled BOOLEAN DEFAULT false;
ALTER TABLE workflows ADD COLUMN schedule_cron TEXT;
ALTER TABLE workflows ADD COLUMN schedule_timezone TEXT DEFAULT 'UTC';
ALTER TABLE workflows ADD COLUMN schedule_input_data JSONB;
ALTER TABLE workflows ADD COLUMN schedule_next_run TIMESTAMPTZ;
CREATE INDEX idx_workflows_schedule ON workflows(schedule_next_run) WHERE schedule_enabled = true;

-- Map iterations
CREATE TABLE map_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES workflow_runs(id),
  node_id TEXT NOT NULL,
  total_items INTEGER NOT NULL,
  completed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(run_id, node_id)
);
CREATE INDEX idx_map_iterations_run ON map_iterations(run_id);
```

---

## 9. Finalized Decisions

All critical questions have been answered. These decisions are **final** for MVP implementation.

---

### 9.1 Run History

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Retention** | Configurable per workspace: 30 / 90 / 180 / 365 days | Balance storage costs with user needs |
| **Deletion** | Hard delete + audit log (not soft-delete) | Simpler queries, audit trail preserved |
| **Pin Runs** | Yes, pinned runs override TTL | Important runs shouldn't auto-expire |
| **Bulk Delete** | Yes, by filter or date range | Expected UX for cleanup |

**Implementation:**
```sql
-- Hard delete the run
DELETE FROM workflow_runs WHERE id = $1;

-- But log it for audit
INSERT INTO run_audit_log (run_id, workflow_id, action, actor, metadata, created_at)
VALUES ($1, $2, 'DELETED', $3, '{"reason": "user_request"}', NOW());
```

**Audit Log Table:**
```sql
CREATE TABLE run_audit_log (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL,  -- No FK, run may be deleted
  workflow_id UUID NOT NULL,
  action TEXT NOT NULL,  -- 'DELETED', 'CANCELLED', etc.
  actor TEXT,  -- user ID or 'system'
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_log_run ON run_audit_log(run_id);
CREATE INDEX idx_audit_log_workflow ON run_audit_log(workflow_id);
```

---

### 9.2 Router Node

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Expression Language** | JavaScript only for MVP | Target audience is technical; visual builder is scope creep |
| **Matching Mode** | Default: `first_match`, Advanced: `broadcast` | Deterministic by default, power when needed |

**MVP Enhancements (instead of visual builder):**
- Syntax highlighting in expression input
- `{{` autocomplete showing available node outputs
- 3-4 example expressions in config panel ("Common patterns")
- Small DSL helpers: `between()`, `contains()`, `matches()`

**Example Patterns to Show:**
```javascript
// Status code ranges
value >= 200 && value < 300

// String matching
value === 'user.created'

// Contains check
value.includes('error')

// Regex matching
/^success_/.test(value)

// Null check
value != null && value !== ''
```

**Visual builder:** Deferred to post-MVP based on user feedback.

---

### 9.3 LLM Node

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Provider Support** | OpenAI-compatible only | Two code paths = double maintenance |
| **Anthropic** | Via proxy (OpenRouter, LiteLLM) | Document workaround, not native support |
| **Cost Tracking** | Yes, mandatory | Store prompt/completion tokens in run_events |

**Provider Presets (dropdown):**
| Provider | Base URL |
|----------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (local) | `http://localhost:11434/v1` |
| Together AI | `https://api.together.xyz/v1` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |
| Custom | (user enters URL) |

**Token Tracking Event:**
```json
{
  "event_type": "NODE_COMPLETED",
  "payload": {
    "result": { "content": "..." },
    "usage": {
      "prompt_tokens": 150,
      "completion_tokens": 89,
      "total_tokens": 239
    },
    "model": "gpt-4o",
    "provider": "openai"
  }
}
```

**Documentation:** "Using Anthropic with SwiftGrid" → points to OpenRouter.

---

### 9.4 Sub-Flows

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Secrets Inheritance** | Explicit mapping only (no inheritance) | Security > Convenience |
| **Timeout Inheritance** | `min(child_config, parent_remaining)` | Prevents child from exceeding parent's budget |

**UX Enhancements:**
- Dropdown showing available parent secrets
- "Map same name" one-click button for common case
- Clear UI: "This sub-flow will receive: [list]"
- Indicator: "Parent deadline in 12.3s → max child time: 12.3s"

**Why explicit secrets:**
- Prevents accidental exposure (contractor sub-flow accessing AWS_ROOT_KEY)
- Creates audit trail: "Who passed what secret to what flow"
- 80% security concern, 20% auditability

**Timeout Calculation:**
```typescript
const effectiveTimeout = Math.min(
  childWorkflow.configuredTimeout,
  parentRun.startedAt + parentRun.timeout - Date.now()
);
```

---

### 9.5 Cron Scheduling

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Overlap Handling** | Default: Skip. Options: Skip / Queue One / Parallel | Prevents death spirals |
| **Notifications** | Webhook + Slack + Discord | Cheap wins, expected by SRE audience |

**Overlap Modes:**
| Mode | Behavior |
|------|----------|
| `skip` (default) | If previous run still active, skip this scheduled run |
| `queue_one` | Queue at most one pending run |
| `parallel` | Run in parallel (use with caution) |

**Notification Implementation:**
```typescript
// Slack (incoming webhook)
POST webhook_url
{
  "text": "⚠️ Workflow 'Daily Report' failed",
  "attachments": [{
    "color": "danger",
    "fields": [
      { "title": "Run ID", "value": "abc123", "short": true },
      { "title": "Error", "value": "Connection timeout", "short": false }
    ]
  }]
}

// Discord (webhook)
POST webhook_url
{
  "content": "⚠️ Workflow 'Daily Report' failed",
  "embeds": [{
    "color": 15158332,
    "fields": [
      { "name": "Run ID", "value": "abc123", "inline": true },
      { "name": "Error", "value": "Connection timeout" }
    ]
  }]
}

// Generic Webhook
POST webhook_url
{
  "event": "run_failed",
  "workflow_id": "...",
  "workflow_name": "Daily Report",
  "run_id": "abc123",
  "error": "Connection timeout",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Email:** Deferred (requires SMTP integration or third-party service).

---

### 9.6 Map/Iterator

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Iterator Body** | Sub-flow only (no inline graphs) | Cleaner UX, reusable logic, simpler editor |
| **Partial Results** | Return settled array (like Promise.allSettled) | Allows downstream filtering and error inspection |

**Result Format:**
```json
{
  "results": [
    { "status": "fulfilled", "value": { "user_id": 1, "sent": true }, "index": 0 },
    { "status": "fulfilled", "value": { "user_id": 2, "sent": true }, "index": 1 },
    { "status": "rejected", "reason": "Email bounced", "index": 2 }
  ],
  "summary": {
    "total": 100,
    "succeeded": 95,
    "failed": 5,
    "duration_ms": 12340
  }
}
```

**Error Handling Options:**
| Option | Behavior |
|--------|----------|
| `continue_on_error: true` (default) | Process all items, collect errors |
| `continue_on_error: false` | Stop on first error, return partial results |

**UX Enhancement: "Create Iterator Sub-flow" Button**
1. Creates new workflow with `item` and `index` as predefined inputs
2. Opens in new tab
3. Auto-links to Map node
4. Pre-populates output schema based on expected return type

---

## 10. Implementation Order

Based on effort vs. value analysis:

| Order | Feature | Effort | Value | Est. Time |
|-------|---------|--------|-------|-----------|
| 1 | **Run History UI** | Low | High | 1-2 days |
| 2 | **Router Node** | Medium | High | 2-3 days |
| 3 | **LLM Chat Node** | Medium | Very High | 2-3 days |
| 4 | **Sub-Flows** | Medium-High | High | 3-4 days |
| 5 | **Cron Scheduling** | Low | Medium | 1-2 days |
| 6 | **Map/Iterator** | High | High | 4-5 days |

**Total estimated time:** 13-19 days

Each feature will get a commit after implementation and testing.

---

## 11. Next Steps

1. ✅ Architecture decisions finalized
2. → Start with **Run History UI** implementation
3. → Commit after each feature
4. → Test thoroughly before moving to next feature

---

## 12. Summary of Key Decisions

| Area | Decision |
|------|----------|
| **Run deletion** | Hard delete + audit log |
| **Router conditions** | JS expressions only (no visual builder for MVP) |
| **LLM providers** | OpenAI-compatible only, presets for common providers |
| **Anthropic** | Via OpenRouter/proxy, not native |
| **Sub-flow secrets** | Explicit mapping only, no inheritance |
| **Sub-flow timeout** | `min(child_config, parent_remaining)` |
| **Cron overlap** | Default skip, configurable |
| **Notifications** | Webhook + Slack + Discord |
| **Map iterator** | Sub-flow only, no inline graphs |
| **Map results** | Promise.allSettled style (partial results with errors) |

