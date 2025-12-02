/// <reference types="node" />
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

async function main() {
    // Check table structure
    const columns = await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'batch_results'
        ORDER BY ordinal_position
    `;
    console.log('batch_results columns:');
    console.table(columns);
    
    // Check constraints
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

