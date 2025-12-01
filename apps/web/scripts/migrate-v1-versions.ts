/// <reference types="node" />
/**
 * Data Migration: Create v1 for existing workflows
 * 
 * This script ensures all existing workflows have at least one published version.
 * It takes the current `graph` from each workflow and creates a v1 snapshot.
 * 
 * Run with: npx tsx scripts/migrate-v1-versions.ts
 * 
 * Safe to run multiple times - only affects workflows without an active_version_id.
 */

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgres://dev:dev123@localhost:5432/swiftgrid');

interface Workflow {
  id: number;
  name: string;
  graph: unknown;
}

interface Version {
  id: string;
}

async function migrateExistingWorkflows() {
  console.log('Starting v1 migration for existing workflows...\n');

  // Find all workflows without an active version
  const workflowsWithoutVersion = await sql<Workflow[]>`
    SELECT id, name, graph 
    FROM workflows 
    WHERE active_version_id IS NULL
  `;

  if (workflowsWithoutVersion.length === 0) {
    console.log('All workflows already have a published version. Nothing to migrate.');
    return;
  }

  console.log(`Found ${workflowsWithoutVersion.length} workflow(s) without a published version:\n`);

  let migrated = 0;
  let failed = 0;

  for (const workflow of workflowsWithoutVersion) {
    try {
      console.log(`  Migrating: "${workflow.name}" (id: ${workflow.id})`);

      // Create v1 from current graph
      const [newVersion] = await sql<Version[]>`
        INSERT INTO workflow_versions (workflow_id, version_number, graph, change_summary, created_by)
        VALUES (${workflow.id}, 1, ${sql.json(workflow.graph)}, 'Initial version (auto-migrated)', 'system:migration')
        RETURNING id
      `;

      // Set as active version
      await sql`
        UPDATE workflows 
        SET active_version_id = ${newVersion.id}, updated_at = NOW()
        WHERE id = ${workflow.id}
      `;

      console.log(`     Created v1 (${newVersion.id})`);
      migrated++;
    } catch (error) {
      console.error(`     Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Migration complete: ${migrated} migrated, ${failed} failed`);
  
  if (failed > 0) {
    await sql.end();
    process.exit(1);
  }
}

// Run the migration
migrateExistingWorkflows()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await sql.end();
    process.exit(1);
  });
