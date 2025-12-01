import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

// GET: Fetch all workflows with their versions (for sub-flow selection)
export async function GET() {
    try {
        // Get all workflows
        const allWorkflows = await db.select({
            id: workflows.id,
            name: workflows.name,
            activeVersionId: workflows.activeVersionId,
            createdAt: workflows.createdAt,
        })
            .from(workflows)
            .orderBy(desc(workflows.createdAt));

        // Get versions for each workflow
        const workflowsWithVersions = await Promise.all(
            allWorkflows.map(async (workflow) => {
                // Get all versions for this workflow
                const versions = await db.select({
                    id: workflowVersions.id,
                    versionNumber: workflowVersions.versionNumber,
                    changeSummary: workflowVersions.changeSummary,
                    createdAt: workflowVersions.createdAt,
                })
                    .from(workflowVersions)
                    .where(eq(workflowVersions.workflowId, workflow.id))
                    .orderBy(desc(workflowVersions.versionNumber));

                // Find active version number
                const activeVersion = versions.find(v => v.id === workflow.activeVersionId);

                return {
                    id: workflow.id,
                    name: workflow.name,
                    activeVersionId: workflow.activeVersionId,
                    activeVersionNumber: activeVersion?.versionNumber || null,
                    versions,
                };
            })
        );

        return json({ workflows: workflowsWithVersions });
    } catch (e) {
        console.error("Failed to load workflows:", e);
        return json({ error: 'Failed to load workflows' }, { status: 500 });
    }
}

