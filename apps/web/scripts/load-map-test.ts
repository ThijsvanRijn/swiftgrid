/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

// =============================================================================
// CHILD WORKFLOW: "Item Processor"
// A simple workflow that processes a single item
// =============================================================================

const childFlow = {
    nodes: [
        {
            id: 'code_process',
            type: 'code-execution',
            position: { x: 100, y: 100 },
            data: {
                label: 'Process Item',
                code: `// Access the item passed from the Map node
const item = INPUT.item;
const index = INPUT.index;

// Simulate some processing
const processed = {
    original: item,
    index: index,
    doubled: typeof item === 'number' ? item * 2 : null,
    uppercased: typeof item === 'string' ? item.toUpperCase() : null,
    processedAt: new Date().toISOString()
};

return processed;`,
                inputs: JSON.stringify({
                    item: '{{$trigger.item}}',
                    index: '{{$trigger.index}}'
                }),
                status: 'idle'
            }
        }
    ],
    edges: [],
    viewport: { x: 150, y: 50, zoom: 1 }
};

// =============================================================================
// PARENT WORKFLOW: "Batch Processor Demo"
// Uses Map node to process an array of items
// =============================================================================

const parentFlow = {
    nodes: [
        {
            id: 'code_generate',
            type: 'code-execution',
            position: { x: 100, y: 50 },
            data: {
                label: 'Generate Test Data',
                code: `// Generate a large array for testing
const count = 50; // Change this to test different sizes
const items = [];
for (let i = 0; i < count; i++) {
  items.push({
    id: i,
    value: \`item-\${i}\`,
    number: i * 10,
    text: \`Hello from item \${i}\`
  });
}
return { items, count };`,
                inputs: '{}',
                status: 'idle'
            }
        },
        {
            id: 'map_process',
            type: 'map',
            position: { x: 100, y: 200 },
            data: {
                label: 'Process Items',
                description: 'Process each item in parallel',
                mapWorkflowId: null as number | null, // Will be set after child is created
                mapVersionId: null as string | null,
                mapVersionNumber: null as number | null,
                mapWorkflowName: 'Item Processor',
                mapInputArray: '{{code_generate.items}}', // The generated array
                mapConcurrency: 10, // Higher concurrency for testing
                mapFailFast: false,
                status: 'idle'
            }
        },
        {
            id: 'code_summary',
            type: 'code-execution',
            position: { x: 100, y: 400 },
            data: {
                label: 'Summarize Results',
                code: `// Get the map results
const mapResult = INPUT.mapResult;

return {
    message: 'Batch processing completed!',
    totalProcessed: mapResult.stats?.total || 0,
    successCount: mapResult.stats?.completed || 0,
    failureCount: mapResult.stats?.failed || 0,
    firstResult: mapResult.results?.[0] || null,
    timestamp: new Date().toISOString()
};`,
                inputs: JSON.stringify({
                    mapResult: '{{map_process}}'
                }),
                status: 'idle'
            }
        }
    ],
    edges: [
        {
            id: 'edge_1',
            source: 'code_generate',
            target: 'map_process',
            type: 'default'
        },
        {
            id: 'edge_2',
            source: 'map_process',
            sourceHandle: 'success',
            target: 'code_summary',
            type: 'default'
        }
    ],
    viewport: { x: 150, y: 50, zoom: 1 }
};

async function main() {
    console.log('Creating Map test workflows...');
    
    // 1. Create the child workflow
    const [childWorkflow] = await sql`
        INSERT INTO workflows (name, graph)
        VALUES ('Item Processor', ${sql.json(childFlow)})
        RETURNING id
    `;
    console.log(`Created child workflow: ${childWorkflow.id}`);
    
    // 2. Create a version for the child workflow
    const [childVersion] = await sql`
        INSERT INTO workflow_versions (workflow_id, version_number, graph, change_summary)
        VALUES (${childWorkflow.id}, 1, ${sql.json(childFlow)}, 'Initial version')
        RETURNING id
    `;
    console.log(`Created child version: ${childVersion.id}`);
    
    // 3. Set the active version
    await sql`
        UPDATE workflows 
        SET active_version_id = ${childVersion.id}
        WHERE id = ${childWorkflow.id}
    `;
    
    // 4. Update parent flow with child workflow ID
    parentFlow.nodes[1].data.mapWorkflowId = childWorkflow.id;
    parentFlow.nodes[1].data.mapVersionId = childVersion.id;
    parentFlow.nodes[1].data.mapVersionNumber = 1;
    
    // 5. Create the parent workflow
    const [parentWorkflow] = await sql`
        INSERT INTO workflows (name, graph)
        VALUES ('Batch Processor Demo', ${sql.json(parentFlow)})
        RETURNING id
    `;
    console.log(`Created parent workflow: ${parentWorkflow.id}`);
    
    // 6. Create a version for the parent workflow
    const [parentVersion] = await sql`
        INSERT INTO workflow_versions (workflow_id, version_number, graph, change_summary)
        VALUES (${parentWorkflow.id}, 1, ${sql.json(parentFlow)}, 'Initial version')
        RETURNING id
    `;
    console.log(`Created parent version: ${parentVersion.id}`);
    
    // 7. Set the active version
    await sql`
        UPDATE workflows 
        SET active_version_id = ${parentVersion.id}
        WHERE id = ${parentWorkflow.id}
    `;
    
    console.log('\nTest workflows created successfully!');
    console.log(`Parent workflow ID: ${parentWorkflow.id}`);
    console.log(`Child workflow ID: ${childWorkflow.id}`);
    console.log('\nOpen the parent workflow in the UI and click "Run" to test the Map node.');
    
    await sql.end();
}

main().catch(console.error);

