/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

async function cleanup() {
    const workflowIds = [829, 830, 831, 832];
    
    console.log('Cleaning up test workflows:', workflowIds);
    
    // Get run IDs for these workflows
    const runs = await sql`SELECT id FROM workflow_runs WHERE workflow_id = ANY(${workflowIds})`;
    
    if (runs.length > 0) {
        console.log(`Found ${runs.length} runs to delete`);
        
        for (const run of runs) {
            await sql`DELETE FROM run_stream_chunks WHERE run_id = ${run.id}`;
            await sql`DELETE FROM run_events WHERE run_id = ${run.id}`;
            await sql`DELETE FROM scheduled_jobs WHERE run_id = ${run.id}`;
            await sql`DELETE FROM suspensions WHERE run_id = ${run.id}`;
        }
        
        await sql`DELETE FROM workflow_runs WHERE workflow_id = ANY(${workflowIds})`;
    }
    
    // Delete versions and workflows
    await sql`DELETE FROM workflow_versions WHERE workflow_id = ANY(${workflowIds})`;
    await sql`DELETE FROM workflows WHERE id = ANY(${workflowIds})`;
    
    console.log('Cleanup complete!');
    await sql.end();
}

cleanup().catch(console.error);

