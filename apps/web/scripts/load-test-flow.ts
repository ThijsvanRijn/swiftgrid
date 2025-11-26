/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

// Router Test Flow - uses JSONPlaceholder (reliable) instead of httpbin
const testFlow = {
  nodes: [
    {
      id: 'http_trigger',
      type: 'http-request',
      data: {
        label: '1. Fetch Post',
        url: 'https://jsonplaceholder.typicode.com/posts/1',  // Always returns 200 with data
        method: 'GET',
        status: 'idle'
      },
      position: { x: 300, y: 50 }
    },
    {
      id: 'status_router',
      type: 'router',
      data: {
        label: '2. Route by User ID',
        routeBy: '{{http_trigger.userId}}',  // userId is directly in the result (not under body)
        conditions: [
          { id: 'user_1', label: 'User 1', expression: 'value === 1' },
          { id: 'user_2', label: 'User 2', expression: 'value === 2' },
          { id: 'other', label: 'Other User', expression: 'value > 2' }
        ],
        defaultOutput: 'unknown',
        routerMode: 'first_match',
        status: 'idle'
      },
      position: { x: 300, y: 200 }
    },
    {
      id: 'user1_handler',
      type: 'code-execution',
      data: { label: 'User 1 Handler', code: 'return { message: "This is User 1!", routed: true };', status: 'idle' },
      position: { x: 50, y: 400 }
    },
    {
      id: 'user2_handler',
      type: 'code-execution',
      data: { label: 'User 2 Handler', code: 'return { message: "This is User 2!", routed: true };', status: 'idle' },
      position: { x: 250, y: 400 }
    },
    {
      id: 'other_handler',
      type: 'code-execution',
      data: { label: 'Other User', code: 'return { message: "Some other user", routed: true };', status: 'idle' },
      position: { x: 450, y: 400 }
    },
    {
      id: 'unknown_handler',
      type: 'code-execution',
      data: { label: 'Unknown', code: 'return { message: "Unknown user", routed: true };', status: 'idle' },
      position: { x: 650, y: 400 }
    }
  ],
  edges: [
    { id: 'e1', source: 'http_trigger', target: 'status_router' },
    { id: 'e2', source: 'status_router', sourceHandle: 'user_1', target: 'user1_handler' },
    { id: 'e3', source: 'status_router', sourceHandle: 'user_2', target: 'user2_handler' },
    { id: 'e4', source: 'status_router', sourceHandle: 'other', target: 'other_handler' },
    { id: 'e5', source: 'status_router', sourceHandle: 'unknown', target: 'unknown_handler' }
  ],
  viewport: { x: 50, y: 50, zoom: 0.85 }
};

async function updateFlow() {
  const flowJson = JSON.stringify(testFlow);
  
  await sql`UPDATE workflows SET graph = ${flowJson}::jsonb WHERE id = (SELECT id FROM workflows ORDER BY updated_at DESC LIMIT 1)`;
  
  console.log('✅ Router test flow loaded! Refresh the browser to see it.');
  console.log('');
  console.log('Test scenarios:');
  console.log('  - /posts/1 returns userId=1 → User 1 Handler should run');
  console.log('  - Change to /posts/11 (userId=2) → User 2 Handler should run');
  console.log('  - Change to /posts/21 (userId=3) → Other User Handler should run');
  
  await sql.end();
}

updateFlow().catch(console.error);

