/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

async function main() {
    console.log('Adding primary key to batch_results...');
    
    // First clean up any duplicate entries
    await sql`
        DELETE FROM batch_results a
        USING batch_results b
        WHERE a.ctid < b.ctid
        AND a.batch_id = b.batch_id
        AND a.item_index = b.item_index
    `;
    
    // Add the primary key constraint
    await sql`
        ALTER TABLE batch_results
        ADD CONSTRAINT batch_results_pkey PRIMARY KEY (batch_id, item_index)
    `;
    
    console.log('Primary key added successfully!');
    
    // Verify
    const constraints = await sql`
        SELECT conname, contype, pg_get_constraintdef(oid) as definition
        FROM pg_constraint
        WHERE conrelid = 'batch_results'::regclass
    `;
    console.log('\nbatch_results constraints:');
    console.table(constraints);
    
    await sql.end();
}

main().catch(console.error);

