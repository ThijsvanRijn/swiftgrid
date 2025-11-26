import { json } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { db } from '$lib/server/db';
import { workflows } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/flows/[flowId]/webhook
 * 
 * Get webhook configuration for a workflow
 */
export async function GET({ params }) {
    const flowId = parseInt(params.flowId, 10);
    
    if (isNaN(flowId)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowId));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    return json({
        flowId,
        webhookEnabled: workflow.webhookEnabled,
        hasSecret: !!workflow.webhookSecret,
        // Don't expose the actual secret!
        endpoint: `/api/hooks/${flowId}`
    });
}

/**
 * POST /api/flows/[flowId]/webhook
 * 
 * Enable webhooks for a workflow (generates a new secret)
 */
export async function POST({ params }) {
    const flowId = parseInt(params.flowId, 10);
    
    if (isNaN(flowId)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowId));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    // Generate a secure random secret
    const secret = randomBytes(32).toString('hex');
    
    await db.update(workflows)
        .set({ 
            webhookEnabled: true,
            webhookSecret: secret,
            updatedAt: new Date()
        })
        .where(eq(workflows.id, flowId));
    
    console.log(`Webhook: Enabled for flow ${flowId}`);
    
    return json({
        success: true,
        flowId,
        webhookEnabled: true,
        // Return secret ONLY on creation (user must save it!)
        secret,
        endpoint: `/api/hooks/${flowId}`,
        message: 'Save this secret! It will not be shown again.'
    });
}

/**
 * DELETE /api/flows/[flowId]/webhook
 * 
 * Disable webhooks for a workflow
 */
export async function DELETE({ params }) {
    const flowId = parseInt(params.flowId, 10);
    
    if (isNaN(flowId)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowId));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    await db.update(workflows)
        .set({ 
            webhookEnabled: false,
            webhookSecret: null,
            updatedAt: new Date()
        })
        .where(eq(workflows.id, flowId));
    
    console.log(`Webhook: Disabled for flow ${flowId}`);
    
    return json({
        success: true,
        flowId,
        webhookEnabled: false,
        message: 'Webhooks disabled'
    });
}

/**
 * PATCH /api/flows/[flowId]/webhook
 * 
 * Regenerate webhook secret (keeps webhooks enabled)
 */
export async function PATCH({ params }) {
    const flowId = parseInt(params.flowId, 10);
    
    if (isNaN(flowId)) {
        return json({ error: 'Invalid flow ID' }, { status: 400 });
    }
    
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, flowId));
    
    if (!workflow) {
        return json({ error: 'Workflow not found' }, { status: 404 });
    }
    
    if (!workflow.webhookEnabled) {
        return json({ error: 'Webhooks are not enabled' }, { status: 400 });
    }
    
    // Generate a new secret
    const secret = randomBytes(32).toString('hex');
    
    await db.update(workflows)
        .set({ 
            webhookSecret: secret,
            updatedAt: new Date()
        })
        .where(eq(workflows.id, flowId));
    
    console.log(`Webhook: Regenerated secret for flow ${flowId}`);
    
    return json({
        success: true,
        flowId,
        secret,
        message: 'New secret generated. Save it! It will not be shown again.'
    });
}

