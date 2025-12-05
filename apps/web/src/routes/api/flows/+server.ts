import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

// GET: Fetch a workflow with version info
// - If ?workflowId=<id> is provided, load that workflow
// - Otherwise load the most recently updated workflow
export async function GET({ url }) {
    try {
        const workflowIdParam = url.searchParams.get('workflowId');
        const requestedId = workflowIdParam ? parseInt(workflowIdParam) : null;
        const isValidId = requestedId !== null && !Number.isNaN(requestedId);

        // Pick requested workflow or fallback to latest updated
        const baseQuery = db.select()
            .from(workflows)
            .orderBy(desc(workflows.updatedAt))
            .limit(1);

        const query = isValidId
            ? baseQuery.where(eq(workflows.id, requestedId))
            : baseQuery;

        const allFlows = await query;

        if (allFlows.length === 0) {
            return json({ graph: null });
        }

        const workflow = allFlows[0];
        
        // Get active version info if available
        let activeVersion = null;
        if (workflow.activeVersionId) {
            const [version] = await db.select({
                id: workflowVersions.id,
                versionNumber: workflowVersions.versionNumber,
                createdAt: workflowVersions.createdAt,
            })
                .from(workflowVersions)
                .where(eq(workflowVersions.id, workflow.activeVersionId))
                .limit(1);
            activeVersion = version || null;
        }

        return json({
            ...workflow,
            activeVersion,
        });
    } catch (e) {
        console.error("DB Load Error:", e);
        return json({ error: 'Failed to load' }, { status: 500 });
    }
}

// POST: Save the current state
export async function POST({ request }) {
    const body = await request.json();
    const { nodes, edges, viewport, workflowId } = body;

    console.log("Saving flow with", nodes.length, "nodes", workflowId ? `(updating ${workflowId})` : '(new)');

    try {
        // If we have an existing workflow ID, update it
        if (workflowId) {
            const [updated] = await db.update(workflows)
                .set({
                    graph: { nodes, edges, viewport },
                    updatedAt: new Date()
                })
                .where(eq(workflows.id, workflowId))
                .returning();
            
            if (updated) {
                return json({ success: true, id: updated.id });
            }
        }
        
        // Otherwise create a new workflow
        const result = await db.insert(workflows).values({
            name: 'My SwiftGrid Flow',
            graph: { nodes, edges, viewport }
        }).returning();

        return json({ success: true, id: result[0].id });
    } catch (e) {
        console.error("DB Save Error:", e);
        return json({ error: 'Failed to save' }, { status: 500 });
    }
}