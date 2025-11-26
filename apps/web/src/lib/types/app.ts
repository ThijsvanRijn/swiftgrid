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

    // UI State fields (Shared)
    status?: 'idle' | 'running' | 'success' | 'error';
    result?: any;
    [key: string]: unknown; // Required by Svelte Flow
};

// 2. Define the Node Type
export type AppNode = Node<AppNodeData>;