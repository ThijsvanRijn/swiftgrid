import type { ExecutionResult } from '$lib/types/worker';
import { handleExecutionResult } from './executionService';

// SSE connection state
let eventSource: EventSource | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

// Callbacks for UI feedback
type ConnectionCallback = (connected: boolean) => void;
let onConnectionChange: ConnectionCallback | null = null;

// Connects to the SSE stream with auto-reconnect
function connect() {
    if (eventSource) {
        eventSource.close();
    }

    console.log('SSE: Connecting...');
    eventSource = new EventSource('/api/stream');

    eventSource.onopen = () => {
        console.log('SSE: Connected');
        reconnectAttempts = 0;
        onConnectionChange?.(true);
    };

    eventSource.onmessage = (event) => {
        const result: ExecutionResult = JSON.parse(event.data);

        // Ignore heartbeat messages
        if ((result as any).type === 'heartbeat') {
            return;
        }

        const isSuccess = result.status_code >= 200 && result.status_code < 300;
        handleExecutionResult(result.node_id, isSuccess, result.body);
    };

    eventSource.onerror = () => {
        console.warn('SSE: Connection error');
        onConnectionChange?.(false);
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
        onConnectionChange?.(false);
    }
}

// Sets a callback for connection state changes
function setConnectionCallback(callback: ConnectionCallback | null) {
    onConnectionChange = callback;
}

// Checks if currently connected
function isConnected() {
    return eventSource?.readyState === EventSource.OPEN;
}

export const sseService = {
    connect,
    disconnect,
    setConnectionCallback,
    isConnected
};

