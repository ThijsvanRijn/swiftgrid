import type { Node } from '@xyflow/svelte';
import type { HttpMethod } from './worker'; // Import from your typeshare file

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

    // UI State fields (Shared)
    status?: 'idle' | 'running' | 'success' | 'error';
    result?: any;
    [key: string]: unknown; // Required by Svelte Flow
};

// 2. Define the Node Type
export type AppNode = Node<AppNodeData>;