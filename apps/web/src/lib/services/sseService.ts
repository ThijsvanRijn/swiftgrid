import { handleExecutionResult } from './executionService';

// Enhanced result type (matches updated worker output)
interface ExecutionResult {
    node_id: string;
    run_id?: string;
    status_code: number;
    body: any;
    timestamp: number;
    duration_ms?: number;
    isolated?: boolean;
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
        // Check for SubFlow suspension (has 'suspended' field)
        const isSubFlowSuspended = result.status_code === 202 && result.body?.suspended;
        // Check for Map node suspension (has 'batch_id' field - initial spawn)
        // Check for Map progress updates FIRST (has 'batch_id' and 'progress' fields)
        const isMapProgress = result.status_code === 202 && result.body?.batch_id && result.body?.progress !== undefined;
        // Map initial suspension (running status but NO progress yet)
        const isMapSuspended = result.status_code === 202 && result.body?.batch_id && result.body?.status === 'running' && !isMapProgress;
        // Check for any map-related lifecycle event (has batch_id) - these are internal state updates
        const isMapLifecycleEvent = result.status_code === 202 && result.body?.batch_id;
        // Map batch completion (status 200 with results array)
        const isMapComplete = result.status_code === 200 && result.body?.results && result.body?.stats;
        // Combined suspension check
        const isSuspended = isSubFlowSuspended || isMapSuspended;
        const isSuccess = result.status_code >= 200 && result.status_code < 300 && !isSuspended && !isMapProgress && !isMapLifecycleEvent;
        const isCancelled = result.status_code === 499;
        
        const durationInfo = result.duration_ms ? ` (${result.duration_ms}ms)` : '';
        const isolatedInfo = result.isolated ? ' (isolated)' : '';
        const statusIcon = isCancelled ? '-' : isSuspended || isMapProgress || isMapLifecycleEvent ? '⏸' : (isSuccess ? '✓' : '✗');
        console.log(`SSE: Node ${result.node_id} ${statusIcon}${durationInfo}${isolatedInfo}`);
        
