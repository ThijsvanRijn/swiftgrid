import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { workflows } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

// GET: Fetch the latest saved workflow
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

        return json(allFlows[0]);
    } catch (e) {
        console.error("DB Load Error:", e);
        return json({ error: 'Failed to load' }, { status: 500 });
    }
}

// POST: Save the current state
export async function POST({ request }) {
    const body = await request.json();
    const { nodes, edges } = body;

    console.log("Saving flow with", nodes.length, "nodes");

    try {
        // For this milestone, we just create a new entry every time (History Mode)
        // Later we can implement "Update existing ID"
        const result = await db.insert(workflows).values({
            name: 'My SwiftGrid Flow', // Hardcoded name for now
            graph: { nodes, edges }    // Store the raw JSON
        }).returning();

        return json({ success: true, id: result[0].id });
    } catch (e) {
        console.error("DB Save Error:", e);
        return json({ error: 'Failed to save' }, { status: 500 });
    }
}