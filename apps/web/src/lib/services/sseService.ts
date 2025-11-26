import { handleExecutionResult } from './executionService';

// Enhanced result type (matches updated worker output)
interface ExecutionResult {
    node_id: string;
    run_id?: string;
    status_code: number;
    body: any;
    timestamp: number;
    duration_ms?: number;
}

// Streaming chunk type
interface StreamChunk {
    run_id: string;
    node_id: string;
    chunk_index: number;
    chunk_type: 'progress' | 'data' | 'token' | 'error' | 'complete';
    content: string;
    timestamp: number;
}

// SSE connection state
let eventSource: EventSource | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// Callbacks
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type StatusCallback = (status: ConnectionStatus) => void;
type ChunkCallback = (chunk: StreamChunk) => void;

let onStatusChange: StatusCallback | null = null;
let onChunk: ChunkCallback | null = null;

// Connects to the SSE stream with auto-reconnect
function connect() {
    if (eventSource) {
        eventSource.close();
    }

    console.log('SSE: Connecting...');
    onStatusChange?.('connecting');
    eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
        console.log('SSE: Connected');
        reconnectAttempts = 0;
        onStatusChange?.('connected');
    };

    // Handle 'result' events (node completions)
    eventSource.addEventListener('result', (event) => {
        const result: ExecutionResult = JSON.parse(event.data);
        const isSuccess = result.status_code >= 200 && result.status_code < 300;
        
        const durationInfo = result.duration_ms ? ` (${result.duration_ms}ms)` : '';
        console.log(`SSE: Node ${result.node_id} ${isSuccess ? '✓' : '✗'}${durationInfo}`);
        
        handleExecutionResult(result.node_id, isSuccess, result.body, result.run_id);
    });

    // Handle 'chunk' events (streaming output)
    eventSource.addEventListener('chunk', (event) => {
        const chunk: StreamChunk = JSON.parse(event.data);
        
        // Always log chunks for debugging
        console.log(`SSE CHUNK: [${chunk.node_id}] ${chunk.chunk_type}: ${chunk.content}`);
        
        // Notify listeners
        onChunk?.(chunk);
    });

    // Fallback for unnamed events (backwards compatibility)
    eventSource.onmessage = (event) => {
        const result: ExecutionResult = JSON.parse(event.data);
        const isSuccess = result.status_code >= 200 && result.status_code < 300;
        
        const durationInfo = result.duration_ms ? ` (${result.duration_ms}ms)` : '';
        console.log(`SSE: Node ${result.node_id} ${isSuccess ? '✓' : '✗'}${durationInfo}`);
        
        handleExecutionResult(result.node_id, isSuccess, result.body, result.run_id);
    };

    eventSource.onerror = () => {
        console.warn('SSE: Connection error');
        onStatusChange?.('disconnected');
        eventSource?.close();
        eventSource = null;

        // Attempt reconnect with backoff
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = RECONNECT_DELAY_MS * reconnectAttempts;
            console.log(`SSE: Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(connect, delay);
        } else {
            console.error('SSE: Max reconnect attempts reached');
        }
    };
}

// Disconnects from the SSE stream
function disconnect() {
    if (eventSource) {
        console.log('SSE: Disconnecting');
        eventSource.close();
        eventSource = null;
        onStatusChange?.('disconnected');
    }
}

// Sets a callback for status changes
function setStatusCallback(callback: StatusCallback | null) {
    onStatusChange = callback;
}

// Sets a callback for streaming chunks
function setChunkCallback(callback: ChunkCallback | null) {
    onChunk = callback;
}

// Checks if currently connected
function isConnected() {
    return eventSource?.readyState === EventSource.OPEN;
}

export const sseService = {
    connect,
    disconnect,
    setStatusCallback,
    setChunkCallback,
    isConnected
};

// Export types for consumers
export type { StreamChunk };

