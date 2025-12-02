import type { Node } from '@xyflow/svelte';
import type { HttpMethod, RouterCondition, LlmMessage } from '@swiftgrid/shared';

// 1. Define the Data Shape
export type AppNodeData = {
    label?: string;

    // HTTP Request Fields
    url?: string;
    method?: HttpMethod | 'GET'; // Fallback string for initial state
    headers?: Record<string, string>; // Headers for the request

    // Code Node Fields
    code?: string; // JS
    inputs?: any; // JSON Object mapping

    // Delay Node Fields
    delayMs?: number;      // Delay in milliseconds
    delayStr?: string;     // Human-readable: "5s", "2m", "1h"

    // Webhook Wait Node Fields
    description?: string;   // "Wait for payment confirmation"
    timeoutMs?: number;     // Timeout in milliseconds (default 7 days)
    timeoutStr?: string;    // Human-readable: "5m", "1h", "7d"

    // Router Node Fields
    routeBy?: string;                   // Variable to evaluate: "{{node.status}}"
    conditions?: RouterCondition[];     // Conditions to check in order
    defaultOutput?: string;             // Output handle if no conditions match
    routerMode?: 'first_match' | 'broadcast';  // Evaluation mode

    // LLM Node Fields
    baseUrl?: string;           // API endpoint: "https://api.openai.com/v1"
    apiKey?: string;            // API key or {{$env.OPENAI_KEY}}
    model?: string;             // "gpt-4o", "gpt-3.5-turbo", etc.
    messages?: LlmMessage[];    // Conversation messages
    systemPrompt?: string;      // System prompt (convenience field)
    userPrompt?: string;        // User prompt (convenience field, can use {{node.field}})
    temperature?: number;       // 0.0 - 2.0
    maxTokens?: number;         // Max response tokens
    stream?: boolean;           // Enable streaming

    // Sub-Flow Node Fields
    subflowWorkflowId?: number;      // ID of the workflow to execute
    subflowVersionId?: string;       // UUID of the pinned version (null = use active)
    subflowVersionNumber?: number;   // Display: "v2"
    subflowName?: string;            // Display: workflow name
    subflowInput?: any;              // JSON input to pass: {{previous.data}} or literal
    subflowFailOnError?: boolean;    // If true, parent fails when sub-flow fails

    // Map/Iterator Node Fields
    mapWorkflowId?: number;          // ID of the workflow to execute for each item
    mapVersionId?: string;           // UUID of the pinned version (null = use active)
    mapVersionNumber?: number;       // Display: "v2"
    mapWorkflowName?: string;        // Display: workflow name
    mapInputArray?: string;          // Expression: "{{prev.items}}" or literal JSON array
    mapConcurrency?: number;         // Max parallel executions (1-50, default 5)
    mapFailFast?: boolean;           // If true, stops on first failure
    
    // Map Node Progress (updated via SSE)
    mapProgress?: number;            // 0-1 progress
    mapCompletedCount?: number;      // Completed iterations
    mapTotalCount?: number;          // Total iterations

    // UI State fields (Shared)
    status?: 'idle' | 'running' | 'success' | 'error' | 'cancelled' | 'suspended';
    result?: any;
    [key: string]: unknown; // Required by Svelte Flow
};

// 2. Define the Node Type
export type AppNode = Node<AppNodeData>;