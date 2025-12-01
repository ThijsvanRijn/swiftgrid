/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

// =============================================================================
// CHILD WORKFLOW: "Greeting Generator"
// A simple workflow that takes a name and returns a greeting
// =============================================================================

const childFlow = {
    nodes: [
        {
            id: 'code_greet',
            type: 'code-execution',
            position: { x: 100, y: 100 },
            data: {
                label: 'Generate Greeting',
                code: `// Access input data passed from parent
const name = INPUT.name || 'World';
const style = INPUT.style || 'formal';

let greeting;
if (style === 'casual') {
    greeting = 'Hey ' + name + '! What\\'s up?';
} else if (style === 'enthusiastic') {
    greeting = 'WOW! Hello ' + name.toUpperCase() + '!!! So great to see you!';
} else {
    greeting = 'Good day, ' + name + '. It is a pleasure to meet you.';
}

return {
    greeting: greeting,
    style: style,
    generatedAt: new Date().toISOString()
};`,
                inputs: JSON.stringify({
                    name: '{{$trigger.name}}',
                    style: '{{$trigger.style}}'
                }),
                status: 'idle'
            }
        }
    ],
    edges: [],
    viewport: { x: 150, y: 50, zoom: 1 }
};

// =============================================================================
// PARENT WORKFLOW: "Multi-Greeting Demo"
// Calls the child workflow multiple times with different inputs
// =============================================================================

// We'll set the subflowWorkflowId after creating the child workflow
const parentFlow = {
    nodes: [
        {
            id: 'http_start',
            type: 'http-request',
            position: { x: 100, y: 50 },
            data: {
                label: 'Fetch User',
                url: 'https://jsonplaceholder.typicode.com/users/1',
                method: 'GET',
                status: 'idle'
            }
        },
        {
            id: 'subflow_formal',
            type: 'subflow',
            position: { x: 100, y: 200 },
            data: {
                label: 'Formal Greeting',
                description: 'Generate formal greeting',
                subflowWorkflowId: null as string | null, // Will be set after child is created
                subflowVersionId: null as string | null,
                subflowVersionNumber: null as number | null,
                subflowName: 'Greeting Generator',
                subflowInput: JSON.stringify({
                    name: '{{http_start.name}}',
                    style: 'formal'
                }),
                subflowFailOnError: false,
                status: 'idle'
            }
        },
        {
            id: 'code_result',
            type: 'code-execution',
            position: { x: 100, y: 400 },
            data: {
                label: 'Format Final Result',
                code: `// Combine the user data with the greeting
const userName = INPUT.userName || 'Unknown';
const greeting = INPUT.greeting || 'No greeting';

return {
    message: 'SubFlow test completed!',
    userName: userName,
    generatedGreeting: greeting,
    timestamp: new Date().toISOString()
};`,
                inputs: JSON.stringify({
                    userName: '{{http_start.name}}',
                    greeting: '{{subflow_formal.output.greeting}}'
                }),
                status: 'idle'
            }
        }
    ],
    edges: [
        { id: 'e1', source: 'http_start', target: 'subflow_formal' },
        { id: 'e2', source: 'subflow_formal', sourceHandle: 'success', target: 'code_result' }
    ],
    viewport: { x: 150, y: 50, zoom: 1 }
};

async function loadSubFlowTest() {
    console.log('Setting up SubFlow test workflows...\n');

    // 1. Create the child workflow
    console.log('1. Creating child workflow "Greeting Generator"...');
    
    const [childWorkflow] = await sql`
        INSERT INTO workflows (name, graph)
        VALUES ('Greeting Generator', ${sql.json(childFlow)})
        RETURNING id, name
    `;
    
    console.log(`   Created workflow #${childWorkflow.id}: "${childWorkflow.name}"`);

    // 2. Publish the child workflow (so parent can reference it)
    console.log('2. Publishing child workflow...');
    
    const [childVersion] = await sql`
        INSERT INTO workflow_versions (workflow_id, version_number, graph, change_summary, created_by)
        VALUES (${childWorkflow.id}, 1, ${sql.json(childFlow)}, 'Initial version for subflow testing', 'system:test')
        RETURNING id, version_number
    `;
    
    await sql`
        UPDATE workflows 
        SET active_version_id = ${childVersion.id}
        WHERE id = ${childWorkflow.id}
    `;
    
    console.log(`   Published v${childVersion.version_number} (${childVersion.id})`);

    // 3. Update parent flow with child workflow ID
    console.log('3. Creating parent workflow "Multi-Greeting Demo"...');
    
    // Update the subflow node with the actual workflow ID
    parentFlow.nodes[1].data.subflowWorkflowId = childWorkflow.id;
    parentFlow.nodes[1].data.subflowVersionId = childVersion.id;
    parentFlow.nodes[1].data.subflowVersionNumber = childVersion.version_number;
    
    const [parentWorkflow] = await sql`
        INSERT INTO workflows (name, graph)
        VALUES ('Multi-Greeting Demo', ${sql.json(parentFlow)})
        RETURNING id, name
    `;
    
    console.log(`   Created workflow #${parentWorkflow.id}: "${parentWorkflow.name}"`);

    // 4. Also update the most recent workflow (for quick testing)
    console.log('4. Loading parent flow into current editor...');
    
    await sql`
        UPDATE workflows 
        SET graph = ${sql.json(parentFlow)},
            name = 'Multi-Greeting Demo',
            updated_at = NOW()
        WHERE id = (SELECT id FROM workflows ORDER BY updated_at DESC LIMIT 1)
    `;

    console.log('\n' + '='.repeat(60));
    console.log('SubFlow Test Setup Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Workflows created:');
    console.log(`  - Child: "Greeting Generator" (#${childWorkflow.id}, v1)`);
    console.log(`  - Parent: "Multi-Greeting Demo" (#${parentWorkflow.id})`);
    console.log('');
    console.log('Test flow structure:');
    console.log('  1. HTTP: Fetches user from JSONPlaceholder');
    console.log('  2. SubFlow: Calls "Greeting Generator" with user name');
    console.log('  3. Code: Formats the final result');
    console.log('');
    console.log('Expected behavior:');
    console.log('  - Parent starts, HTTP node fetches user (name: "Leanne Graham")');
    console.log('  - SubFlow node spawns child run, parent suspends');
    console.log('  - Child generates formal greeting, completes');
    console.log('  - Parent resumes with child output');
    console.log('  - Code node formats final result');
    console.log('');
    console.log('Refresh the browser and click "Run Flow" to test!');

    await sql.end();
}

loadSubFlowTest().catch(console.error);

