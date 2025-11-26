import type { Node } from '@xyflow/svelte';
import type { HttpMethod } from '@swiftgrid/shared';

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
    webhookDescription?: string;  // "Wait for payment confirmation"
    webhookTimeoutMs?: number;    // Default 7 days

    // UI State fields (Shared)
    status?: 'idle' | 'running' | 'success' | 'error';
    result?: any;
    [key: string]: unknown; // Required by Svelte Flow
};

// 2. Define the Node Type
export type AppNode = Node<AppNodeData>;