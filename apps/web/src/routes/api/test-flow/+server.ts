import { json } from '@sveltejs/kit';

/**
 * GET /api/test-flow
 * Returns a test flow configuration for Router node testing
 */
export async function GET() {
    // Router Test Flow:
    // 1. HTTP node fetches a URL that returns a status code
    // 2. Router evaluates the status and routes to:
    //    - Success branch (2xx) -> "Success Handler" code node
    //    - Error branch (4xx/5xx) -> "Error Handler" code node  
    //    - Default branch -> "Fallback Handler" code node

    const testFlow = {
        nodes: [
            {
                id: 'http_trigger',
                type: 'http-request',
                data: {
                    label: '1. Fetch API',
                    url: 'https://httpbin.org/status/200',  // Change to /status/404 or /status/500 to test other branches
                    method: 'GET',
                    status: 'idle'
                },
                position: { x: 300, y: 50 }
            },
            {
                id: 'status_router',
                type: 'router',
                data: {
                    label: '2. Route by Status',
                    routeBy: '{{http_trigger.body.status_code}}',  // httpbin returns status in body
                    conditions: [
                        { id: 'success', label: '2xx Success', expression: 'value >= 200 && value < 300' },
                        { id: 'client_error', label: '4xx Client Error', expression: 'value >= 400 && value < 500' },
                        { id: 'server_error', label: '5xx Server Error', expression: 'value >= 500' }
                    ],
                    defaultOutput: 'unknown',
                    routerMode: 'first_match',
                    status: 'idle'
                },
                position: { x: 300, y: 200 }
            },
            {
                id: 'success_handler',
                type: 'code-execution',
                data: {
                    label: '✓ Success Handler',
                    code: 'return { message: "Request succeeded!", status: "success" };',
                    status: 'idle'
                },
                position: { x: 50, y: 400 }
            },
            {
                id: 'client_error_handler',
                type: 'code-execution',
                data: {
                    label: '⚠ Client Error Handler',
                    code: 'return { message: "Client error (4xx)", status: "client_error" };',
                    status: 'idle'
                },
                position: { x: 250, y: 400 }
            },
            {
                id: 'server_error_handler',
                type: 'code-execution',
                data: {
                    label: '✗ Server Error Handler',
                    code: 'return { message: "Server error (5xx)", status: "server_error" };',
                    status: 'idle'
                },
                position: { x: 450, y: 400 }
            },
            {
                id: 'unknown_handler',
                type: 'code-execution',
                data: {
                    label: '? Unknown Handler',
                    code: 'return { message: "Unknown status", status: "unknown" };',
                    status: 'idle'
                },
                position: { x: 650, y: 400 }
            }
        ],
        edges: [
            // HTTP -> Router
            { id: 'e1', source: 'http_trigger', target: 'status_router' },
            // Router outputs -> Handlers (using sourceHandle to specify which output)
            { id: 'e2', source: 'status_router', sourceHandle: 'success', target: 'success_handler' },
            { id: 'e3', source: 'status_router', sourceHandle: 'client_error', target: 'client_error_handler' },
            { id: 'e4', source: 'status_router', sourceHandle: 'server_error', target: 'server_error_handler' },
            { id: 'e5', source: 'status_router', sourceHandle: 'unknown', target: 'unknown_handler' }
        ],
        viewport: { x: 50, y: 50, zoom: 0.9 }
    };

    return json(testFlow);
}

