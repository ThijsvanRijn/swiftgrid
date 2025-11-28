import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflows, workflowVersions } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';

// GET: Fetch the latest saved workflow with version info
export async function GET() {
    try {
        // Get the most recently created flow
        const allFlows = await db.select()
            .from(workflows)
            .orderBy(desc(workflows.createdAt))
            .limit(1);

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