        // Handle map progress updates FIRST (with progress field)
        if (isMapProgress) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                flowStore.updateNodeStatus(result.node_id, 'suspended', {
                    ...result.body,
                    mapProgress: result.body.progress,
                    mapCompletedCount: result.body.completed,
                    mapTotalCount: result.body.total
                });
            });
            return;
        }
        
        // Handle suspended nodes (sub-flow or map initial waiting for children)
        if (isSuspended) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                // For map initial suspension, extract the total count
                const isMapInitial = result.body?.batch_id && result.body?.total;
                flowStore.updateNodeStatus(result.node_id, 'suspended', {
                    ...result.body,
                    ...(isMapInitial && {
                        mapCompletedCount: 0,
                        mapTotalCount: result.body.total,
                        mapProgress: 0
                    })
                });
            });
            return;
        }
        
        // Handle other map lifecycle events (spawned, no_slots, skipped, etc.)
        // These are internal state updates - don't change the node status, just ignore
        if (isMapLifecycleEvent && !isMapComplete) {
            // Silently ignore intermediate lifecycle events to prevent flickering
            return;
        }
        
        // Handle map batch completion
        if (isMapComplete) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                flowStore.updateNodeStatus(result.node_id, 'success', result.body);
            });
            return;
        }
        
        // Update node status in the UI
        // Note: For tracked runs (with run_id), the worker already calls the orchestrator
        // so we only need to update the UI here, not trigger downstream scheduling
        import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
            const status = isCancelled ? 'cancelled' : (isSuccess ? 'success' : 'error');
            flowStore.updateNodeStatus(result.node_id, status as any, result.body);
            
            // For isolated runs without run_id (test/preview mode), we still need to orchestrate from frontend
            if (!result.isolated && !isCancelled && !result.run_id) {
                handleExecutionResult(result.node_id, isSuccess, result.body, result.run_id);
            }
        });
    });

    // Handle 'chunk' events (streaming output)
    eventSource.addEventListener('chunk', (event) => {
        const chunk: StreamChunk = JSON.parse(event.data);
        
        // Developer-friendly logging based on chunk type (no emojis for CI/log parsers)
        if (chunk.chunk_type === 'token') {
            console.log(`%c[${chunk.node_id}] token: ${chunk.content}`, 'color: #10b981; font-weight: 500;');
        } else if (chunk.chunk_type === 'progress') {
            console.log(`%c[${chunk.node_id}] progress: ${chunk.content}`, 'color: #3b82f6;');
        } else if (chunk.chunk_type === 'error') {
            console.error(`[${chunk.node_id}] error: ${chunk.content}`);
        } else if (chunk.chunk_type === 'complete') {
            console.log(`%c[${chunk.node_id}] complete`, 'color: #10b981; font-weight: bold;');
        } else {
            console.log(`SSE CHUNK: [${chunk.node_id}] ${chunk.chunk_type}: ${chunk.content}`);
        }
        
        // Notify listeners
        onChunk?.(chunk);
    });

    // Fallback for unnamed events (backwards compatibility)
    eventSource.onmessage = (event) => {
        const result: ExecutionResult = JSON.parse(event.data);
        // Check for Map progress updates FIRST (has 'batch_id' and 'progress' fields)
        const isMapProgress = result.status_code === 202 && result.body?.batch_id && result.body?.progress !== undefined;
        const isSuspended = result.status_code === 202 && result.body?.suspended;
        const isMapLifecycleEvent = result.status_code === 202 && result.body?.batch_id && !isMapProgress;
        const isMapComplete = result.status_code === 200 && result.body?.results && result.body?.stats;
        const isSuccess = result.status_code >= 200 && result.status_code < 300 && !isSuspended && !isMapProgress && !isMapLifecycleEvent;
        const isCancelled = result.status_code === 499;
        
        const durationInfo = result.duration_ms ? ` (${result.duration_ms}ms)` : '';
        const isolatedInfo = result.isolated ? ' (isolated)' : '';
        const statusIcon = isCancelled ? '-' : isSuspended || isMapProgress || isMapLifecycleEvent ? '⏸' : (isSuccess ? '✓' : '✗');
        console.log(`SSE: Node ${result.node_id} ${statusIcon}${durationInfo}${isolatedInfo}`);
        
        // Handle map progress updates FIRST
        if (isMapProgress) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                flowStore.updateNodeStatus(result.node_id, 'suspended', {
                    ...result.body,
                    mapProgress: result.body.progress,
                    mapCompletedCount: result.body.completed,
                    mapTotalCount: result.body.total
                });
            });
            return;
        }
        
        // Handle suspended nodes (sub-flow waiting for child)
        if (isSuspended) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                // For map initial suspension, extract the total count
                const isMapInitial = result.body?.batch_id && result.body?.total;
                flowStore.updateNodeStatus(result.node_id, 'suspended', {
                    ...result.body,
                    ...(isMapInitial && {
                        mapCompletedCount: 0,
                        mapTotalCount: result.body.total,
                        mapProgress: 0
                    })
                });
            });
            return;
        }
        
        // Ignore other map lifecycle events (spawned, no_slots, etc.) to prevent flickering
        if (isMapLifecycleEvent && !isMapComplete) {
            return;
        }
        
        // Handle map batch completion
        if (isMapComplete) {
            import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
                flowStore.updateNodeStatus(result.node_id, 'success', result.body);
            });
            return;
        }
        
        // Update node status in the UI
        // Note: For tracked runs (with run_id), the worker already calls the orchestrator
        // so we only need to update the UI here, not trigger downstream scheduling
        import('$lib/stores/flowStore.svelte').then(({ flowStore }) => {
            const status = isCancelled ? 'cancelled' : (isSuccess ? 'success' : 'error');
            flowStore.updateNodeStatus(result.node_id, status as any, result.body);
            
            // For isolated runs without run_id (test/preview mode), we still need to orchestrate from frontend
            if (!result.isolated && !isCancelled && !result.run_id) {
                handleExecutionResult(result.node_id, isSuccess, result.body, result.run_id);
            }
        });
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

